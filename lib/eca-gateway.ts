/**
 * ECA AI Gateway（网宿/EdgeCloud）OpenAI Compatible 请求封装。
 *
 * 目标：
 * 1) 兼容多种鉴权头（Authorization Bearer / x-api-key / api-key），避免因文档差异导致 403。
 * 2) 统一解析常见错误码与错误体（401/403/404/429/5xx），输出可定位日志（含 requestId/traceId）。
 * 3) 默认只在“失败时”打印详细日志，避免泄露提示词内容与刷屏；需要更详细请求日志可用 ECA_GATEWAY_DEBUG=1。
 *
 * 注意：
 * - 这里不会打印任何密钥内容；
 * - 这里不会打印完整 messages 文本，只打印长度/数量等摘要信息。
 */

export type EcaGatewayErrorDetails = {
  /** HTTP 状态码（必填） */
  status: number;
  /** 网关返回的 error.code（若有） */
  code?: string;
  /** 网关返回的 error.type（若有） */
  type?: string;
  /** 网关返回的错误消息（已截断） */
  message?: string;
  /** request id（从 header 或 message 中提取） */
  requestId?: string;
  /** Retry-After（秒），用于 429 等场景 */
  retryAfterSeconds?: number;
};

/**
 * ECA 网关的 HTTP 错误（用于在上层决定是否重试/降级，以及向客户端返回合适的状态码）。
 */
export class EcaGatewayHttpError extends Error {
  readonly name = 'EcaGatewayHttpError';

  constructor(
    /** 用户可读的错误消息（中文） */
    message: string,
    /** 结构化错误细节（含 HTTP 状态码、error.code、requestId 等） */
    public readonly details: EcaGatewayErrorDetails
  ) {
    super(message);
  }
}

/**
 * 类型守卫：判断 unknown 是否为 EcaGatewayHttpError。
 */
export function isEcaGatewayHttpError(error: unknown): error is EcaGatewayHttpError {
  return error instanceof EcaGatewayHttpError;
}

type SafeBodySummary = {
  model?: unknown;
  stream?: unknown;
  temperature?: unknown;
  top_p?: unknown;
  max_tokens?: unknown;
  reasoning_effort?: unknown;
  eca_enable_search?: unknown;
  toolsCount?: number;
  eca_rag_count?: number;
  messagesCount?: number;
  messages?: Array<{ role?: unknown; contentLength?: number }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function truncateText(text: string, maxChars: number): string {
  if (!text) return '';
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars) + '…';
}

function extractRequestIdFromMessage(message: string): string | undefined {
  if (!message) return undefined;
  const match = message.match(/request\\s*id\\s*:\\s*([^\\)\\]\\s]+)/i);
  return match?.[1];
}

