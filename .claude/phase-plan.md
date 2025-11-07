# Open Lovable 国际化改造 Phase 计划

## 项目概览

### 改造目标
**⚠️ 重要原则：保留所有现有功能，采用增量添加方式**

在保留现有 Firecrawl + 国际 AI 模型的基础上，增加以下功能：
1. **国内 AI 模型**：通过七牛云 API 接入通义千问、文心一言等（**新增**，不替换）
2. **多样化爬取**：Firecrawl + Playwright + crawl4ai-mcp-server 多种方案（**扩展**，保留 Firecrawl）
3. **快速站点克隆**：秒级克隆创建站点能力（**新增**）
4. **国内外模型统一接口**：抽象 AI 提供商层，支持自由切换（**兼容现有 @ai-sdk**）

### 现有技术栈分析
- **前端**：Next.js 15 + React 19 + TypeScript + Tailwind CSS
- **AI SDK**：@ai-sdk/* (anthropic, google, groq, openai)
- **爬虫**：@mendable/firecrawl-js
- **沙箱**：@vercel/sandbox + @e2b/code-interpreter

### 架构现状
```
app/api/
├── generate-ai-code-stream/route.ts    # AI 代码生成核心
├── scrape-website/route.ts             # Firecrawl 爬取
├── scrape-url-enhanced/route.ts        # 增强爬取（支持缓存）
├── create-ai-sandbox/route.ts          # 沙箱创建
└── apply-ai-code-stream/route.ts       # 代码应用

lib/
├── sandbox/                            # 沙箱抽象层
│   ├── types.ts                        # 接口定义
│   ├── providers/                      # 提供商实现
│   └── sandbox-manager.ts              # 管理器
└── context-selector.ts                 # 上下文选择器

config/
└── app.config.ts                       # 应用配置
```

---

## Phase 划分总览

| Phase | 名称 | 预计时间 | 依赖 | 交付物 |
|-------|------|----------|------|--------|
| Phase 1 | 七牛云 AI 模型接入 | 3-4h | 无 | AI 提供商抽象层 + 七牛云适配器 |
| Phase 2 | Playwright 爬取方案 | 2-3h | 无 | Playwright 爬取 API |
| Phase 3 | crawl4ai MCP 集成 | 3-4h | Phase 2 | crawl4ai 爬取 API |
| Phase 4 | 爬取方案智能路由 | 2h | Phase 2, 3 | 爬取路由器 + 降级策略 |
| Phase 5 | 模板站点库设计 | 3h | Phase 1 | 模板系统 + 预制模板 |
| Phase 6 | 秒级克隆实现 | 3-4h | Phase 5 | 快速克隆 API |
| Phase 7 | 配置中心和 UI 优化 | 2-3h | Phase 1-6 | 配置管理 + 模型/爬虫选择器 |
| Phase 8 | 集成测试和文档 | 2h | Phase 1-7 | 测试套件 + 文档 |

**总计**: 20-26 小时（约 3-4 个工作日）

---

## Phase 1: 七牛云 AI 模型接入 (3-4h)

### 🎯 核心原则：增量添加，保留现有功能

**明确说明**：
- ✅ **保留** 所有现有的 `@ai-sdk/*` 集成（Anthropic, Google, Groq, OpenAI）
- ✅ **保留** 现有的模型配置和调用方式
- ✅ **新增** 七牛云作为额外的 AI 提供商选项
- ✅ **扩展** 模型列表，不替换现有模型

### 1.1 需求分析 (30min)
**目标**：
- 通过七牛云 API 接入国内 AI 模型（通义千问、文心一言、智谱 AI 等）
- **完全兼容**现有 @ai-sdk 接口和调用方式
- 支持流式响应
- 用户可以自由选择国际模型或国内模型

**调研内容**：
- 七牛云 AI API 文档和调用方式
- 国内模型的参数格式和限制
- 流式响应协议
- 如何与现有 @ai-sdk 共存

### 1.2 AI 提供商抽象层设计 (1h)
**文件**: `lib/ai-providers/base-provider.ts`

```typescript
/**
 * AI 提供商基类
 * 统一国内外 AI 模型调用接口
 */
