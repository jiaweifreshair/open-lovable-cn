# ============================================================================
# Open Lovable - 生产环境 Dockerfile
# ============================================================================
#
# 三层降级爬虫系统 Docker 镜像
# - Firecrawl API（优先）
# - Crawlee 智能爬虫（Cheerio + Playwright）
# - Playwright 无头浏览器（兜底）
#
# 基于官方 Playwright 镜像，确保浏览器依赖完整
# 使用多阶段构建优化镜像大小
#
# ============================================================================

# ============================================================================
# Stage 1: 依赖安装阶段
# ============================================================================
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS deps

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml* ./

# 安装依赖（仅生产依赖）
RUN pnpm install --prod --frozen-lockfile

# ============================================================================
# Stage 2: 构建阶段
# ============================================================================
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖配置文件
COPY package.json pnpm-lock.yaml* ./

# 安装所有依赖（包括开发依赖）
RUN pnpm install --frozen-lockfile

# 复制源代码
COPY . .

# 设置环境变量（构建时）
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production

# 构建 Next.js 应用（生成 standalone 输出）
RUN pnpm build

# ============================================================================
# Stage 3: 运行时阶段（最终镜像）
# ============================================================================
FROM mcr.microsoft.com/playwright:v1.56.1-noble AS runner

WORKDIR /app

# 使用 Playwright 镜像内置的 pwuser (uid=1000, gid=1000)
# Playwright 镜像已包含此用户，无需创建新用户

# 安装 pnpm（运行时需要）
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制必要的运行时文件
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/static ./.next/static

# 复制 standalone 构建输出（包含所有必需依赖）
COPY --from=builder --chown=pwuser:pwuser /app/.next/standalone ./

# 设置环境变量（运行时）
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Playwright 缓存目录（避免重复下载浏览器）
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# 暴露端口
EXPOSE 3000

# 切换到非root用户（Playwright镜像内置）
USER pwuser

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# 启动应用
CMD ["node", "server.js"]
