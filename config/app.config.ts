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
    // Default AI model
    defaultModel: 'moonshotai/kimi-k2-instruct-0905',

    // Available models (保留所有现有国际模型 + 新增国内模型选项)
    availableModels: [
      // ========================================
      // International Models (现有，保留不变)
      // ========================================
      'openai/gpt-5',
      'moonshotai/kimi-k2-instruct-0905',
      'anthropic/claude-sonnet-4-20250514',
      'google/gemini-2.0-flash-exp',

      // ========================================
      // Chinese Models (新增，七牛云实际支持)
      // ========================================
      // Note: To use these, configure OPENAI_BASE_URL in .env.local
      // Example: OPENAI_BASE_URL=https://api.qnaigc.com/v1

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

    // Model display names (显示名称，保留现有 + 新增国内模型)
    modelDisplayNames: {
      // International Models (保留不变)
      'openai/gpt-5': 'GPT-5',
      'moonshotai/kimi-k2-instruct-0905': 'Kimi K2 (Groq)',
      'anthropic/claude-sonnet-4-20250514': 'Sonnet 4',
      'google/gemini-2.0-flash-exp': 'Gemini 2.0 Flash (Experimental)',

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
    maxTokens: 8000,
    
    // Max tokens for truncation recovery
    truncationRecoveryMaxTokens: 4000,
  },
  
  // Code Application Configuration
  codeApplication: {
    // Delay after applying code before refreshing iframe (milliseconds)
    defaultRefreshDelay: 2000,
    
    // Delay when packages are installed (milliseconds)
    packageInstallRefreshDelay: 5000,
    
    // Enable/disable automatic truncation recovery
    enableTruncationRecovery: false, // Disabled - too many false positives
    
    // Maximum number of truncation recovery attempts per file
    maxTruncationRecoveryAttempts: 1,
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