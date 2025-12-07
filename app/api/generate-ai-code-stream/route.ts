import { NextRequest, NextResponse } from 'next/server';
import { geminiFetch } from '../../../lib/gemini-fetch';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { streamText } from 'ai';
import type { SandboxState } from '@/types/sandbox';
import { selectFilesForEdit, getFileContents, formatFilesForAI } from '@/lib/context-selector';
import { executeSearchPlan, formatSearchResultsForAI, selectTargetFile } from '@/lib/file-search-executor';
import { FileManifest } from '@/types/file-manifest';
import type { ConversationState, ConversationMessage, ConversationEdit } from '@/types/conversation';
import { appConfig } from '@/config/app.config';
// 🆕 V2.0 结构化提示词引擎和多轮修复
import {
  generateStructuredSystemPrompt,
  enhanceUserPrompt,
  validateGeneratedCode,
  extractThinkingProcess
} from '@/lib/structured-prompt-engine';
import {
  extractFiles,
  validateDependencies,
  validateCompleteness,
  autoFix,
  assembleGeneratedCode,
  type ValidationIssue
} from '@/lib/multi-turn-fix-engine';

// Force dynamic route to enable streaming
export const dynamic = 'force-dynamic';

// Check if we're using Vercel AI Gateway
const isUsingAIGateway = !!process.env.AI_GATEWAY_API_KEY;
const aiGatewayBaseURL = 'https://ai-gateway.vercel.sh/v1';

console.log('[generate-ai-code-stream] AI Gateway config:', {
  isUsingAIGateway,
  hasGroqKey: !!process.env.GROQ_API_KEY,
  hasAIGatewayKey: !!process.env.AI_GATEWAY_API_KEY
});

const groq = createGroq({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GROQ_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});

const anthropic = createAnthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1'),
});

const googleGenerativeAI = createGoogleGenerativeAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GEMINI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});

// Gemini GCA Provider (Google Cloud AI - OpenAI Compatible)
// 使用 cs.imds.ai 或其他 OpenAI 兼容的 Gemini 代理服务
// 正确的 endpoint: https://cs.imds.ai/api/v1 (不是 /gemini)
const isUsingGeminiGCA = !!process.env.CODE_ASSIST_ENDPOINT && !!process.env.GOOGLE_CLOUD_ACCESS_TOKEN;

console.log('[DEBUG] Gemini GCA Setup:', {
  envEndpoint: process.env.CODE_ASSIST_ENDPOINT,
  hasToken: !!process.env.GOOGLE_CLOUD_ACCESS_TOKEN
});

const geminiGCAProvider = createOpenAICompatible({
  name: 'gemini-gca',
  apiKey: process.env.GOOGLE_CLOUD_ACCESS_TOKEN || '',
  baseURL: 'https://cs.imds.ai/api/v1',
  fetch: geminiFetch,
});

console.log('[generate-ai-code-stream] Gemini GCA config:', {
  isUsingGeminiGCA,
  endpoint: process.env.CODE_ASSIST_ENDPOINT ? 'configured' : 'not set',
});

// 七牛云AI / DashScope (阿里云通义千问) - 使用OpenAI Compatible Provider
// createOpenAI v2.x有bug，会错误地调用/responses端点
// createOpenAICompatible专门为非官方OpenAI API设计，正确调用/chat/completions端点
const qiniuProvider = createOpenAICompatible({
  name: 'qiniu',
  apiKey: process.env.OPENAI_API_KEY || '',
  baseURL: process.env.OPENAI_BASE_URL || 'https://api.qnaigc.com/v1',
});

// OpenAI provider 使用同一个七牛云provider
// 因为.env.local中配置的就是七牛云API，统一使用相同provider避免路由混乱
const openai = qiniuProvider;

// Helper function to analyze user preferences from conversation history
function analyzeUserPreferences(messages: ConversationMessage[]): {
  commonPatterns: string[];
  preferredEditStyle: 'targeted' | 'comprehensive';
} {
  const userMessages = messages.filter(m => m.role === 'user');
  const patterns: string[] = [];
  
  // Count edit-related keywords
  let targetedEditCount = 0;
  let comprehensiveEditCount = 0;
  
  userMessages.forEach(msg => {
    // ✅ 防御性编程：跳过没有content或content不是字符串的消息
    if (!msg.content || typeof msg.content !== 'string') return;

    const content = msg.content.toLowerCase();
    
    // Check for targeted edit patterns
    if (content.match(/\b(update|change|fix|modify|edit|remove|delete)\s+(\w+\s+)?(\w+)\b/)) {
      targetedEditCount++;
    }
    
    // Check for comprehensive edit patterns
    if (content.match(/\b(rebuild|recreate|redesign|overhaul|refactor)\b/)) {
      comprehensiveEditCount++;
    }
    
    // Extract common request patterns
    if (content.includes('hero')) patterns.push('hero section edits');
    if (content.includes('header')) patterns.push('header modifications');
    if (content.includes('color') || content.includes('style')) patterns.push('styling changes');
    if (content.includes('button')) patterns.push('button updates');
    if (content.includes('animation')) patterns.push('animation requests');
  });
  
  return {
    commonPatterns: [...new Set(patterns)].slice(0, 3), // Top 3 unique patterns
    preferredEditStyle: targetedEditCount > comprehensiveEditCount ? 'targeted' : 'comprehensive'
  };
}

declare global {
  var sandboxState: SandboxState;
  var conversationState: ConversationState | null;
}

