# 智能网页爬取模块

## 概述

本模块提供多样化的网页爬取方式，支持自动降级策略，降低对单一服务的依赖。

## 架构设计

```
┌─────────────────────────────────────┐
│   API Route: /api/scrape-url       │
└────────────┬────────────────────────┘
             │
             ▼
┌─────────────────────────────────────┐
│   Scraper Router (智能路由)         │
│   - 检查 Firecrawl 可用性           │
│   - 失败时降级到 Playwright         │
└────────────┬────────────────────────┘
             │
        ┌────┴────┐
        ▼         ▼
┌──────────┐  ┌──────────┐
│Firecrawl │  │Playwright│
│ Scraper  │  │ Scraper  │
└──────────┘  └──────────┘
```

## 主要特性

### 1. 多爬虫支持
- **Firecrawl API**：优先使用，支持缓存加速（500% 性能提升）
- **Playwright**：备选方案，使用无头浏览器

### 2. 智能路由
- 自动检测可用的爬虫
- Firecrawl 失败时自动降级到 Playwright
- 记录降级日志便于监控

### 3. 统一接口
- 所有爬虫返回统一的数据格式
- 简化上层调用逻辑

## 文件结构

```
lib/scraper/
├── types.ts                   # 类型定义
├── firecrawl-scraper.ts      # Firecrawl 爬虫实现
├── playwright-scraper.ts     # Playwright 爬虫实现
├── scraper-router.ts         # 智能路由器
├── index.ts                  # 导出入口
└── README.md                 # 本文档
```

## 使用方法

### 基础用法

```typescript
import { createScraperRouter } from '@/lib/scraper';

// 创建路由器
const router = createScraperRouter({
  preferredScraper: 'firecrawl',
  enableFallback: true,
  firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
});

// 爬取 URL（自动降级）
const result = await router.scrape('https://example.com', {
  waitFor: 3000,
  timeout: 30000,
  blockAds: true,
  fullPageScreenshot: false,
  maxAge: 3600000, // 1 小时缓存
});

console.log('使用的爬虫:', result.scraper);
console.log('是否降级:', result.fallbackUsed);
console.log('页面标题:', result.title);
console.log('内容长度:', result.content.length);
```

### API 路由使用

```typescript
// app/api/scrape-url-enhanced/route.ts
import { createScraperRouter } from '@/lib/scraper';

export async function POST(request: NextRequest) {
  const { url } = await request.json();
  
  const router = createScraperRouter({
    firecrawlApiKey: process.env.FIRECRAWL_API_KEY,
  });
  
  const result = await router.scrape(url);
  
  return NextResponse.json({
    success: true,
    ...result,
  });
}
```

## 配置选项

### RouterConfig

| 选项 | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `preferredScraper` | `'firecrawl' \| 'playwright'` | `'firecrawl'` | 首选爬虫类型 |
| `enableFallback` | `boolean` | `true` | 是否启用自动降级 |
| `firecrawlApiKey` | `string` | `undefined` | Firecrawl API 密钥 |

### ScraperOptions

| 选项 | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `waitFor` | `number` | `3000` | 等待时间（毫秒） |
| `timeout` | `number` | `30000` | 超时时间（毫秒） |
| `blockAds` | `boolean` | `true` | 是否阻止广告 |
| `fullPageScreenshot` | `boolean` | `false` | 是否全屏截图 |
| `maxAge` | `number` | `3600000` | 缓存最大时间（仅 Firecrawl） |

## 返回数据格式

### ScraperResult

```typescript
interface ScraperResult {
  url: string;                  // 请求的 URL
  title: string;                // 页面标题
  content: string;              // 格式化后的内容（供 AI 使用）
  markdown: string;             // Markdown 格式内容
  screenshot?: string;          // 截图（Base64 格式）
  scraper: ScraperType;         // 使用的爬虫类型
  timestamp: number;            // 时间戳
  metadata: ScraperMetadata;    // 元数据
}
```

### RouterResult (扩展)

```typescript
interface RouterResult extends ScraperResult {
  fallbackUsed: boolean;        // 是否使用了降级策略
  attemptedScraper?: ScraperType; // 原始尝试的爬虫类型
}
```

## 降级策略

### 触发条件

以下情况会触发降级：

1. **Firecrawl API Key 不存在**
2. **Firecrawl API 调用失败**
3. **Firecrawl 超时**
4. **Firecrawl 返回错误响应**

### 降级流程

