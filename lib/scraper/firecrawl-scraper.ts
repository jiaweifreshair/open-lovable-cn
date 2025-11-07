/**
 * Firecrawl 爬虫实现
 * 
 * 封装 Firecrawl API 调用逻辑
 * 与 Playwright 爬虫保持统一接口
 */

import type { ScraperOptions, ScraperResult } from './types';
import { ScraperError } from './types';

function sanitizeQuotes(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(/[\u00AB\u00BB]/g, '"')
    .replace(/[\u2039\u203A]/g, "'")
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u2026]/g, '...')
    .replace(/[\u00A0]/g, ' ');
}

export class FirecrawlScraper {
  private apiKey: string;
  
  constructor(apiKey: string) {
    if (!apiKey) {
      throw new Error('Firecrawl API key is required');
    }
    this.apiKey = apiKey;
  }
  
  async scrape(url: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const {
      waitFor = 3000,
      timeout = 30000,
      blockAds = true,
      fullPageScreenshot = false,
      maxAge = 3600000,
    } = options;
    
    try {
      console.log('[firecrawl-scraper] Using Firecrawl to scrape:', url);
      
      const authHeader = 'Bearer ' + this.apiKey;
      const response = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: {
          'Authorization': authHeader,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          url,
          formats: ['markdown', 'html', 'screenshot'],
          waitFor,
          timeout,
          blockAds,
          maxAge,
          actions: [
            { type: 'wait', milliseconds: 2000 },
            { type: 'screenshot', fullPage: fullPageScreenshot },
          ],
        }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        throw new Error('Firecrawl API error (' + response.status + '): ' + error);
      }
      
      const data = await response.json();
      
      if (!data.success || !data.data) {
        throw new Error('Firecrawl scrape failed: no data in response');
      }
      
      const { markdown, metadata, screenshot, actions } = data.data;
      const screenshotUrl = screenshot || (actions && actions.screenshots && actions.screenshots[0]) || null;
      
      const sanitizedMarkdown = sanitizeQuotes(markdown || '');
      const title = sanitizeQuotes((metadata && metadata.title) || '');
      const description = sanitizeQuotes((metadata && metadata.description) || '');
      
      const formattedContent = 'Title: ' + title + '\nDescription: ' + description + '\nURL: ' + url + '\n\nMain Content:\n' + sanitizedMarkdown;
      
      const result: ScraperResult = {
        url,
        title,
        content: formattedContent.trim(),
        markdown: sanitizedMarkdown,
        screenshot: screenshotUrl,
        scraper: 'firecrawl',
        timestamp: Date.now(),
        metadata: {
          title,
          description,
          sourceURL: url,
          cached: (data.data && data.data.cached) || false,
          ...metadata,
        },
      };
      
      console.log('[firecrawl-scraper] Success, cached:', result.metadata.cached);
      return result;
      
    } catch (error) {
      console.error('[firecrawl-scraper] Failed:', error);
      throw new ScraperError(
        'Firecrawl scrape failed: ' + (error as Error).message,
        'firecrawl',
        error as Error
      );
    }
  }
}

export function createFirecrawlScraper(apiKey: string): FirecrawlScraper {
  return new FirecrawlScraper(apiKey);
}
