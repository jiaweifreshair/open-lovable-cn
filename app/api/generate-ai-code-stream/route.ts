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
  normalizeXmlTags,
  repairBrokenXmlTags,
  autoCompleteMissingFiles,
  type ValidationIssue
} from '@/lib/multi-turn-fix-engine';
// 🔥 V3.0 分段生成策略 - 解决token超限和代码混乱
import type {
  GenerationConfig,
  FileManifestItem,
  GenerationRequest,
  PlanGenerationResponse
} from '@/types/generation';

// Force dynamic route to enable streaming
export const dynamic = 'force-dynamic';

/**
 * 将 unknown 错误转换为可读字符串，避免把对象直接抛给用户或日志。
 */
function formatUnknownError(error: unknown): string {
  if (error === null || error === undefined) return '';
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;

  try {
    const json = JSON.stringify(error);
    const message = json === undefined ? String(error) : json;
    return message.length > 2000 ? message.slice(0, 2000) + '…' : message;
  } catch {
    const message = String(error);
    return message.length > 2000 ? message.slice(0, 2000) + '…' : message;
  }
}

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

const DEFAULT_GEMINI_GCA_ENDPOINT = 'https://cs.imds.ai/api/v1';

/**
 * 规范化 Gemini GCA 的 OpenAI 兼容 endpoint。
 *
 * 常见误配：
 * - https://cs.imds.ai/gemini（应为 /api/v1）
 * - https://cs.imds.ai（应补全 /api/v1）
 */
function normalizeGeminiGCAEndpoint(rawEndpoint: string | undefined): string {
  if (!rawEndpoint) return DEFAULT_GEMINI_GCA_ENDPOINT;

  const trimmed = rawEndpoint.trim().replace(/\/+$/, '');
  if (!trimmed) return DEFAULT_GEMINI_GCA_ENDPOINT;

  if (trimmed.endsWith('/gemini')) {
    console.warn('[Gemini GCA] CODE_ASSIST_ENDPOINT 检测到 /gemini，已自动纠正为 /api/v1');
    return trimmed.replace(/\/gemini$/, '/api/v1');
  }

  if (trimmed === 'https://cs.imds.ai') {
    return DEFAULT_GEMINI_GCA_ENDPOINT;
  }

  return trimmed;
}

/**
 * 读取正整数环境变量；非法值回退到默认值。
 */
function getEnvPositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultValue;

  return Math.floor(parsed);
}

/**
 * Gemini GCA 默认模型（用于未显式传 model 时的兜底，以及自动降级场景）。
 */
function resolveGeminiGCADefaultModel(): string {
  const model = process.env.GEMINI_MODEL;
  if (model && model.trim()) return model.trim();
  return 'gemini-3-pro-preview';
}

// Gemini GCA Provider (Google Cloud AI - OpenAI Compatible)
// 使用 cs.imds.ai 或其他 OpenAI 兼容的 Gemini 代理服务
// 正确的 endpoint: https://cs.imds.ai/api/v1 (不是 /gemini)
const isUsingGeminiGCA = !!process.env.CODE_ASSIST_ENDPOINT && !!process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
const geminiGCAEndpoint = normalizeGeminiGCAEndpoint(process.env.CODE_ASSIST_ENDPOINT);

console.log('[DEBUG] Gemini GCA Setup:', {
  endpoint: geminiGCAEndpoint,
  hasToken: !!process.env.GOOGLE_CLOUD_ACCESS_TOKEN
});

const geminiGCAProvider = createOpenAICompatible({
  name: 'gemini-gca',
  apiKey: process.env.GOOGLE_CLOUD_ACCESS_TOKEN || '',
  baseURL: geminiGCAEndpoint,
  fetch: geminiFetch,
});

