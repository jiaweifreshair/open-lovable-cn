# Open Lovable 中文版本

Chat with AI to build React apps instantly. An example app made by the [Firecrawl](https://firecrawl.dev/?ref=open-lovable-github) team. For a complete cloud solution, check out [Lovable.dev](https://lovable.dev/) ❤️.

<img src="https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExODAwZGJzcDVmZGYxc3MyNDUycTliYnAwem1qbzhtNHh0c2JrNDdmZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMYzMkNmOecj3yFw81/giphy.gif" alt="Open Lovable Demo" width="100%"/>

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
