/**
 * ECA Chat Completions 冒烟测试（直连网关，不依赖本地 Next.js 服务）。
 *
 * 用途：
 * - 快速验证 ECA_GATEWAY_ENDPOINT/ECA_GATEWAY_API_KEY 是否可用；
 * - 输出 HTTP 状态码、requestId（若有）、错误体，便于对照网关文档排查。
 *
 * 运行：
 * - `node tests/run-eca-gateway-smoke.js`
 * - 可选：`MODEL=gemini-3-pro-preview node tests/run-eca-gateway-smoke.js`
 */

import { config as loadEnv } from 'dotenv';

loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const DEFAULT_ENDPOINT =
  'https://aigateway.edgecloudapp.com/v1/6a346ca84941b743a3ea49cd6db8d004/xinbang01';

const rawEndpoint =
  process.env.ECA_GATEWAY_ENDPOINT ||
  process.env.AIGATEWAY_URL ||
  process.env.CODE_ASSIST_ENDPOINT ||
  DEFAULT_ENDPOINT;
const endpoint = rawEndpoint
  .trim()
  .replace(/\/+$/, '')
  .replace(/\/chat\/completions$/i, '')
  .replace(/\/+$/, '');
const apiKey =
  process.env.ECA_GATEWAY_API_KEY ||
  process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
  process.env.AIGATEWAY_TOKEN ||
  '';
const model = process.env.MODEL || process.env.GEMINI_MODEL || 'gemini-3-pro-preview';
const stream = process.env.STREAM === '1';
const timeoutMs = Number(process.env.TIMEOUT_MS || 20000);

function pickRequestId(headers) {
  const candidates = ['x-request-id', 'request-id', 'x-eca-request-id', 'x-trace-id', 'trace-id'];
  for (const name of candidates) {
    const value = headers.get(name);
    if (value && value.trim()) return value.trim();
  }
  return '';
}

function truncate(text, max = 2000) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max) + '…' : text;
}

if (!apiKey) {
  console.error('缺少 ECA 网关密钥：请设置 ECA_GATEWAY_API_KEY（或兼容变量 GOOGLE_CLOUD_ACCESS_TOKEN）');
  process.exitCode = 1;
}

console.log('[eca-smoke] endpoint:', endpoint);
console.log('[eca-smoke] model:', model);
console.log('[eca-smoke] hasKey:', Boolean(apiKey));
console.log('[eca-smoke] stream:', stream);
console.log('[eca-smoke] timeoutMs:', timeoutMs);

// 文档要求：POST ${AIGATEWAY_URL}（即 endpoint 本身）
// 兼容部分实现：也可能需要 /chat/completions
const primaryUrl = endpoint;
const fallbackUrl = `${endpoint}/chat/completions`;
const headers = {
  'Content-Type': 'application/json',
  ...(apiKey
    ? {
      Authorization: `Bearer ${apiKey}`,
      'x-api-key': apiKey,
      'api-key': apiKey,
    }
    : {}),
};

const body = {
  model,
  stream,
  temperature: 0,
  max_tokens: 64,
  messages: [
    { role: 'user', content: '只回复一个单词：pong' },
  ],
};

try {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const request = async (url) => {
    console.log('[eca-smoke] POST', url);
    return fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  };

  let res = await request(primaryUrl);
  if ((res.status === 404 || res.status === 405) && fallbackUrl !== primaryUrl) {
    console.log('[eca-smoke] primaryUrl not supported, fallback to /chat/completions');
    res = await request(fallbackUrl);
  }

  const text = await res.text().catch(() => '');
  clearTimeout(timer);
  const requestId = pickRequestId(res.headers);

  console.log('[eca-smoke] httpStatus:', res.status);
  if (requestId) console.log('[eca-smoke] requestId:', requestId);
  console.log('[eca-smoke] contentType:', res.headers.get('content-type') || '');
  console.log('[eca-smoke] responseBody:', truncate(text, 4000));

  if (!res.ok) process.exitCode = 1;
} catch (err) {
  console.error('[eca-smoke] fetch_error:', err?.message || String(err));
  process.exitCode = 1;
}
