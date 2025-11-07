# Phase 3 设计文档：智能缓存与性能优化系统

## 📋 需求分析

### 业务场景

**用户核心需求**：
> "每个爬取都是基于用户的需求来缓存设计的"

**实际场景举例**：
```
场景 1: 用户 A 请求
  URL: https://example.com
  需求: { screenshot: true, fullPageScreenshot: true, blockAds: true }
  缓存键: hash(URL + 需求参数)

场景 2: 用户 B 请求（相同 URL，不同需求）
  URL: https://example.com
  需求: { screenshot: false, blockAds: true }
  缓存键: hash(URL + 需求参数) // 与场景1不同

场景 3: 用户 C 请求（相同 URL 和需求）
  URL: https://example.com
  需求: { screenshot: false, blockAds: true }
  缓存键: hash(URL + 需求参数) // 与场景2相同，命中缓存！
```

### 现状分析

**✅ Firecrawl（已有缓存）**：
- 服务端缓存：`maxAge` 参数控制（默认 1 小时）
- 缓存标识：`result.metadata.cached` 字段
- 性能提升：缓存命中时 ~0.5s（500% 性能提升）
- **限制**：缓存键由 Firecrawl 控制，无法基于 ScraperOptions 定制

**❌ Playwright（无缓存）**：
- 每次都实时爬取
- 平均耗时：~1.7s
- 资源消耗：~100MB 内存/浏览器实例
- **问题**：重复爬取相同 URL+需求组合时浪费资源

### Phase 3 核心目标

**主要目标**：
1. ✅ 为 Playwright 添加智能缓存层
2. ✅ 实现基于用户需求的缓存键设计
3. ✅ 支持多级缓存策略（内存 + Redis）
4. ✅ 性能优化（浏览器池、并发控制、请求去重）
5. ✅ 监控和统计（缓存命中率、性能指标）

**成功标准**：
- 缓存命中率 ≥ 60%（生产环境）
- 缓存命中时响应时间 < 100ms
- 内存占用控制在 500MB 以内
- 支持 100+ 并发请求

---

## 🎯 Phase 划分（遵循 CLAUDE.md 5.0 规范）

### Phase 3.1: 缓存核心层实现（3-4 小时）

**输入**：
- Phase 2 完成的 Playwright 爬虫
- ScraperOptions 和 ScraperResult 接口

**输出**：
- `lib/cache/cache-manager.ts` - 缓存管理器
- `lib/cache/cache-key-generator.ts` - 缓存键生成器
- `lib/cache/types.ts` - 缓存类型定义
- `lib/cache/memory-cache.ts` - 内存缓存实现（LRU）

**验收标准**：
- ✅ 缓存键基于 URL + ScraperOptions 生成
- ✅ 支持 get/set/delete/clear 操作
- ✅ LRU 淘汰策略正确工作
- ✅ 单元测试覆盖率 ≥ 85%

**任务拆解**：
1. 设计缓存键生成算法（hash 算法选择）
2. 实现内存缓存（使用 LRU-Cache 库）
3. 实现缓存管理器接口
4. 编写单元测试

---

### Phase 3.2: 集成缓存到 Playwright 爬虫（2-3 小时）

**依赖**：Phase 3.1 完成

**输入**：
- 缓存管理器
- Playwright 爬虫实现

**输出**：
- 修改 `lib/scraper/playwright-scraper.ts`
- 修改 `lib/scraper/scraper-router.ts`
- 更新 `lib/scraper/types.ts`（添加缓存配置）

**验收标准**：
- ✅ Playwright 爬取前先查缓存
- ✅ 缓存未命中时执行爬取并存入缓存
- ✅ 缓存命中时返回 `cached: true`
- ✅ 集成测试通过

**任务拆解**：
1. 在 PlaywrightScraper 中注入缓存管理器
2. 修改 scrape 方法：查缓存 → 爬取 → 存缓存
3. 添加缓存控制参数（skipCache, forceRefresh）
4. 更新路由器逻辑
5. 编写集成测试

---

### Phase 3.3: Redis 缓存支持（可选，2-3 小时）

**依赖**：Phase 3.2 完成

**输入**：
- 缓存管理器接口
- Redis 配置

