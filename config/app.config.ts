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
    // DeepSeek 格式解析存在问题，暂时使用 Gemini
    defaultModel: 'gemini-3-pro-preview',

    // Available models - 精简版
    availableModels: [
      // 🚀 Gemini GCA Models (cs.imds.ai 代理)
      'gemini-3-pro-preview',                // Gemini 3 Pro Preview (最新)
      'gemini-2.5-pro-preview-05-06',        // Gemini 2.5 Pro Preview
      'gemini-2.0-flash-exp',                // Gemini 2.0 Flash Exp

      // 🇨🇳 DeepSeek (七牛云托管)
      'deepseek/deepseek-v3.2-251201',       // DeepSeek V3.2 - 默认
    ],

    // Model display names - 精简版
    modelDisplayNames: {
      // 🚀 Gemini GCA Models (cs.imds.ai 代理)
      'gemini-3-pro-preview': '🚀 Gemini 3 Pro Preview',
      'gemini-2.5-pro-preview-05-06': '🚀 Gemini 2.5 Pro',
      'gemini-2.0-flash-exp': '🚀 Gemini 2.0 Flash',

      // 🇨🇳 DeepSeek (七牛云)
      'deepseek/deepseek-v3.2-251201': '🇨🇳 DeepSeek V3.2 ⭐',
    } as Record<string, string>,
    
    // Model API configuration
    modelApiConfig: {} as Record<string, { provider: string; model: string }>,
    
    // Temperature settings for non-reasoning models
    defaultTemperature: 0.7,
    
    // Max tokens for code generation (increased for complex pages with large mock data)
    maxTokens: 64000,
    
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