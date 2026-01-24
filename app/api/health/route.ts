/**
 * 健康检查 API
 *
 * Docker 容器健康检查端点
 * - 验证应用程序运行状态
 * - 检查关键依赖可用性
 * - 用于负载均衡器和容器编排
 */

import { NextResponse } from 'next/server';

/**
 * GET /api/health
 *
 * 返回应用健康状态
 */
export async function GET() {
  try {
    const hasEcaToken = !!(
      process.env.ECA_GATEWAY_API_KEY ||
      process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
      process.env.AIGATEWAY_TOKEN
    );
    const hasEcaEndpointEnv = !!(
      process.env.ECA_GATEWAY_ENDPOINT ||
      process.env.AIGATEWAY_URL ||
      process.env.CODE_ASSIST_ENDPOINT
    );

    // 基础健康检查
    const healthCheck = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      version: process.env.npm_package_version || '0.1.0',
      services: {
        // 检查爬虫服务配置
        scraper: {
          firecrawl: !!process.env.FIRECRAWL_API_KEY,
          playwright: true, // Playwright 总是可用（镜像内置）
          crawlee: true,    // Crawlee 总是可用
        },
        // 检查 AI 服务配置
        ai: {
          configured: !!(
            process.env.AI_GATEWAY_API_KEY ||
            hasEcaToken ||
            process.env.OPENAI_API_KEY ||
            process.env.ANTHROPIC_API_KEY ||
            process.env.GEMINI_API_KEY ||
            process.env.GROQ_API_KEY
          ),
          ecaGateway: {
            hasToken: hasEcaToken,
            hasEndpointEnv: hasEcaEndpointEnv,
          },
        },
      },
    };

    return NextResponse.json(healthCheck, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  } catch (error) {
    // 健康检查失败
    return NextResponse.json({
      status: 'unhealthy',
      error: (error as Error).message,
      timestamp: new Date().toISOString(),
    }, {
      status: 503,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    });
  }
}