**输出**：
- `lib/cache/redis-cache.ts` - Redis 缓存实现
- 环境变量配置（REDIS_URL）
- 缓存策略配置

**验收标准**：
- ✅ Redis 连接正常
- ✅ 支持分布式缓存
- ✅ 降级到内存缓存（Redis 不可用时）
- ✅ 性能测试通过

**任务拆解**：
1. 安装 ioredis 依赖
2. 实现 Redis 缓存适配器
3. 添加连接池管理
4. 实现降级策略
5. 性能压测

---

### Phase 3.4: 浏览器池与并发控制（3-4 小时）

**依赖**：Phase 3.2 完成

**输入**：
- Playwright 爬虫
- 缓存层

**输出**：
- `lib/scraper/browser-pool.ts` - 浏览器池管理
- `lib/scraper/concurrency-limiter.ts` - 并发限制器

**验收标准**：
- ✅ 支持最多 N 个浏览器实例（可配置）
- ✅ 并发请求排队机制
- ✅ 浏览器实例复用和自动清理
- ✅ 并发测试（100+ 请求）通过

**任务拆解**：
1. 设计浏览器池接口
2. 实现浏览器获取和归还逻辑
3. 添加健康检查和自动重启
4. 实现并发限制器（p-limit）
5. 编写并发测试

---

### Phase 3.5: 监控与统计（2-3 小时）

**依赖**：Phase 3.2 完成

**输入**：
- 缓存管理器
- Playwright 爬虫

**输出**：
- `lib/cache/cache-stats.ts` - 缓存统计
- `app/api/cache-stats/route.ts` - 统计 API
- `app/api/cache-clear/route.ts` - 缓存清除 API

**验收标准**：
- ✅ 记录缓存命中率
- ✅ 记录平均响应时间
- ✅ 提供统计数据 API
- ✅ 支持手动清除缓存

**任务拆解**：
1. 设计统计数据结构
2. 实现统计收集逻辑
3. 创建统计查询 API
4. 创建缓存管理 API
5. 编写管理界面（可选）

---

## 🏗️ 技术架构设计

### 整体架构图

```
┌─────────────────────────────────────────────────────────────┐
│                      API Layer                               │
│  ┌─────────────────────────────────────────────────────┐   │
│  │   POST /api/scrape-url-enhanced                     │   │
│  │   GET  /api/cache-stats                             │   │
│  │   POST /api/cache-clear                             │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                   Scraper Router                             │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │   Firecrawl      │         │   Playwright     │         │
│  │   (已有缓存)      │         │   (新增缓存)      │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│                  Cache Layer (NEW)                           │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Cache Manager                          │   │
│  │  ┌────────────────┐  ┌────────────────────────┐    │   │
│  │  │  Cache Key     │  │  Cache Strategy        │    │   │
│  │  │  Generator     │  │  (TTL, LRU, etc)       │    │   │
│  │  └────────────────┘  └────────────────────────┘    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                              │
│  ┌──────────────────┐         ┌──────────────────┐         │
│  │  Memory Cache    │         │   Redis Cache    │         │
│  │  (LRU, 默认)     │         │   (可选, 分布式)  │         │
│  └──────────────────┘         └──────────────────┘         │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│              Browser Pool (NEW)                              │
│  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐           │
│  │Browser1│  │Browser2│  │Browser3│  │BrowserN│           │
│  └────────┘  └────────┘  └────────┘  └────────┘           │
│                                                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │         Concurrency Limiter                         │   │
│  │         (并发请求排队机制)                            │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🔑 核心算法设计

### 1. 缓存键生成算法

**需求**：
- 相同 URL + 相同需求参数 → 相同缓存键
- 不同需求参数 → 不同缓存键
- 键长度适中（< 256 字符）

**实现方案**：

```typescript
import crypto from 'crypto';

interface CacheKeyInput {
  url: string;
  options: ScraperOptions;
}

/**
 * 生成缓存键
 * 格式: scraper:playwright:{url_hash}:{options_hash}
 */
