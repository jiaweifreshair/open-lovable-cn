# E2B 沙箱模板 Dockerfile
#
# 此 Dockerfile 用于创建 E2B 预构建模板，大幅减少沙箱创建时间
# 从 32秒 减少到 8-10秒（75% 提升）
#
# 构建命令：e2b template build
# 使用命令：Sandbox.create({ template: 'template-id' })

# 基础镜像：Ubuntu 22.04 (E2B 要求 Debian-based)
FROM ubuntu:22.04

# 设置环境变量
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_VERSION=20
ENV PNPM_VERSION=latest

# 安装系统依赖
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    && rm -rf /var/lib/apt/lists/*

# 安装 Node.js 20.x
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# 启用 corepack 并安装 pnpm
RUN corepack enable && \
    corepack prepare pnpm@${PNPM_VERSION} --activate

# 创建工作目录
WORKDIR /home/user

# 预创建 Vite React 项目结构（避免每次创建时都要初始化）
RUN mkdir -p project && \
    cd project && \
    pnpm create vite@latest . --template react-ts && \
    pnpm install

# 设置默认工作目录
WORKDIR /home/user/project

# 暴露 Vite 默认端口
EXPOSE 5173

# 默认启动命令（可被覆盖）
CMD ["pnpm", "dev", "--host", "0.0.0.0"]
