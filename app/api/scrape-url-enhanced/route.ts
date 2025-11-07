/**
 * 增强的网页爬取 API
 * 
 * 支持多种爬取方式：
 * 1. Firecrawl API（优先，带缓存加速）
 * 2. Playwright 无头浏览器（降级方案）
 * 
 * 自动降级策略：Firecrawl 不可用时自动切换到 Playwright
 */

import { NextRequest, NextResponse } from 'next/server';
import { createScraperRouter } from '@/lib/scraper';

export async function POST(request: NextRequest) {
  try {
    const { url, options = {} } = await request.json();
    
    if (!url) {
      return NextResponse.json({
        success: false,
        error: 'URL is required'
      }, { status: 400 });
    }
    
    console.log('[scrape-url-enhanced] Starting scrape for:', url);
    
    // 获取 Firecrawl API Key（可选）
    const FIRECRAWL_API_KEY = process.env.FIRECRAWL_API_KEY;
    
    // 创建智能路由器
    const router = createScraperRouter({
      preferredScraper: FIRECRAWL_API_KEY ? 'firecrawl' : 'playwright',
      enableFallback: true,
      firecrawlApiKey: FIRECRAWL_API_KEY,
    });
    
    // 记录可用的爬虫
    const availableScrapers = router.getAvailableScrapers();
    console.log('[scrape-url-enhanced] Available scrapers:', availableScrapers);
    
    // 执行智能爬取（自动降级）
    const result = await router.scrape(url, {
      waitFor: options.waitFor || 3000,
      timeout: options.timeout || 30000,
      blockAds: options.blockAds !== false,
      fullPageScreenshot: options.fullPageScreenshot || false,
      maxAge: options.maxAge || 3600000,
    });
    
    // 构建响应
    const response = {
      success: true,
      url: result.url,
      content: result.content,
      screenshot: result.screenshot,
      structured: {
        title: result.title,
        description: result.metadata.description || '',
        content: result.markdown,
        url: result.url,
        screenshot: result.screenshot,
      },
      metadata: {
        scraper: result.scraper,
        fallbackUsed: result.fallbackUsed,
        attemptedScraper: result.attemptedScraper,
        timestamp: new Date(result.timestamp).toISOString(),
        contentLength: result.content.length,
        cached: result.metadata.cached || false,
        ...result.metadata,
      },
      message: generateSuccessMessage(result),
    };
    
    return NextResponse.json(response);
    
  } catch (error) {
    console.error('[scrape-url-enhanced] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message,
      stack: process.env.NODE_ENV === 'development' ? (error as Error).stack : undefined,
    }, { status: 500 });
  }
}

/**
 * 生成成功消息
 */
function generateSuccessMessage(result: any): string {
  const scraper = result.scraper;
  const fallback = result.fallbackUsed;
  const cached = result.metadata?.cached;
  
  if (scraper === 'firecrawl') {
    if (cached) {
      return 'URL scraped successfully with Firecrawl (using cache for 500% faster performance)';
    }
    return 'URL scraped successfully with Firecrawl';
  }
  
  if (scraper === 'playwright') {
    if (fallback) {
      return 'URL scraped successfully with Playwright (fallback from Firecrawl)';
    }
    return 'URL scraped successfully with Playwright';
  }
  
  return 'URL scraped successfully';
}
