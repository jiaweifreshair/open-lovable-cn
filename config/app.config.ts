// Application Configuration
// This file contains all configurable settings for the application

export const appConfig = {
  // Vercel Sandbox Configuration
  vercelSandbox: {
    // Sandbox timeout in minutes
    timeoutMinutes: 15,

    // Convert to milliseconds for Vercel Sandbox API
    get timeoutMs() {
      return this.timeoutMinutes * 60 * 1000;
    },

    // Development server port (Vercel Sandbox typically uses 3000 for Next.js/React)
    devPort: 3000,

    // Time to wait for dev server to be ready (in milliseconds)
    devServerStartupDelay: 7000,

    // Time to wait for CSS rebuild (in milliseconds)
    cssRebuildDelay: 2000,

    // Working directory in sandbox
    workingDirectory: '/app',

    // Default runtime for sandbox
    runtime: 'node22' // Available: node22, python3.13, v0-next-shadcn, cua-ubuntu-xfce
  },

  // E2B Sandbox Configuration
  e2b: {
    // Sandbox timeout in minutes
    timeoutMinutes: 30,

    // Convert to milliseconds for E2B API
    get timeoutMs() {
      return this.timeoutMinutes * 60 * 1000;
    },

    // Development server port (E2B uses 5173 for Vite)
    vitePort: 5173,

    // Time to wait for Vite dev server to be ready (in milliseconds)
    viteStartupDelay: 10000,

    // Working directory in sandbox
    workingDirectory: '/home/user/app',
  },
  
  // AI Model Configuration
  ai: {
    // Default AI model - 使用 Gemini 3 Pro Preview (cs.imds.ai 代理)
    defaultModel: 'gemini-3-pro-preview',

    // Available models - 国外模型优先，国内模型作为后备
    availableModels: [
      // ========================================
      // 🌐 International Models (优先推荐)
      // ========================================
      'anthropic/claude-sonnet-4-20250514',  // 🥇 首选 - Claude Sonnet 4
      'google/gemini-2.0-flash-exp',         // 🥈 次选 - Gemini 2.0 Flash
      'openai/gpt-5',                        // 🥉 GPT-5
      'moonshotai/kimi-k2-instruct-0905',    // Kimi K2 (Groq托管)

      // ========================================
      // 🚀 Gemini GCA Models (cs.imds.ai 代理)
      // ========================================
      // 需配置: CODE_ASSIST_ENDPOINT + GOOGLE_CLOUD_ACCESS_TOKEN
      'gemini-3-pro-preview',                // Gemini 3 Pro Preview (最新)
      'gemini-2.5-pro-preview-05-06',        // Gemini 2.5 Pro Preview
      'gemini-2.0-flash-exp',                // Gemini 2.0 Flash Exp

      // ========================================
      // 🇨🇳 Chinese Models (后备方案 - 七牛云托管)
      // ========================================
      // Note: 当国外模型不可用时自动切换
      // 配置: OPENAI_BASE_URL=https://api.qnaigc.com/v1

      // Qiniu Cloud - Qwen Series (通义千问系列)
      'qwen3-max',                   // 🇨🇳 通义千问 3 Max - 最强推理
      'qwen3-235b-a22b-instruct-2507',  // 🇨🇳 通义千问 3 235B - 旗舰版
      'qwen-turbo',                  // 🇨🇳 通义千问 Turbo - 快速响应
      'qwq-plus',                    // 🇨🇳 QwQ Plus - 推理增强

      // DeepSeek (深度求索)
      'deepseek-v3.1',               // 🇨🇳 DeepSeek V3.1 - 最新版本
      'deepseek-r1',                 // 🇨🇳 DeepSeek R1 - 推理模型
      'deepseek-v3',                 // 🇨🇳 DeepSeek V3 - 通用对话

      // Zhipu AI (智谱)
      'glm-4.5',                     // 🇨🇳 智谱 GLM-4.5
      'glm-4.5-air',                 // 🇨🇳 智谱 GLM-4.5 Air - 快速版

      // Moonshot AI (月之暗面)
      'kimi-k2',                     // 🇨🇳 Kimi K2 - 长文本处理
    ],

    // Model display names - 显示名称（带优先级标记）
    modelDisplayNames: {
      // 🌐 International Models (优先推荐)
      'anthropic/claude-sonnet-4-20250514': '🥇 Claude Sonnet 4',
      'google/gemini-2.0-flash-exp': '🥈 Gemini 2.0 Flash',
      'openai/gpt-5': '🥉 GPT-5',
      'moonshotai/kimi-k2-instruct-0905': 'Kimi K2 (Groq)',

      // 🚀 Gemini GCA Models (cs.imds.ai)
      'gemini-3-pro-preview': '🚀 Gemini 3 Pro Preview',
      'gemini-2.5-pro-preview-05-06': '🚀 Gemini 2.5 Pro',
      'gemini-2.0-flash-exp': '🚀 Gemini 2.0 Flash (GCA)',

      // Chinese Models - Qiniu Cloud (七牛云实际支持的模型)
      'qwen3-max': '🇨🇳 通义千问 3 Max',
      'qwen3-235b-a22b-instruct-2507': '🇨🇳 通义千问 3 235B',
      'qwen-turbo': '🇨🇳 通义千问 Turbo',
      'qwq-plus': '🇨🇳 QwQ Plus 推理',
      'deepseek-v3.1': '🇨🇳 DeepSeek V3.1',
      'deepseek-r1': '🇨🇳 DeepSeek R1 推理',
      'deepseek-v3': '🇨🇳 DeepSeek V3',
      'glm-4.5': '🇨🇳 智谱 GLM-4.5',
      'glm-4.5-air': '🇨🇳 智谱 GLM-4.5 Air',
      'kimi-k2': '🇨🇳 Kimi K2',
    } as Record<string, string>,
    
    // Model API configuration
    modelApiConfig: {
      'moonshotai/kimi-k2-instruct-0905': {
        provider: 'groq',
        model: 'moonshotai/kimi-k2-instruct-0905'
      }
    },
    
    // Temperature settings for non-reasoning models
    defaultTemperature: 0.7,
    
    // Max tokens for code generation
    maxTokens: 30000,
    
    // Max tokens for truncation recovery
    truncationRecoveryMaxTokens: 8000,
  },
  
  // Code Application Configuration
  codeApplication: {
    // Delay after applying code before refreshing iframe (milliseconds)
    defaultRefreshDelay: 2000,
    
    // Delay when packages are installed (milliseconds)
    packageInstallRefreshDelay: 5000,
    
    // Enable/disable automatic truncation recovery
    enableTruncationRecovery: true, // Enabled for reliable generation
    
    // Maximum number of truncation recovery attempts per file
    maxTruncationRecoveryAttempts: 3,
  },
  
  // UI Configuration
  ui: {
    // Show/hide certain UI elements
    showModelSelector: true,
    showStatusIndicator: true,
    
    // Animation durations (milliseconds)
    animationDuration: 200,
    
    // Toast notification duration (milliseconds)
    toastDuration: 3000,
    
    // Maximum chat messages to keep in memory
    maxChatMessages: 100,
    
    // Maximum recent messages to send as context
    maxRecentMessagesContext: 20,
  },
  
  // Development Configuration
  dev: {
    // Enable debug logging
    enableDebugLogging: true,
    
    // Enable performance monitoring
    enablePerformanceMonitoring: false,
    
    // Log API responses
    logApiResponses: true,
  },
  
  // Package Installation Configuration
  packages: {
    // Use --legacy-peer-deps flag for npm install
    useLegacyPeerDeps: true,
    
    // Package installation timeout (milliseconds)
    installTimeout: 60000,
    
    // Auto-restart Vite after package installation
    autoRestartVite: true,
  },
  
  // File Management Configuration
  files: {
    // Excluded file patterns (files to ignore)
    excludePatterns: [
      'node_modules/**',
      '.git/**',
      '.next/**',
      'dist/**',
      'build/**',
      '*.log',
      '.DS_Store'
    ],
    
    // Maximum file size to read (bytes)
    maxFileSize: 1024 * 1024, // 1MB
    
    // File extensions to treat as text
    textFileExtensions: [
      '.js', '.jsx', '.ts', '.tsx',
      '.css', '.scss', '.sass',
      '.html', '.xml', '.svg',
      '.json', '.yml', '.yaml',
      '.md', '.txt', '.env',
      '.gitignore', '.dockerignore'
    ],
  },
  
  // API Endpoints Configuration (for external services)
  api: {
    // Retry configuration
    maxRetries: 3,
    retryDelay: 1000, // milliseconds
    
    // Request timeout (milliseconds)
    requestTimeout: 30000,
  }
};

// Type-safe config getter
export function getConfig<K extends keyof typeof appConfig>(key: K): typeof appConfig[K] {
  return appConfig[key];
}

// Helper to get nested config values
export function getConfigValue(path: string): any {
  return path.split('.').reduce((obj, key) => obj?.[key], appConfig as any);
}

export default appConfig;