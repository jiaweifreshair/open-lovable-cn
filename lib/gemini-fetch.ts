
export const geminiFetch = async (url: string | Request | URL, options?: RequestInit) => {
  const requestUrl = url.toString();
  
  // Only intercept requests to the Gemini proxy
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

  // 2. Call Original Fetch
  const response = await fetch(url, newOptions);

  // 3. Transform Response Stream (Gemini -> OpenAI)
  if (response.ok && response.body) {
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

  return response;
};