export interface AIProviderConfig {
  apiKey: string;
  baseURL?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIStreamChunk {
  text: string;
  done: boolean;
}

export abstract class BaseAIProvider {
  protected config: AIProviderConfig;

  constructor(config: AIProviderConfig) {
    this.config = config;
  }

  /**
   * 流式生成文本
   */
  abstract streamText(
    messages: AIMessage[],
    options?: any
  ): AsyncGenerator<AIStreamChunk>;

  /**
   * 非流式生成文本
   */
  abstract generateText(
    messages: AIMessage[],
    options?: any
  ): Promise<string>;

  /**
   * 健康检查
   */
  abstract healthCheck(): Promise<boolean>;
}
```

### 1.3 七牛云适配器实现 (1.5h)
**文件**: `lib/ai-providers/qiniu-provider.ts`

实现功能：
- 七牛云 API 调用封装
- 流式响应处理
- 错误处理和重试
- 模型映射（通义千问、文心一言等）

**文件**: `lib/ai-providers/model-registry.ts`
```typescript
/**
 * 模型注册表（扩展，保留所有现有模型）
 */
export const MODEL_REGISTRY = {
  // ========================================
  // 现有国际模型（保留不变）
  // ========================================
  'openai/gpt-5': { provider: 'openai', sdk: '@ai-sdk/openai', ... },
  'anthropic/claude-sonnet-4': { provider: 'anthropic', sdk: '@ai-sdk/anthropic', ... },
  'google/gemini-2.0-flash': { provider: 'google', sdk: '@ai-sdk/google', ... },
  'moonshotai/kimi-k2-instruct': { provider: 'groq', sdk: '@ai-sdk/groq', ... },

  // ========================================
  // 新增国内模型（通过七牛云）
  // ========================================
  'qiniu/qwen-max': { provider: 'qiniu', model: 'qwen-max', region: 'cn', ... },
  'qiniu/ernie-4.0': { provider: 'qiniu', model: 'ernie-4.0', region: 'cn', ... },
  'qiniu/chatglm-6b': { provider: 'qiniu', model: 'chatglm-6b', region: 'cn', ... },
};
```

**设计说明**：
- 所有现有模型通过 `@ai-sdk/*` 继续调用，保持不变
- 新增的七牛云模型通过自定义适配器调用
- 用户可以在 UI 中自由选择任意模型

### 1.4 generate-ai-code-stream 集成 (1h)
**修改文件**: `app/api/generate-ai-code-stream/route.ts`

**改造策略（增量修改）**：
```typescript
// 保留现有的 @ai-sdk 实现
const groq = createGroq({ ... });        // ✅ 保留
const anthropic = createAnthropic({ ... }); // ✅ 保留
const googleAI = createGoogleGenerativeAI({ ... }); // ✅ 保留
const openai = createOpenAI({ ... });    // ✅ 保留

// 新增七牛云支持
import { QiniuProvider } from '@/lib/ai-providers/qiniu-provider'; // ✅ 新增

// 扩展模型选择逻辑
const isQiniu = model.startsWith('qiniu/'); // ✅ 新增
if (isQiniu) {
  // 使用七牛云提供商
} else {
  // 使用现有的 @ai-sdk 逻辑（保持不变）
}
```

**关键点**：
- ✅ 保留所有现有的 createGroq、createAnthropic 等调用
- ✅ 保留现有的模型选择逻辑
- ✅ 只在模型名以 `qiniu/` 开头时使用新逻辑
- ✅ 保持流式响应格式完全一致

### 1.5 测试验证 (30min)
- 单元测试：七牛云 API 调用
- 集成测试：端到端代码生成
- 性能测试：响应时间对比
- **兼容性测试**：确保现有模型不受影响

**验收标准**：
✅ 成功调用七牛云 API 生成代码
✅ 流式响应正常工作
✅ **现有国际模型（GPT-5, Claude, Gemini, Kimi）完全正常**
✅ **国际模型和国内模型可以无缝切换**
✅ 错误处理完善
✅ **不影响任何现有功能**

---

## Phase 2: Playwright 爬取方案 (2-3h)

### 🎯 核心原则：保留 Firecrawl，新增 Playwright 选项

**明确说明**：
- ✅ **保留** 所有现有的 Firecrawl 集成和 API
- ✅ **保留** `app/api/scrape-website/route.ts` 和 `scrape-url-enhanced/route.ts`
- ✅ **新增** Playwright 作为额外的爬取选项
- ✅ 用户可以选择使用 Firecrawl 或 Playwright

### 2.1 需求分析 (20min)
**目标**：
- 使用 Playwright 实现网页爬取和截图（**新增**，不替换 Firecrawl）
- 支持 JavaScript 渲染的动态内容
- 提供比 Firecrawl 更灵活的控制
- 为无 API Key 用户提供免费替代方案

**对比 Firecrawl**：
| 特性 | Firecrawl | Playwright |
|------|-----------|------------|
| 速度 | 快（有缓存） | 中等 |
| 动态内容 | 支持 | 完全支持 |
| 截图 | 支持 | 完全支持 |
| 成本 | 付费API | 免费（自托管） |
| 灵活性 | 低 | 高 |

### 2.2 Playwright 爬取实现 (1.5h)
**文件**: `lib/scraper/playwright-scraper.ts`

```typescript
/**
 * Playwright 爬取器
 */
export class PlaywrightScraper {
  /**
   * 爬取网页内容
   */
  async scrape(url: string, options?: {
    waitFor?: number;
    fullPageScreenshot?: boolean;
    extractSelectors?: string[];
  }): Promise<{
    title: string;
    content: string;
    markdown: string;
    screenshot?: string;
    metadata: any;
  }>;