function readRetryAfterSeconds(headers: Headers): number | undefined {
  const raw = headers.get('Retry-After');
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function pickRequestIdFromHeaders(headers: Headers): string | undefined {
  // 常见 request id header 命名（不保证全部存在，按最常见优先）
  const candidates = [
    'x-request-id',
    'request-id',
    'x-eca-request-id',
    'x-trace-id',
    'trace-id'
  ];
  for (const name of candidates) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return undefined;
}

function summarizeBody(bodyText: string | undefined): SafeBodySummary | undefined {
  if (!bodyText) return undefined;
  const parsed = safeJsonParse(bodyText);
  if (!isRecord(parsed)) return undefined;

  const summary: SafeBodySummary = {
    model: parsed.model,
    stream: parsed.stream,
    temperature: parsed.temperature,
    top_p: parsed.top_p,
    max_tokens: parsed.max_tokens,
    reasoning_effort: parsed.reasoning_effort,
    eca_enable_search: parsed.eca_enable_search,
  };

  if (Array.isArray(parsed.tools)) summary.toolsCount = parsed.tools.length;
  if (Array.isArray(parsed.eca_rag)) summary.eca_rag_count = parsed.eca_rag.length;

  const messages = parsed.messages;
  if (Array.isArray(messages)) {
    summary.messagesCount = messages.length;
    summary.messages = messages.slice(0, 8).map(m => {
      if (!isRecord(m)) return {};
      const content = m.content;
      const contentLength =
        typeof content === 'string'
          ? content.length
          : Array.isArray(content)
            ? JSON.stringify(content).length
            : content == null
              ? 0
              : String(content).length;
      return { role: m.role, contentLength };
    });
  }

  return summary;
}

function parseGatewayError(
  status: number,
  headers: Headers,
  rawText: string
): EcaGatewayErrorDetails {
  const retryAfterSeconds = readRetryAfterSeconds(headers);
  const requestIdFromHeader = pickRequestIdFromHeaders(headers);

  const parsed = safeJsonParse(rawText);

  // 兼容 OpenAI 风格：{ error: { code, message, type } }
  if (isRecord(parsed) && isRecord(parsed.error)) {
    const code = typeof parsed.error.code === 'string' ? parsed.error.code : undefined;
    const type = typeof parsed.error.type === 'string' ? parsed.error.type : undefined;
    const message = typeof parsed.error.message === 'string' ? parsed.error.message : undefined;
    const requestIdFromMessage = message ? extractRequestIdFromMessage(message) : undefined;

    return {
      status,
      code,
      type,
      message: message ? truncateText(message, 800) : truncateText(rawText, 800),
      requestId: requestIdFromHeader || requestIdFromMessage,
      retryAfterSeconds,
    };
  }

  // 兼容另一种常见形态：{ code, message, request_id }
  if (isRecord(parsed)) {
    const code = typeof parsed.code === 'string' ? parsed.code : undefined;
    const type = typeof parsed.type === 'string' ? parsed.type : undefined;
    const message = typeof parsed.message === 'string' ? parsed.message : undefined;
    const requestId = typeof parsed.request_id === 'string' ? parsed.request_id : undefined;
    const requestIdFromMessage = message ? extractRequestIdFromMessage(message) : undefined;

    return {
      status,
      code,
      type,
      message: message ? truncateText(message, 800) : truncateText(rawText, 800),
      requestId: requestIdFromHeader || requestId || requestIdFromMessage,
      retryAfterSeconds,
    };
  }

  // 兜底：纯文本/HTML 等
  return {
    status,
    message: truncateText(rawText, 800),
    requestId: requestIdFromHeader || extractRequestIdFromMessage(rawText),
    retryAfterSeconds,
  };
}

function formatErrorMessage(details: EcaGatewayErrorDetails): string {
  const pieces: string[] = [];
  const codePart = details.code || details.type;
  pieces.push(`ECA 网关请求失败 (HTTP ${details.status}${codePart ? `/${codePart}` : ''})`);

  if (details.message) pieces.push(details.message);
  if (details.requestId) pieces.push(`requestId=${details.requestId}`);
  if (details.retryAfterSeconds) pieces.push(`Retry-After=${details.retryAfterSeconds}s`);

  // 追加常见场景提示（尽量简短）
  if (details.status === 401) {
    pieces.push('可能原因：缺少 Authorization 请求头，或 token 错误/过期');
  } else if (details.status === 403) {
    pieces.push('可能原因：token 无权限/错误，或请求体格式不符合文档（messages 必填且需包含 user 问题）');
  } else if (details.status === 404) {
    pieces.push('请检查 ECA_GATEWAY_ENDPOINT 是否正确（应包含 /v1/{project}/{app}）');
  } else if (details.status === 429) {
    pieces.push('触发限流，请稍后重试或降低并发');
  } else if (details.status >= 500) {
    pieces.push('网关服务异常，可稍后重试或切换模型');
  }

  return pieces.join('；');
}

function getRequestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  // Request
  return input.url;
}

function stripChatCompletionsSuffix(url: string): string | null {
  try {
    const parsed = new URL(url);
    // 文档要求：POST ${AIGATEWAY_URL}（形如 /v1/{project}/{app}），而不是 /chat/completions
    // 兼容 ai-sdk/openai-compatible 自动拼接的 /chat/completions：尝试在 fetch 层将其剥离。
    const suffix = '/chat/completions';
    if (!parsed.pathname.endsWith(suffix)) return null;
    const newPath = parsed.pathname.slice(0, parsed.pathname.length - suffix.length) || '/';
    const normalizedPath = newPath.endsWith('/') ? newPath.replace(/\/+$/, '') : newPath;
    parsed.pathname = normalizedPath || '/';
    return parsed.toString();
  } catch {
    return null;
  }
}

