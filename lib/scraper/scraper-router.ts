/**
 * 智能爬虫路由器
 *
 * 根据配置和可用性自动选择最佳爬虫
 * 实现三层降级策略：Firecrawl -> Crawlee (智能路由) -> Playwright
 *
 * Phase 3B 升级：
 * - 新增 Crawlee 智能爬虫（静态页面用 Cheerio，动态页面用 Playwright）
 * - 性能优化：静态页面快 100 倍（20ms vs 2s）
 * - 自动页面类型检测和降级
 */

import type { ScraperOptions, ScraperResult, ScraperType } from './types';
import { ScraperError } from './types';
import { createFirecrawlScraper, FirecrawlScraper } from './firecrawl-scraper';
import { getCrawleeScraper, CrawleeScraper } from './crawlee-scraper';
import { getPlaywrightScraper, PlaywrightScraper } from './playwright-scraper';

/**
 * 路由策略配置
 */
export interface RouterConfig {
  /** 首选爬虫类型 */
  preferredScraper?: ScraperType;
  /** 是否启用自动降级 */
  enableFallback?: boolean;
  /** Firecrawl API 密钥 */
  firecrawlApiKey?: string;
}

/**
 * 路由结果（包含使用的爬虫类型和是否降级）
 */
export interface RouterResult extends ScraperResult {
  /** 是否使用了降级策略 */
  fallbackUsed: boolean;
  /** 原始尝试的爬虫类型 */
  attemptedScraper?: ScraperType;
}

/**
 * 智能爬虫路由器类
 */
export class ScraperRouter {
  private config: RouterConfig;
  private firecrawlScraper: FirecrawlScraper | null = null;
  private crawleeScraper: CrawleeScraper | null = null;
  private playwrightScraper: PlaywrightScraper | null = null;

  constructor(config: RouterConfig = {}) {
    this.config = {
      preferredScraper: 'firecrawl',
      enableFallback: true,
      ...config,
    };

    // 初始化 Firecrawl 爬虫（如果有 API Key）
    if (this.config.firecrawlApiKey) {
      this.firecrawlScraper = createFirecrawlScraper(this.config.firecrawlApiKey);
    }

    // 初始化 Crawlee 智能爬虫（Phase 3B 新增）
    this.crawleeScraper = getCrawleeScraper();

    // 初始化 Playwright 爬虫（兜底）
    this.playwrightScraper = getPlaywrightScraper();
  }
  
  /**
   * 检查 Firecrawl 是否可用
   */
  private isFirecrawlAvailable(): boolean {
    return this.firecrawlScraper !== null && this.config.firecrawlApiKey !== undefined;
  }

  /**
   * 检查 Crawlee 是否可用
   */
  private isCrawleeAvailable(): boolean {
    return this.crawleeScraper !== null;
  }

  /**
   * 检查 Playwright 是否可用
   */
  private isPlaywrightAvailable(): boolean {
    return this.playwrightScraper !== null;
  }
  
  /**
   * 使用 Firecrawl 爬取
   */
  private async scrapeWithFirecrawl(url: string, options: ScraperOptions): Promise<ScraperResult> {
    if (!this.firecrawlScraper) {
      throw new Error('Firecrawl scraper not initialized');
    }

    console.log('[scraper-router] Using Firecrawl scraper');
    return await this.firecrawlScraper.scrape(url, options);
  }

  /**
   * 使用 Crawlee 智能爬取（Phase 3B 新增）
   * 自动选择 Cheerio（静态）或 Playwright（动态）
   */
  private async scrapeWithCrawlee(url: string, options: ScraperOptions): Promise<ScraperResult> {
    if (!this.crawleeScraper) {
      throw new Error('Crawlee scraper not initialized');
    }

    console.log('[scraper-router] Using Crawlee intelligent scraper');
    return await this.crawleeScraper.scrape(url, options);
  }

