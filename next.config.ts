import type { NextConfig } from "next";

/**
 * Next.js 配置
 *
 * Docker 部署配置：
 * - output: 'standalone' - 生成独立的生产构建，包含所有必需依赖
 * - 优化Docker镜像大小，只包含运行时需要的文件
 */
const nextConfig: NextConfig = {
  // Docker部署：使用standalone模式生成优化的生产构建
  output: 'standalone',

  // 实验性功能
  experimental: {
    // 优化服务器组件
    serverComponentsExternalPackages: ['playwright', 'crawlee'],
  },
};

export default nextConfig;
