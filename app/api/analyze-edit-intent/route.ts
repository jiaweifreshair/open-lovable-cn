import { NextRequest, NextResponse } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';
// import type { FileManifest } from '@/types/file-manifest'; // Type is used implicitly through manifest parameter
import { createEcaGatewayFetch, isEcaGatewayHttpError } from '@/lib/eca-gateway';

// Check if we're using Vercel AI Gateway
const isUsingAIGateway = !!process.env.AI_GATEWAY_API_KEY;
const aiGatewayBaseURL = 'https://ai-gateway.vercel.sh/v1';

// ECA 网关默认地址：未显式配置时兜底，避免生成分析请求失败。
const DEFAULT_ECA_GATEWAY_ENDPOINT = 'https://aigateway.edgecloudapp.com/v1/6a346ca84941b743a3ea49cd6db8d004/xinbang01';
// 读取网关地址：优先新变量，兼容旧变量，保证历史配置可用。
const rawEcaGatewayEndpoint =
  process.env.ECA_GATEWAY_ENDPOINT ||
  process.env.AIGATEWAY_URL ||
  process.env.CODE_ASSIST_ENDPOINT;
// 规范化后的网关地址：去掉末尾斜杠，并兼容误配的 /chat/completions 后缀。
const ecaGatewayEndpoint = (rawEcaGatewayEndpoint || DEFAULT_ECA_GATEWAY_ENDPOINT)
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/chat\/completions$/i, '')
  .replace(/\/+$/, '');
// 读取网关密钥：优先新变量，兼容旧变量，避免迁移期请求失败。
const ecaGatewayApiKey =
  process.env.ECA_GATEWAY_API_KEY ||
  process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
  process.env.AIGATEWAY_TOKEN;
// 是否启用网关：要求地址和密钥同时存在，避免误路由。
const isUsingEcaGateway = !!ecaGatewayEndpoint && !!ecaGatewayApiKey;

const groq = createGroq({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GROQ_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});

const anthropic = createAnthropic({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.ANTHROPIC_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1'),
});

const openai = createOpenAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.OPENAI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : process.env.OPENAI_BASE_URL,
});

const googleGenerativeAI = createGoogleGenerativeAI({
  apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GEMINI_API_KEY,
  baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
});

// ECA AI Gateway Provider (OpenAI Compatible)
const ecaGatewayProvider = createOpenAICompatible({
  name: 'eca-gateway',
  apiKey: ecaGatewayApiKey || '',
  baseURL: ecaGatewayEndpoint,
  fetch: createEcaGatewayFetch(),
});

// Schema for the AI's search plan - not file selection!
const searchPlanSchema = z.object({
  editType: z.enum([
    'UPDATE_COMPONENT',
    'ADD_FEATURE', 
    'FIX_ISSUE',
    'UPDATE_STYLE',
    'REFACTOR',
    'ADD_DEPENDENCY',
    'REMOVE_ELEMENT'
  ]).describe('The type of edit being requested'),
  
  reasoning: z.string().describe('Explanation of the search strategy'),
  
  searchTerms: z.array(z.string()).describe('Specific text to search for (case-insensitive). Be VERY specific - exact button text, class names, etc.'),
  
  regexPatterns: z.array(z.string()).optional().describe('Regex patterns for finding code structures (e.g., "className=[\\"\\\'].*header.*[\\"\\\']")'),
  
  fileTypesToSearch: z.array(z.string()).default(['.jsx', '.tsx', '.js', '.ts']).describe('File extensions to search'),
  
  expectedMatches: z.number().min(1).max(10).default(1).describe('Expected number of matches (helps validate search worked)'),
  
  fallbackSearch: z.object({
    terms: z.array(z.string()),
    patterns: z.array(z.string()).optional()
  }).optional().describe('Backup search if primary fails')
});