```
1. 检查 Firecrawl 是否可用
   ├─ 是 → 尝试使用 Firecrawl
   │      ├─ 成功 → 返回结果
   │      └─ 失败 → 记录错误，继续步骤 2
   └─ 否 → 跳到步骤 2

2. 检查 Playwright 是否可用
   ├─ 是 → 使用 Playwright
   │      ├─ 成功 → 返回结果（标记 fallbackUsed: true）
   │      └─ 失败 → 抛出综合错误
   └─ 否 → 抛出"无可用爬虫"错误
```

## 性能对比

| 爬虫 | 平均响应时间 | 缓存命中时 | 资源消耗 | 成本 |
|-----|------------|-----------|---------|------|
| Firecrawl | 2-3s | 0.5s | 低 | API 调用费用 |
| Playwright | 4-6s | N/A | 中 | 服务器资源 |

## 监控和日志

### 关键日志

```typescript
// Firecrawl 日志
'[firecrawl-scraper] Using Firecrawl to scrape: <url>'
'[firecrawl-scraper] Success, cached: <boolean>'

// Playwright 日志
'[playwright-scraper] Starting scrape: <url>'
'[playwright-scraper] Launching Chromium browser...'
'[playwright-scraper] Navigating to page...'
'[playwright-scraper] Taking screenshot...'
'[playwright-scraper] Scrape successful'

// 路由器日志
'[scraper-router] Available scrapers: <list>'
'[scraper-router] Using Firecrawl scraper'
'[scraper-router] Falling back to Playwright'
```

### 监控指标

建议监控以下指标：

1. **成功率**：按爬虫类型统计成功率
2. **降级率**：Playwright 降级使用的比例
3. **响应时间**：P50、P95、P99 响应时间
4. **缓存命中率**：Firecrawl 缓存命中比例

## 环境变量

```bash
# Firecrawl API 密钥（可选，不设置时仅使用 Playwright）
FIRECRAWL_API_KEY=fc-xxx

# Node 环境（影响错误堆栈显示）
NODE_ENV=development
```

## 依赖项

```json
{
  "dependencies": {
    "playwright": "^1.56.1"
  }
}
```

## 最佳实践

### 1. 优先使用 Firecrawl

Firecrawl 具有以下优势：
- ✅ 更快的响应时间
- ✅ 缓存支持（500% 性能提升）
- ✅ 更低的服务器资源消耗

建议设置 `FIRECRAWL_API_KEY` 环境变量。

### 2. 启用降级策略

生产环境中务必启用降级：

```typescript
const router = createScraperRouter({
  enableFallback: true, // 必须开启
});
```

### 3. 合理设置超时

根据网站复杂度调整超时时间：

```typescript
// 简单页面
await router.scrape(url, { timeout: 15000, waitFor: 1000 });

// 复杂单页应用
await router.scrape(url, { timeout: 45000, waitFor: 5000 });
```

### 4. 监控降级情况

定期检查降级日志，识别问题：

```typescript
const result = await router.scrape(url);

if (result.fallbackUsed) {
  console.warn('Firecrawl failed, using Playwright:', {
    url,
    attemptedScraper: result.attemptedScraper,
  });
  
  // 可选：上报到监控系统
}
```

## 故障排查

### Playwright 浏览器启动失败

**症状**：`Error: browserType.launch: Executable doesn't exist`

**解决方案**：
```bash
npx playwright install chromium
```

### Firecrawl API 调用失败

**症状**：`Firecrawl API error (401): Unauthorized`

**解决方案**：
1. 检查 `FIRECRAWL_API_KEY` 环境变量
2. 验证 API Key 是否有效
3. 检查 API 配额是否耗尽

### 内存占用过高

**症状**：Playwright 占用大量内存

**解决方案**：
1. 确保浏览器实例正确关闭
2. 使用单例模式复用浏览器实例
3. 考虑限制并发爬取数量

## 未来改进

- [ ] 支持更多爬虫（如 Puppeteer、Cheerio）
- [ ] 添加请求限流和速率控制
- [ ] 支持代理配置
- [ ] 实现本地缓存机制
- [ ] 添加更详细的性能指标
- [ ] 支持自定义 User-Agent 池

## 相关文档

- [Firecrawl API 文档](https://firecrawl.dev/docs)
- [Playwright 官方文档](https://playwright.dev/)
- [Next.js API Routes](https://nextjs.org/docs/api-routes/introduction)

## 变更日志

### v1.0.0 (2025-11-07)

- ✅ 实现 Firecrawl 爬虫封装
- ✅ 实现 Playwright 爬虫
- ✅ 实现智能路由器
- ✅ 支持自动降级策略
- ✅ 统一数据格式
- ✅ 完整的 TypeScript 类型定义
- ✅ 通过 TypeScript 类型检查
- ✅ 通过 ESLint 检查
- ✅ 基础功能测试通过