  /**
   * 批量爬取
   */
  async scrapeBatch(urls: string[]): Promise<any[]>;
}
```

**技术实现**：
- 使用 playwright 库
- HTML 转 Markdown（使用 turndown）
- 截图保存到临时目录或上传 CDN
- 支持自定义选择器提取

### 2.3 API 路由实现 (40min)
**文件**: `app/api/scrape-playwright/route.ts`

- POST 接口：接收 URL 和选项
- 返回格式与 Firecrawl 一致
- 支持超时控制

### 2.4 测试验证 (30min)
- 测试静态网站爬取
- 测试 SPA 应用爬取（如 React 站点）
- 截图功能测试

**验收标准**：
✅ 成功爬取静态和动态网站
✅ Markdown 转换准确
✅ 截图清晰可用
✅ 响应时间 < 10s

---

## Phase 3: crawl4ai MCP 集成 (3-4h)

### 3.1 crawl4ai-mcp-server 调研 (1h)
**调研内容**：
- GitHub 仓库文档阅读
- 安装和本地测试
- API 接口分析
- 与 Playwright 对比优势

**预期特性**：
- AI 驱动的智能内容提取
- 结构化数据输出
- 多页面爬取能力

### 3.2 MCP 客户端封装 (1.5h)
**文件**: `lib/scraper/crawl4ai-client.ts`

```typescript
/**
 * crawl4ai MCP 客户端
 */
export class Crawl4AIClient {
  private mcpServerUrl: string;

