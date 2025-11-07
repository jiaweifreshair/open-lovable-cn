# Docker 部署指南

Open Lovable 三层降级爬虫系统的 Docker 容器化部署文档。

---

## 📋 目录

- [系统架构](#系统架构)
- [部署准备](#部署准备)
- [快速部署](#快速部署)
- [配置说明](#配置说明)
- [运维管理](#运维管理)
- [监控与日志](#监控与日志)
- [故障排查](#故障排查)
- [性能优化](#性能优化)

---

## 🏗️ 系统架构

### Docker 镜像构成

```
基础镜像: mcr.microsoft.com/playwright:v1.56.1-noble (Ubuntu 24.04)
├── 内置浏览器: Chromium, Firefox, WebKit
├── 系统依赖: 完整的浏览器运行时依赖
└── Node.js 20.x + pnpm

应用层:
├── Next.js 15.4.3 (Standalone 模式)
├── Playwright 1.56.1
├── Crawlee 3.15.2
└── Firecrawl SDK 4.3.4
```

### 三层降级策略

```
Layer 1: Firecrawl API （优先，云端爬取）
    ↓ 失败/超时
Layer 2: Crawlee 智能路由
    ├─ Cheerio (静态页面，20-100ms)
    └─ Playwright (动态页面，1-2s)
    ↓ 失败
Layer 3: Playwright 直接调用（兜底）
```

---

## 🎯 部署准备

### 系统要求

- **Docker**: >= 20.10
- **Docker Compose**: >= 2.0
- **系统资源**:
  - CPU: 最少 1核，推荐 2核
  - 内存: 最少 2GB，推荐 4GB
  - 磁盘: 最少 5GB 可用空间

### 检查环境

```bash
# 检查 Docker 版本
docker --version

# 检查 Docker Compose 版本
docker compose version

# 检查系统资源
docker system df
```

---

## 🚀 快速部署

### Step 1: 克隆项目

```bash
git clone <your-repo-url>
cd open-lovable-cn
```

### Step 2: 配置环境变量

```bash
# 复制环境变量模板
cp .env.docker .env.docker.local

# 编辑环境变量（替换真实的 API Keys）
vi .env.docker.local
```

**必须配置的环境变量**:

```bash
# Firecrawl API Key（必需）
FIRECRAWL_API_KEY=your_firecrawl_api_key

# AI Provider（必需）
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.openai.com/v1

# Sandbox Provider（可选）
SANDBOX_PROVIDER=vercel
VERCEL_OIDC_TOKEN=auto_generated
```

### Step 3: 构建并启动

```bash
# 构建 Docker 镜像（首次运行，约 5-7 分钟）
docker compose build

# 启动容器（后台运行）
docker compose up -d

# 查看启动日志
docker compose logs -f
```

### Step 4: 验证部署

```bash
# 健康检查 API
curl http://localhost:3000/api/health | jq .

# 测试爬虫功能
curl -X POST http://localhost:3000/api/scrape-url-enhanced \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' | jq .
```

**预期输出**:

```json
{
  "status": "healthy",
  "services": {
    "scraper": {
      "firecrawl": true,
      "playwright": true,
      "crawlee": true
    },
    "ai": {
      "configured": true
    }
  }
}
```

---

## ⚙️ 配置说明

### docker-compose.yml 配置

```yaml
services:
  app:
    image: open-lovable:latest
    ports:
      - "3000:3000"
    env_file:
      - .env.docker
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
    restart: unless-stopped
```

### 环境变量详解

| 变量名 | 必需 | 说明 | 默认值 |
|-------|------|------|--------|
| `FIRECRAWL_API_KEY` | ✅ | Firecrawl API密钥 | - |
| `OPENAI_API_KEY` | ✅ | OpenAI API密钥 | - |
| `OPENAI_BASE_URL` | ✅ | OpenAI API地址 | - |
| `SANDBOX_PROVIDER` | ❌ | 沙箱提供商 | vercel |
| `NODE_ENV` | ❌ | 运行环境 | production |
| `PORT` | ❌ | 服务端口 | 3000 |

### 资源限制调整

**生产环境推荐**:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 8G
    reservations:
      cpus: '2'
      memory: 4G
```

**开发/测试环境**:

```yaml
deploy:
  resources:
    limits:
      cpus: '1'
      memory: 2G
    reservations:
      cpus: '0.5'
      memory: 1G
```

---

## 🔧 运维管理

### 常用命令

```bash
# 启动服务
docker compose up -d

# 停止服务
docker compose down

# 重启服务
docker compose restart

# 查看容器状态
docker compose ps

# 查看实时日志
docker compose logs -f app

# 查看最近 100 行日志
docker compose logs --tail=100 app

# 进入容器 Shell
docker compose exec app sh

# 查看容器资源使用
docker stats open-lovable
```

### 更新部署

```bash
# 拉取最新代码
git pull origin main

# 重新构建镜像（使用缓存）
docker compose build

# 停止旧容器并启动新容器
docker compose up -d --force-recreate

# 清理旧镜像
docker image prune -f
```

### 数据备份

```bash
# 备份 Crawlee 存储
docker run --rm \
  -v open-lovable-cn_crawlee-storage:/source \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/crawlee-$(date +%Y%m%d).tar.gz -C /source .

# 备份 Playwright 缓存（可选）
docker run --rm \
  -v open-lovable-cn_playwright-cache:/source \
  -v $(pwd)/backups:/backup \
  alpine tar czf /backup/playwright-$(date +%Y%m%d).tar.gz -C /source .
```

---

## 📊 监控与日志

### 健康检查

Docker Compose 已配置自动健康检查:

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "..."]
  interval: 30s
  timeout: 10s
  retries: 3
  start_period: 40s
```

**手动检查健康状态**:

```bash
# 查看健康状态
docker compose ps

# 详细健康检查
curl http://localhost:3000/api/health
```

### 日志管理

**日志配置** (docker-compose.yml):

```yaml
logging:
  driver: "json-file"
  options:
    max-size: "10m"
    max-file: "3"
```

**日志查询**:

```bash
# 查看所有日志
docker compose logs app

# 查看最近 50 行日志
docker compose logs --tail=50 app

# 实时跟踪日志
docker compose logs -f app

# 搜索日志中的错误
docker compose logs app | grep -i error

# 搜索爬虫相关日志
docker compose logs app | grep scraper
```

### 性能监控

```bash
# 实时资源监控
docker stats open-lovable

# 容器进程列表
docker compose top app

# 容器详细信息
docker inspect open-lovable
```

---

## 🚨 故障排查

### 容器无法启动

**问题**: 端口被占用

```bash
# 查看占用端口的进程
lsof -i:3000

# 杀死占用进程
kill -9 $(lsof -ti:3000)

# 或使用不同端口
# 修改 docker-compose.yml:
ports:
  - "3001:3000"
```

**问题**: 内存不足

```bash
# 查看容器内存使用
docker stats open-lovable

# 增加内存限制（docker-compose.yml）
deploy:
  resources:
    limits:
      memory: 8G
```

### 爬虫功能异常

**问题**: Firecrawl 超时

```
✅ 正常行为 - 自动降级到 Crawlee
```

**问题**: Playwright 浏览器启动失败

```bash
# 检查容器日志
docker compose logs app | grep playwright

# 重启容器
docker compose restart app

# 如果问题持续，重建镜像
docker compose down
docker compose build --no-cache
docker compose up -d
```

### 环境变量未生效

```bash
# 检查环境变量文件
cat .env.docker

# 查看容器内环境变量
docker compose exec app printenv | grep FIRECRAWL

# 重新加载环境变量
docker compose down
docker compose up -d
```

### 日志中的常见警告

**SQLite Experimental Warning**:

```
(node:1) ExperimentalWarning: SQLite is an experimental feature
```

✅ **安全忽略** - Next.js 使用实验性 SQLite 特性

**version 属性警告**:

```
the attribute `version` is obsolete
```

✅ **安全忽略** - Docker Compose v2 不需要 version 字段

---

## ⚡ 性能优化

### 1. 镜像构建优化

**启用 BuildKit**:

```bash
export DOCKER_BUILDKIT=1
docker compose build
```

**使用构建缓存**:

```bash
# 带缓存重建
docker compose build

# 强制无缓存重建（仅问题排查时使用）
docker compose build --no-cache
```

### 2. 运行时优化

**调整资源限制**:

```yaml
# 高负载场景
deploy:
  resources:
    limits:
      cpus: '8'
      memory: 16G
```

**启用 HTTP/2**:

```bash
# Nginx 反向代理配置示例
http2 on;
ssl_certificate /path/to/cert.pem;
ssl_certificate_key /path/to/key.pem;

location / {
    proxy_pass http://localhost:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
}
```

### 3. 数据持久化优化

**使用命名卷**:

```yaml
volumes:
  playwright-cache:
    driver: local
    driver_opts:
      type: none
      o: bind
      device: /data/playwright-cache
```

---

## 🎉 生产环境部署检查清单

部署到生产环境前，请确认以下事项：

### 安全性

- [ ] 所有 API Keys 使用环境变量管理
- [ ] `.env.docker` 已添加到 `.gitignore`
- [ ] 容器以非 root 用户运行 (pwuser)
- [ ] 配置了防火墙规则限制访问
- [ ] 启用 HTTPS（使用 Nginx/Caddy 反向代理）

### 可靠性

- [ ] 配置了自动重启策略 (`restart: unless-stopped`)
- [ ] 健康检查正常工作
- [ ] 配置了日志轮转（max-size, max-file）
- [ ] 设置了资源限制（CPU, 内存）
- [ ] 测试了三层降级策略

### 监控

- [ ] 健康检查 API 可访问
- [ ] 日志聚合配置完成（如 ELK）
- [ ] 性能监控就绪（如 Prometheus）
- [ ] 配置了告警规则

### 备份

- [ ] 定期备份 Crawlee 存储
- [ ] 备份环境变量配置
- [ ] 文档化恢复流程

---

## 📞 获取帮助

遇到问题？

1. 查看 [故障排查](#故障排查) 章节
2. 检查容器日志: `docker compose logs -f app`
3. 提交 Issue 到项目仓库
4. 查看 Phase 3C 完成报告: `PHASE3C_COMPLETION_REPORT.md`

---

## 📚 相关文档

- [Phase 3C 完成报告](./PHASE3C_COMPLETION_REPORT.md) - 三层降级策略测试报告
- [Phase 3B 完成报告](./PHASE3B_COMPLETION_REPORT.md) - Crawlee 集成报告
- [Dockerfile](./Dockerfile) - Docker 镜像构建配置
- [docker-compose.yml](./docker-compose.yml) - Docker Compose 编排配置

---

**🎊 恭喜！您已成功部署 Open Lovable 三层降级爬虫系统！**

镜像大小: ~2.5GB
启动时间: ~5秒
内存使用: ~500MB (空闲) / ~2GB (高负载)