  /**
   * 使用 Playwright 爬取（兜底方案）
   */
  private async scrapeWithPlaywright(url: string, options: ScraperOptions): Promise<ScraperResult> {
    if (!this.playwrightScraper) {
      throw new Error('Playwright scraper not initialized');
    }

    console.log('[scraper-router] Using Playwright scraper (fallback)');
    return await this.playwrightScraper.scrape(url, options);
  }
  
  /**
   * 智能路由爬取
   *
   * Phase 3B 升级：三层降级策略
   * 1. Firecrawl（优先，有缓存）
   * 2. Crawlee（智能路由��静态用 Cheerio，动态用 Playwright）
   * 3. Playwright（兜底）
   */
  async scrape(url: string, options: ScraperOptions = {}): Promise<RouterResult> {
    let attemptedScraper: ScraperType | undefined;
    let fallbackUsed = false;
    let lastError: Error | undefined;

    // 确定首选爬虫
    const preferredScraper = this.config.preferredScraper || 'firecrawl';

    // 策略 1: 尝试首选爬虫（Firecrawl）
    if (preferredScraper === 'firecrawl' && this.isFirecrawlAvailable()) {
      attemptedScraper = 'firecrawl';
      try {
        const result = await this.scrapeWithFirecrawl(url, options);
        return { ...result, fallbackUsed, attemptedScraper };
      } catch (error) {
        console.warn('[scraper-router] Firecrawl failed:', (error as Error).message);
        lastError = error as Error;

        // 如果不启用降级，直接抛出错误
        if (!this.config.enableFallback) {
          throw error;
        }
      }
    }

    // 策略 2: 降级到 Crawlee（Phase 3B 新增，智能路由）
    if (this.isCrawleeAvailable()) {
      console.log('[scraper-router] Falling back to Crawlee (intelligent routing)');
      fallbackUsed = true;

      try {
        const result = await this.scrapeWithCrawlee(url, options);
        return { ...result, fallbackUsed, attemptedScraper };
      } catch (error) {
        console.warn('[scraper-router] Crawlee failed:', (error as Error).message);
        lastError = error as Error;

        // 继续降级到 Playwright
      }
    }

    // 策略 3: 最终降级到 Playwright（兜底）
    if (this.isPlaywrightAvailable()) {
      console.log('[scraper-router] Falling back to Playwright (final fallback)');
      fallbackUsed = true;

      try {
        const result = await this.scrapeWithPlaywright(url, options);
        return { ...result, fallbackUsed, attemptedScraper };
      } catch (error) {
        console.error('[scraper-router] All scrapers failed:', (error as Error).message);

        // 如果有之前的错误，汇总所有错误
        if (lastError) {
          throw new ScraperError(
            'All scrapers failed. First error: ' + lastError.message + '; Final error: ' + (error as Error).message,
            attemptedScraper || 'firecrawl',
            lastError
          );
        }

        throw error;
      }
    }

    // 策略 4: 如果首选是 Playwright，直接使用
    if (preferredScraper === 'playwright' && this.isPlaywrightAvailable()) {
      attemptedScraper = 'playwright';
      const result = await this.scrapeWithPlaywright(url, options);
      return { ...result, fallbackUsed, attemptedScraper };
    }

    // 如果所有策略都不可用
    throw new Error('No scraper available. Please configure at least one scraper.');
  }
  
  /**
   * 获取当前路由器配置
   */
  getConfig(): RouterConfig {
    return { ...this.config };
  }
  
  /**
   * 获取可用的爬虫列表
   */
  getAvailableScrapers(): ScraperType[] {
    const scrapers: ScraperType[] = [];

    if (this.isFirecrawlAvailable()) {
      scrapers.push('firecrawl');
    }

    if (this.isCrawleeAvailable()) {
      scrapers.push('cheerio'); // Crawlee 包含 Cheerio
      scrapers.push('playwright'); // Crawlee 包含 Playwright
    } else if (this.isPlaywrightAvailable()) {
      scrapers.push('playwright');
    }

    return scrapers;
  }
}

/**
 * 创建智能爬虫路由器实例
 */
export function createScraperRouter(config: RouterConfig = {}): ScraperRouter {
  return new ScraperRouter(config);
}