export async function POST(request: NextRequest) {
  try {
    const { prompt, model = 'deepseek-v3', context, isEdit = false } = await request.json();
    
    console.log('[generate-ai-code-stream] Received request:');
    console.log('[generate-ai-code-stream] - prompt:', prompt);
    console.log('[generate-ai-code-stream] - isEdit:', isEdit);
    console.log('[generate-ai-code-stream] - context.sandboxId:', context?.sandboxId);
    console.log('[generate-ai-code-stream] - context.currentFiles:', context?.currentFiles ? Object.keys(context.currentFiles) : 'none');
    console.log('[generate-ai-code-stream] - currentFiles count:', context?.currentFiles ? Object.keys(context.currentFiles).length : 0);
    
    // Initialize conversation state if not exists
    if (!global.conversationState) {
      global.conversationState = {
        conversationId: `conv-${Date.now()}`,
        startedAt: Date.now(),
        lastUpdated: Date.now(),
        context: {
          messages: [],
          edits: [],
          projectEvolution: { majorChanges: [] },
          userPreferences: {}
        }
      };
    }
    
    // Add user message to conversation history
    const userMessage: ConversationMessage = {
      id: `msg-${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now(),
      metadata: {
        sandboxId: context?.sandboxId
      }
    };
    global.conversationState.context.messages.push(userMessage);
    
    // Clean up old messages to prevent unbounded growth
    if (global.conversationState.context.messages.length > 20) {
      // Keep only the last 15 messages
      global.conversationState.context.messages = global.conversationState.context.messages.slice(-15);
      console.log('[generate-ai-code-stream] Trimmed conversation history to prevent context overflow');
    }
    
    // Clean up old edits
    if (global.conversationState.context.edits.length > 10) {
      global.conversationState.context.edits = global.conversationState.context.edits.slice(-8);
    }
    
    // Debug: Show a sample of actual file content
    if (context?.currentFiles && Object.keys(context.currentFiles).length > 0) {
      const firstFile = Object.entries(context.currentFiles)[0];
      console.log('[generate-ai-code-stream] - sample file:', firstFile[0]);
      console.log('[generate-ai-code-stream] - sample content preview:', 
        typeof firstFile[1] === 'string' ? firstFile[1].substring(0, 100) + '...' : 'not a string');
    }
    
    if (!prompt) {
      return NextResponse.json({ 
        success: false, 
        error: 'Prompt is required' 
      }, { status: 400 });
    }
    
    // Create a stream for real-time updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Heartbeat Mechanism: Send a comment every 15 seconds to keep the connection alive
    // Heartbeat Mechanism: Send a comment every 15 seconds to keep the connection alive
    const heartbeatInterval = setInterval(async () => {
      try {
        // Send a keep-alive comment that won't affect the JSON parsing
        // SSE format: ": comment"
        await writer.write(encoder.encode(': keep-alive\n\n'));
      } catch (e) {
        console.error('[generate-ai-code-stream] Heartbeat failed:', e);
        clearInterval(heartbeatInterval);
      }
    }, 15000);

        const sendProgress = async (data: any) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      try {
        await writer.write(encoder.encode(message));
        // Force flush by writing a keep-alive comment
        if (data.type === 'stream' || data.type === 'conversation') {
          await writer.write(encoder.encode(': keepalive\n\n'));
        }
      } catch (error) {
        console.error('[generate-ai-code-stream] Error writing to stream:', error);
      }
    };
    
    // Start processing in background
    (async () => {
      try {
        // Send initial status
        await sendProgress({ type: 'status', message: 'Initializing AI...' });
        
        // No keep-alive needed - sandbox provisioned for 10 minutes
        
        // Check if we have a file manifest for edit mode
        let editContext = null;
        let enhancedSystemPrompt = '';
        
        if (isEdit) {
          console.log('[generate-ai-code-stream] Edit mode detected - starting agentic search workflow');
          console.log('[generate-ai-code-stream] Has fileCache:', !!global.sandboxState?.fileCache);
          console.log('[generate-ai-code-stream] Has manifest:', !!global.sandboxState?.fileCache?.manifest);
          
          const manifest: FileManifest | undefined = global.sandboxState?.fileCache?.manifest;
          
          if (manifest) {
            await sendProgress({ type: 'status', message: '🔍 Creating search plan...' });
            
            const fileContents = global.sandboxState.fileCache?.files || {};
            console.log('[generate-ai-code-stream] Files available for search:', Object.keys(fileContents).length);
            
            // STEP 1: Get search plan from AI
            try {
              const intentResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/analyze-edit-intent`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, manifest, model })
              });
              
              if (intentResponse.ok) {
                const { searchPlan } = await intentResponse.json();
                console.log('[generate-ai-code-stream] Search plan received:', searchPlan);
                
                await sendProgress({ 
                  type: 'status', 
                  message: `🔎 Searching for: "${searchPlan.searchTerms.join('", "')}"`
                });
                
                // STEP 2: Execute the search plan
                const searchExecution = executeSearchPlan(searchPlan, 
                  Object.fromEntries(
                    Object.entries(fileContents).map(([path, data]) => [
                      path.startsWith('/') ? path : `/home/user/app/${path}`,
                      data.content
                    ])
                  )
                );
                
                console.log('[generate-ai-code-stream] Search execution:', {
                  success: searchExecution.success,
                  resultsCount: searchExecution.results.length,
                  filesSearched: searchExecution.filesSearched,
                  time: searchExecution.executionTime + 'ms'
                });
                
                if (searchExecution.success && searchExecution.results.length > 0) {
                  // STEP 3: Select the best target file
                  const target = selectTargetFile(searchExecution.results, searchPlan.editType);
                  
                  if (target) {
                    await sendProgress({ 
                      type: 'status', 
                      message: `✅ Found code in ${target.filePath.split('/').pop()} at line ${target.lineNumber}`
                    });
                    
                    console.log('[generate-ai-code-stream] Target selected:', target);
                    
                    // Create surgical edit context with exact location
                    // normalizedPath would be: target.filePath.replace('/home/user/app/', '');
                    // fileContent available but not used in current implementation
                    // const fileContent = fileContents[normalizedPath]?.content || '';
                    
                    // Build enhanced context with search results
                    enhancedSystemPrompt = `
${formatSearchResultsForAI(searchExecution.results)}

SURGICAL EDIT INSTRUCTIONS:
You have been given the EXACT location of the code to edit.
- File: ${target.filePath}
- Line: ${target.lineNumber}
- Reason: ${target.reason}

Make ONLY the change requested by the user. Do not modify any other code.
User request: "${prompt}"`;
                    
                    // Set up edit context with just this one file
                    editContext = {
                      primaryFiles: [target.filePath],
                      contextFiles: [],
                      systemPrompt: enhancedSystemPrompt,
                      editIntent: {
                        type: searchPlan.editType,
                        description: searchPlan.reasoning,
                        targetFiles: [target.filePath],
                        confidence: 0.95, // High confidence since we found exact location
                        searchTerms: searchPlan.searchTerms
                      }
                    };
                    
                    console.log('[generate-ai-code-stream] Surgical edit context created');
                  }
                } else {
                  // Search failed - fall back to old behavior but inform user
                  console.warn('[generate-ai-code-stream] Search found no results, falling back to broader context');
                  await sendProgress({ 
                    type: 'status', 
                    message: '⚠️ Could not find exact match, using broader search...'
                  });
                }
              } else {
                console.error('[generate-ai-code-stream] Failed to get search plan');
              }
            } catch (error) {
              console.error('[generate-ai-code-stream] Error in agentic search workflow:', error);
              await sendProgress({ 
                type: 'status', 
                message: '⚠️ Search workflow error, falling back to keyword method...'
              });
              // Fall back to old method on any error if we have a manifest
              if (manifest) {
                editContext = selectFilesForEdit(prompt, manifest);
              }
            }
          } else {
            // Fall back to old method if AI analysis fails
            console.warn('[generate-ai-code-stream] AI intent analysis failed, falling back to keyword method');
            if (manifest) {
              editContext = selectFilesForEdit(prompt, manifest);
            } else {
              console.log('[generate-ai-code-stream] No manifest available for fallback');
              await sendProgress({ 
                type: 'status', 
                message: '⚠️ No file manifest available, will use broad context'
              });
            }
          }
          
          // If we got an edit context from any method, use its system prompt
          if (editContext) {
            enhancedSystemPrompt = editContext.systemPrompt;
            
            await sendProgress({ 
              type: 'status', 
              message: `Identified edit type: ${editContext.editIntent?.description || 'Code modification'}`
            });
          } else if (!manifest) {
            console.log('[generate-ai-code-stream] WARNING: No manifest available for edit mode!');
            
            // Try to fetch files from sandbox if we have one
            if (global.activeSandbox) {
              await sendProgress({ type: 'status', message: 'Fetching current files from sandbox...' });
              
              try {
                // Fetch files directly from sandbox
                const filesResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/get-sandbox-files`, {
                  method: 'GET',
                  headers: { 'Content-Type': 'application/json' }
                });
                
                if (filesResponse.ok) {
                  const filesData = await filesResponse.json();
                  
                  if (filesData.success && filesData.manifest) {
                    console.log('[generate-ai-code-stream] Successfully fetched manifest from sandbox');
                    const manifest = filesData.manifest;
                    
                    // Now try to analyze edit intent with the fetched manifest
                    try {
                      const intentResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/analyze-edit-intent`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ prompt, manifest, model })
                      });
                      
                      if (intentResponse.ok) {
                        const { searchPlan } = await intentResponse.json();
                        console.log('[generate-ai-code-stream] Search plan received (after fetch):', searchPlan);
                        
                        // For now, fall back to keyword search since we don't have file contents for search execution
                        // This path happens when no manifest was initially available
                        let targetFiles: any[] = [];
                        if (!searchPlan || searchPlan.searchTerms.length === 0) {
                          console.warn('[generate-ai-code-stream] No target files after fetch, searching for relevant files');
                          
                          const promptLower = prompt.toLowerCase();
                          const allFilePaths = Object.keys(manifest.files);
                          
                          // Look for component names mentioned in the prompt
                          if (promptLower.includes('hero')) {
                            targetFiles = allFilePaths.filter(p => p.toLowerCase().includes('hero'));
                          } else if (promptLower.includes('header')) {
                            targetFiles = allFilePaths.filter(p => p.toLowerCase().includes('header'));
                          } else if (promptLower.includes('footer')) {
                            targetFiles = allFilePaths.filter(p => p.toLowerCase().includes('footer'));
                          } else if (promptLower.includes('nav')) {
                            targetFiles = allFilePaths.filter(p => p.toLowerCase().includes('nav'));
                          } else if (promptLower.includes('button')) {
                            targetFiles = allFilePaths.filter(p => p.toLowerCase().includes('button'));
                          }
                          
                          if (targetFiles.length > 0) {
                            console.log('[generate-ai-code-stream] Found target files by keyword search after fetch:', targetFiles);
                          }
                        }
                        
                        const allFiles = Object.keys(manifest.files)
                          .filter(path => !targetFiles.includes(path));
                        
                        editContext = {
                          primaryFiles: targetFiles,
                          contextFiles: allFiles,
                          systemPrompt: `
You are an expert senior software engineer performing a surgical, context-aware code modification. Your primary directive is **precision and preservation**.

Think of yourself as a surgeon making a precise incision, not a construction worker demolishing a wall.

## Search-Based Edit
Search Terms: ${searchPlan?.searchTerms?.join(', ') || 'keyword-based'}
Edit Type: ${searchPlan?.editType || 'UPDATE_COMPONENT'}
Reasoning: ${searchPlan?.reasoning || 'Modifying based on user request'}

Files to Edit: ${targetFiles.join(', ') || 'To be determined'}
User Request: "${prompt}"

## Your Mandatory Thought Process (Execute Internally):
Before writing ANY code, you MUST follow these steps:

1. **Understand Intent:**
   - What is the user's core goal? (adding feature, fixing bug, changing style?)
   - Does the conversation history provide extra clues?

2. **Locate the Code:**
   - First examine the Primary Files provided
   - Check the "ALL PROJECT FILES" list to find the EXACT file name
   - "nav" might be Navigation.tsx, NavBar.tsx, Nav.tsx, or Header.tsx
   - DO NOT create a new file if a similar one exists!

3. **Plan the Changes (Mental Diff):**
   - What is the *minimal* set of changes required?
   - Which exact lines need to be added, modified, or deleted?
   - Will this require new packages?

4. **Verify Preservation:**
   - What existing code, props, state, and logic must NOT be touched?
   - How can I make my change without disrupting surrounding code?

5. **Construct the Final Code:**
   - Only after completing steps above, generate the final code
   - Provide the ENTIRE file content with modifications integrated

## Critical Rules & Constraints:

**PRESERVATION IS KEY:** You MUST NOT rewrite entire components or files. Integrate your changes into the existing code. Preserve all existing logic, props, state, and comments not directly related to the user's request.

**MINIMALISM:** Only output files you have actually changed. If a file doesn't need modification, don't include it.

**COMPLETENESS:** Each file must be COMPLETE from first line to last:
- NEVER TRUNCATE - Include EVERY line
- NO ellipsis (...) to skip content
- ALL imports, functions, JSX, and closing tags must be present
- The file MUST be runnable

**SURGICAL PRECISION:**
- Change ONLY what's explicitly requested
- If user says "change background to green", change ONLY the background class
- 99% of the original code should remain untouched
- NO refactoring, reformatting, or "improvements" unless requested

**NO CONVERSATION:** Your output must contain ONLY the code. No explanations or apologies.

## EXAMPLES:

### CORRECT APPROACH for "change hero background to blue":
<thinking>
I need to change the background color of the Hero component. Looking at the file, I see the main div has 'bg-gray-900'. I will change ONLY this to 'bg-blue-500' and leave everything else exactly as is.
</thinking>

Then return the EXACT same file with only 'bg-gray-900' changed to 'bg-blue-500'.

### WRONG APPROACH (DO NOT DO THIS):
- Rewriting the Hero component from scratch
- Changing the structure or reorganizing imports
- Adding or removing unrelated code
- Reformatting or "cleaning up" the code

Remember: You are a SURGEON making a precise incision, not an artist repainting the canvas!`,
                          editIntent: {
                            type: searchPlan?.editType || 'UPDATE_COMPONENT',
                            targetFiles: targetFiles,
                            confidence: searchPlan ? 0.85 : 0.6,
                            description: searchPlan?.reasoning || 'Keyword-based file selection',
                            suggestedContext: []
                          }
                        };
                        
                        enhancedSystemPrompt = editContext.systemPrompt;
                        
                        await sendProgress({ 
                          type: 'status', 
                          message: `Identified edit type: ${editContext.editIntent.description}`
                        });
                      }
                    } catch (error) {
                      console.error('[generate-ai-code-stream] Error analyzing intent after fetch:', error);
                    }
                  } else {
                    console.error('[generate-ai-code-stream] Failed to get manifest from sandbox files');
                  }
                } else {
                  console.error('[generate-ai-code-stream] Failed to fetch sandbox files:', filesResponse.status);
                }
              } catch (error) {
                console.error('[generate-ai-code-stream] Error fetching sandbox files:', error);
                await sendProgress({ 
                  type: 'warning', 
                  message: 'Could not analyze existing files for targeted edits. Proceeding with general edit mode.'
                });
              }
            } else {
              console.log('[generate-ai-code-stream] No active sandbox to fetch files from');
              await sendProgress({ 
                type: 'warning', 
                message: 'No existing files found. Consider generating initial code first.'
              });
            }
          }
        }
        
        // Build conversation context for system prompt
        let conversationContext = '';
        if (global.conversationState && global.conversationState.context.messages.length > 1) {
          console.log('[generate-ai-code-stream] Building conversation context');
          console.log('[generate-ai-code-stream] Total messages:', global.conversationState.context.messages.length);
          console.log('[generate-ai-code-stream] Total edits:', global.conversationState.context.edits.length);
          
          conversationContext = `\n\n## Conversation History (Recent)\n`;
          
          // Include only the last 3 edits to save context
          const recentEdits = global.conversationState.context.edits.slice(-3);
          if (recentEdits.length > 0) {
            console.log('[generate-ai-code-stream] Including', recentEdits.length, 'recent edits in context');
            conversationContext += `\n### Recent Edits:\n`;
            recentEdits.forEach(edit => {
              conversationContext += `- "${edit.userRequest}" → ${edit.editType} (${edit.targetFiles.map(f => f.split('/').pop()).join(', ')})\n`;
            });
          }
          
          // Include recently created files - CRITICAL for preventing duplicates
          const recentMsgs = global.conversationState.context.messages.slice(-5);
          const recentlyCreatedFiles: string[] = [];
          recentMsgs.forEach(msg => {
            if (msg.metadata?.editedFiles) {
              recentlyCreatedFiles.push(...msg.metadata.editedFiles);
            }
          });
          
          if (recentlyCreatedFiles.length > 0) {
            const uniqueFiles = [...new Set(recentlyCreatedFiles)];
            conversationContext += `\n### 🚨 RECENTLY CREATED/EDITED FILES (DO NOT RECREATE THESE):\n`;
            uniqueFiles.forEach(file => {
              conversationContext += `- ${file}\n`;
            });
            conversationContext += `\nIf the user mentions any of these components, UPDATE the existing file!\n`;
          }
          
          // Include only last 5 messages for context (reduced from 10)
          const recentMessages = recentMsgs;
          if (recentMessages.length > 2) { // More than just current message
            conversationContext += `\n### Recent Messages:\n`;
            recentMessages.slice(0, -1).forEach(msg => { // Exclude current message
              if (msg.role === 'user') {
                const truncatedContent = msg.content.length > 100 ? msg.content.substring(0, 100) + '...' : msg.content;
                conversationContext += `- "${truncatedContent}"\n`;
              }
            });
          }
          
          // Include only last 2 major changes
          const majorChanges = global.conversationState.context.projectEvolution.majorChanges.slice(-2);
          if (majorChanges.length > 0) {
            conversationContext += `\n### Recent Changes:\n`;
            majorChanges.forEach(change => {
              conversationContext += `- ${change.description}\n`;
            });
          }
          
          // Keep user preferences - they're concise
          const userPrefs = analyzeUserPreferences(global.conversationState.context.messages);
          if (userPrefs.commonPatterns.length > 0) {
            conversationContext += `\n### User Preferences:\n`;
            conversationContext += `- Edit style: ${userPrefs.preferredEditStyle}\n`;
          }
          
          // Limit total conversation context length
          if (conversationContext.length > 2000) {
            conversationContext = conversationContext.substring(0, 2000) + '\n[Context truncated to prevent length errors]';
          }
        }
        
        // 🆕 V2.0: 使用结构化提示词引擎
        // 构建提示词上下文
        const promptContext = {
          isEdit,
          currentFiles: editContext?.primaryFiles || [],
          editContext: editContext ? {
            primaryFiles: editContext.primaryFiles,
            editIntent: {
              type: editContext.editIntent?.type || 'MODIFY',
              description: editContext.editIntent?.description || '代码修改'
            }
          } : undefined,
          conversationSummary: conversationContext || undefined,
          morphEnabled: Boolean(isEdit && process.env.MORPH_API_KEY)
        };

        // 生成结构化系统提示词
        let systemPrompt = generateStructuredSystemPrompt(promptContext);

        // 添加对话上下文
        if (conversationContext) {
          systemPrompt += `\n\n## 对话历史\n${conversationContext}`;
        }

        console.log('[generate-ai-code-stream] V2.0 结构化提示词已启用');
        console.log('[generate-ai-code-stream] - isEdit:', isEdit);
        console.log('[generate-ai-code-stream] - morphEnabled:', promptContext.morphEnabled);
        console.log('[generate-ai-code-stream] - editContext:', editContext ? 'yes' : 'no');

        // 编辑模式时添加额外的精准编辑规则
        if (isEdit) {
          systemPrompt += `

## 编辑模式精准规则（补充）

### 文件修改限制
- 简单修改（颜色、文字）= 最多1个文件
- 添加新组件 = 最多2个文件（新组件 + 父组件）
- 超过3个文件 = 你做的太多了！

### 目标文件信息
${editContext ? `
- 编辑类型: ${editContext.editIntent?.type || 'MODIFY'}
- 置信度: ${editContext.editIntent?.confidence || 0.8}
- 目标文件: ${editContext.primaryFiles?.join(', ') || '待确定'}

🚨 重要：只生成上面列出的文件！
` : '已存在的文件在上下文中提供'}
`;
        }

        // 保留增量更新规则
        systemPrompt += `

CRITICAL INCREMENTAL UPDATE RULES:
- When the user asks for additions or modifications (like "add a videos page", "create a new component", "update the header"):
  - DO NOT regenerate the entire application
  - DO NOT recreate files that already exist unless explicitly asked
  - ONLY create/modify the specific files needed for the requested change
  - Preserve all existing functionality and files
  - If adding a new page/route, integrate it with the existing routing system
  - Reference existing components and styles rather than duplicating them
  - NEVER recreate config files (tailwind.config.js, vite.config.js, package.json, etc.)

IMPORTANT: When the user asks for edits or modifications:
- You have access to the current file contents in the context
- Make targeted changes to existing files rather than regenerating everything
- Preserve the existing structure and only modify what's requested
- If you need to see a specific file that's not in context, mention it

IMPORTANT: You have access to the full conversation context including:
- Previously scraped websites and their content
- Components already generated and applied
- The current project being worked on
- Recent conversation history
- Any Vite errors that need to be resolved

When the user references "the app", "the website", or "the site" without specifics, refer to:
1. The most recently scraped website in the context
2. The current project name in the context
3. The files currently in the sandbox

If you see scraped websites in the context, you're working on a clone/recreation of that site.

CRITICAL UI/UX RULES:
- NEVER use emojis in any code, text, console logs, or UI elements
- ALWAYS ensure responsive design using proper Tailwind classes (sm:, md:, lg:, xl:)
- ALWAYS use proper mobile-first responsive design patterns
- NEVER hardcode pixel widths - use relative units and responsive classes
- ALWAYS test that the layout works on mobile devices (320px and up)
- ALWAYS make sections full-width by default - avoid max-w-7xl or similar constraints
- For full-width layouts: use className="w-full" or no width constraint at all
- Only add max-width constraints when explicitly needed for readability (like blog posts)
- Prefer system fonts and clean typography
- Ensure all interactive elements have proper hover/focus states
- Use proper semantic HTML elements for accessibility

CRITICAL STYLING RULES - MUST FOLLOW:
- NEVER use inline styles with style={{ }} in JSX
- NEVER use <style jsx> tags or any CSS-in-JS solutions
- NEVER create App.css, Component.css, or any component-specific CSS files
- NEVER import './App.css' or any CSS files except index.css
- ALWAYS use Tailwind CSS classes for ALL styling
- ONLY create src/index.css with the @tailwind directives
- The ONLY CSS file should be src/index.css with:
  @tailwind base;
  @tailwind components;
  @tailwind utilities;
- Use Tailwind's full utility set: spacing, colors, typography, flexbox, grid, animations, etc.
- ALWAYS add smooth transitions and animations where appropriate:
  - Use transition-all, transition-colors, transition-opacity for hover states
  - Use animate-fade-in, animate-pulse, animate-bounce for engaging UI elements
  - Add hover:scale-105 or hover:scale-110 for interactive elements
  - Use transform and transition utilities for smooth interactions
- For complex layouts, combine Tailwind utilities rather than writing custom CSS
- NEVER use non-standard Tailwind classes like "border-border", "bg-background", "text-foreground", etc.
- Use standard Tailwind classes only:
  - For borders: use "border-gray-200", "border-gray-300", etc. NOT "border-border"
  - For backgrounds: use "bg-white", "bg-gray-100", etc. NOT "bg-background"
  - For text: use "text-gray-900", "text-black", etc. NOT "text-foreground"
- Examples of good Tailwind usage:
  - Buttons: className="px-4 py-2 bg-blue-600 text-white rounded-lg shadow-md hover:bg-blue-700 hover:shadow-lg transform hover:scale-105 transition-all duration-200"
  - Cards: className="bg-white rounded-lg shadow-md p-6 border border-gray-200 hover:shadow-xl transition-shadow duration-300"
  - Full-width sections: className="w-full px-4 sm:px-6 lg:px-8"
  - Constrained content (only when needed): className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"
  - Dark backgrounds: className="min-h-screen bg-gray-900 text-white"
  - Hero sections: className="animate-fade-in-up"
  - Feature cards: className="transform hover:scale-105 transition-transform duration-300"
  - CTAs: className="animate-pulse hover:animate-none"

CRITICAL STRING AND SYNTAX RULES:
- ALWAYS escape apostrophes in strings: use \' instead of ' or use double quotes
- ALWAYS escape quotes properly in JSX attributes
- NEVER use curly quotes or smart quotes ('' "" '' "") - only straight quotes (' ")
- ALWAYS convert smart/curly quotes to straight quotes:
  - ' and ' → '
  - " and " → "
  - Any other Unicode quotes → straight quotes
- When strings contain apostrophes, either:
  1. Use double quotes: "you're" instead of 'you're'
  2. Escape the apostrophe: 'you\'re'
- When working with scraped content, ALWAYS sanitize quotes first
- Replace all smart quotes with straight quotes before using in code
- Be extra careful with user-generated content or scraped text
- Always validate that JSX syntax is correct before generating

CRITICAL CODE SNIPPET DISPLAY RULES:
- When displaying code examples in JSX, NEVER put raw curly braces { } in text
- ALWAYS wrap code snippets in template literals with backticks
- For code examples in components, use one of these patterns:
  1. Template literals: <div>{\`const example = { key: 'value' }\`}</div>
  2. Pre/code blocks: <pre><code>{\`your code here\`}</code></pre>
  3. Escape braces: <div>{'{'}key: value{'}'}</div>
- NEVER do this: <div>const example = { key: 'value' }</div> (causes parse errors)
- For multi-line code snippets, always use:
  <pre className="bg-gray-900 text-gray-100 p-4 rounded">
    <code>{\`
      // Your code here
      const example = {
        key: 'value'
      }
    \`}</code>
  </pre>

CRITICAL: When asked to create a React app or components:
- ALWAYS CREATE ALL FILES IN FULL - never provide partial implementations
- ALWAYS CREATE EVERY COMPONENT that you import - no placeholders
- ALWAYS IMPLEMENT COMPLETE FUNCTIONALITY - don't leave TODOs unless explicitly asked
- If you're recreating a website, implement ALL sections and features completely
- NEVER create tailwind.config.js - it's already configured in the template
- ALWAYS include a Navigation/Header component (Nav.jsx or Header.jsx) - websites need navigation!

REQUIRED COMPONENTS for website clones:
1. Nav.jsx or Header.jsx - Navigation bar with links (NEVER SKIP THIS!)
2. Hero.jsx - Main landing section
3. Features/Services/Products sections - Based on the site content
4. Footer.jsx - Footer with links and info
5. App.jsx - Main component that imports and arranges all components
- NEVER create vite.config.js - it's already configured in the template
- NEVER create package.json - it's already configured in the template

WHEN WORKING WITH SCRAPED CONTENT:
- ALWAYS sanitize all text content before using in code
- Convert ALL smart quotes to straight quotes
- Example transformations:
  - "Firecrawl's API" → "Firecrawl's API" or "Firecrawl\\'s API"
  - 'It's amazing' → "It's amazing" or 'It\\'s amazing'
  - "Best tool ever" → "Best tool ever"
- When in doubt, use double quotes for strings containing apostrophes
- For testimonials or quotes from scraped content, ALWAYS clean the text:
  - Bad: content: 'Moved our internal agent's web scraping...'
  - Good: content: "Moved our internal agent's web scraping..."
  - Also good: content: 'Moved our internal agent\\'s web scraping...'

When generating code, FOLLOW THIS PROCESS:
1. ALWAYS generate src/index.css FIRST - this establishes the styling foundation
2. List ALL components you plan to import in App.jsx
3. Count them - if there are 10 imports, you MUST create 10 component files
4. Generate src/index.css first (with proper CSS reset and base styles)
5. Generate App.jsx second
6. Then generate EVERY SINGLE component file you imported
7. Do NOT stop until all imports are satisfied

Use this XML format for React components only (DO NOT create tailwind.config.js - it already exists):

<file path="src/index.css">
@tailwind base;
@tailwind components;
@tailwind utilities;
</file>

<file path="src/App.jsx">
// Main App component that imports and uses other components
// Use Tailwind classes: className="min-h-screen bg-gray-50"
</file>

<file path="src/components/Example.jsx">
// Your React component code here
// Use Tailwind classes for ALL styling
</file>

CRITICAL COMPLETION RULES:
1. NEVER say "I'll continue with the remaining components"
2. NEVER say "Would you like me to proceed?"
3. NEVER use <continue> tags
4. Generate ALL components in ONE response
5. If App.jsx imports 10 components, generate ALL 10
6. Complete EVERYTHING before ending your response

With 16,000 tokens available, you have plenty of space to generate a complete application. Use it!

UNDERSTANDING USER INTENT FOR INCREMENTAL VS FULL GENERATION:
- "add/create/make a [specific feature]" → Add ONLY that feature to existing app
- "add a videos page" → Create ONLY Videos.jsx and update routing
- "update the header" → Modify ONLY header component
- "fix the styling" → Update ONLY the affected components
- "change X to Y" → Find the file containing X and modify it
- "make the header black" → Find Header component and change its color
- "rebuild/recreate/start over" → Full regeneration
- Default to incremental updates when working on an existing app

SURGICAL EDIT RULES (CRITICAL FOR PERFORMANCE):
- **PREFER TARGETED CHANGES**: Don't regenerate entire components for small edits
- For color/style changes: Edit ONLY the specific className or style prop
- For text changes: Change ONLY the text content, keep everything else
- For adding elements: INSERT into existing JSX, don't rewrite the whole return
- **PRESERVE EXISTING CODE**: Keep all imports, functions, and unrelated code exactly as-is
- Maximum files to edit:
  - Style change = 1 file ONLY
  - Text change = 1 file ONLY
  - New feature = 2 files MAX (feature + parent)
- If you're editing >3 files for a simple request, STOP - you're doing too much

EXAMPLES OF CORRECT SURGICAL EDITS:
✅ "change header to black" → Find className="..." in Header.jsx, change ONLY color classes
✅ "update hero text" → Find the <h1> or <p> in Hero.jsx, change ONLY the text inside
✅ "add a button to hero" → Find the return statement, ADD button, keep everything else
❌ WRONG: Regenerating entire Header.jsx to change one color
❌ WRONG: Rewriting Hero.jsx to add one button

NAVIGATION/HEADER INTELLIGENCE:
- ALWAYS check App.jsx imports first
- Navigation is usually INSIDE Header.jsx, not separate
- If user says "nav", check Header.jsx FIRST
- Only create Nav.jsx if no navigation exists anywhere
- Logo, menu, hamburger = all typically in Header

CRITICAL: When files are provided in the context:
1. The user is asking you to MODIFY the existing app, not create a new one
2. Find the relevant file(s) from the provided context
3. Generate ONLY the files that need changes
4. Do NOT ask to see files - they are already provided in the context above
5. Make the requested change immediately`;

        // If Morph Fast Apply is enabled (edit mode + MORPH_API_KEY), force <edit> block output
        const morphFastApplyEnabled = Boolean(isEdit && process.env.MORPH_API_KEY);
        if (morphFastApplyEnabled) {
          systemPrompt += `

MORPH FAST APPLY MODE (EDIT-ONLY):
- Output edits as <edit> blocks, not full <file> blocks, for files that already exist.
- Format for each edit:
  <edit target_file="src/components/Header.jsx">
    <instructions>Describe the minimal change, single sentence.</instructions>
    <update>Provide the SMALLEST code snippet necessary to perform the change.</update>
  </edit>
- Only use <file> blocks when you must CREATE a brand-new file.
- Prefer ONE edit block for a simple change; multiple edits only if absolutely needed for separate files.
- Keep updates minimal and precise; do not rewrite entire files.
`;
        }

        // Build full prompt with context
        let fullPrompt = prompt;
        if (context) {
          const contextParts = [];
          
          if (context.sandboxId) {
            contextParts.push(`Current sandbox ID: ${context.sandboxId}`);
          }
          
          if (context.structure) {
            contextParts.push(`Current file structure:\n${context.structure}`);
          }
          
          // Use backend file cache instead of frontend-provided files
          let backendFiles = global.sandboxState?.fileCache?.files || {};
          let hasBackendFiles = Object.keys(backendFiles).length > 0;
          
          console.log('[generate-ai-code-stream] Backend file cache status:');
          console.log('[generate-ai-code-stream] - Has sandboxState:', !!global.sandboxState);
          console.log('[generate-ai-code-stream] - Has fileCache:', !!global.sandboxState?.fileCache);
          console.log('[generate-ai-code-stream] - File count:', Object.keys(backendFiles).length);
          console.log('[generate-ai-code-stream] - Has manifest:', !!global.sandboxState?.fileCache?.manifest);
          
          // If no backend files and we're in edit mode, try to fetch from sandbox
          if (!hasBackendFiles && isEdit && (global.activeSandbox || context?.sandboxId)) {
            console.log('[generate-ai-code-stream] No backend files, attempting to fetch from sandbox...');
            
            try {
              const filesResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/get-sandbox-files`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
              });
              
              if (filesResponse.ok) {
                const filesData = await filesResponse.json();
                if (filesData.success && filesData.files) {
                  console.log('[generate-ai-code-stream] Successfully fetched', Object.keys(filesData.files).length, 'files from sandbox');
                  
                  // Initialize sandboxState if needed
                  if (!global.sandboxState) {
                    global.sandboxState = {
                      fileCache: {
                        files: {},
                        lastSync: Date.now(),
                        sandboxId: context?.sandboxId || 'unknown'
                      }
                    } as any;
                  } else if (!global.sandboxState.fileCache) {
                    global.sandboxState.fileCache = {
                      files: {},
                      lastSync: Date.now(),
                      sandboxId: context?.sandboxId || 'unknown'
                    };
                  }
                  
                  // Store files in cache
                  for (const [path, content] of Object.entries(filesData.files)) {
                    const normalizedPath = path.replace('/home/user/app/', '');
                    if (global.sandboxState.fileCache) {
                      global.sandboxState.fileCache.files[normalizedPath] = {
                        content: content as string,
                        lastModified: Date.now()
                      };
                    }
                  }
                  
                  if (filesData.manifest && global.sandboxState.fileCache) {
                    global.sandboxState.fileCache.manifest = filesData.manifest;
                    
                    // Now try to analyze edit intent with the fetched manifest
                    if (!editContext) {
                      console.log('[generate-ai-code-stream] Analyzing edit intent with fetched manifest');
                      try {
                        const intentResponse = await fetch(`${process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'}/api/analyze-edit-intent`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ prompt, manifest: filesData.manifest, model })
                        });
                        
                        if (intentResponse.ok) {
                          const { searchPlan } = await intentResponse.json();
                          console.log('[generate-ai-code-stream] Search plan received:', searchPlan);
                          
                          // Create edit context from AI analysis
                          // Note: We can't execute search here without file contents, so fall back to keyword method
                          const fileContext = selectFilesForEdit(prompt, filesData.manifest);
                          editContext = fileContext;
                          enhancedSystemPrompt = fileContext.systemPrompt;
                          
                          console.log('[generate-ai-code-stream] Edit context created with', editContext.primaryFiles.length, 'primary files');
                        }
                      } catch (error) {
                        console.error('[generate-ai-code-stream] Failed to analyze edit intent:', error);
                      }
                    }
                  }
                  
                  // Update variables
                  backendFiles = global.sandboxState.fileCache?.files || {};
                  hasBackendFiles = Object.keys(backendFiles).length > 0;
                  console.log('[generate-ai-code-stream] Updated backend cache with fetched files');
                }
              }
            } catch (error) {
              console.error('[generate-ai-code-stream] Failed to fetch sandbox files:', error);
            }
          }
          
          // Include current file contents from backend cache
          if (hasBackendFiles) {
            // If we have edit context, use intelligent file selection
            if (editContext && editContext.primaryFiles.length > 0) {
              contextParts.push('\nEXISTING APPLICATION - TARGETED EDIT MODE');
              contextParts.push(`\n${editContext.systemPrompt || enhancedSystemPrompt}\n`);
              
              // Get contents of primary and context files
              const primaryFileContents = await getFileContents(editContext.primaryFiles, global.sandboxState!.fileCache!.manifest!);
              const contextFileContents = await getFileContents(editContext.contextFiles, global.sandboxState!.fileCache!.manifest!);
              
              // Format files for AI
              const formattedFiles = formatFilesForAI(primaryFileContents, contextFileContents);
              contextParts.push(formattedFiles);
              
              contextParts.push('\nIMPORTANT: Only modify the files listed under "Files to Edit". The context files are provided for reference only.');
            } else {
              // Fallback to showing all files if no edit context
              console.log('[generate-ai-code-stream] WARNING: Using fallback mode - no edit context available');
              contextParts.push('\nEXISTING APPLICATION - TARGETED EDIT REQUIRED');
              contextParts.push('\nYou MUST analyze the user request and determine which specific file(s) to edit.');
              contextParts.push('\nCurrent project files (DO NOT regenerate all of these):');
              
              const fileEntries = Object.entries(backendFiles);
              console.log(`[generate-ai-code-stream] Using backend cache: ${fileEntries.length} files`);
              
              // Show file list first for reference
              contextParts.push('\n### File List:');
              for (const [path] of fileEntries) {
                contextParts.push(`- ${path}`);
              }
              
              // Include ALL files as context in fallback mode
              contextParts.push('\n### File Contents (ALL FILES FOR CONTEXT):');
              for (const [path, fileData] of fileEntries) {
                const content = fileData.content;
                if (typeof content === 'string') {
                  contextParts.push(`\n<file path="${path}">\n${content}\n</file>`);
                }
              }
              
              contextParts.push('\n🚨 CRITICAL INSTRUCTIONS - VIOLATION = FAILURE 🚨');
              contextParts.push('1. Analyze the user request: "' + prompt + '"');
              contextParts.push('2. Identify the MINIMUM number of files that need editing (usually just ONE)');
              contextParts.push('3. PRESERVE ALL EXISTING CONTENT in those files');
              contextParts.push('4. ONLY ADD/MODIFY the specific part requested');
              contextParts.push('5. DO NOT regenerate entire components from scratch');
              contextParts.push('6. DO NOT change unrelated parts of any file');
              contextParts.push('7. Generate ONLY the files that MUST be changed - NO EXTRAS');
              contextParts.push('\n⚠️ FILE COUNT RULE:');
              contextParts.push('- Simple change (color, text, spacing) = 1 file ONLY');
              contextParts.push('- Adding new component = 2 files MAX (new component + parent that imports it)');
              contextParts.push('- DO NOT exceed these limits unless absolutely necessary');
              contextParts.push('\nEXAMPLES OF CORRECT BEHAVIOR:');
              contextParts.push('✅ "add a chart to the hero" → Edit ONLY Hero.jsx, ADD the chart, KEEP everything else');
              contextParts.push('✅ "change header to black" → Edit ONLY Header.jsx, change ONLY the color');
              contextParts.push('✅ "fix spacing in footer" → Edit ONLY Footer.jsx, adjust ONLY spacing');
              contextParts.push('\nEXAMPLES OF FAILURES:');
              contextParts.push('❌ "change header color" → You edit Header, Footer, and App "for consistency"');
              contextParts.push('❌ "add chart to hero" → You regenerate the entire Hero component');
              contextParts.push('❌ "fix button" → You update 5 different component files');
              contextParts.push('\n⚠️ FINAL WARNING:');
              contextParts.push('If you generate MORE files than necessary, you have FAILED');
              contextParts.push('If you DELETE or REWRITE existing functionality, you have FAILED');
              contextParts.push('ONLY change what was EXPLICITLY requested - NOTHING MORE');
            }
          } else if (context.currentFiles && Object.keys(context.currentFiles).length > 0) {
            // Fallback to frontend-provided files if backend cache is empty
            console.log('[generate-ai-code-stream] Warning: Backend cache empty, using frontend files');
            contextParts.push('\nEXISTING APPLICATION - DO NOT REGENERATE FROM SCRATCH');
            contextParts.push('Current project files (modify these, do not recreate):');
            
            const fileEntries = Object.entries(context.currentFiles);
            for (const [path, content] of fileEntries) {
              if (typeof content === 'string') {
                contextParts.push(`\n<file path="${path}">\n${content}\n</file>`);
              }
            }
            contextParts.push('\nThe above files already exist. When the user asks to modify something (like "change the header color to black"), find the relevant file above and generate ONLY that file with the requested changes.');
          }
          
          // Add explicit edit mode indicator
          if (isEdit) {
            contextParts.push('\nEDIT MODE ACTIVE');
            contextParts.push('This is an incremental update to an existing application.');
            contextParts.push('DO NOT regenerate App.jsx, index.css, or other core files unless explicitly requested.');
            contextParts.push('ONLY create or modify the specific files needed for the user\'s request.');
            contextParts.push('\n⚠️ CRITICAL FILE OUTPUT FORMAT - VIOLATION = FAILURE:');
            contextParts.push('YOU MUST OUTPUT EVERY FILE IN THIS EXACT XML FORMAT:');
            contextParts.push('<file path="src/components/ComponentName.jsx">');
            contextParts.push('// Complete file content here');
            contextParts.push('</file>');
            contextParts.push('<file path="src/index.css">');
            contextParts.push('/* CSS content here */');
            contextParts.push('</file>');
            contextParts.push('\n❌ NEVER OUTPUT: "Generated Files: index.css, App.jsx"');
            contextParts.push('❌ NEVER LIST FILE NAMES WITHOUT CONTENT');
            contextParts.push('✅ ALWAYS: One <file> tag per file with COMPLETE content');
            contextParts.push('✅ ALWAYS: Include EVERY file you modified');
          } else if (!hasBackendFiles) {
            // First generation mode - make it beautiful!
            contextParts.push('\n🎨 FIRST GENERATION MODE - CREATE SOMETHING BEAUTIFUL!');
            contextParts.push('\nThis is the user\'s FIRST experience. Make it impressive:');
            contextParts.push('1. **USE TAILWIND PROPERLY** - Use standard Tailwind color classes');
            contextParts.push('2. **NO PLACEHOLDERS** - Use real content, not lorem ipsum');
            contextParts.push('3. **COMPLETE COMPONENTS** - Header, Hero, Features, Footer minimum');
            contextParts.push('4. **VISUAL POLISH** - Shadows, hover states, transitions');
            contextParts.push('5. **STANDARD CLASSES** - bg-white, text-gray-900, bg-blue-500, NOT bg-background');
            contextParts.push('\nCreate a polished, professional application that works perfectly on first load.');
            contextParts.push('\n⚠️ OUTPUT FORMAT:');
            contextParts.push('Use <file path="...">content</file> tags for EVERY file');
            contextParts.push('NEVER output "Generated Files:" as plain text');
          }
          
          // Add conversation context (scraped websites, etc)
          if (context.conversationContext) {
            if (context.conversationContext.scrapedWebsites?.length > 0) {
              contextParts.push('\nScraped Websites in Context:');
              context.conversationContext.scrapedWebsites.forEach((site: any) => {
                contextParts.push(`\nURL: ${site.url}`);
                contextParts.push(`Scraped: ${new Date(site.timestamp).toLocaleString()}`);
                if (site.content) {
                  // Include a summary of the scraped content
                  const contentPreview = typeof site.content === 'string' 
                    ? site.content.substring(0, 1000) 
                    : JSON.stringify(site.content).substring(0, 1000);
                  contextParts.push(`Content Preview: ${contentPreview}...`);
                }
              });
            }
            
            if (context.conversationContext.currentProject) {
              contextParts.push(`\nCurrent Project: ${context.conversationContext.currentProject}`);
            }
          }
          
          if (contextParts.length > 0) {
            if (morphFastApplyEnabled) {
              contextParts.push('\nOUTPUT FORMAT (REQUIRED IN MORPH MODE):');
              contextParts.push('<edit target_file="src/components/Component.jsx">');
              contextParts.push('<instructions>Minimal, precise instruction.</instructions>');
              contextParts.push('<update>// Smallest necessary snippet</update>');
              contextParts.push('</edit>');
              contextParts.push('\nIf you need to create a NEW file, then and only then output a full file:');
              contextParts.push('<file path="src/components/NewComponent.jsx">');
              contextParts.push('// Full file content when creating new files');
              contextParts.push('</file>');
            }
            fullPrompt = `CONTEXT:\n${contextParts.join('\n')}\n\nUSER REQUEST:\n${prompt}`;
          }
        }
        
        await sendProgress({ type: 'status', message: 'Planning application structure...' });
        
        console.log('\n[generate-ai-code-stream] Starting streaming response...\n');
        
        // Track packages that need to be installed
        const packagesToInstall: string[] = [];
        
        // Determine which provider to use based on model
        const isAnthropic = model.startsWith('anthropic/');
        const isGoogle = model.startsWith('google/');
        const isOpenAI = model.startsWith('openai/');
        const isKimiGroq = model.startsWith('kimi-');

        // Gemini GCA 模型识别：gemini- 开头且配置了 GCA 环境变量
        // 支持模型如：gemini-3-pro-preview, gemini-2.0-flash-exp 等
        const isGeminiGCA = model.startsWith('gemini-') && isUsingGeminiGCA;

        // 中文模型识别：通义千问、DeepSeek、智谱 GLM、Kimi、Moonshot、gpt-oss-20b
        // 注意：gpt-oss-20b 是七牛云的开源模型，必须使用七牛云provider
        const isChineseModel = /^(qwen|deepseek|glm-|qwq-|kimi-|moonshotai\/|gpt-oss)/.test(model);

        // 模型提供商路由优先级：
        // 1. Anthropic (Claude) - anthropic/ 前缀
        // 2. Gemini GCA (cs.imds.ai) - gemini- 前缀且配置了 GCA 环境变量
        // 3. 中文模型 (七牛云) - qwen/deepseek/glm 等
        // 4. OpenAI (GPT) - openai/ 前缀
        // 5. Google (原生 Gemini) - google/ 前缀
        // 6. 默认使用七牛云 provider
        const modelProvider = isAnthropic ? anthropic :
                              (isGeminiGCA ? geminiGCAProvider :
                              (isChineseModel ? qiniuProvider :
                              (isOpenAI ? openai :
                              (isGoogle ? googleGenerativeAI : qiniuProvider))));

        // Fix model name transformation for different providers
        let actualModel: string;
        if (isAnthropic) {
          actualModel = model.replace('anthropic/', '');
        } else if (isGeminiGCA) {
          // Gemini GCA 使用完整模型名，如 gemini-3-pro-preview
          actualModel = model;
        } else if (isOpenAI) {
          actualModel = model.replace('openai/', '');
        } else if (isGoogle) {
          // Google uses specific model names - convert our naming to theirs
          actualModel = model.replace('google/', '');
        } else if (isChineseModel) {
          // 中文模型保持原始名称（七牛云provider支持这些格式）
          // 包括: qwen, deepseek, glm-, qwq-, kimi-, moonshotai/
          actualModel = model;
        } else {
          actualModel = model;
        }

        // 确定 provider 名称用于日志
        const providerName = isAnthropic ? 'Anthropic' :
                             isGeminiGCA ? 'Gemini GCA (cs.imds.ai)' :
                             isChineseModel ? 'Chinese Model (OpenAI Compatible)' :
                             isGoogle ? 'Google' :
                             isOpenAI ? 'OpenAI' : 'Groq';
        console.log(`[generate-ai-code-stream] Using provider: ${providerName}, model: ${actualModel}`);
        console.log(`[generate-ai-code-stream] AI Gateway enabled: ${isUsingAIGateway}`);
        console.log(`[generate-ai-code-stream] Model string: ${model}`);

        // Make streaming API call with appropriate provider
        const streamOptions: any = {
          model: modelProvider(actualModel),
          messages: [
            { 
              role: 'system', 
              content: systemPrompt + `

🚨 CRITICAL CODE GENERATION RULES - VIOLATION = FAILURE 🚨:
1. NEVER truncate ANY code - ALWAYS write COMPLETE files
2. NEVER use "..." anywhere in your code - this causes syntax errors
3. NEVER cut off strings mid-sentence - COMPLETE every string
4. NEVER leave incomplete class names or attributes
5. ALWAYS close ALL tags, quotes, brackets, and parentheses
6. If you run out of space, prioritize completing the current file

CRITICAL STRING RULES TO PREVENT SYNTAX ERRORS:
- NEVER write: className="px-8 py-4 bg-black text-white font-bold neobrut-border neobr...
- ALWAYS write: className="px-8 py-4 bg-black text-white font-bold neobrut-border neobrut-shadow"
- COMPLETE every className attribute
- COMPLETE every string literal
- NO ellipsis (...) ANYWHERE in code

PACKAGE RULES:
- For INITIAL generation: Use ONLY React, no external packages
- For EDITS: You may use packages, specify them with <package> tags
- NEVER install packages like @mendable/firecrawl-js unless explicitly requested

Examples of SYNTAX ERRORS (NEVER DO THIS):
❌ className="px-4 py-2 bg-blue-600 hover:bg-blue-7...
❌ <button className="btn btn-primary btn-...
❌ const title = "Welcome to our...
❌ import { useState, useEffect, ... } from 'react'

Examples of CORRECT CODE (ALWAYS DO THIS):
✅ className="px-4 py-2 bg-blue-600 hover:bg-blue-700"
✅ <button className="btn btn-primary btn-large">
✅ const title = "Welcome to our application"
✅ import { useState, useEffect, useCallback } from 'react'

// Set maximum execution time to 5 minutes
export const maxDuration = 300;

REMEMBER: It's better to generate fewer COMPLETE files than many INCOMPLETE files.`
            },
            { 
              role: 'user', 
              content: fullPrompt + `

CRITICAL: You MUST complete EVERY file you start. If you write:
<file path="src/components/Hero.jsx">

You MUST include the closing </file> tag and ALL the code in between.

NEVER write partial code like:
<h1>Build and deploy on the AI Cloud.</h1>
<p>Some text...</p>  ❌ WRONG

ALWAYS write complete code:
<h1>Build and deploy on the AI Cloud.</h1>
<p>Some text here with full content</p>  ✅ CORRECT

If you're running out of space, generate FEWER files but make them COMPLETE.
It's better to have 3 complete files than 10 incomplete files.`
            }
          ],
                    maxTokens: 30000,
          stopSequences: [] // Don't stop early
          // Note: Neither Groq nor Anthropic models support tool/function calling in this context
          // We use XML tags for package detection instead
        };
        
        // Add temperature for non-reasoning models
        if (!model.startsWith('openai/gpt-5')) {
          streamOptions.temperature = 0.7;
        }
        
        // Add reasoning effort for GPT-5 models
        if (isOpenAI) {
          streamOptions.experimental_providerMetadata = {
            openai: {
              reasoningEffort: 'high'
            }
          };
        }
        
        // Stream the response and parse in real-time
        let generatedCode = '';
        let currentFile = '';
        let currentFilePath = '';
        let componentCount = 0;
        let isInFile = false;
        let isInTag = false;
        let conversationalBuffer = '';
        
        // Buffer for incomplete tags
        let tagBuffer = '';
        
        let loopCount = 0;
        const maxLoops = 5;
        let continueGeneration = false;

        do {
          loopCount++;
          let result;
          let retryCount = 0;
          const maxRetries = 2;
          
          // Update prompt for continuation if needed
          let currentMessages = [...streamOptions.messages];
          if (loopCount > 1) {
             console.log(`[generate-ai-code-stream] Starting continuation loop ${loopCount}`);

             // 🔥 CRITICAL FIX: Parse already generated files to track progress
             const generatedFiles: string[] = [];
             const fileRegex = /<file path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
             let match;
             while ((match = fileRegex.exec(generatedCode)) !== null) {
               generatedFiles.push(match[1]);
             }

             console.log(`[generate-ai-code-stream] 📊 Continuation ${loopCount}: ${generatedFiles.length} files generated so far`);
             console.log(`[generate-ai-code-stream] 📋 Files: ${generatedFiles.join(', ')}`);

             // 🔥 CRITICAL FIX: Check for missing required files (App.jsx, index.css)
             const hasAppFile = generatedFiles.some(f => f.includes('App.jsx') || f.includes('App.tsx'));
             const hasIndexCss = generatedFiles.some(f => f.includes('index.css'));
             const hasComponents = generatedFiles.some(f => f.includes('/components/'));

             let missingFilesReminder = '';
             if (hasComponents && !hasAppFile) {
               missingFilesReminder += '\n⚠️ CRITICAL: You have NOT yet generated App.jsx/App.tsx! You MUST generate it to complete the application.';
             }
             if (hasComponents && !hasIndexCss) {
               missingFilesReminder += '\n⚠️ WARNING: You have NOT yet generated index.css! You should generate it for styling.';
             }

             currentMessages = [
               ...streamOptions.messages,
               {
                 role: 'assistant',
                 content: generatedCode // Pre-fill conversation with what we have so far
               },
               {
                 role: 'user',
                 content: `[SYSTEM: The previous response was truncated. Please continue exactly where you left off.

📊 Progress Summary:
- Generated ${generatedFiles.length} files so far: ${generatedFiles.slice(0, 5).join(', ')}${generatedFiles.length > 5 ? '...' : ''}
${missingFilesReminder}

RULES:
1. Do NOT repeat code that was already generated
2. Continue from the exact point where you stopped
3. If you were in the middle of a file, complete that file first
4. Then generate any missing required files (especially App.jsx/App.tsx if missing)
5. Start immediately with the next character - no explanations needed]`
               }
             ];
             // Update options with new messages
             streamOptions.messages = currentMessages;
          }

          while (retryCount <= maxRetries) {
            try {
              result = await streamText(streamOptions);
              break; // Success, exit retry loop
            } catch (streamError: any) {
              console.error(`[generate-ai-code-stream] Error calling streamText (attempt ${retryCount + 1}/${maxRetries + 1}):`, streamError);
              
              // Check if this is a Groq service unavailable error
              const isGroqServiceError = isKimiGroq && streamError.message?.includes('Service unavailable');
              const isRetryableError = streamError.message?.includes('Service unavailable') || 
                                      streamError.message?.includes('rate limit') ||
                                      streamError.message?.includes('timeout');
              
              if (retryCount < maxRetries && isRetryableError) {
                retryCount++;
                console.log(`[generate-ai-code-stream] Retrying in ${retryCount * 2} seconds...`);
                
                // Send progress update about retry
                await sendProgress({ 
                  type: 'info', 
                  message: `Service temporarily unavailable, retrying (attempt ${retryCount + 1}/${maxRetries + 1})...` 
                });
                
                // Wait before retry with exponential backoff
                await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
                
                // If Groq fails, try switching to a fallback model
                if (isGroqServiceError && retryCount === maxRetries) {
                  console.log('[generate-ai-code-stream] Groq service unavailable, falling back to GPT-4');
                  streamOptions.model = openai('gpt-4-turbo');
                  actualModel = 'gpt-4-turbo';
                }
              } else {
                // Final error, send to user
                await sendProgress({ 
                  type: 'error', 
                  message: `Failed to initialize ${isGeminiGCA ? 'Gemini GCA' : isGoogle ? 'Gemini' : isAnthropic ? 'Claude' : isOpenAI ? 'GPT-5' : isKimiGroq ? 'Kimi (Groq)' : 'Groq'} streaming: ${streamError.message}` 
                });
                
                // If this is a Google/Gemini model error, provide helpful info
                if (isGeminiGCA) {
                  await sendProgress({
                    type: 'info',
                    message: 'Tip: Make sure CODE_ASSIST_ENDPOINT and GOOGLE_CLOUD_ACCESS_TOKEN are set correctly.'
                  });
                } else if (isGoogle) {
                  await sendProgress({
                    type: 'info',
                    message: 'Tip: Make sure your GEMINI_API_KEY is set correctly and has proper permissions.'
                  });
                }
                
                throw streamError;
              }
            }
          }
          
          // Stream the raw text for live preview
          for await (const textPart of result?.textStream || []) {
            const text = textPart || '';
            generatedCode += text;
            currentFile += text;
            
            // Combine with buffer for tag detection
            const searchText = tagBuffer + text;
            
            // Log streaming chunks to console
            process.stdout.write(text);
            
            // Check if we're entering or leaving a tag
            const hasOpenTag = /<(file|package|packages|explanation|command|structure|template)\b/.test(text);
            const hasCloseTag = /<\/(file|package|packages|explanation|command|structure|template)>/.test(text);
            
            if (hasOpenTag) {
              // Send any buffered conversational text before the tag
              if (conversationalBuffer.trim() && !isInTag) {
                await sendProgress({ 
                  type: 'conversation', 
                  text: conversationalBuffer.trim()
                });
                conversationalBuffer = '';
              }
              isInTag = true;
            }
            
            if (hasCloseTag) {
              isInTag = false;
            }
            
            // If we're not in a tag, buffer as conversational text
            if (!isInTag && !hasOpenTag) {
              conversationalBuffer += text;
            }
            
            // Stream the raw text for live preview
            await sendProgress({ 
              type: 'stream', 
              text: text,
              raw: true 
            });
            
            // Debug: Log every 100 characters streamed
            if (generatedCode.length % 100 < text.length) {
              console.log(`[generate-ai-code-stream] Streamed ${generatedCode.length} chars`);
            }
            
            // Check for package tags in buffered text (ONLY for edits, not initial generation)
            let lastIndex = 0;
            if (isEdit) {
              const packageRegex = /<package>([^<]+)<\/package>/g;
              let packageMatch;
              
              while ((packageMatch = packageRegex.exec(searchText)) !== null) {
                const packageName = packageMatch[1].trim();
                if (packageName && !packagesToInstall.includes(packageName)) {
                  packagesToInstall.push(packageName);
                  console.log(`[generate-ai-code-stream] Package detected: ${packageName}`);
                  await sendProgress({ 
                    type: 'package', 
                    name: packageName,
                    message: `Package detected: ${packageName}`
                  });
                }
                lastIndex = packageMatch.index + packageMatch[0].length;
              }
            }
            
            // Keep unmatched portion in buffer for next iteration
            tagBuffer = searchText.substring(Math.max(0, lastIndex - 50)); // Keep last 50 chars
            
            // Check for file boundaries
            if (text.includes('<file path="')) {
              const pathMatch = text.match(/<file path="([^"]+)"/);
              if (pathMatch) {
                currentFilePath = pathMatch[1];
                isInFile = true;
                currentFile = text;
              }
            }
            
            // Check for file end
            if (isInFile && currentFile.includes('</file>')) {
              isInFile = false;
              
              // Send component progress update
              if (currentFilePath.includes('components/')) {
                componentCount++;
                const componentName = currentFilePath.split('/').pop()?.replace('.jsx', '') || 'Component';
                await sendProgress({ 
                  type: 'component', 
                  name: componentName,
                  path: currentFilePath,
                  index: componentCount
                });
              } else if (currentFilePath.includes('App.jsx')) {
                await sendProgress({ 
                  type: 'app', 
                  message: 'Generated main App.jsx',
                  path: currentFilePath
                });
              }
              
              currentFile = '';
              currentFilePath = '';
            }
          }

          // Check finish reason to decide on continuation
          // result is guaranteed to be defined here because of the throw in the retry loop
          const finishReason = await result!.finishReason;
          console.log(`[generate-ai-code-stream] Loop ${loopCount} finished with reason: ${finishReason}`);

          if (finishReason === 'length' && loopCount < maxLoops) {
              continueGeneration = true;
              console.log(`[generate-ai-code-stream] Output truncated (loop ${loopCount}), continuing generation...`);
              await sendProgress({ type: 'status', message: 'Output truncated, continuing generation...' });
          } else {
              continueGeneration = false;
          }

        } while (continueGeneration);

        
        console.log('\n\n[generate-ai-code-stream] Streaming complete.');
        
        // Send any remaining conversational text
        if (conversationalBuffer.trim()) {
          await sendProgress({ 
            type: 'conversation', 
            text: conversationalBuffer.trim()
          });
        }
        
        // Also parse <packages> tag for multiple packages - ONLY for edits
        if (isEdit) {
          const packagesRegex = /<packages>([\s\S]*?)<\/packages>/g;
          let packagesMatch;
          while ((packagesMatch = packagesRegex.exec(generatedCode)) !== null) {
            const packagesContent = packagesMatch[1].trim();
            const packagesList = packagesContent.split(/[\n,]+/)
              .map(pkg => pkg.trim())
              .filter(pkg => pkg.length > 0);
            
            for (const packageName of packagesList) {
              if (!packagesToInstall.includes(packageName)) {
                packagesToInstall.push(packageName);
                console.log(`[generate-ai-code-stream] Package from <packages> tag: ${packageName}`);
                await sendProgress({ 
                  type: 'package', 
                  name: packageName,
                  message: `Package detected: ${packageName}`
                });
              }
            }
          }
        }
        
        // Function to extract packages from import statements
        function extractPackagesFromCode(content: string): string[] {
          const packages: string[] = [];
          // Match ES6 imports
          const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;
          let importMatch;
          
          while ((importMatch = importRegex.exec(content)) !== null) {
            const importPath = importMatch[1];
            // Skip relative imports and built-in React
            if (!importPath.startsWith('.') && !importPath.startsWith('/') && 
                importPath !== 'react' && importPath !== 'react-dom' &&
                !importPath.startsWith('@/')) {
              // Extract package name (handle scoped packages like @heroicons/react)
              const packageName = importPath.startsWith('@') 
                ? importPath.split('/').slice(0, 2).join('/')
                : importPath.split('/')[0];
              
              if (!packages.includes(packageName)) {
                packages.push(packageName);
              }
            }
          }
          
          return packages;
        }
        
        // Parse files and send progress for each
        const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
        const files = [];
        let match;
        
        while ((match = fileRegex.exec(generatedCode)) !== null) {
          const filePath = match[1];
          const content = match[2].trim();
          files.push({ path: filePath, content });
          
          // Extract packages from file content - ONLY for edits
          if (isEdit) {
            const filePackages = extractPackagesFromCode(content);
            for (const pkg of filePackages) {
              if (!packagesToInstall.includes(pkg)) {
                packagesToInstall.push(pkg);
                console.log(`[generate-ai-code-stream] Package detected from imports: ${pkg}`);
                await sendProgress({ 
                  type: 'package', 
                  name: pkg,
                  message: `Package detected from imports: ${pkg}`
                });
              }
            }
          }
          
          // Send progress for each file (reusing componentCount from streaming)
          if (filePath.includes('components/')) {
            const componentName = filePath.split('/').pop()?.replace('.jsx', '') || 'Component';
            await sendProgress({ 
              type: 'component', 
              name: componentName,
              path: filePath,
              index: componentCount
            });
          } else if (filePath.includes('App.jsx')) {
            await sendProgress({ 
              type: 'app', 
              message: 'Generated main App.jsx',
              path: filePath
            });
          }
        }
        
        // Extract explanation
        const explanationMatch = generatedCode.match(/<explanation>([\s\S]*?)<\/explanation>/);
        const explanation = explanationMatch ? explanationMatch[1].trim() : 'Code generated successfully!';

        // ✅ SYNTAX VALIDATION - Catch common AI code generation errors
        const syntaxErrors: Array<{ file: string; line: number; error: string; suggestion: string }> = [];

        for (const file of files) {
          if (!file.path.match(/\.(jsx?|tsx?)$/)) continue; // Only check JS/TS files

          const lines = file.content.split('\n');
          lines.forEach((line, index) => {
            const lineNum = index + 1;
            const trimmed = line.trim();

            // Check for typos in export statement
            if (trimmed.match(/export\s+(defaum|defaut|defualt|defalut)/)) {
              syntaxErrors.push({
                file: file.path,
                line: lineNum,
                error: `Invalid export keyword: "${trimmed.match(/export\s+(defaum|defaut|defualt|defalut)/)?.[1]}"`,
                suggestion: 'Did you mean "export default"?'
              });
            }

            // Check for invalid export patterns
            if (trimmed.match(/^export\s+(defaum|defaut|defualt|defalut)\s+['"`]/)) {
              syntaxErrors.push({
                file: file.path,
                line: lineNum,
                error: `Malformed export statement: ${trimmed}`,
                suggestion: 'Should be: export default ComponentName; or export default function() {...}'
              });
            }

            // Check for import typos
            if (trimmed.match(/^(improt|imoprt|ipmort)\s+/)) {
              syntaxErrors.push({
                file: file.path,
                line: lineNum,
                error: `Invalid import keyword: "${trimmed.match(/^(improt|imoprt|ipmort)/)?.[1]}"`,
                suggestion: 'Did you mean "import"?'
              });
            }

            // Check for "form" instead of "from" in imports
            if (trimmed.match(/import\s+.*\s+form\s+['"`]/)) {
              syntaxErrors.push({
                file: file.path,
                line: lineNum,
                error: 'Invalid import syntax: "form" should be "from"',
                suggestion: trimmed.replace(/\s+form\s+/, ' from ')
              });
            }

            // Check for function typos
            if (trimmed.match(/^(fucntion|funciton|functoin)\s+/)) {
              syntaxErrors.push({
                file: file.path,
                line: lineNum,
                error: `Invalid function keyword: "${trimmed.match(/^(fucntion|funciton|functoin)/)?.[1]}"`,
                suggestion: 'Did you mean "function"?'
              });
            }

            // Check for const/let/var typos
            if (trimmed.match(/^(cosnt|cnst|lte)\s+/)) {
              syntaxErrors.push({
                file: file.path,
                line: lineNum,
                error: `Invalid variable declaration: "${trimmed.match(/^(cosnt|cnst|lte)/)?.[1]}"`,
                suggestion: 'Did you mean "const" or "let"?'
              });
            }
          });
        }

        // If syntax errors detected, send warning and log details
        if (syntaxErrors.length > 0) {
          console.error('[generate-ai-code-stream] ❌ SYNTAX ERRORS DETECTED:', syntaxErrors);

          const errorSummary = syntaxErrors.map(e =>
            `  - ${e.file}:${e.line} - ${e.error} (Suggestion: ${e.suggestion})`
          ).join('\n');

          await sendProgress({
            type: 'error',
            error: `⚠️ AI generated code with syntax errors:\n${errorSummary}\n\nPlease regenerate or the code will fail to compile.`
          });

          // Log to console for debugging
          console.error('[generate-ai-code-stream] Generated code contains syntax errors. Details:\n' + errorSummary);
        }

        // Validate generated code for truncation issues
        const truncationWarnings: string[] = [];
        
        // Check for unclosed file tags
        const fileOpenCount = (generatedCode.match(/<file path="/g) || []).length;
        const fileCloseCount = (generatedCode.match(/<\/file>/g) || []).length;
        if (fileOpenCount !== fileCloseCount) {
          truncationWarnings.push(`Unclosed file tags detected: ${fileOpenCount} open, ${fileCloseCount} closed`);
        }
        
        // Check for files that seem truncated (very short or ending abruptly)
        const truncationCheckRegex = /<file path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
        let truncationMatch;
        while ((truncationMatch = truncationCheckRegex.exec(generatedCode)) !== null) {
          const fullMatch = truncationMatch[0];
          const filePath = truncationMatch[1];
          const content = truncationMatch[2];
          
          // CRITICAL CHECK: Does the file block actually end with </file>?
          // If the regex matched via the '$' (end of string) alternative, it means </file> was missing.
          const hasClosingTag = fullMatch.trim().endsWith('</file>');
          
          if (!hasClosingTag) {
            truncationWarnings.push(`File ${filePath} is missing closing tag (truncated)`);
          }
          
          // Only check for really obvious HTML truncation - file ends with opening tag
          if (content.trim().endsWith('<') || content.trim().endsWith('</')) {
            truncationWarnings.push(`File ${filePath} appears to have incomplete HTML tags`);
          }
          
          // 🔥 Enhanced truncation detection for JS/TS files
          if (filePath.match(/\.(jsx?|tsx?)$/)) {
            // Check curly braces (functions, objects, blocks)
            const openBraces = (content.match(/{/g) || []).length;
            const closeBraces = (content.match(/}/g) || []).length;
            const braceDiff = Math.abs(openBraces - closeBraces);

            // Check parentheses (function calls, expressions)
            const openParens = (content.match(/\(/g) || []).length;
            const closeParens = (content.match(/\)/g) || []).length;
            const parenDiff = Math.abs(openParens - closeParens);

            // Check square brackets (arrays, property access)
            const openBrackets = (content.match(/\[/g) || []).length;
            const closeBrackets = (content.match(/\]/g) || []).length;
            const bracketDiff = Math.abs(openBrackets - closeBrackets);

            // 🔥 Check JSX tags (only for .jsx/.tsx files)
            let jsxTagDiff = 0;
            if (filePath.match(/\.(jsx|tsx)$/)) {
              // Match self-closing tags like <Component />
              const selfClosingTags = (content.match(/<[^>]+\/>/g) || []).length;
              // Match opening tags like <div>
              const openingTags = (content.match(/<\w+[^/>]*>/g) || []).length;
              // Match closing tags like </div>
              const closingTags = (content.match(/<\/\w+>/g) || []).length;
              jsxTagDiff = Math.abs((openingTags - selfClosingTags) - closingTags);
            }

            // 🚫 STRICT: If no closing tag, ANY mismatch is truncation
            if (!hasClosingTag && (braceDiff > 0 || parenDiff > 0 || jsxTagDiff > 0)) {
               truncationWarnings.push(`File ${filePath} is truncated (missing closing tag, braces: ${braceDiff}, parens: ${parenDiff}, JSX tags: ${jsxTagDiff})`);
            }
            // 🚫 STRICT: Even with closing tag, check for mismatches (lowered threshold from 3 to 2)
            else if (braceDiff > 2 || parenDiff > 2 || jsxTagDiff > 1) {
              truncationWarnings.push(`File ${filePath} has unmatched brackets (braces: ${openBraces}/${closeBraces}, parens: ${openParens}/${closeParens}, JSX: ${jsxTagDiff})`);
            }

            // 🚫 Check if file is extremely short and looks incomplete
            if (content.length < 20 && content.includes('function') && !content.includes('}')) {
              truncationWarnings.push(`File ${filePath} appears severely truncated (< 20 chars with incomplete function)`);
            }

            // 🚫 NEW: Check for incomplete return statements in React components
            if (filePath.match(/\.(jsx|tsx)$/)) {
              const hasReturnKeyword = content.includes('return');
              const hasOpenReturn = content.match(/return\s*\(/);
              const hasJSX = content.includes('<');

              // If there's a return statement with JSX but missing closing parenthesis
              if (hasReturnKeyword && hasOpenReturn && hasJSX && parenDiff > 0) {
                truncationWarnings.push(`File ${filePath} has incomplete return statement in React component`);
              }
            }

            // 🚫 NEW: Check for dangling code indicators
            const danglingIndicators = [
              content.trim().endsWith(','),
              content.trim().endsWith('{'),
              content.trim().endsWith('('),
              content.trim().endsWith('<span'),
              content.trim().endsWith('<div'),
              content.trim().match(/\w+\s*=\s*$/)  // variable assignment without value
            ];

            if (danglingIndicators.some(Boolean)) {
              truncationWarnings.push(`File ${filePath} ends with incomplete code (dangling syntax)`);
            }
          }
        }

        // 🔥 UNIVERSAL FIX: Check for missing required files
        // This detects cases where AI response was truncated before generating critical files
        if (!isEdit) {  // Only check in initial generation mode
          const hasAppFile = files.some(f =>
            f.path === 'src/App.jsx' ||
            f.path === 'src/App.tsx' ||
            f.path === 'App.jsx' ||
            f.path === 'App.tsx'
          );

          const hasIndexCss = files.some(f =>
            f.path === 'src/index.css' ||
            f.path === 'index.css'
          );

          const hasComponents = files.some(f =>
            f.path.includes('/components/') &&
            (f.path.endsWith('.jsx') || f.path.endsWith('.tsx'))
          );

          // Check for any missing required files
          if (hasComponents) {
            if (!hasAppFile) {
              truncationWarnings.push(`Critical: App.jsx/App.tsx is missing but components were generated`);
              console.warn('[generate-ai-code-stream] 🚨 CRITICAL: Missing App.jsx/App.tsx but has components');
            }
            if (!hasIndexCss) {
              truncationWarnings.push(`Warning: index.css is missing - styling foundation may be incomplete`);
              console.warn('[generate-ai-code-stream] ⚠️ Missing index.css but has components');
            }
          }
        }

        // Handle truncation with automatic retry (if enabled in config)
        if (truncationWarnings.length > 0 && appConfig.codeApplication.enableTruncationRecovery) {
          console.warn('[generate-ai-code-stream] 🚨 Truncation detected, attempting to fix:', truncationWarnings);
          console.warn(`[generate-ai-code-stream] 📊 Total warnings: ${truncationWarnings.length}`);
          truncationWarnings.forEach((warning, index) => {
            console.warn(`[generate-ai-code-stream] ⚠️  Warning ${index + 1}: ${warning}`);
          });

          await sendProgress({
            type: 'warning',
            message: `Detected ${truncationWarnings.length} incomplete code generation issues. Attempting to complete...`,
            warnings: truncationWarnings
          });

          // Try to fix truncated files automatically
          const truncatedFiles: string[] = [];
          const fileRegex = /<file path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
          let match;
          
          while ((match = fileRegex.exec(generatedCode)) !== null) {
            const filePath = match[1];
            const content = match[2];
            
            // Check if this file appears truncated - be more selective
            const hasEllipsis = content.includes('...') && 
                               !content.includes('...rest') && 
                               !content.includes('...props') &&
                               !content.includes('spread');
                               
            const endsAbruptly = content.trim().endsWith('...') || 
                                 content.trim().endsWith(',') ||
                                 content.trim().endsWith('(');
                                 
            const hasUnclosedTags = content.includes('</') && 
                                    !content.match(/<\/[a-zA-Z0-9]+>/) &&
                                    content.includes('<');
                                    
            const tooShort = content.length < 50 && filePath.match(/\.(jsx?|tsx?)$/);
            
            // Check for unmatched braces specifically
            const openBraceCount = (content.match(/{/g) || []).length;
            const closeBraceCount = (content.match(/}/g) || []).length;
            const hasUnmatchedBraces = Math.abs(openBraceCount - closeBraceCount) > 1;
            
            const isTruncated = (hasEllipsis && endsAbruptly) || 
                               hasUnclosedTags || 
                               (tooShort && !content.includes('export')) ||
                               hasUnmatchedBraces;
            
            if (isTruncated) {
              truncatedFiles.push(filePath);
            }
          }
          
          // If we have truncated files, try to regenerate them
          if (truncatedFiles.length > 0) {
            console.log(`[generate-ai-code-stream] 🔄 Attempting to regenerate ${truncatedFiles.length} truncated files:`, truncatedFiles);

            for (const filePath of truncatedFiles) {
              console.log(`[generate-ai-code-stream] 📝 Processing file: ${filePath}`);

              await sendProgress({
                type: 'info',
                message: `Completing ${filePath}...`
              });

              try {
                // Create a focused prompt to complete just this file
                const completionPrompt = `Complete the following file that was truncated. Provide the FULL file content.

File: ${filePath}
Original request: ${prompt}

Provide the complete file content without any truncation. Include all necessary imports, complete all functions, and close all tags properly.`;
                
                // Make a focused API call to complete this specific file
                // Create a new client for the completion based on the provider
                let completionClient;
                if (model.includes('gpt') || model.includes('openai')) {
                  completionClient = openai;
                } else if (model.includes('claude')) {
                  completionClient = anthropic;
                } else if (model === 'moonshotai/kimi-k2-instruct-0905') {
                  completionClient = groq;
                } else {
                  completionClient = groq;
                }
                
                // Determine the correct model name for the completion
                let completionModelName: string;
                if (model === 'moonshotai/kimi-k2-instruct-0905') {
                  completionModelName = 'moonshotai/kimi-k2-instruct-0905';
                } else if (model.includes('openai')) {
                  completionModelName = model.replace('openai/', '');
                } else if (model.includes('anthropic')) {
                  completionModelName = model.replace('anthropic/', '');
                } else if (model.includes('google')) {
                  completionModelName = model.replace('google/', '');
                } else {
                  completionModelName = model;
                }
                
                const completionResult = await streamText({
                  model: completionClient(completionModelName),
                  messages: [
                    { 
                      role: 'system', 
                      content: 'You are completing a truncated file. Provide the complete, working file content.'
                    },
                    { role: 'user', content: completionPrompt }
                  ],
                  temperature: model.startsWith('openai/gpt-5') ? undefined : appConfig.ai.defaultTemperature
                });
                
                // Get the full text from the stream
                let completedContent = '';
                for await (const chunk of completionResult.textStream) {
                  completedContent += chunk;
                }
                
                // Replace the truncated file in the generatedCode
                const filePattern = new RegExp(
                  `<file path="${filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}">[\\s\\S]*?(?:</file>|$)`,
                  'g'
                );
                
                // Extract just the code content (remove any markdown or explanation)
                let cleanContent = completedContent;
                if (cleanContent.includes('```')) {
                  const codeMatch = cleanContent.match(/```[\w]*\n([\s\S]*?)```/);
                  if (codeMatch) {
                    cleanContent = codeMatch[1];
                  }
                }
                
                generatedCode = generatedCode.replace(
                  filePattern,
                  `<file path="${filePath}">\n${cleanContent}\n</file>`
                );

                console.log(`[generate-ai-code-stream] ✅ Successfully completed ${filePath}`);
                console.log(`[generate-ai-code-stream] 📊 Completed content length: ${cleanContent.length} chars`);

              } catch (completionError: any) {
                console.error(`[generate-ai-code-stream] ❌ Failed to complete ${filePath}:`, completionError?.message || completionError);
                console.error(`[generate-ai-code-stream] 🔍 Error details:`, {
                  name: completionError?.name,
                  stack: completionError?.stack?.split('\n').slice(0, 3)
                });

                await sendProgress({
                  type: 'warning',
                  message: `Could not auto-complete ${filePath}. Manual review may be needed.`
                });
              }
            }
            
            // Clear the warnings after attempting fixes
            truncationWarnings.length = 0;
            await sendProgress({
              type: 'info',
              message: 'Truncation recovery complete'
            });
          }
        }
        
        // Send completion with packages info
        await sendProgress({ 
          type: 'complete', 
          generatedCode,
          explanation,
          files: files.length,
          components: componentCount,
          model,
          packagesToInstall: packagesToInstall.length > 0 ? packagesToInstall : undefined,
          warnings: truncationWarnings.length > 0 ? truncationWarnings : undefined
        });
        
        // Track edit in conversation history
        if (isEdit && editContext && global.conversationState) {
          const editRecord: ConversationEdit = {
            timestamp: Date.now(),
            userRequest: prompt,
            editType: editContext.editIntent.type,
            targetFiles: editContext.primaryFiles,
            confidence: editContext.editIntent.confidence,
            outcome: 'success' // Assuming success if we got here
          };
          
          global.conversationState.context.edits.push(editRecord);
          
          // Track major changes
          if (editContext.editIntent.type === 'ADD_FEATURE' || files.length > 3) {
            global.conversationState.context.projectEvolution.majorChanges.push({
              timestamp: Date.now(),
              description: editContext.editIntent.description,
              filesAffected: editContext.primaryFiles
            });
          }
          
          // Update last updated timestamp
          global.conversationState.lastUpdated = Date.now();
          
          console.log('[generate-ai-code-stream] Updated conversation history with edit:', editRecord);
        }
        
      } catch (error) {
        console.error('[generate-ai-code-stream] Stream processing error:', error);
        
        // Check if it's a tool validation error
        if ((error as any).message?.includes('tool call validation failed')) {
          console.error('[generate-ai-code-stream] Tool call validation error - this may be due to the AI model sending incorrect parameters');
          await sendProgress({ 
            type: 'warning', 
            message: 'Package installation tool encountered an issue. Packages will be detected from imports instead.'
          });
          // Continue processing - packages can still be detected from the code
        } else {
          await sendProgress({ 
            type: 'error', 
            error: (error as Error).message 
          });
        }
      } finally {
        clearInterval(heartbeatInterval);
        await writer.close();
      }
    })();
    
    // Return the stream with proper headers for streaming support
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Transfer-Encoding': 'chunked',
        'Content-Encoding': 'none', // Prevent compression that can break streaming
        'X-Accel-Buffering': 'no', // Disable nginx buffering
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
    
  } catch (error) {
    console.error('[generate-ai-code-stream] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}