console.log('[generate-ai-code-stream] Gemini GCA config:', {
  isUsingGeminiGCA,
  endpoint: process.env.CODE_ASSIST_ENDPOINT ? geminiGCAEndpoint : 'not set',
  defaultModel: resolveGeminiGCADefaultModel(),
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
    const requestBody = await request.json() as GenerationRequest;
    const {
      prompt,
      model: rawModel,
      context,
      isEdit = false,
      generation = { mode: 'full' } // 🔥 默认使用 full 模式保持向后兼容
    } = requestBody;

    let model = typeof rawModel === 'string' ? rawModel.trim() : '';
    if (!model) {
      model = isUsingGeminiGCA ? resolveGeminiGCADefaultModel() : 'deepseek-r1';
    }

    console.log('[generate-ai-code-stream] Received request:');
    console.log('[generate-ai-code-stream] - prompt:', prompt);
    console.log('[generate-ai-code-stream] - isEdit:', isEdit);
    console.log('[generate-ai-code-stream] - generation.mode:', generation.mode);
    console.log('[generate-ai-code-stream] - generation.fileIndex:', generation.fileIndex);
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

        // ✅ E2E/离线测试模式：不调用外部服务，直接使用 Mock 输出
        if (isE2eMockEnabled()) {
          console.log('[generate-ai-code-stream] ✅ OPEN_LOVABLE_E2E=1，使用 Mock 生成数据');
          await runE2eMockGeneration(generation, sendProgress);
          return;
        }
        
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
        console.log(`[generate-ai-code-stream] Generation mode: ${generation.mode}`);

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

        // =================================================================
        // 🔥 V3.0 Generation Mode Routing (分段生成策略路由)
        // =================================================================

        // Mode: plan - 生成技术方案（第一步：需求 → 方案）
        if (generation.mode === 'plan') {
          console.log('[generate-ai-code-stream] Mode: plan - 生成技术方案');
          await sendProgress({ type: 'status', message: '正在分析需求并制定技术方案...' });

          try {
            const plan = await generatePlan(
              fullPrompt,
              context,
              model,
              modelProvider,
              actualModel,
              sendProgress
            );

            console.log(`[generate-ai-code-stream] 技术方案生成完成，建议生成 ${plan.suggestedManifest.length} 个文件`);

            // ✅ Plan 模式使用 SSE streaming，所有数据已通过 sendProgress 发送
            // 不返回 JSON，而是退出当前函数，让 finally 块关闭 stream
            console.log('[generate-ai-code-stream] Plan 模式完成，stream 将自然关闭');
            return; // 退出异步 IIFE，触发 finally 块

	          } catch (error) {
	            console.error('[generate-ai-code-stream] Plan generation failed:', error);
	            const errorMessage = formatUnknownError(error);
	            await sendProgress({
	              type: 'error',
	              error: errorMessage.includes('技术方案生成失败')
	                ? errorMessage
	                : `技术方案生成失败: ${errorMessage}`
	            });
	            throw error;
	          }
	        }

        // Mode: manifest - 只生成文件清单
        if (generation.mode === 'manifest') {
          console.log('[generate-ai-code-stream] Mode: manifest - 生成文件清单');
          await sendProgress({ type: 'status', message: '正在分析需求并规划文件结构...' });

          try {
            const manifest = await generateManifest(
              fullPrompt,
              context,
              model,
              modelProvider,
              actualModel
            );

            await sendProgress({
              type: 'manifest_complete',
              manifest,
              totalFiles: manifest.length
            });

            console.log(`[generate-ai-code-stream] Manifest 生成完成，共 ${manifest.length} 个文件`);

            // ✅ streaming API：manifest 数据已通过 SSE 发送，直接结束当前流程
            return; // 退出异步 IIFE，触发 finally 块关闭 stream

	          } catch (error) {
	            console.error('[generate-ai-code-stream] Manifest generation failed:', error);
	            const errorMessage = formatUnknownError(error);
	            await sendProgress({
	              type: 'error',
	              error: errorMessage.includes('文件清单生成失败')
	                ? errorMessage
	                : `文件清单生成失败: ${errorMessage}`
	            });
	            throw error;
	          }
	        }

        // Mode: file - 生成单个文件
        if (generation.mode === 'file') {
          console.log('[generate-ai-code-stream] Mode: file - 生成单个文件');

          if (!generation.manifest || !Array.isArray(generation.manifest)) {
            throw new Error('Mode "file" requires a valid manifest array');
          }

          if (generation.fileIndex === undefined || generation.fileIndex < 0) {
            throw new Error('Mode "file" requires a valid fileIndex');
          }

          if (generation.fileIndex >= generation.manifest.length) {
            throw new Error(`fileIndex ${generation.fileIndex} out of bounds (manifest has ${generation.manifest.length} files)`);
          }

          const manifestItem = generation.manifest[generation.fileIndex];
          const totalFiles = generation.manifest.length;
          const progress = Math.round(((generation.fileIndex + 1) / totalFiles) * 100);

          console.log(`[generate-ai-code-stream] 生成文件 ${generation.fileIndex + 1}/${totalFiles}: ${manifestItem.path}`);
          await sendProgress({
            type: 'status',
            message: `正在生成文件 ${generation.fileIndex + 1}/${totalFiles}: ${manifestItem.path}...`
          });

          try {
            const fileResult = await generateSingleFile(
              manifestItem,
              generation.manifest,
              fullPrompt,
              context,
              model,
              modelProvider,
              actualModel,
              systemPrompt,
              sendProgress // 🔥 传入 sendProgress 以支持打字机效果
            );

            const isComplete = generation.fileIndex === totalFiles - 1;

            await sendProgress({
              type: 'file_complete',
              fileIndex: generation.fileIndex,
              totalFiles,
              file: fileResult,
              progress,
              isComplete
            });

            console.log(`[generate-ai-code-stream] 文件生成完成: ${fileResult.path} (${fileResult.content.length} 字符)`);

            // ✅ streaming API：file 数据已通过 SSE 发送，直接结束当前流程
            return; // 退出异步 IIFE，触发 finally 块关闭 stream

          } catch (error) {
            console.error(`[generate-ai-code-stream] File generation failed for ${manifestItem.path}:`, error);
            await sendProgress({
              type: 'error',
              error: `文件生成失败 (${manifestItem.path}): ${(error as Error).message}`
            });
            throw error;
          }
        }

        // Mode: full - 原有的一次性生成所有文件逻辑（向后兼容）
        console.log('[generate-ai-code-stream] Mode: full - 一次性生成所有文件');

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

📦 FILE STRUCTURE RULES (CRITICAL FOR AVOIDING SYNTAX ERRORS):
1. ALL import statements MUST be at the TOP of the file, BEFORE any code
2. NEVER add import statements in the middle of functions or components
3. File structure MUST be: imports → type definitions → component → export

CORRECT FILE STRUCTURE:
\`\`\`jsx
import React, { useState } from 'react';      // ← ALL imports FIRST
import { Icon } from 'lucide-react';          // ← More imports

export default function Component() {          // ← Then component
  const [state, setState] = useState('');

  return (
    <div>
      <Icon />                                 // ← Use imported components
    </div>
  );
}
\`\`\`

WRONG FILE STRUCTURE (CAUSES SYNTAX ERRORS):
\`\`\`jsx
export default function Component() {
  import { Icon } from 'lucide-react';         // ❌ NEVER import inside function!
  return <Icon />;
}
\`\`\`

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
❌ Putting import statements inside function bodies

Examples of CORRECT CODE (ALWAYS DO THIS):
✅ className="px-4 py-2 bg-blue-600 hover:bg-blue-700"
✅ <button className="btn btn-primary btn-large">
✅ const title = "Welcome to our application"
✅ import { useState, useEffect, useCallback } from 'react'
✅ All imports at the top of the file

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
                    maxOutputTokens: 32000, // DeepSeek R1 限制为 32768，使用 32000 兼容所有模型
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
        const maxLoops = 8; // 🔥 增加最大循环次数，支持复杂页面（如淘宝风格、大量 Mock 数据）
        let continueGeneration = false;

        do {
          loopCount++;
          let result;
          let retryCount = 0;
          let isContinuationStart = loopCount > 1; // 🔥 Flag to detect start of continuation
          const maxRetries = 2;
          let fallbackToGeminiUsed = false;
          let fallbackToDeepSeekUsed = false; // 🔄 双向 fallback：Gemini → DeepSeek

          // 流式生成超时控制：
          // - 首 token 超时：避免上游“无输出”导致前端一直卡住
          // - 空闲超时：防止中途长时间无 chunk
          // - 总超时：兜底，避免无限挂起
          const streamFirstTokenTimeoutMs = getEnvPositiveInt('AI_STREAM_FIRST_TOKEN_TIMEOUT_MS', 25_000);
          const streamIdleTimeoutMs = getEnvPositiveInt('AI_STREAM_IDLE_TIMEOUT_MS', 60_000);
          const streamTotalTimeoutMs = getEnvPositiveInt('AI_STREAM_TOTAL_TIMEOUT_MS', 240_000);
          
          // Update prompt for continuation if needed
          let currentMessages = [...streamOptions.messages];
          if (loopCount > 1) {
             console.log(`[generate-ai-code-stream] Starting continuation loop ${loopCount}`);

             // 🔥 CRITICAL FIX: Parse already generated files to track progress
             // 🔥 先规范化 XML 标签，处理空白问题
             const normalizedCode = normalizeXmlTags(generatedCode);
             const generatedFiles: string[] = [];
             const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
             let match;
             while ((match = fileRegex.exec(normalizedCode)) !== null) {
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

             // 🔥 分析截断点上下文，帮助 AI 更准确地继续
             // 🔥 使用灵活空白正则
             const lastFileMatch = normalizedCode.match(/<file\s+path="([^"]+)">[^]*$/);
             const isInMiddleOfFile = lastFileMatch && !generatedCode.endsWith('</file>');
             const currentFileName = lastFileMatch ? lastFileMatch[1] : 'unknown';

             // 获取最后 500 个字符作为上下文提示（增加上下文长度以便更好定位）
             const lastContext = generatedCode.slice(-500);

             // 🔥 分析截断类型，给出更精确的续写指导
             let truncationType = 'general';
             let truncationGuidance = '';

             // 检测 URL 截断
             if (/https?:\/\/[^\s"',>]*$/.test(lastContext)) {
               truncationType = 'url';
               truncationGuidance = '⚠️ 检测到 URL 被截断！请先完成当前 URL 字符串。';
             }
             // 检测字符串截断（引号不匹配）
             else if ((lastContext.match(/'/g) || []).length % 2 !== 0 ||
                      (lastContext.match(/"/g) || []).length % 2 !== 0) {
               truncationType = 'string';
               truncationGuidance = '⚠️ 检测到字符串被截断！请先闭合当前字符串。';
             }
             // 检测数组/对象截断（以逗号结尾）
             else if (lastContext.trim().endsWith(',')) {
               truncationType = 'array_object';
               truncationGuidance = '⚠️ 检测到数组/对象元素被截断！请继续完成剩余元素。';
             }

             const contextHint = isInMiddleOfFile
               ? `\n📍 Truncation Context (last 500 chars):\n\`\`\`\n${lastContext}\n\`\`\`\n${truncationGuidance ? `\n${truncationGuidance}` : ''}`
               : '';

             // 🔥 动态生成续写指令
             const continuationInstruction = isInMiddleOfFile
                ? `\n⚠️ CRITICAL: You are currently IN THE MIDDLE of file "${currentFileName}".\n- CONTINUE CODE GENERATION IMMEDIATELY from the last character.\n- DO NOT output <file> tags.\n- DO NOT output the file path.\n- DO NOT output markdown code blocks.\n- Just write the next line of code.`
                : `\n⚠️ You are between files. Start the next file using <file path="..."> tag.`;

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
- Currently ${isInMiddleOfFile ? `IN THE MIDDLE of file: ${currentFileName}` : 'between files'}
${missingFilesReminder}
${contextHint}
${continuationInstruction}

🚨 CRITICAL RULES - MUST FOLLOW:
1. Do NOT repeat code that was already generated (look at the context above).
2. Continue from the EXACT character where you stopped.
3. If you were in the middle of a file, complete that file first with proper syntax.
4. 🚫 NEVER insert import statements in the middle of code.
5. 🚫 If you realize an import is missing, DO NOT add it inline - finish the current file first.
6. Start immediately with the next character - no explanations needed.
7. DO NOT use <thinking> tags in this continuation - output CODE ONLY.]`
               }
             ];
             // Update options with new messages
             streamOptions.messages = currentMessages;
          }

                    while (retryCount <= maxRetries) {
            // Setup AbortController for this attempt
            const controller = new AbortController();
            const signal = controller.signal;
            const firstTokenTimer = setTimeout(() => {
              controller.abort('AI_STREAM_FIRST_TOKEN_TIMEOUT');
            }, streamFirstTokenTimeoutMs);

            try {
              // Wrap streamText with explicit timeout signal
              console.log(`[generate-ai-code-stream] streamText attempt ${retryCount + 1}/${maxRetries + 1} (timeout: ${streamFirstTokenTimeoutMs}ms)...`);
              const currentStreamOptions = {
                ...streamOptions,
                abortSignal: signal,
              };

              // Race streamText against our timer
              result = await streamText(currentStreamOptions);
              
              // Clear connection timer as we have established connection
              clearTimeout(firstTokenTimer);

              // 🟢 Optimization: Wrap textStream to detect IDLE timeouts during generation
              if (result && result.textStream) {
                  const originalStream = result.textStream;
                  const wrappedStream = (async function* () {
                      let idleTimer = setTimeout(() => {
                          controller.abort('AI_STREAM_IDLE_TIMEOUT');
                      }, streamIdleTimeoutMs);
                      
                      const totalTimer = setTimeout(() => {
                          controller.abort('AI_STREAM_TOTAL_TIMEOUT');
                      }, streamTotalTimeoutMs);

                      try {
                          for await (const chunk of originalStream) {
                              clearTimeout(idleTimer);
                              yield chunk;
                              idleTimer = setTimeout(() => {
                                  controller.abort('AI_STREAM_IDLE_TIMEOUT');
                              }, streamIdleTimeoutMs);
                          }
                      } catch (err: any) {
                          if (signal.aborted) {
                              if (signal.reason === 'AI_STREAM_IDLE_TIMEOUT') throw new Error(`Stream idle timeout (${streamIdleTimeoutMs}ms)`);
                              if (signal.reason === 'AI_STREAM_TOTAL_TIMEOUT') throw new Error(`Stream total timeout (${streamTotalTimeoutMs}ms)`);
                          }
                          throw err;
                      } finally {
                          clearTimeout(idleTimer);
                          clearTimeout(totalTimer);
                      }
                  })();
                  
                  result = { ...result, textStream: wrappedStream };
              }

              break; // Success, exit retry loop
            } catch (streamError: any) {
              clearTimeout(firstTokenTimer);
              
              // Standardize timeout error message
              if (signal.aborted && signal.reason === 'AI_STREAM_FIRST_TOKEN_TIMEOUT') {
                  streamError = new Error(`Connection/First-token timeout (${streamFirstTokenTimeoutMs}ms)`);
              }

              console.error(`[generate-ai-code-stream] Error calling streamText (attempt ${retryCount + 1}/${maxRetries + 1}):`, streamError);

              const isGroqServiceError = isKimiGroq && streamError.message?.includes('Service unavailable');
              const isTimeout = streamError.message?.includes('timeout') || streamError.message?.includes('Timeout');
              // 🔄 扩展可重试错误检测：包括 rate limit、服务不可用、超时、API 错误等
              const errorMsg = streamError.message || '';
              const isRetryableError = errorMsg.includes('Service unavailable') ||
                                      errorMsg.includes('rate limit') ||
                                      errorMsg.includes('Rate Limit') ||
                                      errorMsg.includes('429') ||
                                      errorMsg.includes('频率超限') ||
                                      errorMsg.includes('500') ||
                                      errorMsg.includes('502') ||
                                      errorMsg.includes('503') ||
                                      errorMsg.includes('API error') ||
                                      isTimeout;

              // 🔄 双向 Fallback 机制
              // 1. 非 Gemini 模型 → Gemini GCA
              const canFallbackToGemini = isRetryableError &&
                                          isUsingGeminiGCA &&
                                          !isGeminiGCA &&
                                          !fallbackToGeminiUsed &&
                                          !fallbackToDeepSeekUsed;

              // 2. Gemini GCA → DeepSeek (反向 fallback)
              const canFallbackToDeepSeek = isRetryableError &&
                                            isGeminiGCA &&
                                            !fallbackToDeepSeekUsed &&
                                            !fallbackToGeminiUsed;

              if ((retryCount < maxRetries && isRetryableError) || canFallbackToGemini || canFallbackToDeepSeek) {
                retryCount++;

                if (canFallbackToGemini) {
                    console.log('[generate-ai-code-stream] ⚠️ Primary provider failed. Switching to Gemini GCA fallback...');
                    const fallbackModel = resolveGeminiGCADefaultModel();
                    streamOptions.model = geminiGCAProvider(fallbackModel);
                    actualModel = fallbackModel;
                    fallbackToGeminiUsed = true;
                    if (retryCount > maxRetries) retryCount = maxRetries;

                    await sendProgress({
                      type: 'info',
                      message: `模型切换：正在使用 Gemini GCA (${fallbackModel}) 重试...`
                    });
                } else if (canFallbackToDeepSeek) {
                    // 🔄 Gemini 失败时切换到 DeepSeek
                    console.log('[generate-ai-code-stream] ⚠️ Gemini GCA failed. Switching to DeepSeek fallback...');
                    const fallbackModel = 'deepseek-r1';
                    streamOptions.model = qiniuProvider(fallbackModel);
                    actualModel = fallbackModel;
                    fallbackToDeepSeekUsed = true;
                    if (retryCount > maxRetries) retryCount = maxRetries;

                    await sendProgress({
                      type: 'info',
                      message: `模型切换：Gemini 不可用，正在使用 DeepSeek R1 重试...`
                    });
                } else {
                    console.log(`[generate-ai-code-stream] Retrying in ${retryCount * 2} seconds...`);
                    await sendProgress({
                      type: 'info',
                      message: `服务暂时不可用，正在重试 (${retryCount + 1}/${maxRetries + 1})...`
                    });
                    await new Promise(resolve => setTimeout(resolve, retryCount * 2000));
                }

                // If Groq fails, try switching to a fallback model (Old logic)
                if (isGroqServiceError && retryCount === maxRetries && !fallbackToGeminiUsed && !fallbackToDeepSeekUsed) {
                  console.log('[generate-ai-code-stream] Groq service unavailable, falling back to GPT-4');
                  streamOptions.model = openai('gpt-4-turbo');
                  actualModel = 'gpt-4-turbo';
                }
              } else {
                // Final error, send to user
                const finalErrorMsg = streamError.message || 'Unknown error';
                const modelName = isGeminiGCA ? 'Gemini GCA' : isGoogle ? 'Gemini' : isAnthropic ? 'Claude' : isOpenAI ? 'GPT-5' : isKimiGroq ? 'Kimi (Groq)' : isChineseModel ? 'DeepSeek/Qwen' : 'AI';
                await sendProgress({
                  type: 'error',
                  message: `${modelName} 生成失败: ${finalErrorMsg}`
                });

                if (isGeminiGCA || fallbackToGeminiUsed) {
                  await sendProgress({
                    type: 'info',
                    message: '提示：请检查 Gemini GCA 配置 (CODE_ASSIST_ENDPOINT, GOOGLE_CLOUD_ACCESS_TOKEN)'
                  });
                }

                throw streamError;
              }
            }
          }
          
          // Stream the raw text for live preview
          for await (const textPart of result?.textStream || []) {
            let text = textPart || '';

            // 🔥 Continuation Cleanup: Remove repeated filenames or artifacts
            if (isContinuationStart && isInFile) {
                // Regex to find and remove artifacts like `Step.jsx">`, ````, or a repeated `<file...>` tag at the beginning of a chunk.
                // It handles optional leading whitespace (\s*)
                const artifactRegex = /^\s*(?:[a-zA-Z0-9_/-]+\.[a-zA-Z]+">|```[a-z]*\n?|<file\s+path="[^"]+">)/;

                if (text.match(artifactRegex)) {
                    const matchedArtifact = text.match(artifactRegex)![0];
                    console.log(`[generate-ai-code-stream] 🧹 Cleaning continuation artifact: "${matchedArtifact.trim()}"`);
                    text = text.replace(artifactRegex, '');
                }

                // Turn off flag after processing the first meaningful chunk
                if (text.trim().length > 0) {
                    isContinuationStart = false;
                }
            }

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
            // 🔥 使用灵活空白正则
            if (/<file\s+path="/.test(text)) {
              const pathMatch = text.match(/<file\s+path="([^"]+)"/);
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

          // 🔄 过滤 DeepSeek R1 等推理模型的 <think> 标签（思考过程不应出现在生成代码中）
          if (generatedCode.includes('<think>')) {
            const originalLength = generatedCode.length;
            generatedCode = generatedCode.replace(/<think>[\s\S]*?<\/think>/gi, '');
            console.log(`[generate-ai-code-stream] 🧹 Filtered <think> tags: ${originalLength - generatedCode.length} chars removed`);
          }

          // 🔥 CRITICAL FIX: Quick truncation detection BEFORE deciding on continuation
          // This ensures we continue even if finishReason is 'unknown' (Gemini) or other non-standard values
          let quickTruncationDetected = false;

          if (loopCount < maxLoops) {
            // Check 1: Unclosed file tags (most reliable indicator)
            // 🔥 使用灵活空白正则
            const fileOpenCount = (generatedCode.match(/<file\s+path="/g) || []).length;
            const fileCloseCount = (generatedCode.match(/<\/file>/g) || []).length;
            if (fileOpenCount > fileCloseCount) {
              quickTruncationDetected = true;
              console.warn(`[generate-ai-code-stream] 🚨 Quick check: Unclosed file tags (${fileOpenCount} open, ${fileCloseCount} closed)`);
            }

            // Check 2: Missing App.jsx/App.tsx when components exist (critical for React apps)
            if (!quickTruncationDetected && !isEdit) {
              const hasComponents = generatedCode.includes('/components/') &&
                                   (generatedCode.includes('.jsx') || generatedCode.includes('.tsx'));
              const hasAppFile = generatedCode.includes('path="src/App.jsx"') ||
                                generatedCode.includes('path="src/App.tsx"') ||
                                generatedCode.includes('path="App.jsx"') ||
                                generatedCode.includes('path="App.tsx"');

              if (hasComponents && !hasAppFile) {
                quickTruncationDetected = true;
                console.warn('[generate-ai-code-stream] 🚨 Quick check: Missing App.jsx/App.tsx but has components');
              }
            }

            // Check 3: Code ends with obvious truncation indicators
            if (!quickTruncationDetected) {
              const trimmedCode = generatedCode.trim();
              const truncationEndings = [
                trimmedCode.endsWith(','),
                trimmedCode.endsWith('{'),
                trimmedCode.endsWith('('),
                trimmedCode.endsWith('<'),
                trimmedCode.endsWith('className="'),
                trimmedCode.endsWith('="'),
                // Check if last line looks incomplete (no closing tag or brace)
                !trimmedCode.endsWith('</file>') && !trimmedCode.endsWith('}') && fileOpenCount > 0
              ];

              if (truncationEndings.some(Boolean)) {
                quickTruncationDetected = true;
                console.warn('[generate-ai-code-stream] 🚨 Quick check: Code ends with truncation indicator');
              }
            }

            // 🔥 Check 4: JSX 内部截断检测（检测未闭合的 JSX 标签）
            if (!quickTruncationDetected && fileOpenCount > 0) {
              // 获取最后一个文件的内容
              // 🔥 使用灵活空白正则
              const lastFileMatch = generatedCode.match(/<file\s+path="[^"]+">([^]*?)(?:<\/file>|$)/g);
              if (lastFileMatch) {
                const lastFileContent = lastFileMatch[lastFileMatch.length - 1];

                // 检测未闭合的 JSX 标签（大写开头的标签）
                const jsxOpenTags = (lastFileContent.match(/<[A-Z][a-zA-Z0-9]*(?:\s|>)/g) || []).length;
                const jsxCloseTags = (lastFileContent.match(/<\/[A-Z][a-zA-Z0-9]*>/g) || []).length;
                const jsxSelfClosing = (lastFileContent.match(/<[A-Z][a-zA-Z0-9]*[^>]*\/>/g) || []).length;

                if (jsxOpenTags > jsxCloseTags + jsxSelfClosing + 1) {
                  quickTruncationDetected = true;
                  console.warn(`[generate-ai-code-stream] 🚨 Quick check: Unclosed JSX tags (${jsxOpenTags} open, ${jsxCloseTags} closed, ${jsxSelfClosing} self-closing)`);
                }

                // 检测 className 属性未闭合
                const lastLine = lastFileContent.split('\n').pop() || '';
                if (lastLine.includes('className="') && !lastLine.includes('">') && !lastLine.includes('"/>')) {
                  quickTruncationDetected = true;
                  console.warn('[generate-ai-code-stream] 🚨 Quick check: Unclosed className attribute');
                }
              }
            }

            // 🔥 Check 5: 检测代码结构异常（函数定义在 JSX 内部等）
            if (!quickTruncationDetected && fileOpenCount > 0) {
              const lastFileMatch = generatedCode.match(/<file path="[^"]+">([^]*?)(?:<\/file>|$)/g);
              if (lastFileMatch) {
                const lastFileContent = lastFileMatch[lastFileMatch.length - 1];

                // 检测多个 export default（代码混入的标志）
                const exportDefaultCount = (lastFileContent.match(/export\s+default\s+(function|class|const)/g) || []).length;
                if (exportDefaultCount > 1) {
                  quickTruncationDetected = true;
                  console.warn(`[generate-ai-code-stream] 🚨 Quick check: Multiple export default detected (${exportDefaultCount}) - possible code mixup`);
                }
              }
            }

            // 🔥 Check 6: URL 截断检测（检测未完成的 URL）
            if (!quickTruncationDetected && fileOpenCount > 0) {
              const trimmedCode = generatedCode.trim();
              // 检测以 http:// 或 https:// 开头但没有正确结束的 URL
              // URL 应该以 引号、空格、逗号 或 > 结束
              const lastLine = trimmedCode.split('\n').pop() || '';
              const urlInProgress = /https?:\/\/[^\s"',>]*$/.test(lastLine);
              if (urlInProgress) {
                quickTruncationDetected = true;
                console.warn('[generate-ai-code-stream] 🚨 Quick check: URL truncated mid-string');
              }
            }

            // 🔥 Check 7: 字符串中间截断检测（最后一行引号不匹配）
            if (!quickTruncationDetected && fileOpenCount > 0) {
              const trimmedCode = generatedCode.trim();
              const lastLines = trimmedCode.split('\n').slice(-3).join('\n'); // 检查最后3行

              // 计算最后几行的引号数量
              const singleQuotes = (lastLines.match(/'/g) || []).length;
              const doubleQuotes = (lastLines.match(/"/g) || []).length;
              const backticks = (lastLines.match(/`/g) || []).length;

              // 如果引号数量是奇数，说明有未闭合的字符串
              if (singleQuotes % 2 !== 0 || doubleQuotes % 2 !== 0 || backticks % 2 !== 0) {
                // 进一步确认：检查最后一行是否看起来像截断
                const lastLine = trimmedCode.split('\n').pop() || '';
                const looksLikeTruncation =
                  !lastLine.endsWith(';') &&
                  !lastLine.endsWith('}') &&
                  !lastLine.endsWith(')') &&
                  !lastLine.endsWith('>') &&
                  !lastLine.endsWith('</file>');

                if (looksLikeTruncation) {
                  quickTruncationDetected = true;
                  console.warn(`[generate-ai-code-stream] 🚨 Quick check: String truncated (quotes: single=${singleQuotes}, double=${doubleQuotes}, backtick=${backticks})`);
                }
              }
            }

            // 🔥 Check 8: 数组/对象中间截断检测（括号不匹配）
            if (!quickTruncationDetected && fileOpenCount > 0) {
              // 获取最后一个文件的内容
              const lastFileMatch = generatedCode.match(/<file\s+path="[^"]+">([^]*?)(?:<\/file>|$)/g);
              if (lastFileMatch) {
                const lastFileContent = lastFileMatch[lastFileMatch.length - 1];

                // 计算大括号、方括号、圆括号的数量
                const openBraces = (lastFileContent.match(/\{/g) || []).length;
                const closeBraces = (lastFileContent.match(/\}/g) || []).length;
                const openBrackets = (lastFileContent.match(/\[/g) || []).length;
                const closeBrackets = (lastFileContent.match(/\]/g) || []).length;
                const openParens = (lastFileContent.match(/\(/g) || []).length;
                const closeParens = (lastFileContent.match(/\)/g) || []).length;

                // 如果有明显的不匹配（差异 >= 1），认为是截断
                const braceDiff = openBraces - closeBraces;
                const bracketDiff = openBrackets - closeBrackets;
                const parenDiff = openParens - closeParens;

                // 🔥 调整阈值：任何未闭合的括号都应该触发截断检测
                // 但需要结合其他条件避免误报（如文件未完成）
                const hasUnclosedBrackets = braceDiff >= 1 || bracketDiff >= 1 || parenDiff >= 3;
                const lastFileClosed = lastFileContent.includes('</file>');

                if (hasUnclosedBrackets && !lastFileClosed) {
                  quickTruncationDetected = true;
                  console.warn(`[generate-ai-code-stream] 🚨 Quick check: Brackets unbalanced (braces: +${braceDiff}, brackets: +${bracketDiff}, parens: +${parenDiff})`);
                }

                // 额外检查：最后一行是否以逗号结尾且在数组/对象内部
                const lastLine = lastFileContent.split('\n').pop() || '';
                const trimmedLastLine = lastLine.trim();
                if (trimmedLastLine.endsWith(',') && (openBraces > closeBraces || openBrackets > closeBrackets)) {
                  quickTruncationDetected = true;
                  console.warn('[generate-ai-code-stream] 🚨 Quick check: Array/object element truncated (ends with comma in unclosed structure)');
                }
              }
            }
          }

          // Decide on continuation: either by finishReason OR by truncation detection
          if ((finishReason === 'length' || quickTruncationDetected) && loopCount < maxLoops) {
              continueGeneration = true;
              const reason = quickTruncationDetected ? 'truncation detected' : 'token limit reached';
              console.log(`[generate-ai-code-stream] 🔄 Output incomplete (loop ${loopCount}, reason: ${reason}), continuing generation...`);
              await sendProgress({ type: 'status', message: `Output incomplete (${reason}), continuing generation...` });
          } else {
              continueGeneration = false;
              if (quickTruncationDetected && loopCount >= maxLoops) {
                console.error(`[generate-ai-code-stream] ❌ Truncation detected but max loops (${maxLoops}) reached!`);
              }
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
        // 🔥 使用灵活空白正则
        const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
        const files = [];
        let match;
        
        while ((match = fileRegex.exec(generatedCode)) !== null) {
          const filePath = match[1];
          let content = match[2].trim();
          
          // Clean up any <thinking> tags that might have leaked into the file content
          // This happens especially during continuation when the model restarts thinking
          content = content.replace(/<thinking>[\s\S]*?<\/thinking>/g, '').trim();

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
        // 🔥 使用灵活空白正则
        const fileOpenCount = (generatedCode.match(/<file\s+path="/g) || []).length;
        const fileCloseCount = (generatedCode.match(/<\/file>/g) || []).length;
        if (fileOpenCount !== fileCloseCount) {
          truncationWarnings.push(`Unclosed file tags detected: ${fileOpenCount} open, ${fileCloseCount} closed`);
        }
        
        // Check for files that seem truncated (very short or ending abruptly)
        // 🔥 使用灵活空白正则
        const truncationCheckRegex = /<file\s+path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
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

          // 🔥 hasIndexCss 不再需要单独检查，由通用依赖验证处理

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
          }

          // 🔥 通用依赖验证和自动补全（包括 CSS 文件）
          const dependencyIssues = validateDependencies(files);
          if (dependencyIssues.length > 0) {
            console.log(`[generate-ai-code-stream] 📋 检测到 ${dependencyIssues.length} 个依赖问题`);
            dependencyIssues.forEach(issue => {
              console.log(`[generate-ai-code-stream]   - ${issue.severity}: ${issue.message}`);
            });

            // 自动补全缺失的文件（主要是 CSS 文件）
            const { completedFiles, remainingIssues } = autoCompleteMissingFiles(files, dependencyIssues);

            if (completedFiles.length > 0) {
              console.log(`[generate-ai-code-stream] ✅ 自动补全了 ${completedFiles.length} 个文件:`);
              completedFiles.forEach(f => {
                console.log(`[generate-ai-code-stream]   - ${f.path}`);
                files.push(f);
              });
            }

            // 将无法自动补全的问题添加到警告列表
            remainingIssues.forEach(issue => {
              if (issue.severity === 'error') {
                truncationWarnings.push(`${issue.message} (${issue.suggestion})`);
              }
            });
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
          // 🔥 使用灵活空白正则
          const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
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

        // ===========================
        // 处理 <fix-imports> 标签（续写时AI补充的import）
        // ===========================
        const fixImportsRegex = /<fix-imports\s+file="([^"]+)">([\s\S]*?)<\/fix-imports>/g;
        let fixImportMatch;
        const importFixes: Map<string, string[]> = new Map();

        while ((fixImportMatch = fixImportsRegex.exec(generatedCode)) !== null) {
          const targetFile = fixImportMatch[1];
          const importsToAdd = fixImportMatch[2].trim().split('\n').filter(line => line.trim());

          if (!importFixes.has(targetFile)) {
            importFixes.set(targetFile, []);
          }
          importFixes.get(targetFile)!.push(...importsToAdd);
          console.log(`[generate-ai-code-stream] 📦 Found fix-imports for ${targetFile}: ${importsToAdd.length} imports`);
        }

        // 从生成代码中移除 <fix-imports> 标签
        generatedCode = generatedCode.replace(fixImportsRegex, '');

        // 将补充的 import 应用到对应文件
        if (importFixes.size > 0) {
          // 🔥 使用灵活空白正则
          const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
          generatedCode = generatedCode.replace(fileRegex, (match, filePath, content) => {
            const additionalImports = importFixes.get(filePath);
            if (additionalImports && additionalImports.length > 0) {
              // 找到第一个非注释、非空行的位置，在其前面插入 imports
              const lines = content.split('\n');
              let insertIndex = 0;

              // 跳过已有的 import 语句
              for (let i = 0; i < lines.length; i++) {
                const trimmed = lines[i].trim();
                if (trimmed.startsWith('import ')) {
                  insertIndex = i + 1;
                } else if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*')) {
                  break;
                }
              }

              // 去重：只添加不存在的 import
              const existingImports = content.match(/import\s+.*\s+from\s+['"][^'"]+['"]/g) || [];
              const newImports = additionalImports.filter(imp => {
                const normalizedNew = imp.replace(/;$/, '').trim();
                return !existingImports.some((existing: string) =>
                  existing.replace(/;$/, '').trim() === normalizedNew
                );
              });

              if (newImports.length > 0) {
                lines.splice(insertIndex, 0, ...newImports.map(imp => imp.endsWith(';') ? imp : imp + ';'));
                console.log(`[generate-ai-code-stream] ✅ Added ${newImports.length} imports to ${filePath}`);
                return `<file path="${filePath}">${lines.join('\n')}</file>`;
              }
            }
            return match;
          });
        }

        // ===========================
        // 生成阶段依赖自检与自动补全（更彻底的闭环）
        // ===========================
        try {
          // 保留原始生成结果中的非 <file> 段落（packages/commands/structure 等），避免自动补全后丢失元信息
          const nonFileSections =
            generatedCode.match(/<(package|packages|explanation|command|structure|template)[\s\S]*?<\/\1>/g) || [];
          const nonFileText = nonFileSections.join('\n\n');

          const extractedFiles = extractFiles(generatedCode);
          const depIssues = validateDependencies(extractedFiles);
          const completenessIssues = validateCompleteness(extractedFiles);
          const fixableErrors = [...depIssues, ...completenessIssues].filter(i => i.severity === 'error');

          if (fixableErrors.length > 0) {
            console.warn('[generate-ai-code-stream] 🔧 Detected dependency/completeness errors, starting auto-fix:', fixableErrors);
            await sendProgress({
              type: 'status',
              message: `检测到 ${fixableErrors.length} 个依赖/截断问题，开始自动补全...`
            });

            const fixResult = await autoFix(
              generatedCode,
              modelProvider(actualModel),
              2
            );

            if (fixResult.fixedFiles.length > 0) {
              generatedCode = assembleGeneratedCode(fixResult.fixedFiles);
              if (nonFileText.trim()) {
                generatedCode += `\n\n${nonFileText}\n`;
              }

              // 重新计算 files/componentCount，确保前端拿到的是修复后的结构
              files.length = 0;
              const reExtracted = extractFiles(generatedCode);
              for (const f of reExtracted) {
                files.push({ path: f.path, content: f.content });
              }
              componentCount = reExtracted.filter(f => f.path.includes('components/')).length;

              console.log('[generate-ai-code-stream] ✅ Auto-fix applied. Remaining issues:', fixResult.remainingIssues);
              await sendProgress({
                type: 'status',
                message: '自动补全完成，已生成缺失文件。'
              });
            }
          }
        } catch (autoFixError) {
          console.error('[generate-ai-code-stream] Auto-fix failed:', autoFixError);
          await sendProgress({
            type: 'warning',
            message: '自动补全阶段发生错误，请手动检查生成结果。'
          });
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
        // 安全关闭 writer，避免在 stream 已关闭时抛出异常
        try {
          await writer.close();
        } catch (closeError) {
          // Stream 可能已被关闭（客户端断开连接），忽略关闭错误
          console.log('[generate-ai-code-stream] Stream already closed, skipping close()');
        }
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

// =============================================================================
// 🔥 V3.0 分段生成策略辅助函数
// =============================================================================

/**
 * 生成文件清单 (Manifest Generation)
 * 目的：先让AI规划需要创建哪些文件，避免一次性生成导致token超限
 */
async function generateManifest(
  prompt: string,
  context: any,
  model: string,
  modelProvider: any,
  actualModel: string
): Promise<FileManifestItem[]> {
  console.log('[generateManifest] 开始生成文件清单...');

  const manifestPrompt = `
分析以下需求，生成需要创建的文件清单（仅列出文件，不生成代码）。

用户需求：
${prompt}

${context?.currentFiles ? `
现有文件：
${Object.keys(context.currentFiles).map(f => `- ${f}`).join('\n')}
` : ''}

请以 JSON 格式输出文件清单（只输出 JSON，不要 Markdown 代码块，不要解释文字），格式如下：
{
  "files": [
    {
      "path": "src/App.jsx",
      "description": "应用主入口，配置路由和全局状态",
      "type": "page",
      "dependencies": ["src/components/Header.jsx", "src/pages/Home.jsx"],
      "isCritical": true,
      "estimatedLines": 50
    }
  ]
}

🚨 强约束（务必遵守）：
1. 输出必须是完整 JSON（以 { 开始，以 } 结束），不能截断
2. files 数组不能为空；文件数量控制在 3-30 个之间（避免列出图片/字体等二进制资源）
3. dependencies 不确定可填空数组；type 不确定可填 other
4. 描述保持简短，避免过长导致输出被截断

示例（仅示例，不要照抄）：
\`\`\`json
{
  "files": [
    {
      "path": "src/App.jsx",
      "description": "应用主入口，配置路由和全局状态",
      "type": "page",
      "dependencies": ["src/components/Header.jsx", "src/pages/Home.jsx"],
      "isCritical": true,
      "estimatedLines": 50
    },
    {
      "path": "src/components/Header.jsx",
      "description": "页头组件，包含导航和Logo",
      "type": "component",
      "dependencies": [],
      "isCritical": false,
      "estimatedLines": 30
    }
  ]
}
\`\`\`

🎯 注意事项：
1. path 必须是完整的相对路径（从项目根目录开始）
2. type 必须是：component | page | api | lib | config | style | other
3. dependencies 列出直接依赖的文件路径
4. isCritical 标记是否为核心功能文件
5. estimatedLines 预估代码行数（可选）
6. 按依赖关系排序：被依赖的文件排在前面

只输出 JSON，不要其他解释。`;

	  const runModel = async (userContent: string): Promise<string> => {
	    const result = await streamText({
	      model: modelProvider(actualModel),
	      messages: [
        {
          role: 'system',
          content: '你是一个专业的前端架构师，擅长分析需求并规划项目文件结构。'
        },
        {
          role: 'user',
          content: userContent
        }
	      ],
	      temperature: 0.2, // 尽量降低随机性，减少格式漂移/截断风险
	    });

	    let text = '';
	    let reasoningText = '';
	    let lastStreamError: unknown = undefined;

	    // 用 fullStream 捕获 error/reasoning，避免 textStream 吞掉底层异常导致“空内容”
	    for await (const part of result.fullStream) {
	      if (part.type === 'text-delta') {
	        text += part.text;
	      } else if (part.type === 'reasoning-delta') {
	        reasoningText += part.text;
	      } else if (part.type === 'error') {
	        lastStreamError = part.error;
	      }
	    }

	    if (text.trim().length > 0) return text;
	    if (reasoningText.trim().length > 0) return reasoningText;

	    const streamErrorMessage = formatUnknownError(lastStreamError);
	    if (streamErrorMessage) throw new Error(streamErrorMessage);
	    return text;
	  };

  try {
    // 1) 首次生成
    const firstOutput = await runModel(manifestPrompt);
    console.log('[generateManifest] AI 输出:', firstOutput);

	    // ⚠️ 检查输出是否为空（可能是 API 调用失败）
	    if (!firstOutput || firstOutput.trim().length === 0) {
	      console.error('[generateManifest] ❌ AI 输出为空，可能是 API 调用失败（rate limit 或网络错误）');
	      throw new Error('API 返回空内容，请稍后重试或切换模型');
	    }

    const parsedFirst = parseManifestFromModelOutput(firstOutput);
    if (parsedFirst.length > 0) {
      console.log(`[generateManifest] 成功生成 ${parsedFirst.length} 个文件的清单`);
      return parsedFirst;
    }

    // 2) 本地兜底：即使 JSON 被截断，也尽量从片段中提取 path，避免 0 文件
    const recoveredFirst = recoverManifestFromModelOutput(firstOutput);
    if (recoveredFirst.length > 0) {
      console.warn(`[generateManifest] ⚠️ JSON 解析失败，已从片段恢复 ${recoveredFirst.length} 个文件`);
      return recoveredFirst;
    }

    // 3) 二次兜底：让模型仅输出“修复后的完整 JSON”
    const repairPrompt = `
你上一次输出的文件清单不是可解析的 JSON（可能被截断或混入了非 JSON 文本）。
请根据用户需求，重新输出一份“完整、可解析、只包含 JSON”的文件清单。

要求：
1) 只输出 JSON（不要 Markdown 代码块、不要解释文字）
2) 输出必须以 { 开始，以 } 结束，并包含 "files" 数组
3) 文件数量控制在 3-30 个之间（避免列出图片/字体等二进制资源）
4) 每个文件至少包含：path、description、type、dependencies（dependencies 可为空数组；type 不确定可用 other）

用户需求：
${prompt}

${context?.currentFiles ? `
现有文件（仅供参考）：
${Object.keys(context.currentFiles).slice(0, 50).map(f => `- ${f}`).join('\n')}
${Object.keys(context.currentFiles).length > 50 ? `... 共 ${Object.keys(context.currentFiles).length} 个文件` : ''}
` : ''}

上一次输出（可能不完整，仅供参考）：
${firstOutput.slice(0, 6000)}
`;

    const secondOutput = await runModel(repairPrompt);
    console.log('[generateManifest] AI 修复输出:', secondOutput);

    const parsedSecond = parseManifestFromModelOutput(secondOutput);
    if (parsedSecond.length > 0) {
      console.log(`[generateManifest] 修复后成功生成 ${parsedSecond.length} 个文件的清单`);
      return parsedSecond;
    }

    const recoveredSecond = recoverManifestFromModelOutput(secondOutput);
    if (recoveredSecond.length > 0) {
      console.warn(`[generateManifest] ⚠️ 修复输出仍无法解析 JSON，已从片段恢复 ${recoveredSecond.length} 个文件`);
      return recoveredSecond;
    }

    throw new Error('AI 输出的文件清单无法解析为有效 JSON（可能被截断），请重试或简化需求。');
  } catch (error) {
    console.error('[generateManifest] 生成文件清单失败:', error);
    throw error;
  }
}

/**
 * 生成单个文件 (Single File Generation)
 * 目的：基于清单逐个生成文件，保持代码完整性
 */
async function generateSingleFile(
  manifestItem: FileManifestItem,
  manifest: FileManifestItem[],
  prompt: string,
  context: any,
  model: string,
  modelProvider: any,
  actualModel: string,
  systemPrompt: string,
  sendProgress?: (data: any) => Promise<void>
): Promise<{ path: string; content: string }> {
  console.log(`[generateSingleFile] 开始生成文件: ${manifestItem.path}`);

  /**
   * 从模型输出中提取单文件内容。
   *
   * 兼容常见偏差：
   * - 未按要求输出 <file> 包裹，改成了 Markdown code block
   * - 在 <file> 外多输出了说明文字
   */
  const extractSingleFileContentFromModelOutput = (output: string, filePath: string): string | null => {
    if (!output || typeof output !== 'string') return null;

    // 1) 标准 <file path="...">...</file>
    const fileTagMatches = [
      output.match(/<file\s+path="[^"]+"\s*>\s*([\s\S]*?)\s*<\/file>/i),
      output.match(/<file\s+path='[^']+'\s*>\s*([\s\S]*?)\s*<\/file>/i),
      output.match(/<file[^>]*>\s*([\s\S]*?)\s*<\/file>/i),
    ];
    for (const m of fileTagMatches) {
      if (m && m[1]) return m[1].trim();
    }

    // 2) Markdown code fence：```jsx ... ```
    const fenceMatches = [...output.matchAll(/```[a-zA-Z]*\s*([\s\S]*?)```/g)];
    if (fenceMatches.length > 0) {
      const best = fenceMatches.reduce((a, b) => (a[1].length >= b[1].length ? a : b));
      const code = best[1].trim();
      if (code) return stripNonCodePreamble(code, filePath);
    }

    // 3) 兜底：去掉可能的围栏并尝试裁剪前导说明
    const cleaned = output
      .replace(/```[a-zA-Z]*\s*/g, '')
      .replace(/```/g, '')
      .trim();

    if (!cleaned) return null;
    return stripNonCodePreamble(cleaned, filePath);
  };

  /**
   * 尝试移除模型在代码前面输出的自然语言前导（例如 “下面是代码：”）。
   * 这是启发式处理，只在明显匹配时才裁剪。
   */
  const stripNonCodePreamble = (text: string, filePath: string): string => {
    const ext = (filePath.split('.').pop() || '').toLowerCase();
    const candidates: Array<{ token: string; index: number }> = [];

    const pushIndex = (token: string) => {
      const idx = text.indexOf(token);
      if (idx >= 0) candidates.push({ token, index: idx });
    };

    if (['js', 'jsx', 'ts', 'tsx'].includes(ext)) {
      pushIndex('import ');
      pushIndex('export ');
      pushIndex('const ');
      pushIndex('function ');
      pushIndex('class ');
      pushIndex('//');
      pushIndex('/*');
    } else if (ext === 'css') {
      pushIndex('@tailwind');
      pushIndex(':root');
      pushIndex('body');
      pushIndex('html');
      pushIndex('/*');
    } else if (ext === 'json') {
      pushIndex('{');
      pushIndex('[');
    }

    if (candidates.length === 0) return text.trim();
    const start = candidates.sort((a, b) => a.index - b.index)[0].index;
    return start > 0 ? text.slice(start).trim() : text.trim();
  };

  // 获取依赖文件的内容（如果已生成）
  const dependencyContents: string[] = [];
  if (manifestItem.dependencies && context?.currentFiles) {
    for (const depPath of manifestItem.dependencies) {
      const depContent = context.currentFiles[depPath];
      if (depContent) {
        dependencyContents.push(`
// 依赖文件: ${depPath}
${depContent.substring(0, 500)}... // 截取前500字符作为参考
`);
      }
    }
  }

  const filePath = manifestItem.path;
  const fileExt = (filePath.split('.').pop() || '').toLowerCase();
  const isEntryFile = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts'].includes(filePath);
  const isCssFile = ['css', 'scss', 'sass', 'less'].includes(fileExt);
  const isJsonFile = fileExt === 'json';
  const requiresDefaultExport =
    !isEntryFile &&
    !isCssFile &&
    !isJsonFile &&
    (manifestItem.type === 'component' || manifestItem.type === 'page') &&
    ['js', 'jsx', 'ts', 'tsx'].includes(fileExt);

  const requirementLines: string[] = [
    `- 只生成 ${filePath} 这一个文件`,
    `- 输出必须是且仅是一个 <file path="${filePath}">...</file>（标签外不要输出任何文字/Markdown）`,
    `- 内容必须完整，严禁使用省略号（...）`
  ];

  if (!isCssFile && !isJsonFile) {
    requirementLines.push('- 所有 import 必须在文件顶部（如果该文件需要 import）');
  }
  if (requiresDefaultExport) {
    requirementLines.push('- 必须包含 export default');
  }
  if (isEntryFile) {
    requirementLines.push('- 入口文件：使用 ReactDOM.createRoot 挂载 <App />，并引入 ./index.css');
  }
  if (isCssFile) {
    requirementLines.push('- 只输出 CSS（可包含 Tailwind 指令），不要输出 JS/TS');
  }
  if (isJsonFile) {
    requirementLines.push('- 只输出纯 JSON 内容，必须可被 JSON.parse 解析');
    requirementLines.push('- JSON 格式必须标准：每个键值对只出现一次，格式为 "key": "value"');
    requirementLines.push('- 严禁重复输出键名或值，严禁在值后面添加额外文本');
    requirementLines.push('- 不要添加注释或说明文字（JSON 不支持注释）');
  }

  const filePrompt = `
生成文件：${filePath}

文件描述：${manifestItem.description}
文件类型：${manifestItem.type}

${dependencyContents.length > 0 ? `
依赖的文件（参考）：
${dependencyContents.join('\n')}
` : ''}

原始需求：
${prompt}

🎯 关键要求：
${requirementLines.join('\n')}

输出格式（严格遵守）：
<file path="${filePath}">
${isJsonFile ? '{ ... 完整的JSON内容 ... }' : '// 完整的文件代码'}
</file>`;

  try {
    const generateOnce = async (attempt: number) => {
      const extraStrict =
        attempt > 1
          ? '\n⚠️ 上一次输出未按 <file> 格式返回，本次必须严格按格式输出，否则视为失败。'
          : '';

      const result = await streamText({
        model: modelProvider(actualModel),
        messages: [
          {
            role: 'system',
            content: systemPrompt + `

🔥 单文件生成模式 - 特殊规则：
1. 只生成一个文件：${filePath}
2. 输出必须是且仅是一个 <file path="${filePath}">...</file>
3. <file> 标签外不要输出任何文字、说明或 Markdown
4. 确保代码完整无截断，严禁使用省略号（...）
5. import 必须在文件顶部（如果该文件需要 import）${extraStrict}`
          },
          {
            role: 'user',
            content: filePrompt
          }
        ],
        temperature: attempt > 1 ? 0.2 : 0.5,
        maxOutputTokens: 16000, // 增加输出长度限制，防止截断
      });

      let raw = '';
      try {
        for await (const chunk of result.textStream) {
          raw += chunk;
          // 🔥 打字机效果：实时发送代码块给前端
          if (sendProgress) {
            await sendProgress({
              type: 'codeChunk',
              chunk: chunk,
              filePath: manifestItem.path
            });
          }
        }
      } catch (streamError: any) {
        console.error(`[generateSingleFile] Stream error for ${filePath}:`, streamError.message);
        throw new Error(`AI API 流式响应错误: ${streamError.message}`);
      }

      // 检查是否返回了空内容（可能是 API 错误导致）
      if (!raw || raw.trim().length === 0) {
        throw new Error('AI API 返回了空内容，可能是服务暂时不可用');
      }

      return raw;
    };

    // 最多尝试 2 次，包括 API 错误和格式偏差
    let fileContent = '';
    let content: string | null = null;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        fileContent = await generateOnce(attempt);
        content = extractSingleFileContentFromModelOutput(fileContent, filePath);

        if (content) {
          break; // 成功提取内容，退出循环
        }

        console.warn(`[generateSingleFile] ⚠️ 第 ${attempt} 次未能提取内容: ${filePath}`);
        lastError = new Error(`无法从输出中提取文件内容`);
      } catch (error: any) {
        console.warn(`[generateSingleFile] ⚠️ 第 ${attempt} 次生成失败: ${filePath} - ${error.message}`);
        lastError = error;

        if (attempt < 2) {
          // 如果是 API 错误，等待一下再重试
          console.log(`[generateSingleFile] 等待 3 秒后重试...`);
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }
    }

    if (!content) {
      const errorMsg = lastError?.message || '未知错误';
      throw new Error(`无法从输出中提取文件内容。错误: ${errorMsg}。输出: ${fileContent.substring(0, 400)}...`);
    }

    console.log(`[generateSingleFile] ${filePath} 生成完成，长度: ${content.length}`);

    // ���� 增强截断检测：检查多种截断标志
    let isTruncated = false;
    const truncationReasons: string[] = [];

    // 1. 检查明显的截断标记
    if (content.includes('...') && !content.includes('// ...') && !content.includes('...props') && !content.includes('...rest')) {
      truncationReasons.push('包含省略号');
    }

    // 2. 检查引号匹配
    const doubleQuotes = (content.match(/"/g) || []).length;
    const backticks = (content.match(/`/g) || []).length;
    if (doubleQuotes % 2 !== 0) {
      truncationReasons.push(`双引号不匹配 (${doubleQuotes}个)`);
      isTruncated = true;
    }
    if (backticks % 2 !== 0) {
      truncationReasons.push(`反引号不匹配 (${backticks}个)`);
      isTruncated = true;
    }

    // 3. 检查括号匹配 - 更严格
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;
    if (openBraces > closeBraces + 1) {
      truncationReasons.push(`大括号不匹配 ({:${openBraces}, }:${closeBraces})`);
      isTruncated = true;
    }

    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;
    if (openParens > closeParens + 1) {
      truncationReasons.push(`圆括号不匹配 ((:${openParens}, ):${closeParens})`);
      isTruncated = true;
    }

    const openBrackets = (content.match(/\[/g) || []).length;
    const closeBrackets = (content.match(/\]/g) || []).length;
    if (openBrackets > closeBrackets + 1) {
      truncationReasons.push(`方括号不匹配 ([:${openBrackets}, ]:${closeBrackets})`);
      isTruncated = true;
    }

    // 4. 检查文件是否在不完整的位置结束
    const trimmed = content.trim();
    const lastLine = trimmed.split('\n').pop() || '';

    if (trimmed.endsWith('="') || trimmed.endsWith("='") || trimmed.endsWith('=`') ||
        trimmed.endsWith('(') || trimmed.endsWith('{') || trimmed.endsWith('[')) {
      truncationReasons.push(`文件在不完整位置结束: ...${trimmed.slice(-30)}`);
      isTruncated = true;
    }

    // 5. 检查是否以逗号结尾（在数组或对象中截断）
    if (trimmed.endsWith(',') && !trimmed.endsWith('},') && !trimmed.endsWith('],')) {
      truncationReasons.push(`文件以逗号结尾，可能在数组/对象中截断`);
      isTruncated = true;
    }

    // 6. 检查对象字面量是否在中间截断
    if (lastLine.match(/{\s*\w+:\s*["'][^"']*["'],?\s*$/) && !lastLine.includes('}')) {
      truncationReasons.push(`对象字面量不完整: ${lastLine.slice(-50)}`);
      isTruncated = true;
    }

    if (isTruncated) {
      console.error(`[generateSingleFile] ❌ 文件 ${filePath} 检测到截断:`, truncationReasons);
      // 尝试重新生成，最多重试2次
      for (let retry = 1; retry <= 2; retry++) {
        console.log(`[generateSingleFile] 🔄 尝试重新生成 ${filePath} (第${retry}次重试)...`);
        const retryContent = await generateOnce(2 + retry);
        const retryExtracted = extractSingleFileContentFromModelOutput(retryContent, filePath);
        if (retryExtracted && retryExtracted.length > content.length) {
          // 检查重试后的内容是否完整
          const retryTrimmed = retryExtracted.trim();
          const retryOpenBraces = (retryExtracted.match(/{/g) || []).length;
          const retryCloseBraces = (retryExtracted.match(/}/g) || []).length;
          const retryDoubleQuotes = (retryExtracted.match(/"/g) || []).length;

          if (retryOpenBraces <= retryCloseBraces + 1 &&
              retryDoubleQuotes % 2 === 0 &&
              !retryTrimmed.endsWith(',') &&
              !retryTrimmed.endsWith('{') &&
              !retryTrimmed.endsWith('[')) {
            console.log(`[generateSingleFile] ✅ 重新生成成功，新长度: ${retryExtracted.length} (原: ${content.length})`);
            content = retryExtracted;
            break;
          } else {
            console.warn(`[generateSingleFile] ⚠️ 重试${retry}内容仍不完整，继续重试...`);
            if (retryExtracted.length > content.length) {
              content = retryExtracted;
            }
          }
        }
      }
    }

    return {
      path: filePath,
      content: content
    };

  } catch (error) {
    console.error(`[generateSingleFile] 生成文件失败: ${manifestItem.path}`, error);
    throw new Error(`文件生成失败 (${manifestItem.path}): ${(error as Error).message}`);
  }
}

/**
 * 从技术方案 Markdown 中提取建议的文件清单（manifest）。
 *
 * 为什么需要：模型在输出 Markdown 时，JSON 代码块可能出现：
 * - 代码块不止一个、顺序变化
 * - JSON 有轻微格式瑕疵（常见：尾逗号）
 *
 * 这里做"尽量解析"的本地修复，减少因为解析失败导致的 0 文件问题。
 */
function extractSuggestedManifestFromPlan(planContent: string): FileManifestItem[] {
  const candidates: string[] = [];

  // 1) 优先提取 ```json ... ``` 代码块（可能出现多个）
  const jsonFenceRegex = /```json\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFenceRegex.exec(planContent)) !== null) {
    candidates.push(match[1]);
  }

  // 2) 兜底：提取所有 ``` ... ``` 代码块，并筛选包含 files 结构的候选
  const anyFenceRegex = /```\s*([\s\S]*?)\s*```/gi;
  while ((match = anyFenceRegex.exec(planContent)) !== null) {
    const block = match[1];
    if (typeof block === 'string' && block.includes('"files"')) {
      candidates.push(block);
    }
  }

  // 3) 再兜底：有些模型会直接输出裸 JSON（不包裹 code fence），这里把全文也作为候选尝试一次
  candidates.push(planContent);

  // 4) 逐个尝试解析，找到第一个有效的 manifest
  for (const candidate of candidates) {
    const parsed = tryParseManifestJson(candidate);
    if (parsed.length > 0) return parsed;
  }

  // 5) JSON 解析全部失败时，尝试从文本中恢复文件路径
  const recovered = recoverManifestFromModelOutput(planContent);
  if (recovered.length > 0) {
    console.log(`[extractSuggestedManifestFromPlan] ⚠️ JSON 解析失败，从文本中恢复了 ${recovered.length} 个文件路径`);
    return recovered;
  }

  // 6) 最后兜底：从 Markdown 中提取文件路径模式（如 src/xxx.tsx）
  const pathsFromMarkdown = extractFilePathsFromMarkdown(planContent);
  if (pathsFromMarkdown.length > 0) {
    console.log(`[extractSuggestedManifestFromPlan] ⚠️ 从 Markdown 文本中提取了 ${pathsFromMarkdown.length} 个文件路径`);
    return pathsFromMarkdown;
  }

  return [];
}

/**
 * 从 Markdown 文本中提取文件路径（最后的兜底方案）
 * 匹配常见的文件路径模式，如：
 * - src/components/Header.tsx
 * - app/page.tsx
 * - index.html
 */
function extractFilePathsFromMarkdown(content: string): FileManifestItem[] {
  const pathPatterns = [
    // 匹配 src/ 或 app/ 开头的路径
    /(?:^|\s|`|"|'|\()((?:src|app|pages|components|lib|utils|hooks|styles|public)\/[\w\-\/]+\.(?:tsx?|jsx?|css|scss|html|json))/gim,
    // 匹配列表项中的文件路径 (- src/xxx.tsx 或 * src/xxx.tsx)
    /^[\s]*[-*]\s*([\w\-\/]+\.(?:tsx?|jsx?|css|scss|html|json))/gim,
    // 匹配 index.xxx 或 main.xxx
    /(?:^|\s|`|"|'|\()((?:index|main|App|app)\.(?:tsx?|jsx?|css|html))/gim,
    // 匹配配置文件
    /(?:^|\s|`|"|'|\()((tailwind|vite|next|postcss|tsconfig)\.config\.(?:js|ts|mjs|json))/gim,
    /(?:^|\s|`|"|'|\()(package\.json)/gim,
  ];

  const seenPaths = new Set<string>();
  const items: FileManifestItem[] = [];

  for (const pattern of pathPatterns) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(content)) !== null) {
      const path = (match[1] || '').trim();
      if (!path || seenPaths.has(path)) continue;

      // 过滤掉明显不是文件路径的匹配
      if (path.includes('...') || path.includes('example') || path.length < 3) continue;

      seenPaths.add(path);
      items.push({
        path,
        description: `从方案中提取的文件`,
        type: normalizeRecoveredManifestType(path, ''),
        dependencies: [],
        isCritical: path.includes('App') || path.includes('index') || path.includes('main'),
        estimatedLines: 50
      });
    }
  }

  // 按路径排序，让入口文件排在前面
  return items.sort((a, b) => {
    const aIsEntry = a.path.includes('App') || a.path.includes('index') || a.path.includes('main');
    const bIsEntry = b.path.includes('App') || b.path.includes('index') || b.path.includes('main');
    if (aIsEntry && !bIsEntry) return -1;
    if (!aIsEntry && bIsEntry) return 1;
    return a.path.localeCompare(b.path);
  });
}

/**
 * 从模型输出中尽量解析出 manifest（优先严格 JSON，失败则返回空数组）。
 */
function parseManifestFromModelOutput(output: string): FileManifestItem[] {
  if (!output || typeof output !== 'string') return [];

  const candidates: string[] = [];

  // 1) 提取 ```json ... ```（可能存在多个）
  const jsonFenceRegex = /```json\s*([\s\S]*?)\s*```/gi;
  let match: RegExpExecArray | null;
  while ((match = jsonFenceRegex.exec(output)) !== null) {
    candidates.push(match[1]);
  }

  // 2) 提取通用 code fence，并筛选疑似 JSON 的块
  const anyFenceRegex = /```\s*([\s\S]*?)\s*```/gi;
  while ((match = anyFenceRegex.exec(output)) !== null) {
    const block = match[1];
    if (!block || typeof block !== 'string') continue;
    const trimmed = block.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[') || trimmed.includes('"files"')) {
      candidates.push(block);
    }
  }

  // 3) 从全文截取“最外层看起来像 JSON”的片段（应对模型在 JSON 前后混入少量文字）
  const firstBrace = output.indexOf('{');
  const lastBrace = output.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    candidates.push(output.slice(firstBrace, lastBrace + 1));
  }

  const firstBracket = output.indexOf('[');
  const lastBracket = output.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    candidates.push(output.slice(firstBracket, lastBracket + 1));
  }

  // 4) 全文兜底：有些模型会直接输出裸 JSON（不包裹 code fence）
  candidates.push(output);

  // 去重 + 依次尝试解析
  const seen = new Set<string>();
  for (const candidate of candidates) {
    const normalized = (candidate || '').trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    const parsed = tryParseManifestJson(normalized);
    if (parsed.length > 0) return parsed;
  }

  return [];
}

/**
 * 当 JSON 解析失败时，尽量从片段中恢复 path 列表，避免流程直接退化到 0 文件。
 *
 * 说明：
 * - 最常见的失败原因是模型输出在数组/对象中间被截断（SyntaxError: Unexpected end of JSON input）
 * - 此时虽然 JSON 不完整，但 `"path": "..."` 往往已经输出，可用于恢复最小可用 manifest
 */
function recoverManifestFromModelOutput(output: string): FileManifestItem[] {
  if (!output || typeof output !== 'string') return [];

  const matches = [
    ...output.matchAll(/"path"\s*:\s*"([^"]+)"/g),
    ...output.matchAll(/"path"\s*:\s*'([^']+)'/g),
  ];

  if (matches.length === 0) return [];

  const items: FileManifestItem[] = [];
  const seenPaths = new Set<string>();

  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const path = (m[1] || '').trim();
    if (!path) continue;
    // 粗筛：避免把 URL/无意义字段误判为路径
    if (path.startsWith('http://') || path.startsWith('https://')) continue;
    if (!path.includes('/')) continue;

    if (seenPaths.has(path)) continue;
    seenPaths.add(path);

    const start = typeof m.index === 'number' ? m.index : 0;
    const end = (i + 1 < matches.length && typeof matches[i + 1].index === 'number')
      ? (matches[i + 1].index as number)
      : Math.min(output.length, start + 1200);
    const segment = output.slice(start, end);

    const descriptionMatch =
      segment.match(/"description"\s*:\s*"([^"]*)"/) ||
      segment.match(/"description"\s*:\s*'([^']*)'/);
    const description = descriptionMatch ? String(descriptionMatch[1] || '').trim() : '';

    const typeMatch =
      segment.match(/"type"\s*:\s*"([^"]+)"/) ||
      segment.match(/"type"\s*:\s*'([^']+)'/);
    const rawType = typeMatch ? String(typeMatch[1] || '').trim() : '';
    const type = normalizeRecoveredManifestType(path, rawType);

    items.push({
      path,
      description,
      dependencies: [],
      type,
    });

    // 防止恢复过多导致后续单文件生成压力过大
    if (items.length >= 60) break;
  }

  return items;
}

/**
 * 归一化恢复出来的文件类型；如果模型没有给 type，则按路径启发式推断。
 */
function normalizeRecoveredManifestType(path: string, rawType: string): FileManifestItem['type'] {
  const allowed = new Set<FileManifestItem['type']>([
    'component',
    'page',
    'api',
    'lib',
    'config',
    'style',
    'other',
  ]);
  if (allowed.has(rawType as FileManifestItem['type'])) {
    return rawType as FileManifestItem['type'];
  }

  const lower = path.toLowerCase();
  if (lower.includes('/components/')) return 'component';
  if (lower.includes('/pages/') || lower.includes('/app/')) return 'page';
  if (lower.includes('/api/')) return 'api';
  if (lower.includes('/lib/') || lower.includes('/utils/') || lower.includes('/hooks/')) return 'lib';
  if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.less')) return 'style';
  if (
    lower.endsWith('package.json') ||
    lower.includes('tsconfig') ||
    lower.includes('vite.config') ||
    lower.includes('next.config') ||
    lower.includes('tailwind.config') ||
    lower.includes('postcss.config') ||
    lower.includes('eslint') ||
    lower.includes('prettier')
  ) {
    return 'config';
  }
  return 'other';
}

/**
 * 尝试解析 manifest JSON，并做最小的结构化校验与归一化。
 */
function tryParseManifestJson(rawJson: string): FileManifestItem[] {
  const cleaned = normalizeJsonForParsing(rawJson);
  try {
    const parsed = JSON.parse(cleaned);
    return normalizeManifestFiles(parsed);
  } catch {
    return [];
  }
}

/**
 * 轻量级 JSON 清理（不引入 JSON5 依赖）：
 * - 去掉常见尾逗号：`, }` / `, ]`
 * - 去掉可能残留的代码块围栏
 */
function normalizeJsonForParsing(raw: string): string {
  const trimmed = raw.trim();
  const withoutFences = trimmed
    .replace(/^```(?:json)?/i, '')
    .replace(/```$/i, '')
    .trim();

  // 尾逗号是模型最常见的 JSON 瑕疵之一
  return withoutFences.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * 把解析结果归一化为 FileManifestItem[]（缺字段则补默认值）。
 */
function normalizeManifestFiles(parsed: any): FileManifestItem[] {
  const rawFiles: any[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.files)
      ? parsed.files
      : [];

  const allowedTypes = new Set<FileManifestItem['type']>([
    'component',
    'page',
    'api',
    'lib',
    'config',
    'style',
    'other'
  ]);

  return rawFiles
    .filter(item => item && typeof item === 'object' && typeof item.path === 'string' && item.path.trim())
    .map((item) => ({
      path: String(item.path).trim(),
      description: typeof item.description === 'string' ? item.description : '',
      dependencies: Array.isArray(item.dependencies)
        ? item.dependencies.filter((d: any) => typeof d === 'string')
        : [],
      type: allowedTypes.has(item.type) ? item.type : 'other',
      estimatedLines: typeof item.estimatedLines === 'number' ? item.estimatedLines : undefined,
      isCritical: typeof item.isCritical === 'boolean' ? item.isCritical : undefined,
    }));
}

/**
 * 判断是否启用 E2E/离线 Mock 模式。
 *
 * 目的：让端到端测试在无外部网络/密钥（E2B、Firecrawl、LLM）时也能跑通。
 */
function isE2eMockEnabled(): boolean {
  return process.env.OPEN_LOVABLE_E2E === '1';
}

/**
 * E2E/离线模式下的固定 manifest，用于验证 Plan → Confirm → Code 生成链路。
 */
function getE2eMockManifest(): FileManifestItem[] {
  return [
    {
      path: 'src/components/Header.jsx',
      description: '页面头部组件，包含站点标题与导航',
      type: 'component',
      dependencies: [],
      isCritical: true,
      estimatedLines: 40,
    },
    {
      path: 'src/App.jsx',
      description: '应用主入口，组合页面结构',
      type: 'page',
      dependencies: ['src/components/Header.jsx'],
      isCritical: true,
      estimatedLines: 80,
    },
    {
      path: 'src/index.css',
      description: '全局样式（用于 Tailwind 指令与基础样式）',
      type: 'style',
      dependencies: [],
      isCritical: false,
      estimatedLines: 20,
    }
  ];
}

/**
 * E2E/离线模式下根据文件路径生成固定文件内容。
 */
function getE2eMockFileContent(filePath: string): string {
  if (filePath.endsWith('src/components/Header.jsx')) {
    return `import React from 'react';

export default function Header() {
  return (
    <header className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <div className="text-lg font-semibold text-gray-900">Open Lovable Mock</div>
        <nav className="text-sm text-gray-600 flex gap-4">
          <a href="#" className="hover:text-gray-900">首页</a>
          <a href="#" className="hover:text-gray-900">关于</a>
        </nav>
      </div>
    </header>
  );
}
`;
  }

  if (filePath.endsWith('src/App.jsx')) {
    return `import React from 'react';
import Header from './components/Header';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">代码已成功生成</h1>
        <p className="text-gray-700">这是用于 E2E 验证的 Mock 页面内容。</p>
      </main>
    </div>
  );
}
`;
  }

  if (filePath.endsWith('src/index.css')) {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
  }

  return `// Mock file: ${filePath}\n`;
}

/**
 * E2E/离线 Mock 生成：根据 generation.mode 模拟输出 SSE 事件。
 *
 * 注意：该路由名含 "stream"，因此这里统一走 SSE 输出，便于前端复用解析逻辑。
 */
async function runE2eMockGeneration(
  generation: GenerationConfig,
  sendProgress: (data: any) => Promise<void>
): Promise<void> {
  const manifest = getE2eMockManifest();

  if (generation.mode === 'plan') {
    const planContent = `# 技术实现方案

## 1. 需求分析
- E2E Mock：验证从 Plan 到代码生成的完整链路

## 4. 文件拆解
### 文件清单
\`\`\`json
{
  "files": ${JSON.stringify(manifest, null, 2)}
}
\`\`\`
`;

    await sendProgress({ type: 'plan_chunk', chunk: planContent, totalLength: planContent.length });
    await sendProgress({
      type: 'plan_complete',
      plan: {
        content: planContent,
        suggestedManifest: manifest,
        summary: {
          requirementAnalysis: 'E2E Mock：验证生成流程',
          techStack: ['React', 'Tailwind CSS'],
          architecture: '单页应用（Mock）',
          totalFiles: manifest.length,
          estimatedTime: 1,
          risks: []
        }
      }
    });
    return;
  }

  if (generation.mode === 'manifest') {
    await sendProgress({ type: 'manifest_complete', manifest, totalFiles: manifest.length });
    return;
  }

  if (generation.mode === 'file') {
    const totalFiles = Array.isArray(generation.manifest) && generation.manifest.length > 0
      ? generation.manifest.length
      : manifest.length;
    const fileIndex = typeof generation.fileIndex === 'number' ? generation.fileIndex : 0;

    const selected = Array.isArray(generation.manifest) && generation.manifest[fileIndex]
      ? generation.manifest[fileIndex]
      : manifest[Math.min(fileIndex, manifest.length - 1)];

    const progress = totalFiles > 0 ? Math.round(((fileIndex + 1) / totalFiles) * 100) : 100;
    const isComplete = fileIndex >= totalFiles - 1;

    await sendProgress({
      type: 'file_complete',
      fileIndex,
      totalFiles,
      file: {
        path: selected.path,
        content: getE2eMockFileContent(selected.path),
      },
      progress,
      isComplete
    });
    return;
  }

  // full 模式：输出 <file> 标签格式，兼容旧的前端解析逻辑
  const generatedCode = manifest
    .map((f) => `<file path="${f.path}">\n${getE2eMockFileContent(f.path)}\n</file>`)
    .join('\n\n');

  await sendProgress({ type: 'stream', raw: true, text: generatedCode });
  await sendProgress({
    type: 'complete',
    generatedCode,
    explanation: 'E2E Mock：已生成固定文件集合'
  });
}

/**
 * 生成技术方案 (Plan Generation)
 * 目的：在代码生成之前，先让AI输出详细的技术实现方案
 *
 * @returns 包含方案全文和建议 manifest 的对象
 */
async function generatePlan(
  prompt: string,
  context: any,
  model: string,
  modelProvider: any,
  actualModel: string,
  sendProgress: (data: any) => Promise<void>
): Promise<PlanGenerationResponse['plan']> {
  console.log('[generatePlan] 开始生成技术方案...');

  const planPrompt = `
分析需求，输出极简技术方案。

## 需求
${prompt}

${context?.currentFiles && Object.keys(context.currentFiles).length > 0 ? `现有文件：${Object.keys(context.currentFiles).slice(0, 10).join(', ')}` : '新项目'}

---

## 输出格式（严格遵守，不要多余内容）

## 方案概述
用1-2句话描述实现思路

## 技术栈
React + Tailwind CSS + Vite

## 文件清单
\`\`\`json
{"files":[{"path":"package.json","desc":"配置"},{"path":"src/index.css","desc":"样式"},{"path":"src/App.jsx","desc":"主组件"}]}
\`\`\`

## 预估
X个文件 / Y分钟 / 复杂度

---

🚨 要求：
1. 不要生成代码
2. 文件按依赖顺序（配置→样式→组件→页面）
3. JSON必须有效，紧凑格式
4. 总输出控制在800字以内`;

	  try {
	    const result = await streamText({
	      model: modelProvider(actualModel),
	      messages: [
        {
          role: 'system',
          content: `你是一名资深全栈架构师，擅长需求分析、技术选型和架构设计。
你的输出风格是：专业、详细、实用，注重可执行性。
你会考虑性能、可维护性、可扩展性等工程质量。`
        },
        {
          role: 'user',
          content: planPrompt
        }
      ],
	      temperature: 0.7, // 适中温度平衡创造性和准确性
	    });

	    let planContent = '';
	    let reasoningContent = '';
	    let pendingChunk = '';
	    let lastFlushTime = Date.now();
	    let lastStreamError: unknown = undefined;

	    // Streaming 输出方案
	    for await (const part of result.fullStream) {
	      if (part.type === 'text-delta') {
	        planContent += part.text;
	        pendingChunk += part.text;
	      } else if (part.type === 'reasoning-delta') {
	        // 部分推理模型/兼容 API 可能只输出 reasoning channel（text 为空）
	        reasoningContent += part.text;
	      } else if (part.type === 'error') {
	        lastStreamError = part.error;
	      }

	      // 每100ms或每50字符发送一次进度更新（打字机效果）
	      const now = Date.now();
	      if (pendingChunk && (now - lastFlushTime > 100 || pendingChunk.length > 50)) {
	        await sendProgress({
	          type: 'plan_chunk',
	          chunk: pendingChunk,
	          totalLength: planContent.length
	        });
	        pendingChunk = '';
	        lastFlushTime = now;
	      }
	    }

	    // flush 剩余未发送的 chunk，避免丢字
	    if (pendingChunk) {
	      await sendProgress({
	        type: 'plan_chunk',
	        chunk: pendingChunk,
	        totalLength: planContent.length
	      });
	    }

	    // ⚠️ 检查方案内容是否为空（可能是 API 调用失败）
	    if (!planContent || planContent.trim().length === 0) {
	      // 兜底：有些推理模型会把内容放在 reasoning channel
	      if (reasoningContent.trim().length > 0) {
	        console.warn('[generatePlan] ⚠️ text 为空，已使用 reasoning 作为方案内容（常见于推理模型/兼容 API）');
	        planContent = reasoningContent;
	      } else {
	        const streamErrorMessage = formatUnknownError(lastStreamError);
	        let finishReason: unknown = undefined;
	        try {
	          finishReason = await result.finishReason;
	        } catch {
	          // ignore
	        }
	        console.error('[generatePlan] ❌ 方案内容为空，可能是 API 调用失败（rate limit、网络错误或模型不可用）', {
	          model: actualModel,
	          rawModel: model,
	          finishReason,
	          streamErrorMessage
	        });
	        if (streamErrorMessage) {
	          throw new Error(streamErrorMessage);
	        }
	        throw new Error('API 返回空内容，请稍后重试或切换模型');
	      }
	    }
	
	    console.log(`[generatePlan] 方案生成完成，长度: ${planContent.length}`);

	    // 从方案中提取文件清单（必要时兜底单独生成）
	    await sendProgress({ type: 'status', message: '正在从方案中提取文件清单...' });
	    let suggestedManifest: FileManifestItem[] = extractSuggestedManifestFromPlan(planContent);

    if (suggestedManifest.length === 0) {
      console.warn('[generatePlan] ⚠️ 未能从方案中解析出文件清单，尝试单独生成 manifest 兜底...');
      await sendProgress({ type: 'status', message: '方案已生成，正在补全文件清单...' });
      try {
        suggestedManifest = await generateManifest(
          prompt,
          context,
          model,
          modelProvider,
          actualModel
        );
      } catch (error) {
        console.warn('[generatePlan] 兜底 manifest 生成失败:', error);
      }
    }

    // 提取方案摘要
    const summary = {
      requirementAnalysis: extractSection(planContent, '需求分析') || '需求分析中...',
      techStack: extractTechStack(planContent),
      architecture: extractSection(planContent, '架构设计') || '架构设计中...',
      totalFiles: suggestedManifest.length,
      estimatedTime: extractEstimatedTime(planContent),
      risks: extractRisks(planContent)
    };

    await sendProgress({
      type: 'plan_complete',
      plan: {
        content: planContent,
        suggestedManifest,
        summary
      }
    });

    return {
      content: planContent,
      suggestedManifest,
      summary
    };

  } catch (error) {
    console.error('[generatePlan] 生成技术方案失败:', error);
    const errorMessage = (error as Error).message;

    // 检测 rate limit 相关错误，提供更友好的提示
    const isRateLimitError = errorMessage.includes('429') ||
                            errorMessage.includes('Rate Limit') ||
                            errorMessage.includes('频率超限') ||
                            errorMessage.includes('too many requests');

    if (isRateLimitError) {
      throw new Error('API 请求频率超限，请等待 30 秒后重试，或切换其他模型（如 Claude/GPT）');
    }

    // 如果错误信息已经包含"技术方案生成失败"，直接传递，避免重复
    if (errorMessage.includes('技术方案生成失败')) {
      throw error;
    }

    throw new Error(`技术方案生成失败: ${errorMessage}`);
  }
}

/**
 * 从方案中提取指定章节内容
 */
function extractSection(content: string, sectionName: string): string {
  const regex = new RegExp(`##\\s*\\d*\\.?\\s*${sectionName}\\s*([\\s\\S]*?)(?=##|$)`, 'i');
  const match = content.match(regex);
  return match ? match[1].trim().substring(0, 200) : '';
}

/**
 * 提取技术栈列表
 */
function extractTechStack(content: string): string[] {
  const techSection = extractSection(content, '技术选型');
  const techs: string[] = [];

  // 匹配常见技术关键词
  const keywords = ['React', 'Vue', 'Next.js', 'TypeScript', 'Tailwind', 'Node.js', 'Express', 'MongoDB', 'PostgreSQL'];
  keywords.forEach(keyword => {
    if (techSection.toLowerCase().includes(keyword.toLowerCase())) {
      techs.push(keyword);
    }
  });

  return techs.length > 0 ? techs : ['React', 'Tailwind CSS'];
}

/**
 * 提取预估时间（分钟）
 */
function extractEstimatedTime(content: string): number {
  const timeMatch = content.match(/预计开发时间[：:]\s*(\d+)\s*分钟/);
  return timeMatch ? parseInt(timeMatch[1]) : 60;
}

/**
 * 提取风险点列表
 */
function extractRisks(content: string): string[] {
  const riskSection = extractSection(content, '注意事项和风险点');
  const risks: string[] = [];

  // 匹配 ⚠️ 或 - 开头的行
  const riskLines = riskSection.match(/[⚠️\-]\s*([^\n]+)/g);
  if (riskLines) {
    riskLines.forEach(line => {
      const cleaned = line.replace(/^[⚠️\-]\s*/, '').trim();
      if (cleaned) {
        risks.push(cleaned);
      }
    });
  }

  return risks.slice(0, 5); // 最多5个风险点
}
