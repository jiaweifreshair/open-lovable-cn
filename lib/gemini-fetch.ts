
export const geminiFetch = async (url: string | Request | URL, options?: RequestInit) => {
  const requestUrl = url.toString();

  // Only intercept requests to the Gemini proxy (支持本地和远程代理)
  // Antigravity Tools (127.0.0.1:8045) 已经返回标准 OpenAI 格式,直接透传
  if (requestUrl.includes('127.0.0.1:8045')) {
    return fetch(url, options);
  }

  if (!requestUrl.includes('cs.imds.ai')) {
    return fetch(url, options);
  }

  console.log('[GeminiFetch] Intercepting request to:', requestUrl);

  // 1. Modify Request Body (Handle System Prompt & Params)
  let newOptions = { ...options };
  if (options?.body && typeof options.body === 'string') {
    try {
      const body = JSON.parse(options.body);

      // Merge system prompt
      if (body.messages) {
        const newMessages: any[] = [];
        let systemPrompt = '';

        for (const msg of body.messages) {
          if (msg.role === 'system') {
            systemPrompt += (systemPrompt ? '\n' : '') + msg.content;
          } else {
            if (systemPrompt && msg.role === 'user') {
              msg.content = systemPrompt + '\n\n' + msg.content;
              systemPrompt = ''; // Clear it once merged
            }
            newMessages.push(msg);
          }
        }

        // If system prompt is still there (no user message?), add it as user message
        if (systemPrompt) {
            newMessages.push({ role: 'user', content: systemPrompt });
        }

        body.messages = newMessages;
      }

      // Remove potentially unsupported parameters
      if (body.max_tokens) {
        // Gemini uses maxOutputTokens, but proxy might map it. Keep it for now.
      }

      newOptions.body = JSON.stringify(body);
    } catch (e) {
      console.error('[GeminiFetch] Error parsing body:', e);
    }
  }

  // 2. Call Original Fetch with retry for transient errors
  const maxRetries = 3;
  // 可重试的 HTTP 状态码：429(速率限制), 502(网关错误), 503(服务不可用), 504(网关超时)
  const retryableStatuses = [429, 502, 503, 504];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const response = await fetch(url, newOptions);

    // 处理可重试的错误状态码
    if (retryableStatuses.includes(response.status)) {
      const retryAfter = response.headers.get('Retry-After');
      const baseDelay = response.status === 429 ? 2000 : 3000; // 504超时等待更长
      const delayMs = retryAfter ? parseInt(retryAfter) * 1000 : Math.min(baseDelay * Math.pow(2, attempt - 1), 15000);
      console.warn(`[GeminiFetch] ${response.status} error (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`);

      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // 最后一次重试也失败，抛出明确的错误
      const errorBody = await response.text().catch(() => '');
      throw new Error(`Gemini API error (${response.status}) after ${maxRetries} retries. Response: ${errorBody.substring(0, 200)}`);
    }

    // 处理其他错误状态码
    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      console.error(`[GeminiFetch] API error ${response.status}:`, errorBody.substring(0, 500));

      // 检测代理服务器包装的 429 错误（代理可能将 429 包装成 500 返回）
      const isWrapped429 = errorBody.includes('429') ||
                          errorBody.toLowerCase().includes('rate limit') ||
                          errorBody.toLowerCase().includes('too many requests');

      if (isWrapped429 && attempt < maxRetries) {
        const delayMs = Math.min(2000 * Math.pow(2, attempt - 1), 15000);
        console.warn(`[GeminiFetch] Detected wrapped 429 in ${response.status} (attempt ${attempt}/${maxRetries}), retrying in ${delayMs}ms...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
        continue;
      }

      // 提供更清晰的错误信息
      const errorMessage = isWrapped429
        ? `API 请求频率超限 (Rate Limit)，请稍后重试或切换其他模型`
        : `Gemini API error (${response.status}): ${errorBody.substring(0, 200)}`;
      throw new Error(errorMessage);
    }

    // 3. Transform Response Stream (Gemini -> OpenAI)
    if (response.body) {
    const reader = response.body.getReader();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          let buffer = '';
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              if (line.trim() === '') {
                 controller.enqueue(encoder.encode('\n'));
                 continue;
              }
              
              if (line.startsWith('data: ')) {
                const data = line.slice(6);
                if (data === '[DONE]') {
                  controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                  continue;
                }

                try {
                  const json = JSON.parse(data);
                  if (json.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const text = json.response.candidates[0].content.parts[0].text;
                    
                    const openAIChunk = {
                      id: 'chatcmpl-' + Date.now(),
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini-3-pro-preview',
                      choices: [
                        {
                          index: 0,
                          delta: { content: text },
                          finish_reason: null
                        }
                      ]
                    };
                    
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                  } else if (json.error) {
                     console.error('[GeminiFetch] Stream error:', json.error);
                  } else {
                    controller.enqueue(encoder.encode(line + '\n'));
                  }
                } catch (e) {
                  controller.enqueue(encoder.encode(line + '\n'));
                }
              } else {
                controller.enqueue(encoder.encode(line + '\n'));
              }
            }
          }
          
          if (buffer) {
            const line = buffer;
            if (line.startsWith('data: ')) {
              const data = line.slice(6);
              if (data !== '[DONE]') {
                try {
                  const json = JSON.parse(data);
                  if (json.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
                    const text = json.response.candidates[0].content.parts[0].text;
                    const openAIChunk = {
                      id: 'chatcmpl-' + Date.now(),
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini-3-pro-preview',
                      choices: [{ index: 0, delta: { content: text }, finish_reason: null }]
                    };
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify(openAIChunk)}\n\n`));
                  }
                } catch (e) {
                  controller.enqueue(encoder.encode(line + '\n'));
                }
              }
            } else if (line.trim() !== '') {
              controller.enqueue(encoder.encode(line + '\n'));
            }
          }
          
          controller.close();
        } catch (e) {
          controller.error(e);
        }
      }
    });

    return new Response(stream, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
    }

    // 没有 body 的情况，直接返回响应
    return response;
  }

  // 理论上不会到达这里，但为了类型安全
  throw new Error('[GeminiFetch] Unexpected: exhausted all retries without result');
};
