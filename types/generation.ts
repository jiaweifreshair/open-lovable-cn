/**
 * 分段生成策略类型定义
 *
 * 目的：解决一次性生成所有文件导致的token超限和代码混乱问题
 * 策略：先生成文件清单，再逐个生成文件
 */

/**
 * 生成模式
 * - plan: 生成技术方案规划（streaming输出）
 * - full: 一次性生成所有文件（向后兼容，存在token限制风险）
 * - manifest: 只生成文件清单，不生成代码
 * - file: 基于清单逐个生成单个文件的完整代码
 */
export type GenerationMode = 'plan' | 'full' | 'manifest' | 'file';

/**
 * 文件清单项
 * 描述需要生成的文件的元信息
 */
export interface FileManifestItem {
  /** 文件路径（相对于项目根目录） */
  path: string;

  /** 文件描述（用途、主要功能） */
  description: string;

  /** 依赖的其他文件路径 */
  dependencies: string[];

  /** 文件类型 */
  type: 'component' | 'page' | 'api' | 'lib' | 'config' | 'style' | 'other';

  /** 预估行数（可选，用于优先级排序） */
  estimatedLines?: number;

  /** 是否为关键文件（核心功能文件） */
  isCritical?: boolean;
}

/**
 * 生成配置
 * 控制代码生成的行为
 */
export interface GenerationConfig {
  /** 生成模式 */
  mode: GenerationMode;

  /** 文件清单（mode='file' 时必需） */
  manifest?: FileManifestItem[];

  /** 当前生成的文件索引（mode='file' 时必需） */
  fileIndex?: number;

  /** 是否启用严格验证（默认 true） */
  strictValidation?: boolean;

  /** 单个文件最大token数（默认 4000） */
  maxTokensPerFile?: number;
}

/**
 * 生成请求体
 * API /api/generate-ai-code-stream 的请求参数
 */
export interface GenerationRequest {
  /** 用户提示词 */
  prompt: string;

  /** AI模型名称 */
  model?: string;

  /** 沙箱上下文 */
  context: {
    sandboxId: string;
    currentFiles?: Record<string, string>;
    [key: string]: any;
  };

  /** 是否为编辑模式 */
  isEdit?: boolean;

  /** 生成配置（可选，默认使用 full 模式） */
  generation?: GenerationConfig;
}

/**
 * 生成响应 - Manifest
 * mode='manifest' 时的响应格式
 */
export interface ManifestGenerationResponse {
  success: true;
  mode: 'manifest';
  manifest: FileManifestItem[];
  totalFiles: number;
  estimatedTime?: number; // 预估总耗时（秒）
}

/**
 * 生成响应 - Plan (技术方案)
 * mode='plan' 时的响应格式
 */
export interface PlanGenerationResponse {
  success: true;
  mode: 'plan';
  plan: {
    /** 方案全文（Markdown格式） */
    content: string;
    /** 从方案中提取的建议 manifest */
    suggestedManifest: FileManifestItem[];
    /** 方案摘要 */
    summary: {
      requirementAnalysis: string; // 需求分析摘要
      techStack: string[];         // 技术栈
      architecture: string;         // 架构概述
      totalFiles: number;           // 预计文件数
      estimatedTime: number;        // 预计开发时间（分钟）
      risks: string[];              // 风险点
    };
  };
}

/**
 * 生成响应 - File
 * mode='file' 时的响应格式
 */
export interface FileGenerationResponse {
  success: true;
  mode: 'file';
  fileIndex: number;
  totalFiles: number;
  file: {
    path: string;
    content: string;
  };
  progress: number; // 进度百分比 0-100
  isComplete: boolean; // 是否全部文件生成完成
}

/**
 * 生成响应 - Full (向后兼容)
 * mode='full' 时的响应格式
 */
export interface FullGenerationResponse {
  success: true;
  mode: 'full';
  files: Array<{
    path: string;
    content: string;
  }>;
  // ... 其他现有字段
}

/**
 * 生成响应类型联合
 */
export type GenerationResponse =
  | PlanGenerationResponse
  | ManifestGenerationResponse
  | FileGenerationResponse
  | FullGenerationResponse;