function generateCacheKey(input: CacheKeyInput): string {
  // 1. URL 规范化
  const normalizedUrl = normalizeUrl(input.url);

  // 2. 选项序列化（只包含影响结果的参数）
  const relevantOptions = {
    waitFor: input.options.waitFor || 3000,
    blockAds: input.options.blockAds !== false,
    fullPageScreenshot: input.options.fullPageScreenshot || false,
    // timeout 不影响结果，不包含在缓存键中
  };

  // 3. 生成哈希
  const urlHash = hashString(normalizedUrl);
  const optionsHash = hashString(JSON.stringify(relevantOptions));

  // 4. 组合缓存键
  return `scraper:playwright:${urlHash}:${optionsHash}`;
}

/**
 * URL 规范化
 * - 统一协议（http/https）
 * - 移除尾部斜杠
 * - 排序查询参数
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // 排序查询参数
    const params = Array.from(parsed.searchParams.entries())
      .sort(([a], [b]) => a.localeCompare(b));

    parsed.search = new URLSearchParams(params).toString();

    // 移除尾部斜杠
    let normalized = parsed.toString();
    if (normalized.endsWith('/')) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  } catch {
    return url;
  }
}

/**
 * 字符串哈希（SHA-256 前 16 位）
 */
function hashString(str: string): string {
  return crypto
    .createHash('sha256')
    .update(str)
    .digest('hex')
    .substring(0, 16);
}
```

**示例**：
```typescript
// 示例 1: 基础爬取
const key1 = generateCacheKey({
  url: 'https://example.com',
  options: { waitFor: 3000, blockAds: true },
});
// 结果: scraper:playwright:a1b2c3d4e5f6g7h8:i9j0k1l2m3n4o5p6

// 示例 2: 相同 URL，不同参数
const key2 = generateCacheKey({
  url: 'https://example.com',
  options: { waitFor: 3000, blockAds: true, fullPageScreenshot: true },
});
// 结果: scraper:playwright:a1b2c3d4e5f6g7h8:q7r8s9t0u1v2w3x4
//       ↑ URL 哈希相同            ↑ 选项哈希不同

// 示例 3: URL 规范化
const key3a = generateCacheKey({
  url: 'https://example.com?b=2&a=1',
  options: {},
});
const key3b = generateCacheKey({
  url: 'https://example.com?a=1&b=2',
  options: {},
});
// key3a === key3b （查询参数已排序）
```

---

### 2. LRU 缓存淘汰策略

**需求**：
- 内存有限，需要淘汰最少使用的缓存
- 缓存大小可配置（默认 100 条）
- 支持 TTL（生存时间）

**实现方案**：使用 `lru-cache` 库

```typescript
import { LRUCache } from 'lru-cache';

interface CacheEntry {
  data: ScraperResult;
  createdAt: number;
  accessCount: number;
}

const cache = new LRUCache<string, CacheEntry>({
  max: 100,                  // 最多 100 条缓存
  maxSize: 50 * 1024 * 1024, // 最大 50MB
  sizeCalculation: (value) => {
    // 计算缓存项大小（JSON 序列化后的字节数）
    return JSON.stringify(value.data).length;
  },
  ttl: 1000 * 60 * 60,       // 1 小时 TTL
  updateAgeOnGet: true,      // 访问时更新年龄
  updateAgeOnHas: false,     // 检查时不更新年龄
});
```

---

### 3. 浏览器池管理算法

**需求**：
- 维护 N 个浏览器实例（默认 3 个）
- 按需创建，自动复用
- 健康检查和自动重启
- 优雅关闭

**实现方案**：

```typescript
interface BrowserInstance {
  id: string;
  browser: Browser;
  inUse: boolean;
  createdAt: number;
  lastUsedAt: number;
  requestCount: number;
}

class BrowserPool {
  private instances: Map<string, BrowserInstance> = new Map();
  private maxInstances = 3;
  private maxRequestsPerBrowser = 100; // 处理 100 次后重启