  /**
   * 智能爬取
   */
  async intelligentScrape(url: string, options?: {
    extractSchema?: any; // AI 驱动的结构化提取
    followLinks?: boolean;
    maxDepth?: number;
  }): Promise<{
    content: string;
    structured: any;
    links: string[];
    metadata: any;
  }>;
}
```

### 3.3 API 路由实现 (40min)
**文件**: `app/api/scrape-crawl4ai/route.ts`

### 3.4 测试验证 (30min)
**验收标准**：
✅ MCP 服务器通信正常
✅ 智能内容提取准确
✅ 结构化数据格式正确

---

## Phase 4: 爬取方案智能路由 (2h)

### 🎯 核心原则：新增路由功能，保留现有 API

**明确说明**：
- ✅ **保留** `app/api/scrape-website/route.ts` (Firecrawl API)
- ✅ **保留** `app/api/scrape-url-enhanced/route.ts` (增强 Firecrawl API)
- ✅ **新增** `app/api/scrape-unified/route.ts` (智能路由 API)
- ✅ 现有 API 继续独立工作，新 API 作为可选增强

### 4.1 爬取路由器设计 (1h)
**文件**: `lib/scraper/scraper-router.ts`

```typescript
/**
 * 爬取方案路由器（新增，不影响现有 API）
 * 根据 URL 类型、用户配置、成本等因素选择最优爬取方案
 */
export enum ScraperType {
  FIRECRAWL = 'firecrawl',     // 快速、付费（现有）
  PLAYWRIGHT = 'playwright',    // 灵活、免费（新增）
  CRAWL4AI = 'crawl4ai',       // 智能、免费（新增）
}

export class ScraperRouter {
  /**
   * 智能选择爬取方案
   */
  async route(url: string, options?: {
    preferredScraper?: ScraperType;
    requiresScreenshot?: boolean;
    requiresStructured?: boolean;
  }): Promise<{
    scraper: ScraperType;
    reason: string;
  }>;

