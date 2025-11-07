# 智能爬虫快速上手指南

## 5 分钟快速开始

### 1. 安装依赖

```bash
# 安装 Playwright 浏览器
npx playwright install chromium
```

### 2. 配置环境变量（可选）

```bash
# .env.local
FIRECRAWL_API_KEY=fc-your-api-key  # 可选，不设置时使用 Playwright
```

### 3. 使用示例

#### 方式 1: API 调用（推荐）

```bash
# 基础调用
curl -X POST http://localhost:3000/api/scrape-url-enhanced \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com"}'

# 带配置调用
curl -X POST http://localhost:3000/api/scrape-url-enhanced \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://example.com",
    "options": {
      "waitFor": 5000,
      "timeout": 45000,
      "blockAds": true,
      "fullPageScreenshot": false
    }
  }'
```

#### 方式 2: 代码集成

```typescript
import { createScraperRouter } from '@/lib/scraper';

// 创建路由器
const router = createScraperRouter({
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY, // 可选
});

// 爬取网页
const result = await router.scrape('https://example.com', {
  waitFor: 3000,        // 等待 3 秒
  timeout: 30000,       // 超时 30 秒
  blockAds: true,       // 阻止广告
  fullPageScreenshot: false, // 仅可见区域
});

// 使用结果
console.log('使用的爬虫:', result.scraper);
console.log('是否降级:', result.fallbackUsed);
console.log('页面标题:', result.title);
console.log('内容:', result.content);
console.log('截图:', result.screenshot); // Base64
```

### 4. 响应格式

```json
{
  "success": true,
  "url": "https://example.com",
  "content": "Title: Example Domain\nDescription: ...\n\nMain Content:\n...",
  "screenshot": "data:image/png;base64,...",
  "structured": {
    "title": "Example Domain",
    "description": "Example Domain",
    "content": "# Example Domain\n\n...",
    "url": "https://example.com",
    "screenshot": "data:image/png;base64,..."
  },
  "metadata": {
    "scraper": "playwright",
    "fallbackUsed": true,
    "attemptedScraper": "firecrawl",
    "timestamp": "2025-11-07T14:30:00.000Z",
    "contentLength": 1234,
    "cached": false
  },
  "message": "URL scraped successfully with Playwright (fallback from Firecrawl)"
}
```

### 5. 监控降级情况

```typescript
const result = await router.scrape(url);

if (result.fallbackUsed) {
  console.warn('⚠️ Firecrawl 不可用，已降级到 Playwright:', {
    url,
    attemptedScraper: result.attemptedScraper,
  });
  
  // 可选：上报到监控系统
  monitoring.track('scraper_fallback', {
    url,
    from: result.attemptedScraper,
    to: result.scraper,
  });
}
```

### 6. 性能优化建议

#### a) 优先使用 Firecrawl（更快）

```typescript
// 设置 FIRECRAWL_API_KEY 环境变量
const router = createScraperRouter({
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY, // 优先使用
});
```

#### b) 利用缓存加速

```typescript
// Firecrawl 自动缓存 1 小时
const result = await router.scrape(url, {
  maxAge: 3600000, // 1 小时（默认）
});

// 缓存命中时仅需 0.5s（500% 性能提升）
console.log('使用缓存:', result.metadata.cached);
```

#### c) 调整超时时间

```typescript
// 简单页面
await router.scrape(url, {
  timeout: 15000,  // 15 秒足够
  waitFor: 1000,   // 仅等待 1 秒
});

// 复杂单页应用
await router.scrape(url, {
  timeout: 45000,  // 45 秒超时
  waitFor: 5000,   // 等待 5 秒加载
});
```

### 7. 常见问题

#### Q: Playwright 浏览器启动失败？

```bash
# 解决方案：安装 Chromium
npx playwright install chromium
```

#### Q: Firecrawl API 调用失败？

```bash
# 检查 API Key
echo $FIRECRAWL_API_KEY

# 检查 API 配额
# 访问：https://firecrawl.dev/dashboard
```

#### Q: 内存占用过高？

```typescript
// 使用单例模式（已内置）
// 确保浏览器实例正确关闭
import { cleanupPlaywrightScraper } from '@/lib/scraper';

// 应用关闭时清理
process.on('SIGTERM', async () => {
  await cleanupPlaywrightScraper();
});
```

### 8. 高级用法

#### 自定义爬虫策略

```typescript
import { 
  createScraperRouter, 
  FirecrawlScraper, 
  PlaywrightScraper 
} from '@/lib/scraper';

// 仅使用 Playwright（跳过 Firecrawl）
const router = createScraperRouter({
  preferredScraper: 'playwright',
  enableFallback: false,
});

// 直接使用特定爬虫
const firecrawl = new FirecrawlScraper(apiKey);
const result = await firecrawl.scrape(url);

const playwright = new PlaywrightScraper();
const result2 = await playwright.scrape(url);
```

#### 批量爬取

```typescript
const urls = [
  'https://example1.com',
  'https://example2.com',
  'https://example3.com',
];

const router = createScraperRouter({
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
});

// 并发爬取（注意控制并发数）
const results = await Promise.all(
  urls.map(url => router.scrape(url))
);

// 统计降级情况
const fallbackCount = results.filter(r => r.fallbackUsed).length;
console.log('降级率:', (fallbackCount / results.length * 100).toFixed(2) + '%');
```

## 完整示例项目

```typescript
// pages/api/scrape.ts
import { NextApiRequest, NextApiResponse } from 'next';
import { createScraperRouter } from '@/lib/scraper';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { url, options = {} } = req.body;

  if (!url) {
    return res.status(400).json({ error: 'URL is required' });
  }

  try {
    const router = createScraperRouter({
      firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
    });

    const result = await router.scrape(url, options);

    // 记录降级事件
    if (result.fallbackUsed) {
      console.warn('Scraper fallback:', {
        url,
        from: result.attemptedScraper,
        to: result.scraper,
      });
    }

    return res.status(200).json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Scrape error:', error);
    return res.status(500).json({
      success: false,
      error: (error as Error).message,
    });
  }
}
```

## 下一步

- 📖 阅读 [完整文档](./lib/scraper/README.md)
- 🧪 运行 [测试脚本](./test-scraper.mjs)
- 📊 查看 [Phase 2 总结](./PHASE2_SUMMARY.md)
- 🔍 监控降级情况和性能指标

---

**需要帮助？**
- GitHub Issues: [提交问题](https://github.com/yourusername/yourrepo/issues)
- 文档：[lib/scraper/README.md](./lib/scraper/README.md)
