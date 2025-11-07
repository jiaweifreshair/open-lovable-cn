/**
 * Crawlee 智能爬虫实现
 *
 * 核心特性：
 * 1. 智能页面类型检测（静态 vs 动态）
 * 2. 自动降级策略：Cheerio（快） → Playwright（强）
 * 3. 统一接口，与现有 Scraper 兼容
 * 4. 性能最优：静态页面快 100 倍
 */

import { CheerioCrawler, PlaywrightCrawler, Dataset } from 'crawlee';
import type { ScraperOptions, ScraperResult } from './types';
import { ScraperError } from './types';
import * as cheerio from 'cheerio';

/**
 * HTML 转 Markdown
 * 复用自 playwright-scraper.ts
 */
function htmlToMarkdown(html: string): string {
  let markdown = html;

  // 移除 script 和 style 标签
  markdown = markdown.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  markdown = markdown.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');

  // 转换标题
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### ' + String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### ' + String.raw`$1` + '\n\n');

  // 转换段落和链接
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, String.raw`$1` + '\n\n');
  markdown = markdown.replace(/<a[^>]*href=["']([^"']*)["'][^>]*>(.*?)<\/a>/gi, '[' + String.raw`$2` + '](' + String.raw`$1` + ')');

  // 转换加粗和斜体
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**' + String.raw`$1` + '**');
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**' + String.raw`$1` + '**');
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*' + String.raw`$1` + '*');
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*' + String.raw`$1` + '*');

  // 转换列表
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- ' + String.raw`$1` + '\n');
  markdown = markdown.replace(/<ul[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ul>/gi, '\n');
  markdown = markdown.replace(/<ol[^>]*>/gi, '\n');
  markdown = markdown.replace(/<\/ol>/gi, '\n');
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n');

  // 移除其他 HTML 标签
  markdown = markdown.replace(/<[^>]+>/g, '');

  // 解码 HTML 实体
  markdown = markdown
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // 清理多余换行
  markdown = markdown.replace(/\n{3,}/g, '\n\n');

  return markdown.trim();
}

/**
 * 消毒智能引号和特殊字符
 * 复用自 playwright-scraper.ts
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

/**
 * 页面类型
 */
type PageType = 'static' | 'dynamic' | 'unknown';

/**
 * 智能页面类型检测器
 */
class PageTypeDetector {
  /**
   * 已知静态站点域名
   */
  private static readonly STATIC_DOMAINS = [
    'wikipedia.org',
    'github.com',
    'stackoverflow.com',
    'medium.com',
    'dev.to',
    'reddit.com',
    'news.ycombinator.com',
    'substack.com',
  ];

  /**
   * 已知动态站点模式
   */
  private static readonly DYNAMIC_PATTERNS = [
    '/app/',
    '/dashboard/',
    '/#/',        // Hash routing
    '/spa/',
    '/react/',
    '/vue/',
    '/angular/',
  ];

  /**
   * 已知 SPA 框架特征（在 HTML 中检测）
   */
  private static readonly SPA_INDICATORS = [
    'data-react-root',
    'data-reactroot',
    'ng-app',
    'ng-version',
    'v-cloak',
    '__next',
    '__nuxt',
  ];

