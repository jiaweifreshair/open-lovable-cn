/**
 * 爬虫统一类型定义
 * 
 * 定义所有爬虫实现的统一接口和数据结构
 */

/**
 * 爬虫类型枚举
 */
export type ScraperType = 'firecrawl' | 'playwright';

/**
 * 爬虫配置选项
 */
export interface ScraperOptions {
  /** 等待时间（毫秒） */
  waitFor?: number;
  /** 超时时间（毫秒） */
  timeout?: number;
  /** 是否阻止广告 */
  blockAds?: boolean;
  /** 是否全屏截图 */
  fullPageScreenshot?: boolean;
  /** 缓存最大时间（毫秒） */
  maxAge?: number;
}

/**
 * 爬虫结果元数据
 */
export interface ScraperMetadata {
  /** 页面标题 */
  title?: string;
  /** 页面描述 */
  description?: string;
  /** 来源URL */
  sourceURL?: string;
  /** HTTP状态码 */
  statusCode?: number;
  /** 是否使用缓存 */
  cached?: boolean;
  /** 其他元数据 */
  [key: string]: unknown;
}

/**
 * 统一爬虫结果接口
 */
export interface ScraperResult {
  /** 请求的URL */
  url: string;
  /** 页面标题 */
  title: string;
  /** 格式化后的内容（供AI使用） */
  content: string;
  /** Markdown格式内容 */
  markdown: string;
  /** 截图（Base64格式） */
  screenshot?: string;
  /** 使用的爬虫类型 */
  scraper: ScraperType;
  /** 时间戳 */
  timestamp: number;
  /** 元数据 */
  metadata: ScraperMetadata;
}

/**
 * 爬虫错误类型
 */
export class ScraperError extends Error {
  constructor(
    message: string,
    public scraper: ScraperType,
    public originalError?: Error
  ) {
    super(message);
    this.name = 'ScraperError';
  }
}