function buildTraceId(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  return `eca_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function shouldDebug(): boolean {
  return process.env.ECA_GATEWAY_DEBUG === '1';
}

function getApiKeyFromEnv(): string {
  // 兼容网宿文档变量名：AIGATEWAY_TOKEN
  return process.env.ECA_GATEWAY_API_KEY ||
    process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
    process.env.AIGATEWAY_TOKEN ||
    '';
}

/**
 * 创建一个用于 @ai-sdk/openai-compatible 的 fetch 实现。
 *
 * 做什么：
 * - 为 ECA 网关补齐兼容鉴权头；
 * - 在非 2xx 时解析 error body，输出结构化日志，并抛出 EcaGatewayHttpError；
 * - 在 ECA_GATEWAY_DEBUG=1 时额外打印“请求摘要/耗时”日志。
 *
 * 为什么：
 * - 不同版本文档/网关可能要求不同 header 名称，统一兼容可显著减少 403 排查时间；
 * - AI SDK 默认错误信息可能不包含 requestId / error.code，导致定位困难。
 */
export function createEcaGatewayFetch(): typeof fetch {
  return async (input: any, init?: RequestInit) => {
    const url = getRequestUrl(input as any);
    const method = (init?.method || (input instanceof Request ? input.method : 'POST')).toUpperCase();
    const traceId = buildTraceId();
    const startedAt = Date.now();

    const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
    const apiKey = getApiKeyFromEnv();

    // 兼容多种鉴权头（不覆盖已有 Authorization，避免破坏 SDK 行为）
    if (apiKey) {
      if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${apiKey}`);
      if (!headers.has('x-api-key')) headers.set('x-api-key', apiKey);
      if (!headers.has('api-key')) headers.set('api-key', apiKey);
    }

    // 便于链路追踪（如果网关忽略该 header 也无副作用）
    if (!headers.has('x-trace-id')) headers.set('x-trace-id', traceId);

    const bodyText = typeof init?.body === 'string' ? init.body : undefined;
    const safeBody = summarizeBody(bodyText);

    if (shouldDebug()) {
      // 注意：只打印摘要，避免泄露 prompt
      console.log('[eca-gateway] request', { traceId, method, url, body: safeBody });
    }

    try {
      // ✅ 兼容 ECA 文档的 URL：优先尝试“去掉 /chat/completions”的形式
      // - 若该形式返回 404/405，再回退到原始 URL（避免破坏其他兼容实现）
      const urlWithoutChatCompletions = stripChatCompletionsSuffix(url);
      const candidates = urlWithoutChatCompletions ? [urlWithoutChatCompletions, url] : [url];

      let lastResponse: Response | null = null;
      let lastRawText = '';

      for (let index = 0; index < candidates.length; index += 1) {
        const attemptUrl = candidates[index];
        lastResponse = await fetch(attemptUrl, { ...init, headers });
        const durationMs = Date.now() - startedAt;

        if (lastResponse.ok) {
          if (shouldDebug()) {
            console.log('[eca-gateway] response', {
              traceId,
              status: lastResponse.status,
              durationMs,
              url: attemptUrl,
              requestId: pickRequestIdFromHeaders(lastResponse.headers),
            });
          }
          return lastResponse;
        }

        // 只在必要时回退：404/405 表示路径不对；其余错误（401/403/429/5xx）回退意义不大。
        if (index < candidates.length - 1 && (lastResponse.status === 404 || lastResponse.status === 405)) {
          if (shouldDebug()) {
            console.warn('[eca-gateway] url_fallback', {
              traceId,
              from: attemptUrl,
              to: candidates[index + 1],
              status: lastResponse.status,
            });
          }
          continue;
        }

        lastRawText = await lastResponse.text().catch(() => '');
        const details = parseGatewayError(lastResponse.status, lastResponse.headers, lastRawText);

        // 失败时始终打印结构化日志（不含密钥、不含完整 prompt）
        console.error('[eca-gateway] http_error', {
          traceId,
          method,
          url: attemptUrl,
          durationMs,
          request: safeBody,
          response: {
            status: lastResponse.status,
            code: details.code,
            type: details.type,
            requestId: details.requestId,
            retryAfterSeconds: details.retryAfterSeconds,
            body: truncateText(lastRawText, 1500),
          },
        });

        throw new EcaGatewayHttpError(formatErrorMessage(details), details);
      }

      // 理论上不会到达这里（上面的循环会 return 或 throw）
      throw new Error('ECA 网关请求失败：未获得可用响应');
    } catch (error) {
      // 对于网络错误/超时等，也打印简要日志，方便排查。
      if (error instanceof EcaGatewayHttpError) throw error;

      const durationMs = Date.now() - startedAt;
      console.error('[eca-gateway] fetch_error', {
        traceId,
        method,
        url,
        durationMs,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  };
}