export async function POST(request: NextRequest) {
  try {
    const { prompt, manifest, model = 'openai/gpt-oss-20b' } = await request.json();
    
    console.log('[analyze-edit-intent] Request received');
    console.log('[analyze-edit-intent] Prompt:', prompt);
    console.log('[analyze-edit-intent] Model:', model);
    console.log('[analyze-edit-intent] Manifest files count:', manifest?.files ? Object.keys(manifest.files).length : 0);
    
    if (!prompt || !manifest) {
      return NextResponse.json({
        error: 'prompt and manifest are required'
      }, { status: 400 });
    }
    
    // Create a summary of available files for the AI
    const validFiles = Object.entries(manifest.files as Record<string, any>)
      .filter(([path]) => {
        // Filter out invalid paths
        return path.includes('.') && !path.match(/\/\d+$/);
      });
    
    const fileSummary = validFiles
      .map(([path, info]: [string, any]) => {
        const componentName = info.componentInfo?.name || path.split('/').pop();
        // const hasImports = info.imports?.length > 0; // Kept for future use
        const childComponents = info.componentInfo?.childComponents?.join(', ') || 'none';
        return `- ${path} (${componentName}, renders: ${childComponents})`;
      })
      .join('\n');
    
    console.log('[analyze-edit-intent] Valid files found:', validFiles.length);
    
    if (validFiles.length === 0) {
      console.error('[analyze-edit-intent] No valid files found in manifest');
      return NextResponse.json({
        success: false,
        error: 'No valid files found in manifest'
      }, { status: 400 });
    }
    
    console.log('[analyze-edit-intent] Analyzing prompt:', prompt);
    console.log('[analyze-edit-intent] File summary preview:', fileSummary.split('\n').slice(0, 5).join('\n'));
    
    // Select the appropriate AI model based on the request
    // ECA 网关模型识别：gemini-/claude- 且网关可用时走同一路由。
    const isEcaModel = (model.startsWith('gemini-') || model.startsWith('claude-')) && isUsingEcaGateway;
    const isEcaStyleModel = model.startsWith('gemini-') || model.startsWith('claude-');

    // 🚧 保护性校验：用户选择了 ECA 风格模型名，但未配置网关时，避免误路由到 Groq/其他 provider。
    if (isEcaStyleModel && !isUsingEcaGateway) {
      return NextResponse.json({
        success: false,
        error: 'ECA 网关未配置：请设置 ECA_GATEWAY_ENDPOINT 与 ECA_GATEWAY_API_KEY（或兼容变量 CODE_ASSIST_ENDPOINT/GOOGLE_CLOUD_ACCESS_TOKEN），或改用 google/ 或 anthropic/ 前缀模型。'
      }, { status: 400 });
    }

    let aiModel;
    if (model.startsWith('anthropic/')) {
      aiModel = anthropic(model.replace('anthropic/', ''));
    } else if (isEcaModel) {
      // ECA 网关模型（Gemini/Claude）
      aiModel = ecaGatewayProvider(model);
    } else if (model.startsWith('openai/')) {
      if (model.includes('gpt-oss')) {
        aiModel = groq(model);
      } else {
        aiModel = openai(model.replace('openai/', ''));
      }
    } else if (model.startsWith('google/')) {
      aiModel = googleGenerativeAI(model.replace('google/', ''));
    } else {
      // Default to groq if model format is unclear
      aiModel = groq(model);
    }
    
    console.log('[analyze-edit-intent] Using AI model:', model);
    
    // Use AI to create a search plan
    const result = await generateObject({
      model: aiModel,
      schema: searchPlanSchema,
      messages: [
        {
          role: 'system',
          content: `You are an expert at planning code searches. Your job is to create a search strategy to find the exact code that needs to be edited.

DO NOT GUESS which files to edit. Instead, provide specific search terms that will locate the code.

SEARCH STRATEGY RULES:
1. For text changes (e.g., "change 'Start Deploying' to 'Go Now'"):
   - Search for the EXACT text: "Start Deploying"
   
2. For style changes (e.g., "make header black"):
   - Search for component names: "Header", "<header"
   - Search for class names: "header", "navbar"
   - Search for className attributes containing relevant words
   
3. For removing elements (e.g., "remove the deploy button"):
   - Search for the button text or aria-label
   - Search for relevant IDs or data-testids
   
4. For navigation/header issues:
   - Search for: "navigation", "nav", "Header", "navbar"
   - Look for Link components or href attributes
   
5. Be SPECIFIC:
   - Use exact capitalization for user-visible text
   - Include multiple search terms for redundancy
   - Add regex patterns for structural searches

Current project structure for context:
${fileSummary}`
        },
        {
          role: 'user',
          content: `User request: "${prompt}"

Create a search plan to find the exact code that needs to be modified. Include specific search terms and patterns.`
        }
      ]
    });
    
    console.log('[analyze-edit-intent] Search plan created:', {
      editType: result.object.editType,
      searchTerms: result.object.searchTerms,
      patterns: result.object.regexPatterns?.length || 0,
      reasoning: result.object.reasoning
    });
    
    // Return the search plan, not file matches
    return NextResponse.json({
      success: true,
      searchPlan: result.object
    });
    
  } catch (error) {
    console.error('[analyze-edit-intent] Error:', error);

    // ✅ 尽量透传上游错误码，便于前端区分 401/403/429 等场景。
    if (isEcaGatewayHttpError(error)) {
      return NextResponse.json({
        success: false,
        error: error.message,
        requestId: error.details.requestId,
        code: error.details.code || error.details.type,
      }, { status: error.details.status });
    }

    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
