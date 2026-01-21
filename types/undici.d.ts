/**
 * undici 类型兜底声明（仅用于构建期通过类型检查）。
 *
 * 背景：
 * - Next.js instrumentation 里使用了 `import('undici')` 来为 E2B SDK 配置全局 Dispatcher。
 * - 在部分生产镜像/精简依赖安装场景中，`undici` 可能未被显式安装，导致 `next build` 报错：
 *   "Cannot find module 'undici' or its corresponding type declarations."
 *
 * 说明：
 * - 这是最小可用的类型声明，用于让 TypeScript 能够解析 `undici` 模块类型。
 * - 运行时若未安装 `undici`，代码会在 try/catch 内安全降级（不影响主流程）。
 */

declare module 'undici' {
  export abstract class Dispatcher {
    dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler): boolean;
    close(): Promise<void>;
    destroy(): Promise<void>;
  }

  export namespace Dispatcher {
    export interface DispatchOptions {
      origin?: string | URL;
    }

    export interface DispatchHandler {
      // 这里不声明细节：instrumentation 仅透传 handler
    }
  }

  export class Agent extends Dispatcher {
    constructor(options?: unknown);
  }

  export class ProxyAgent extends Agent {
    constructor(options: unknown);
  }

  export function setGlobalDispatcher(dispatcher: Dispatcher): void;
}