  /**
   * 获取可用的浏览器实例
   */
  async acquire(): Promise<Browser> {
    // 1. 查找空闲实例
    for (const [id, instance] of this.instances) {
      if (!instance.inUse && instance.requestCount < this.maxRequestsPerBrowser) {
        instance.inUse = true;
        instance.lastUsedAt = Date.now();
        instance.requestCount++;
        return instance.browser;
      }
    }

    // 2. 创建新实例（如果未达上限）
    if (this.instances.size < this.maxInstances) {
      const browser = await chromium.launch({ headless: true });
      const id = nanoid();

      this.instances.set(id, {
        id,
        browser,
        inUse: true,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        requestCount: 1,
      });

      return browser;
    }

    // 3. 等待实例释放（排队）
    return await this.waitForAvailable();
  }

  /**
   * 释放浏览器实例
   */
  release(browser: Browser): void {
    for (const [id, instance] of this.instances) {
      if (instance.browser === browser) {
        instance.inUse = false;

        // 检查是否需要重启（达到请求上限）
        if (instance.requestCount >= this.maxRequestsPerBrowser) {
          this.restartInstance(id);
        }

        return;
      }
    }
  }

  /**
   * 重启实例
   */
  private async restartInstance(id: string): Promise<void> {
    const instance = this.instances.get(id);
    if (!instance) return;

    // 关闭旧浏览器
    await instance.browser.close();

    // 启动新浏览器
    const newBrowser = await chromium.launch({ headless: true });

    this.instances.set(id, {
      id,
      browser: newBrowser,
      inUse: false,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
      requestCount: 0,
    });
  }
}
```

---

## 📊 缓存策略配置

### 默认配置

```typescript
export interface CacheConfig {
  // 缓存启用开关
  enabled: boolean;              // 默认: true

  // 缓存后端
  backend: 'memory' | 'redis';   // 默认: 'memory'

  // 内存缓存配置
  memory: {
    maxSize: number;             // 默认: 100 (条目数)
    maxMemory: number;           // 默认: 50MB
    ttl: number;                 // 默认: 3600000 (1小时)
  };

  // Redis 缓存配置
  redis?: {
    url: string;                 // Redis 连接 URL
    ttl: number;                 // 默认: 3600 (秒)
    keyPrefix: string;           // 键前缀，默认: 'scraper:'
  };

  // 缓存键配置
  keyGeneration: {
    includeWaitFor: boolean;     // 默认: true
    includeBlockAds: boolean;    // 默认: true
    includeScreenshot: boolean;  // 默认: true
  };

  // 性能优化
  performance: {
    enableCompression: boolean;  // 压缩缓存数据，默认: true
    enableStatistics: boolean;   // 启用统计，默认: true
  };
}

