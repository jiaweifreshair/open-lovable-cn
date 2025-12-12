/**
 * Next.js Instrumentation - 为E2B SDK配置HTTP代理
 *
 * E2B SDK使用undici进行HTTP请求，而undici不会自动读取HTTP_PROXY环境变量。
 * 这个文件在Next.js服务端启动时运行，为undici设置全局代理。
 *
 * 注意：E2B sandbox域名（*.e2b.app, *.e2b.dev）需要排除代理，因为代理不支持WebSocket连接
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

import type { Dispatcher as UndiciDispatcher } from 'undici';

// E2B相关域名不走代理（WebSocket连接不兼容HTTP代理）
const NO_PROXY_DOMAINS = [
  '.e2b.app',
  '.e2b.dev',
  'api.e2b.dev',
  'localhost',
  '127.0.0.1',
];

export async function register() {
  // 仅在服务端运行
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const proxyUrl = process.env.HTTPS_PROXY || process.env.HTTP_PROXY ||
                     process.env.https_proxy || process.env.http_proxy;

    if (proxyUrl) {
      console.log(`[Instrumentation] Configuring undici global proxy: ${proxyUrl}`);
      console.log(`[Instrumentation] NO_PROXY domains: ${NO_PROXY_DOMAINS.join(', ')}`);

      try {
        // 动态导入undici（避免在edge runtime上出错）
        const { ProxyAgent, Agent, setGlobalDispatcher, Dispatcher: RuntimeDispatcher } = await import('undici');

        // 创建直连Agent（用于bypass代理的请求）
        const directAgent = new Agent({
          connect: {
            timeout: 30000,
          }
        });

        // 创建代理Agent
        const proxyAgent = new ProxyAgent({
          uri: proxyUrl,
          connect: {
            timeout: 30000,
          }
        });

        // 创建自定义dispatcher，根据域名决定是否使用代理
        class SmartDispatcher extends RuntimeDispatcher {
          dispatch(options: UndiciDispatcher.DispatchOptions, handler: UndiciDispatcher.DispatchHandler): boolean {
            const origin = options.origin?.toString() || '';

            // 检查是否需要bypass代理
            const shouldBypass = NO_PROXY_DOMAINS.some(domain => {
              if (domain.startsWith('.')) {
                // 匹配子域名，如 .e2b.app 匹配 xxx.e2b.app
                return origin.includes(domain);
              }
              return origin.includes(domain);
            });

            if (shouldBypass) {
              console.log(`[Instrumentation] Bypassing proxy for: ${origin}`);
              return directAgent.dispatch(options, handler);
            }

            return proxyAgent.dispatch(options, handler);
          }

          async close(): Promise<void> {
            await Promise.all([directAgent.close(), proxyAgent.close()]);
          }

          async destroy(): Promise<void> {
            await Promise.all([directAgent.destroy(), proxyAgent.destroy()]);
          }
        }

        // 设置为全局dispatcher
        setGlobalDispatcher(new SmartDispatcher());

        console.log('[Instrumentation] Smart proxy configured successfully (E2B domains bypassed)');
      } catch (error) {
        console.error('[Instrumentation] Failed to configure proxy:', error);
      }
    } else {
      console.log('[Instrumentation] No proxy configured (HTTP_PROXY/HTTPS_PROXY not set)');
    }
  }
}
