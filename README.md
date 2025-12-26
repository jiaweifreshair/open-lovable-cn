# Open Lovable 中文版本

Chat with AI to build React apps instantly. An example app made by the [Firecrawl](https://firecrawl.dev/?ref=open-lovable-github) team. For a complete cloud solution, check out [Lovable.dev](https://lovable.dev/) ❤️.

<img src="https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExODAwZGJzcDVmZGYxc3MyNDUycTliYnAwem1qbzhtNHh0c2JrNDdmZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMYzMkNmOecj3yFw81/giphy.gif" alt="Open Lovable Demo" width="100%"/>

## 📊 与原版对比（vs open-lovable）

本项目（open-lovable-cn）是 [open-lovable](https://github.com/firecrawl/open-lovable) 的增强中文版本，专为中国用户优化，包含以下重要改进：

### 🚀 核心功能增强

#### 1. 中文AI模型支持
- ✅ **默认模型**：Gemini 3 Pro（速度快、质量高、不易超时）
- ✅ **国产模型**：DeepSeek V3/V3.1/R1、Qwen3 Max、Kimi K2（七牛云托管，国内直连）
- ✅ **双向Fallback**：Gemini ↔ DeepSeek 自动切换，避免 rate limit
- ✅ **推理模型**：DeepSeek R1 推理模型支持（代码质量更高）
- ❌ **原版**：仅支持 GPT-5、Kimi K2（Groq）、Sonnet 4、Gemini 2.0 Flash

#### 2. 智能Prompt截断
- ✅ **动态适配**：根据不同模型自动调整上下文限制（DeepSeek 64K tokens、Gemini 1M tokens）
- ✅ **智能截断**：克隆大型网站时自动截断 Prompt，避免超过模型输入限制
- ✅ **保留关键信息**：确定性裁剪，保留开头+结尾，不丢失关键约束
- ❌ **原版**：固定 8000 tokens 限制，无智能截断

#### 3. 网站抓取索引
- ✅ **内容索引**：抓取网站内容时自动建立索引（`utils/scrape-index.ts`）
- ✅ **相关性过滤**：智能选择相关内容块，减少无关信息
- ✅ **格式化输出**：结构化格式输出，提升 AI 理解能力
- ❌ **原版**：直接使用原始抓取内容，无索引优化

#### 4. E2E测试框架
- ✅ **Mock测试**：完整的 E2E Mock 测试支持（`lib/e2e/mock-generation.ts`）
- ✅ **测试脚本**：8个测试脚本（DeepSeek、Playwright、克隆API等）
- ✅ **自动化验证**：代码生成、沙箱部署全流程测试
- ❌ **原版**：无 E2E 测试框架

#### 5. 沙箱管理优化
- ✅ **心跳机制**：沙箱心跳检测（`app/api/sandbox-heartbeat/route.ts`）
- ✅ **健康检查**：独立健康检查接口（`app/api/health/route.ts`）
- ✅ **自动重启**：沙箱重启脚本（`scripts/restart-e2b-sandbox.ts`）
- ❌ **原版**：基础沙箱管理，无心跳和健康检查

### 🌐 中国用户专属优化

#### 1. CDN加速配置
- ✅ **Cloudflare CDN**（免费，推荐）- 5分钟配置
- ✅ **阿里云 CDN**（国内快）- 需要域名备案
- ✅ **腾讯云 CDN**（国内快）- 需要域名备案
- 📖 **详细指南**：[docs/cdn-acceleration.md](docs/cdn-acceleration.md)

#### 2. 国内模型托管
- ✅ **七牛云代理**：OpenAI 兼容接口，国内直连
- ✅ **无需VPN**：DeepSeek、Qwen3、Kimi 直接访问
- ✅ **即插即用**：完全兼容原有代码
- 📖 **配置指南**：[docs/chinese-ai-models.md](docs/chinese-ai-models.md)

#### 3. 常见问题FAQ
- ✅ 沙箱预览提示 `no service running on port 5173` 解决方案
- ✅ 中文文档和中英文双语说明
- ❌ **原版**：仅英文文档，无中文FAQ

### 🐳 容器化部署

- ✅ **Docker支持**：完整的 Docker 配置（`Dockerfile`、`.dockerignore`）
- ✅ **部署文档**：详细的 Docker 部署指南（`DOCKER_DEPLOYMENT.md`）
- ✅ **环境隔离**：Docker 专用环境变量（`.env.docker.example`）
- ❌ **原版**：无 Docker 支持

### 📚 文档增强

#### 新增文档（16篇）
- `AGENTS.md` - Agent 系统架构文档
- `DOCKER_DEPLOYMENT.md` - Docker 部署指南
- `docs/chinese-ai-models.md` - 中文AI模型配置
- `docs/cdn-acceleration.md` - CDN加速配置
- `docs/anti-truncation-strategy.md` - 防截断策略
- `docs/segmented-generation-strategy.md` - 分段生成策略
- `docs/plan-mode-*.md` - Plan模式优化文档（3篇）
- `docs/code-generation-*.md` - 代码生成优化（2篇）
- `docs/STREAMING_FIXES_SUMMARY.md` - 流式修复总结
- `docs/TOOL_CALL_FIX_SUMMARY.md` - 工具调用修复
- `docs/TRUNCATION_RECOVERY_GUIDE.md` - 截断恢复指南
- `docs/UI_FEEDBACK_DEMO.md` - UI反馈演示
- `docs/frontend-plan-integration.md` - 前端Plan集成

### 🛠️ 工具和脚本

#### 新增工具
- `utils/scrape-index.ts` - 网站抓取索引工具
- `utils/codegen-dependencies.ts` - 依赖分析工具

#### 新增测试脚本（8个）
- `tests/test-deepseek-r1-full.js` - DeepSeek R1 完整测试
- `tests/test-deepseek-simple.js` - DeepSeek 简单测试
- `tests/test-clone-api.js` - 克隆API测试
- `tests/run-e2e-mock-generation.ts` - E2E Mock生成测试
- `tests/run-scrape-index-tests.ts` - 抓取索引测试
- `tests/playwright-beauty-eval.js` - Playwright UI美化评估
- `tests/deploy-to-sandbox.js` - 沙箱部署测试
- `tests/run-truncation-tests.mjs` - 截断测试

### 🎯 代码质量改进

| 指标 | open-lovable-cn | open-lovable |
|-----|-----------------|--------------|
| AI模型数量 | 7个（含国产） | 4个（海外） |
| 最大Token限制 | 动态（32K-150K） | 固定8K |
| E2E测试 | ✅ 8个测试脚本 | ❌ 无 |
| 文档数量 | 16篇 | 1篇（README） |
| Docker支持 | ✅ 完整配置 | ❌ 无 |
| 中文优化 | ✅ 全面支持 | ❌ 无 |
| CDN加速 | ✅ 3种方案 | ❌ 无 |
| 心跳监控 | ✅ 自动检测 | ❌ 无 |
| Prompt截断 | ✅ 智能适配 | ❌ 无 |

### 📦 新增依赖

- `crawlee` - 网站爬虫框架（内容抓取）
- `playwright` - E2E测试框架
- 更完善的 TypeScript 类型支持

### ❌ 移除功能

- **MORPH_API_KEY**（Fast Apply）- 原版的快速编辑功能已移除

### 🎨 配置差异总结

| 配置项 | open-lovable-cn | open-lovable |
|-------|-----------------|--------------|
| 默认模型 | Gemini 3 Pro | Kimi K2 (Groq) |
| 最大Token | 32000 | 8000 |
| 温度系数 | 0.7 | 0.7 |
| 可用模型 | 7个 | 4个 |
| Sandbox超时 | 15min / 30min | 15min / 30min |
| E2B Vite端口 | 5173 | 5173 |

---

### 🚀 快速开始

如果你是中国用户，推荐使用本项目（open-lovable-cn）以获得更好的体验和性能！

## Setup

2. **Add `.env.local`**

```env
# =================================================================
# REQUIRED
# =================================================================
FIRECRAWL_API_KEY=your_firecrawl_api_key    # https://firecrawl.dev

# =================================================================
# AI PROVIDER - Choose your LLM
# =================================================================
ANTHROPIC_API_KEY=your_anthropic_api_key  # https://console.anthropic.com
OPENAI_API_KEY=your_openai_api_key        # https://platform.openai.com
GEMINI_API_KEY=your_gemini_api_key        # https://aistudio.google.com/app/apikey
GROQ_API_KEY=your_groq_api_key            # https://console.groq.com

# =================================================================
# FAST APPLY (Optional - for faster edits)
# =================================================================
MORPH_API_KEY=your_morphllm_api_key    # https://morphllm.com/dashboard

# =================================================================
# SANDBOX PROVIDER - Choose ONE: Vercel (default) or E2B
# =================================================================
SANDBOX_PROVIDER=vercel  # or 'e2b'

# Option 1: Vercel Sandbox (default)
# Choose one authentication method:

# Method A: OIDC Token (recommended for development)
# Run `vercel link` then `vercel env pull` to get VERCEL_OIDC_TOKEN automatically
VERCEL_OIDC_TOKEN=auto_generated_by_vercel_env_pull

# Method B: Personal Access Token (for production or when OIDC unavailable)
# VERCEL_TEAM_ID=team_xxxxxxxxx      # Your Vercel team ID 
# VERCEL_PROJECT_ID=prj_xxxxxxxxx    # Your Vercel project ID
# VERCEL_TOKEN=vercel_xxxxxxxxxxxx   # Personal access token from Vercel dashboard

# Option 2: E2B Sandbox
# E2B_API_KEY=your_e2b_api_key      # https://e2b.dev
```

3. **Run**
```bash
pnpm dev  # or npm run dev / yarn dev
```

Open [http://localhost:3000](http://localhost:3000)

## 常见问题

### 沙箱预览提示 `no service running on port 5173`

这通常表示沙箱内的 Vite 没有监听预览端口（默认 `5173`）。请确认：

- Vite 配置中的 `server.port` 与预览端口一致（默认 `5173`）
- 启动命令包含 `--host 0.0.0.0`（例如：`pnpm dev --host 0.0.0.0`）

## 🚀 Performance Optimization

### For Chinese Users

#### 1. Chinese AI Models (国内 AI 模型)

**Default: DeepSeek R1** - A reasoning model that produces higher quality code. Supports multiple Chinese AI models with automatic fallback!

📖 **Full guide**: [docs/chinese-ai-models.md](docs/chinese-ai-models.md)

**Quick Setup:**
```env
# .env.local
OPENAI_API_KEY=your_qiniu_api_key
OPENAI_BASE_URL=https://api.qiniu.com/v1
```

**Available Models:**
- 🧠 **DeepSeek R1** (推理模型，默认) - 代码质量更高
- 🇨🇳 DeepSeek V3 / V3.1 - 通用对话模型
- 🇨🇳 Qwen3 Max / Max Preview - 通义千问最新版
- 🇨🇳 Kimi K2 - Moonshot 最新模型
- 🚀 Gemini 3 Pro Preview (备用) - 自动 fallback

**Fallback Mechanism:**
- Gemini ↔ DeepSeek 双向自动切换
- 遇到 rate limit 或服务不可用时自动重试
- 智能错误检测，包括代理包装的 429 错误

**中文用户：国内 AI 模型支持**

默认使用 **DeepSeek R1 推理模型**，代码生成质量更高！支持多种国产模型自由切换。

📖 **完整配置指南**: [docs/chinese-ai-models.md](docs/chinese-ai-models.md)

**快速配置：**
- ✅ **DeepSeek R1 默认** - 推理模型，代码更优
- ✅ **双向 Fallback** - Gemini/DeepSeek 自动切换
- ✅ **无需 VPN** - 七牛云托管，国内直连
- ✅ **即插即用** - 完全兼容 OpenAI 接口

---

#### 2. CDN Acceleration (CDN 加速)

If you're in China and experiencing slow Vercel Sandbox access, we recommend using CDN acceleration:

📖 **See detailed guide**: [docs/cdn-acceleration.md](docs/cdn-acceleration.md)

**Quick Options:**
- ✅ **Cloudflare CDN** (Free, Recommended) - 5 minutes setup
- ✅ **Aliyun CDN** (Fast in China) - Requires domain filing
- ✅ **Tencent Cloud CDN** (Fast in China) - Requires domain filing

**中文用户：CDN 加速配置**

如果您在中国访问 Vercel 沙箱较慢，建议配置 CDN 加速：

📖 **详细配置指南**: [docs/cdn-acceleration.md](docs/cdn-acceleration.md)

**快速选项：**
- ✅ **Cloudflare CDN**（免费，推荐）- 5分钟配置
- ✅ **阿里云 CDN**（国内快）- 需要域名备案
- ✅ **腾讯云 CDN**（国内快）- 需要域名备案

## License

MIT