export const defaultCacheConfig: CacheConfig = {
  enabled: true,
  backend: 'memory',
  memory: {
    maxSize: 100,
    maxMemory: 50 * 1024 * 1024,
    ttl: 3600000,
  },
  keyGeneration: {
    includeWaitFor: true,
    includeBlockAds: true,
    includeScreenshot: true,
  },
  performance: {
    enableCompression: true,
    enableStatistics: true,
  },
};
```

---

## 🧪 测试策略

### 单元测试（Phase 3.1）

**测试文件**: `lib/cache/__tests__/cache-manager.test.ts`

```typescript
describe('CacheManager', () => {
  describe('缓存键生成', () => {
    it('相同 URL 和参数应生成相同键', () => {
      const key1 = generateCacheKey({
        url: 'https://example.com',
        options: { waitFor: 3000 },
      });

      const key2 = generateCacheKey({
        url: 'https://example.com',
        options: { waitFor: 3000 },
      });

      expect(key1).toBe(key2);
    });

    it('不同参数应生成不同键', () => {
      const key1 = generateCacheKey({
        url: 'https://example.com',
        options: { fullPageScreenshot: false },
      });

      const key2 = generateCacheKey({
        url: 'https://example.com',
        options: { fullPageScreenshot: true },
      });

      expect(key1).not.toBe(key2);
    });

    it('URL 规范化应正确工作', () => {
      const key1 = generateCacheKey({
        url: 'https://example.com?b=2&a=1',
        options: {},
      });

      const key2 = generateCacheKey({
        url: 'https://example.com?a=1&b=2',
        options: {},
      });

      expect(key1).toBe(key2);
    });
  });

  describe('LRU 缓存', () => {
    it('应正确存储和获取缓存', async () => {
      const cache = new MemoryCache({ maxSize: 10 });

      const result = { url: 'test', title: 'Test' };
      await cache.set('key1', result);

      const cached = await cache.get('key1');
      expect(cached).toEqual(result);
    });

    it('超过容量时应淘汰最旧项', async () => {
      const cache = new MemoryCache({ maxSize: 2 });

      await cache.set('key1', { url: 'test1' });
      await cache.set('key2', { url: 'test2' });
      await cache.set('key3', { url: 'test3' }); // key1 应被淘汰

      expect(await cache.get('key1')).toBeNull();
      expect(await cache.get('key2')).not.toBeNull();
      expect(await cache.get('key3')).not.toBeNull();
    });

    it('TTL 过期后应返回 null', async () => {
      const cache = new MemoryCache({ ttl: 100 }); // 100ms TTL

      await cache.set('key1', { url: 'test' });

      await new Promise(resolve => setTimeout(resolve, 150));

      expect(await cache.get('key1')).toBeNull();
    });
  });
});
```

### 集成测试（Phase 3.2）

**测试文件**: `lib/scraper/__tests__/playwright-cached.test.ts`

```typescript
describe('Playwright 缓存集成', () => {
  it('首次爬取应未命中缓存', async () => {
    const scraper = getPlaywrightScraper();

    const result = await scraper.scrape('https://example.com');

    expect(result.metadata.cached).toBe(false);
  });

  it('第二次爬取相同 URL 应命中缓存', async () => {
    const scraper = getPlaywrightScraper();

    await scraper.scrape('https://example.com');
    const result2 = await scraper.scrape('https://example.com');

    expect(result2.metadata.cached).toBe(true);
  });

  it('不同参数应不命中缓存', async () => {
    const scraper = getPlaywrightScraper();

    await scraper.scrape('https://example.com', { fullPageScreenshot: false });
    const result2 = await scraper.scrape('https://example.com', { fullPageScreenshot: true });

    expect(result2.metadata.cached).toBe(false);
  });

  it('forceRefresh 应强制刷新缓存', async () => {
    const scraper = getPlaywrightScraper();

    await scraper.scrape('https://example.com');
    const result2 = await scraper.scrape('https://example.com', { forceRefresh: true });

    expect(result2.metadata.cached).toBe(false);
  });
});
```

### 性能测试（Phase 3.4）

**测试文件**: `lib/scraper/__tests__/performance.test.ts`

```typescript
describe('性能测试', () => {
  it('缓存命中应在 100ms 内响应', async () => {
    const scraper = getPlaywrightScraper();

    // 预热缓存
    await scraper.scrape('https://example.com');

    // 测试缓存响应时间
    const start = Date.now();
    await scraper.scrape('https://example.com');
    const duration = Date.now() - start;

    expect(duration).toBeLessThan(100);
  });

  it('应支持 100 个并发请求', async () => {
    const scraper = getPlaywrightScraper();

    const promises = Array.from({ length: 100 }, (_, i) =>
      scraper.scrape(`https://example.com/page${i}`)
    );

    const results = await Promise.all(promises);

    expect(results).toHaveLength(100);
    expect(results.every(r => r.url)).toBe(true);
  });
});
```

---

## 📈 性能指标

### 目标指标

| 指标 | 目标值 | 测量方法 |
|-----|--------|----------|
| 缓存命中率 | ≥ 60% | 生产环境统计 |
| 缓存命中响应时间 | < 100ms | 性能测试 |
| 缓存未命中响应时间 | < 2s | 性能测试 |
| 并发处理能力 | 100+ req/s | 压力测试 |
| 内存占用 | < 500MB | 运行时监控 |
| 缓存数据大小 | < 50MB | 内存监控 |

### 监控指标

**实时监控**：
```typescript
interface CacheStatistics {
  // 命中率
  hitRate: number;           // 0.6 = 60%
  totalRequests: number;     // 总请求数
  cacheHits: number;         // 缓存命中数
  cacheMisses: number;       // 缓存未命中数

  // 性能
  avgResponseTime: number;   // 平均响应时间（ms）
  avgCacheHitTime: number;   // 缓存命中平均时间（ms）
  avgCacheMissTime: number;  // 缓存未命中平均时间（ms）