  /**
   * 基于 URL 的快速检测
   */
  static detectByUrl(url: string): PageType {
    try {
      const parsedUrl = new URL(url);
      const hostname = parsedUrl.hostname;
      const pathname = parsedUrl.pathname;

      // 检查静态站点
      if (this.STATIC_DOMAINS.some(domain => hostname.includes(domain))) {
        console.log('[crawlee-scraper] Detected static site by domain:', hostname);
        return 'static';
      }

      // 检查动态站点模式
      if (this.DYNAMIC_PATTERNS.some(pattern => pathname.includes(pattern))) {
        console.log('[crawlee-scraper] Detected dynamic site by URL pattern:', pathname);
        return 'dynamic';
      }

      return 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * 基于 HTML 内容的检测
   */
  static detectByHtml(html: string): PageType {
    // 检查 HTML 长度（静态页面通常内容较多）
    if (html.length < 500) {
      console.log('[crawlee-scraper] HTML too short, likely SPA');
      return 'dynamic';
    }

    // 检查 SPA 框架特征
    for (const indicator of this.SPA_INDICATORS) {
      if (html.includes(indicator)) {
        console.log('[crawlee-scraper] Detected SPA indicator:', indicator);
        return 'dynamic';
      }
    }

    // 检查内容丰富度（静态页面有更多文本内容）
    const $ = cheerio.load(html);
    const bodyText = $('body').text().trim();
    const textRatio = bodyText.length / html.length;

    if (textRatio < 0.1) {
      console.log('[crawlee-scraper] Low text ratio, likely SPA:', textRatio);
      return 'dynamic';
    }

    // 检查是否有主要内容区域
    const mainContent = $('main, article, [role="main"], #content, .content').text().trim();
    if (mainContent.length > 200) {
      console.log('[crawlee-scraper] Found substantial main content, likely static');
      return 'static';
    }

    return 'unknown';
  }
}

/**
 * Crawlee 智能爬虫类
 */
export class CrawleeScraper {
  /**
   * 智能爬取（自动选择最优方式）
   */
  async scrape(url: string, options: ScraperOptions = {}): Promise<ScraperResult> {
    console.log('[crawlee-scraper] Starting intelligent scrape:', url);

    // 第一步：基于 URL 快速判断
    const urlDetection = PageTypeDetector.detectByUrl(url);

    if (urlDetection === 'dynamic') {
      // 确定是动态页面，直接用 Playwright
      console.log('[crawlee-scraper] Using Playwright (URL detection: dynamic)');
      return this.scrapeWithPlaywright(url, options);
    }

    // 第二步：尝试 Cheerio（静态页面爬取）
    if (urlDetection === 'static' || urlDetection === 'unknown') {
      try {
        console.log('[crawlee-scraper] Trying Cheerio first (fast path)');
        const result = await this.scrapeWithCheerio(url, options);

        // 验证结果质量
        if (this.isResultValid(result)) {
          console.log('[crawlee-scraper] Cheerio success! Content length:', result.content.length);
          return result;
        }

        console.log('[crawlee-scraper] Cheerio result invalid, falling back to Playwright');
      } catch (error) {
        console.log('[crawlee-scraper] Cheerio failed, falling back to Playwright:', (error as Error).message);
      }
    }

    // 第三步：降级到 Playwright
    console.log('[crawlee-scraper] Using Playwright (fallback)');
    return this.scrapeWithPlaywright(url, options);
  }

  /**
   * 验证结果是否有效
   */
  private isResultValid(result: ScraperResult): boolean {
    // 检查内容长度
    if (!result.content || result.content.length < 100) {
      return false;
    }

    // 检查是否有标题
    if (!result.title || result.title.length < 3) {
      return false;
    }

    return true;
  }

  /**
   * 使用 Cheerio 爬取（静态页面，极快）
   */
  private async scrapeWithCheerio(url: string, options: ScraperOptions): Promise<ScraperResult> {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const crawler = new CheerioCrawler({
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: (options.timeout || 30000) / 1000,

        async requestHandler({ request, $, log, body }) {
          try {
            // 提取标题
            const title = $('h1').first().text().trim() ||
                         $('title').first().text().trim() ||
                         $('meta[property="og:title"]').attr('content') ||
                         'Untitled';

            // 提取描述
            const description = $('meta[name="description"]').attr('content') ||
                               $('meta[property="og:description"]').attr('content') ||
                               '';

            // 智能内容提取（按优先级尝试）
            const contentSelectors = [
              'main',
              'article',
              '[role="main"]',
              '#content',
              '.content',
              '#main',
              '.main',
              '.post-content',
              '.article-content',
            ];

            let mainContent = '';
            for (const selector of contentSelectors) {
              const text = $(selector).text().trim();
              if (text.length > 200) {
                mainContent = text;
                console.log('[cheerio-crawler] Found content with selector:', selector, 'length:', text.length);
                break;
              }
            }

            // 如果未找到主内容，使用 body
            if (!mainContent) {
              mainContent = $('body').text().trim();
            }

            // 转换为 Markdown
            const htmlContent = $.html();
            const markdown = htmlToMarkdown(htmlContent);

            // 消毒文本
            const sanitizedTitle = sanitizeQuotes(title);
            const sanitizedDescription = sanitizeQuotes(description);
            const sanitizedMarkdown = sanitizeQuotes(markdown);
            const sanitizedContent = sanitizeQuotes(mainContent);

            // 格式化内容
            const formattedContent =
              'Title: ' + sanitizedTitle + '\n' +
              'Description: ' + sanitizedDescription + '\n' +
              'URL: ' + url + '\n\n' +
              'Main Content:\n' + sanitizedContent;

            const result: ScraperResult = {
              url: request.url,
              title: sanitizedTitle,
              content: formattedContent.trim(),
              markdown: sanitizedMarkdown,
              screenshot: undefined, // Cheerio 不支持截图
              scraper: 'cheerio',
              timestamp: Date.now(),
              metadata: {
                title: sanitizedTitle,
                description: sanitizedDescription,
                sourceURL: url,
                statusCode: 200,
                cached: false,
                responseTime: Date.now() - startTime,
                contentLength: formattedContent.length,
              },
            };

            // 使用 Dataset API 存储结果
            await Dataset.pushData(result);

          } catch (error) {
            log.error('[cheerio-crawler] Request handler error:', error as Error);
            throw error;
          }
        },

        async failedRequestHandler({ request, error, log }) {
          log.error('[cheerio-crawler] Request failed:', error as Error);
          reject(new ScraperError(
            'Cheerio scrape failed: ' + (error as Error).message,
            'cheerio',
            error as Error
          ));
        },
      });

      // 运行爬虫并获取结果
      crawler.run([url])
        .then(async () => {
          const data = await crawler.getData();
          if (data.items.length > 0) {
            console.log('[cheerio-crawler] Scrape completed in', Date.now() - startTime, 'ms');
            resolve(data.items[0] as ScraperResult);
          } else {
            reject(new ScraperError('No results from Cheerio crawler', 'cheerio'));
          }
        })
        .catch(error => {
          reject(new ScraperError(
            'Cheerio crawler failed: ' + error.message,
            'cheerio',
            error
          ));
        });
    });
  }

