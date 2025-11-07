# Open Lovable

Chat with AI to build React apps instantly. An example app made by the [Firecrawl](https://firecrawl.dev/?ref=open-lovable-github) team. For a complete cloud solution, check out [Lovable.dev](https://lovable.dev/) ❤️.

<img src="https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExODAwZGJzcDVmZGYxc3MyNDUycTliYnAwem1qbzhtNHh0c2JrNDdmZCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/LMYzMkNmOecj3yFw81/giphy.gif" alt="Open Lovable Demo" width="100%"/>

## Setup

1. **Clone & Install**
```bash
git clone https://github.com/firecrawl/open-lovable.git
cd open-lovable
pnpm install  # or npm install / yarn install
```

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

**Now supports Chinese AI models** including Qwen (通义千问), DeepSeek, Ernie (文心一言), and GLM!

📖 **Full guide**: [docs/chinese-ai-models.md](docs/chinese-ai-models.md)

**Quick Setup:**
```env
# .env.local
OPENAI_API_KEY=your_qiniu_or_aliyun_key
OPENAI_BASE_URL=https://api.qiniu.com/v1  # or Aliyun DashScope
```

**Available Models:**
- 🇨🇳 通义千问 (Qwen Max/Plus/Turbo)
- 🇨🇳 DeepSeek (Chat/Reasoner)
- 🇨🇳 文心一言 (Ernie 4.0/3.5)
- 🇨🇳 智谱 (GLM-4 Plus/Flash)

**中文用户：国内 AI 模型支持**

现已支持通义千问、DeepSeek、文心一言、智谱 GLM 等国内主流模型！

📖 **完整配置指南**: [docs/chinese-ai-models.md](docs/chinese-ai-models.md)

**快速配置：**
- ✅ **零代码改动** - 仅需配置环境变量
- ✅ **无需 VPN** - 国内服务器直连
- ✅ **成本更低** - 国内模型价格实惠
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