  /**
   * 降级策略：Firecrawl -> Playwright -> crawl4ai
   */
  async scrapeWithFallback(url: string): Promise<any>;
}
```

### 4.2 统一爬取 API (40min)
**文件**: `app/api/scrape-unified/route.ts`

- 接收 URL + 爬取偏好
- 自动选择最优方案
- 失败时自动降级

### 4.3 测试验证 (20min)
**验收标准**：
✅ 路由逻辑正确
✅ 降级策略有效
✅ 性能满足要求

---

## Phase 5: 模板站点库设计 (3h)

### 5.1 模板系统设计 (1h)
**目标**：预制常见站点模板，实现秒级克隆

**文件**: `lib/templates/template-registry.ts`

```typescript
/**
 * 站点模板
 */
export interface SiteTemplate {
  id: string;
  name: string;
  description: string;
  category: 'landing' | 'dashboard' | 'blog' | 'ecommerce' | 'portfolio';
  thumbnail: string;
  files: Record<string, string>; // 预生成的文件内容
  dependencies: string[];
  screenshots: string[];
}

export const TEMPLATE_REGISTRY: Record<string, SiteTemplate> = {
  'landing-modern': {
    id: 'landing-modern',
    name: '现代着陆页',
    description: 'SaaS 产品着陆页模板',
    category: 'landing',
    files: {
      'src/App.jsx': '...',
      'src/components/Hero.jsx': '...',
      'src/components/Features.jsx': '...',
      // ... 预生成的完整代码
    },
    dependencies: ['framer-motion', 'lucide-react'],
  },
  // 更多模板...
};
```

### 5.2 模板预生成 (1.5h)
创建 5-10 个高质量模板：
- ✅ 现代着陆页
- ✅ SaaS Dashboard
- ✅ 博客站点
- ✅ 作品集
- ✅ 电商首页

### 5.3 模板 API (30min)
**文件**: `app/api/templates/list/route.ts` - 列出所有模板
**文件**: `app/api/templates/[id]/route.ts` - 获取模板详情

**验收标准**：
✅ 模板代码完整可运行
✅ 响应式设计良好
✅ 性能优化到位

---

## Phase 6: 秒级克隆实现 (3-4h)

### 6.1 快速克隆流程设计 (40min)
**流程**：
```
用户输入 URL
  ↓
智能路由选择爬取方案
  ↓
提取关键信息（标题、描述、配色、布局）
  ↓
AI 分析站点类型
  ↓
匹配最相似模板
  ↓
应用爬取内容到模板
  ↓
一键部署到沙箱
```

### 6.2 智能模板匹配 (1.5h)
**文件**: `lib/templates/template-matcher.ts`

```typescript
/**
 * 模板智能匹配器
 * 使用 AI 分析网站特征，匹配最合适的模板
 */
export class TemplateMatcher {
  /**
   * 分析网站并匹配模板
   */
  async matchTemplate(scrapedData: any): Promise<{
    templateId: string;
    confidence: number;
    reasoning: string;
    modifications: any; // 需要应用的修改
  }>;
}
```

### 6.3 快速克隆 API (1h)
**文件**: `app/api/clone-site/route.ts`

```typescript
/**
 * POST /api/clone-site
 *
 * 请求体：
 * {
 *   url: string;
 *   useTemplate?: boolean; // 是否使用模板加速
 *   customizations?: any;
 * }
 *
 * 返回：
 * {
 *   sandboxId: string;
 *   sandboxUrl: string;
 *   templateUsed: string;
 *   generationTime: number; // 毫秒
 * }
 */
```

### 6.4 性能优化 (40min)
- 模板预加载到内存
- 并行处理（爬取 + 模板匹配）
- 缓存机制

### 6.5 测试验证 (30min)
**验收标准**：
✅ 克隆时间 < 5 秒（使用模板）
✅ 模板匹配准确率 > 80%
✅ 生成站点可用性 100%

---

## Phase 7: 配置中心和 UI 优化 (2-3h)

### 7.1 配置中心设计 (1h)
**文件**: `config/providers.config.ts`

```typescript
/**
 * 提供商配置中心
 */
export const PROVIDERS_CONFIG = {
  ai: {
    preferred: 'qiniu', // 优先使用国内模型
    fallback: ['openai', 'anthropic'],
    models: {
      qiniu: ['qwen-max', 'ernie-4.0'],
      openai: ['gpt-5'],
      anthropic: ['claude-sonnet-4'],
    },
  },
  scraper: {
    preferred: 'playwright',
    fallback: ['firecrawl', 'crawl4ai'],
    config: {
      firecrawl: { maxAge: 3600000 },
      playwright: { timeout: 30000 },
    },
  },
};
```

### 7.2 UI 选择器组件 (1-1.5h)
**组件**: `components/AIModelSelector.tsx` - AI 模型选择器
**组件**: `components/ScraperSelector.tsx` - 爬取方案选择器
**组件**: `components/TemplateGallery.tsx` - 模板库展示

### 7.3 环境变量管理 (30min)
更新 `.env.example` 添加：
```env
# 七牛云 AI
QINIU_AI_API_KEY=your_qiniu_key
QINIU_AI_BASE_URL=https://api.qiniu.com/ai

# crawl4ai MCP
CRAWL4AI_MCP_URL=http://localhost:3001

# 爬取配置
PREFERRED_SCRAPER=playwright # firecrawl | playwright | crawl4ai
```

**验收标准**：
✅ 配置中心功能完善
✅ UI 组件交互流畅
✅ 环境变量文档完整

---

## Phase 8: 集成测试和文档 (2h)

### 8.1 集成测试套件 (1h)
**文件**: `tests/integration/`

测试场景：
- ✅ 国内模型代码生成端到端测试
- ✅ Playwright 爬取测试
- ✅ crawl4ai 爬取测试
- ✅ 模板克隆测试
- ✅ 降级策略测试

### 8.2 文档编写 (1h)
**文件**: `docs/zh/README.md`

内容：
- 🚀 快速开始
- 🔧 配置指南
  - 七牛云 AI 配置
  - 爬取方案选择
  - 模板使用
- 📖 API 文档
- 🎨 模板开发指南
- ❓ 常见问题

**文件**: `CHANGELOG.md` - 更新日志

**验收标准**：
✅ 所有集成测试通过
✅ 文档清晰易懂
✅ 代码注释完整

---

## 质量保证

### 每个 Phase 完成检查清单
- [ ] TypeScript 编译通过 (`pnpm tsc --noEmit`)
- [ ] ESLint 检查通过 (`pnpm lint`)
- [ ] 单元测试通过
- [ ] 功能测试通过
- [ ] 代码注释完整（中文）
- [ ] Git 提交（遵循约定式提交）

### 整体质量标准
| 指标 | 目标值 |
|------|--------|
| TypeScript 错误 | 0 |
| ESLint 警告 | 0 |
| 测试覆盖率 | ≥85% |
| API 响应时间 | <2s (AI生成除外) |
| 模板克隆时间 | <5s |

---

## 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|----------|
| 七牛云 API 限流 | 中 | 高 | 实现限流控制和队列 |
| crawl4ai MCP 不稳定 | 中 | 中 | 降级到 Playwright |
| 模板匹配不准确 | 低 | 中 | 提供手动选择 |
| 性能达不到秒级 | 低 | 中 | 优化并行处理 |

---

## 里程碑

- **Week 1 (Day 1-2)**: Phase 1-3 完成，AI 模型和爬取方案就绪
- **Week 1 (Day 3-4)**: Phase 4-6 完成，核心功能交付
- **Week 1 (Day 5)**: Phase 7-8 完成，系统优化和文档

---

## 后续优化方向

1. **模板商店**：社区贡献模板
2. **AI 辅助设计**：根据描述生成定制模板
3. **多语言支持**：模板国际化
4. **性能监控**：爬取和生成性能追踪
5. **成本优化**：智能选择最经济方案

---

## 附录：技术选型对比

### AI 模型对比
| 模型 | 提供商 | 速度 | 成本 | 代码质量 | 国内可用性 |
|------|--------|------|------|----------|------------|
| GPT-5 | OpenAI | 慢 | 高 | 优秀 | 需VPN |
| Claude Sonnet 4 | Anthropic | 中 | 高 | 优秀 | 需VPN |
| Kimi K2 | Moonshot | 快 | 低 | 良好 | 是 |
| 通义千问 | 阿里云 | 快 | 低 | 良好 | 是 |
| 文心一言 | 百度 | 快 | 低 | 良好 | 是 |

### 爬取方案对比
| 方案 | 速度 | 成本 | 动态内容 | 结构化数据 | 维护成本 |
|------|------|------|----------|------------|----------|
| Firecrawl | 极快 | 付费 | 支持 | 一般 | 低 |
| Playwright | 中等 | 免费 | 完全支持 | 需自己处理 | 中 |
| crawl4ai | 中等 | 免费 | 完全支持 | AI驱动 | 中 |

---

## ⚠️ 重要声明：向后兼容保证

### 保留功能清单

#### AI 模型（100% 保留）
- ✅ `@ai-sdk/openai` - GPT-5 及所有 OpenAI 模型
- ✅ `@ai-sdk/anthropic` - Claude Sonnet 4 及所有 Anthropic 模型
- ✅ `@ai-sdk/google` - Gemini 2.0 及所有 Google 模型
- ✅ `@ai-sdk/groq` - Kimi K2 及所有 Groq 支持的模型
- ✅ 所有现有的模型配置和环境变量

#### 爬取功能（100% 保留）
- ✅ `@mendable/firecrawl-js` - 完整保留
- ✅ `app/api/scrape-website/route.ts` - 完整保留
- ✅ `app/api/scrape-url-enhanced/route.ts` - 完整保留
- ✅ 所有现有的爬取 API 和配置

#### 配置文件（100% 兼容）
- ✅ `.env.local` 中的所有现有环境变量继续有效
- ✅ `config/app.config.ts` 保持向后兼容
- ✅ 新增的环境变量全部可选，不强制配置

### 改造承诺

1. **零破坏性更改**：所有改造都是增量添加，不修改现有功能
2. **完全可选**：国内模型和新爬取方案都是可选的，用户可以选择不使用
3. **无缝切换**：用户可以在国际模型和国内模型之间自由切换
4. **向后兼容**：改造后的系统完全兼容现有的使用方式

### 测试保证

每个 Phase 完成后都会进行兼容性测试，确保：
- ✅ 现有功能正常工作
- ✅ 现有 API 响应格式不变
- ✅ 现有环境变量配置有效
- ✅ 现有用户流程不受影响

---

**制定时间**: 2025-11-07
**预计完成**: 2025-11-11
**负责人**: Claude Code AI Agent
**改造策略**: 增量添加，向后兼容，零破坏