  // 资源
  cacheSize: number;         // 当前缓存条目数
  cacheMemory: number;       // 缓存占用内存（bytes）
  browserPoolSize: number;   // 浏览器池大小
  activeBrowsers: number;    // 活跃浏览器数

  // 时间范围
  startTime: number;
  lastResetTime: number;
}
```

---

## 🚀 API 接口设计

### 1. 爬取 API（增强）

**路径**: `POST /api/scrape-url-enhanced`

**请求体**（新增缓存控制参数）：
```typescript
interface ScrapeRequest {
  url: string;
  options?: {
    waitFor?: number;
    timeout?: number;
    blockAds?: boolean;
    fullPageScreenshot?: boolean;

    // 🆕 缓存控制参数
    skipCache?: boolean;      // 跳过缓存读取
    forceRefresh?: boolean;   // 强制刷新缓存
    maxAge?: number;          // 缓存最大年龄（ms）
  };
}
```

**响应体**（新增缓存元数据）：
```typescript
interface ScrapeResponse {
  success: boolean;
  url: string;
  content: string;
  screenshot?: string;
  metadata: {
    scraper: 'firecrawl' | 'playwright';
    cached: boolean;                 // 是否命中缓存
    cacheKey?: string;               // 缓存键（调试用）
    cacheAge?: number;               // 缓存年龄（ms）
    responseTime: number;            // 响应时间（ms）
    // ... 其他元数据
  };
}
```

### 2. 缓存统计 API（新增）

**路径**: `GET /api/cache-stats`

**响应体**：
```typescript
{
  "success": true,
  "statistics": {
    "hitRate": 0.65,
    "totalRequests": 1000,
    "cacheHits": 650,
    "cacheMisses": 350,
    "avgResponseTime": 450,
    "avgCacheHitTime": 80,
    "avgCacheMissTime": 1700,
    "cacheSize": 87,
    "cacheMemory": 12582912,
    "browserPoolSize": 3,
    "activeBrowsers": 1,
    "startTime": 1699999999000,
    "lastResetTime": 1700000000000
  }
}
```

### 3. 缓存清除 API（新增）

**路径**: `POST /api/cache-clear`

**请求体**：
```typescript
interface CacheClearRequest {
  type?: 'all' | 'expired' | 'specific';  // 清除类型
  key?: string;                            // 特定缓存键（type=specific 时）
  pattern?: string;                        // 键模式（支持通配符）
}
```

**响应体**：
```typescript
{
  "success": true,
  "cleared": 23,                           // 清除的缓存条目数
  "message": "Cache cleared successfully"
}
```

---

## 💾 依赖包清单

**新增依赖**：
```json
{
  "dependencies": {
    "lru-cache": "^10.0.0",        // LRU 缓存实现
    "ioredis": "^5.3.0",           // Redis 客户端（可选）
    "p-limit": "^5.0.0",           // 并发限制
    "nanoid": "^5.0.0"             // 唯一 ID 生成（已有）
  }
}
```

---

## 📝 文件清单

### Phase 3.1: 缓存核心层
```
lib/cache/
├── types.ts                    # 缓存类型定义
├── cache-key-generator.ts      # 缓存键生成器
├── cache-manager.ts            # 缓存管理器接口
├── memory-cache.ts             # 内存缓存实现
└── __tests__/
    └── cache-manager.test.ts   # 单元测试
```

### Phase 3.2: 集成到 Playwright
```
lib/scraper/
├── playwright-scraper.ts       # 修改：添加缓存逻辑
├── scraper-router.ts           # 修改：传递缓存配置
├── types.ts                    # 修改：添加缓存参数
└── __tests__/
    └── playwright-cached.test.ts
```

### Phase 3.3: Redis 支持（可选）
```
lib/cache/
├── redis-cache.ts              # Redis 缓存实现
└── __tests__/
    └── redis-cache.test.ts
```

### Phase 3.4: 浏览器池
```
lib/scraper/
├── browser-pool.ts             # 浏览器池管理
├── concurrency-limiter.ts      # 并发限制器
└── __tests__/
    └── browser-pool.test.ts
```

### Phase 3.5: 监控与统计
```
lib/cache/
└── cache-stats.ts              # 缓存统计

