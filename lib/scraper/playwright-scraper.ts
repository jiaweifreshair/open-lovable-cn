/**
 * Playwright 爬虫实现
 * 
 * 使用 Playwright 无头浏览器进行网页爬取和截图
 * 作为 Firecrawl 的备选方案
 */

import { chromium, Browser, Page } from 'playwright';
import type { ScraperOptions, ScraperResult } from './types';
import { ScraperError } from './types';

/**
 * 将 HTML 内容转换为 Markdown
 */
function htmlToMarkdown(html: string): string {
  let markdown = html;
  
  markdown = markdown.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  markdown = markdown.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### ' + String.raw`$1` + '\n\n');
  
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[' + String.raw`$2` + '](' + String.raw`$1` + ')');
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**' + String.raw`$1` + '**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**' + String.raw`$1` + '**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*' + String.raw`$1` + '*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*' + String.raw`$1` + '*');
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- ' + String.raw`$1` + '\n');
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');
  markdown = markdown.replace(/<[^>]+>/g, '');
  
  markdown = markdown
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  markdown = markdown.replace(/\n{3,}/g, '\n\n');
  
  return markdown.trim();
}

/**
 * 消毒智能引号和其他特殊字符
 */
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

export class PlaywrightScraper {
  private browser: Browser | null = null;
  
  private async initBrowser(): Promise<Browser> {
    if (this.browser) {
      return this.browser;
    }
    
    console.log('[playwright-scraper] Launching Chromium browser...');
    
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
    
    return this.browser;
  }
  
  async close(): Promise<void> {
    if (this.browser) {
      console.log('[playwright-scraper] Closing browser...');
      await this.browser.close();
      this.browser = null;
    }
  }
  
  async scrape(url: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    const {
      waitFor = 3000,
      timeout = 30000,
      blockAds = true,
      fullPageScreenshot = false,
    } = options;
    
    let page: Page | null = null;
    
    try {
      console.log('[playwright-scraper] Starting scrape:', url);
      
      const browser = await this.initBrowser();
      page = await browser.newPage({
        viewport: { width: 1280, height: 720 },
        ...(blockAds && {
          userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        }),
      });
      
      page.setDefaultTimeout(timeout);
      
      if (blockAds) {
        await page.route('**/*', (route) => {
          const routeUrl = route.request().url();
          const resourceType = route.request().resourceType();
          
          const adDomains = [
            'googleadservices.com',
            'doubleclick.net',
            'googlesyndication.com',
            'adservice.google.com',
          ];
          
          const shouldBlock = adDomains.some(domain => routeUrl.includes(domain)) ||
            (resourceType === 'image' && routeUrl.includes('ad')) ||
            (resourceType === 'script' && routeUrl.includes('analytics'));
          
          if (shouldBlock) {
            route.abort();
          } else {
            route.continue();
          }
        });
      }
      
      console.log('[playwright-scraper] Navigating to page...');
      await page.goto(url, { 
        waitUntil: 'networkidle',
        timeout 
      });
      
      console.log('[playwright-scraper] Waiting for dynamic content...');
      await page.waitForTimeout(waitFor);
      
      const title = await page.title();
      const description = await page.$eval(
        'meta[name="description"]',
        (el) => el.getAttribute('content') || ''
      ).catch(() => '');
      
      console.log('[playwright-scraper] Extracting page content...');
      const htmlContent = await page.content();
      
      let mainContent = '';
      try {
        const selectors = [
          'main',
          'article',
          '[role="main"]',
          '#content',
          '.content',
          '#main',
          '.main',
        ];
        
        for (const selector of selectors) {
          const element = await page.$(selector);
          if (element) {
            mainContent = await element.textContent() || '';
            break;
          }
        }
      } catch (error) {
        console.log('[playwright-scraper] Cannot extract main content, using body');
      }
      
      if (!mainContent) {
        mainContent = await page.$eval('body', el => el.textContent || '').catch(() => '');
      }
      
      const markdown = htmlToMarkdown(htmlContent);
      
      console.log('[playwright-scraper] Taking screenshot...');
      const screenshotBuffer = await page.screenshot({
        fullPage: fullPageScreenshot,
        type: 'png',
      });
      
      const screenshotBase64 = 'data:image/png;base64,' + screenshotBuffer.toString('base64');
      
      const sanitizedTitle = sanitizeQuotes(title);
      const sanitizedDescription = sanitizeQuotes(description);
      const sanitizedMarkdown = sanitizeQuotes(markdown);
      const sanitizedContent = sanitizeQuotes(mainContent);
      
      const formattedContent = 'Title: ' + sanitizedTitle + '\nDescription: ' + sanitizedDescription + '\nURL: ' + url + '\n\nMain Content:\n' + sanitizedContent;
      
      const result: ScraperResult = {
        url,
        title: sanitizedTitle,
        content: formattedContent.trim(),
        markdown: sanitizedMarkdown,
        screenshot: screenshotBase64,
        scraper: 'playwright',
        timestamp: Date.now(),
        metadata: {
          title: sanitizedTitle,
          description: sanitizedDescription,
          sourceURL: url,
          statusCode: 200,
          cached: false,
        },
      };
      
      console.log('[playwright-scraper] Scrape successful');
      return result;
      
    } catch (error) {
      console.error('[playwright-scraper] Scrape failed:', error);
      throw new ScraperError(
        'Playwright scrape failed: ' + (error as Error).message,
        'playwright',
        error as Error
      );
    } finally {
      if (page) {
        await page.close().catch(err => {
          console.error('[playwright-scraper] Failed to close page:', err);
        });
      }
    }
  }
}

let scraperInstance: PlaywrightScraper | null = null;

export function getPlaywrightScraper(): PlaywrightScraper {
  if (!scraperInstance) {
    scraperInstance = new PlaywrightScraper();
  }
  return scraperInstance;
}

export async function cleanupPlaywrightScraper(): Promise<void> {
  if (scraperInstance) {
    await scraperInstance.close();
    scraperInstance = null;
  }
}