  /**
   * 使用 Playwright 爬取（动态页面，功能强大）
   */
  private async scrapeWithPlaywright(url: string, options: ScraperOptions): Promise<ScraperResult> {
    const {
      waitFor = 3000,
      timeout = 30000,
      blockAds = true,
      fullPageScreenshot = false,
    } = options;

    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      const crawler = new PlaywrightCrawler({
        maxRequestsPerCrawl: 1,
        requestHandlerTimeoutSecs: timeout / 1000,
        launchContext: {
          launchOptions: {
            headless: true,
            args: [
              '--no-sandbox',
              '--disable-setuid-sandbox',
              '--disable-dev-shm-usage',
              '--disable-gpu',
            ],
          },
        },

        async requestHandler({ request, page, log }) {
          try {
            // 设置 User-Agent
            await page.setViewportSize({ width: 1280, height: 720 });

            // 广告拦截
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
                  route.abort().catch(() => {});
                } else {
                  route.continue().catch(() => {});
                }
              });
            }

            // 等待页面加载
            console.log('[playwright-crawler] Waiting for dynamic content...');
            await page.waitForTimeout(waitFor);

            // 提取数据
            const title = await page.title();
            const description = await page.$eval(
              'meta[name="description"]',
              (el) => el.getAttribute('content') || ''
            ).catch(() => '');

            const htmlContent = await page.content();

            // 智能内容提取
            const contentSelectors = [
              'main',
              'article',
              '[role="main"]',
              '#content',
              '.content',
              '#main',
              '.main',
            ];

            let mainContent = '';
            for (const selector of contentSelectors) {
              try {
                const text = await page.$eval(selector, el => el.textContent || '');
                if (text.length > 200) {
                  mainContent = text;
                  break;
                }
              } catch {
                // 选择器不存在，继续尝试
              }
            }

            if (!mainContent) {
              mainContent = await page.$eval('body', el => el.textContent || '').catch(() => '');
            }

            // 截图（如果需要）
            let screenshot: string | undefined;
            if (options.screenshot !== false) {
              console.log('[playwright-crawler] Taking screenshot...');
              const screenshotBuffer = await page.screenshot({
                fullPage: fullPageScreenshot,
                type: 'png',
              });
              screenshot = 'data:image/png;base64,' + screenshotBuffer.toString('base64');
            }

            // 转换为 Markdown
            const markdown = htmlToMarkdown(htmlContent);

            // 消毒文本
            const sanitizedTitle = sanitizeQuotes(title);
            const sanitizedDescription = sanitizeQuotes(description);
            const sanitizedMarkdown = sanitizeQuotes(markdown);
            const sanitizedContent = sanitizeQuotes(mainContent);

            // 格式化内容
            const formattedContent =
              'Title: ' + sanitizedTitle + '\n' +
              'Description: ' + sanitizedDescription + '\n' +
              'URL: ' + url + '\n\n' +
              'Main Content:\n' + sanitizedContent;

            const result: ScraperResult = {
              url: request.url,
              title: sanitizedTitle,
              content: formattedContent.trim(),
              markdown: sanitizedMarkdown,
              screenshot,
              scraper: 'playwright',
              timestamp: Date.now(),
              metadata: {
                title: sanitizedTitle,
                description: sanitizedDescription,
                sourceURL: url,
                statusCode: 200,
                cached: false,
                responseTime: Date.now() - startTime,
                contentLength: formattedContent.length,
              },
            };

            // 使用 Dataset API 存储结果
            await Dataset.pushData(result);

          } catch (error) {
            log.error('[playwright-crawler] Request handler error:', error as Error);
            throw error;
          }
        },

        async failedRequestHandler({ request, error, log }) {
          log.error('[playwright-crawler] Request failed:', error as Error);
          reject(new ScraperError(
            'Playwright scrape failed: ' + (error as Error).message,
            'playwright',
            error as Error
          ));
        },
      });

      // 运行爬虫并获取结果
      crawler.run([url])
        .then(async () => {
          const data = await crawler.getData();
          if (data.items.length > 0) {
            console.log('[playwright-crawler] Scrape completed in', Date.now() - startTime, 'ms');
            resolve(data.items[0] as ScraperResult);
          } else {
            reject(new ScraperError('No results from Playwright crawler', 'playwright'));
          }
        })
        .catch(error => {
          reject(new ScraperError(
            'Playwright crawler failed: ' + error.message,
            'playwright',
            error
          ));
        });
    });
  }
}

/**
 * 创建 Crawlee 爬虫实例（单例）
 */
let scraperInstance: CrawleeScraper | null = null;

export function getCrawleeScraper(): CrawleeScraper {
  if (!scraperInstance) {
    scraperInstance = new CrawleeScraper();
  }
  return scraperInstance;
}