app/api/
├── cache-stats/
│   └── route.ts                # 统计查询 API
└── cache-clear/
    └── route.ts                # 缓存清除 API
```

---

## ⏱️ 时间估算

| Phase | 预计时间 | 关键路径 |
|-------|---------|---------|
| Phase 3.1: 缓存核心层 | 3-4 小时 | ✅ 关键 |
| Phase 3.2: 集成 Playwright | 2-3 小时 | ✅ 关键 |
| Phase 3.3: Redis 支持 | 2-3 小时 | 可选 |
| Phase 3.4: 浏览器池 | 3-4 小时 | 重要 |
| Phase 3.5: 监控统计 | 2-3 小时 | 重要 |
| **总计** | **12-17 小时** | |

**最小可行版本（MVP）**：Phase 3.1 + 3.2 = 5-7 小时

---

## 🎯 成功标准

### 功能完整性
- ✅ 基于 URL + ScraperOptions 的缓存键生成
- ✅ LRU 内存缓存实现
- ✅ Playwright 爬虫集成缓存
- ✅ 缓存命中率统计
- ✅ 缓存管理 API

### 性能指标
- ✅ 缓存命中响应时间 < 100ms
- ✅ 缓存命中率 ≥ 60%（生产环境）
- ✅ 支持 100+ 并发请求
- ✅ 内存占用 < 500MB

### 质量标准
- ✅ TypeScript 类型检查通过（0 errors）
- ✅ 单元测试覆盖率 ≥ 85%
- ✅ 集成测试全部通过
- ✅ 性能测试达标

### 文档完整性
- ✅ 缓存使用文档
- ✅ API 接口文档
- ✅ 性能优化建议
- ✅ 故障排查指南

---

## 🚧 风险评估

### 技术风险

**1. 内存泄漏风险（中等）**
- **原因**：浏览器实例未正确释放
- **缓解**：实现浏览器池健康检查和自动重启
- **监控**：内存使用量告警

**2. 缓存一致性风险（低）**
- **原因**：网页内容更新但缓存未失效
- **缓解**：合理设置 TTL，提供手动刷新接口
- **监控**：缓存命中率异常告警

**3. 并发性能风险（中等）**
- **原因**：高并发时浏览器池耗尽
- **缓解**：实现请求排队机制，限制并发数
- **监控**：请求队列长度告警

### 资源风险

**1. 开发时间风险（低）**
- **预计**: 12-17 小时
- **实际可能**: 15-20 小时（+20%）
- **缓解**：优先实现 MVP（Phase 3.1 + 3.2）

**2. 测试时间风险（中等）**
- **原因**：性能测试和并发测试耗时
- **缓解**：自动化测试脚本，CI/CD 集成

---

## 📚 参考资料

**技术文档**：
- [LRU Cache](https://www.npmjs.com/package/lru-cache)
- [ioredis](https://github.com/redis/ioredis)
- [Playwright Pool](https://playwright.dev/docs/api/class-browsertype#browser-type-launch)

**最佳实践**：
- [Caching Strategies](https://aws.amazon.com/caching/best-practices/)
- [Browser Pool Patterns](https://www.browserless.io/blog/2023/04/05/browser-pooling/)

---

## 🎉 总结

Phase 3 将为 Playwright 爬虫系统添加企业级缓存能力：

**核心价值**：
1. ✅ **性能提升**: 缓存命中时响应时间从 1.7s → 100ms（17倍）
2. ✅ **成本降低**: 减少 60% 的实际爬取次数
3. ✅ **用户体验**: 基于用户需求的精确缓存
4. ✅ **可扩展性**: 支持分布式 Redis 缓存

**技术亮点**：
- 智能缓存键生成（URL + ScraperOptions）
- LRU 淘汰策略（内存优化）
- 浏览器池管理（并发优化）
- 完整监控统计（可观测性）

**开发策略**：
- MVP 优先（Phase 3.1 + 3.2）
- 增量交付（Phase 3.3-3.5 按需）
- 充分测试（单元 + 集成 + 性能）

---

**文档版本**: 1.0
**创建时间**: 2025-11-07
**作者**: Claude Code
**状态**: 设计中，待用户确认
