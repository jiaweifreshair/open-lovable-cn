import { NextRequest, NextResponse } from 'next/server';

/**
 * Ingenio后端适配器端点
 *
 * 功能:将Ingenio后端的请求格式转换为OpenLovable-CN的generate-ai-code-stream格式
 *
 * Ingenio请求格式:
 * {
 *   "userMessage": "用户需求描述",
 *   "model": "ai模型名称"
 * }
 *
 * OpenLovable-CN格式:
 * {
 *   "prompt": "用户需求描述",
 *   "model": "模型名称",
 *   "context": { ... },
 *   "isEdit": false
 * }
 */
export async function POST(request: NextRequest) {
  try {
    // 解析Ingenio后端的请求
    const { userMessage, model = 'deepseek-v3' } = await request.json();

    console.log('[generate-ai-code] Ingenio适配器收到请求');
    console.log('[generate-ai-code] - userMessage:', userMessage);
    console.log('[generate-ai-code] - model:', model);

    if (!userMessage) {
      return NextResponse.json({
        success: false,
        error: 'userMessage参数不能为空'
      }, { status: 400 });
    }

    // 转换为OpenLovable-CN的格式并调用内部API
    const openLovableRequest = {
      prompt: userMessage,
      model: model,
      context: {
        sandboxId: null, // 首次生成,无沙箱ID
        currentFiles: {},
        structure: null
      },
      isEdit: false // 首次生成,非编辑模式
    };

    console.log('[generate-ai-code] 转发到generate-ai-code-stream端点');

    // 调用内部的generate-ai-code-stream API
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3001';
    const response = await fetch(`${baseUrl}/api/generate-ai-code-stream`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(openLovableRequest),
    });

    if (!response.ok) {
      console.error('[generate-ai-code] generate-ai-code-stream返回错误:', response.status);
      return NextResponse.json({
        success: false,
        error: `AI代码生成失败: ${response.statusText}`
      }, { status: response.status });
    }

    // 由于generate-ai-code-stream返回的是SSE流,我们需要处理流式响应
    // 这里收集完整响应后再返回给Ingenio
    const reader = response.body?.getReader();
    if (!reader) {
      return NextResponse.json({
        success: false,
        error: '无法读取AI生成响应'
      }, { status: 500 });
    }

    const decoder = new TextDecoder();
    let generatedCode = '';
    let sandboxId = '';
    let previewUrl = '';
    let explanation = '';

    // 读取SSE流
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            const data = JSON.parse(line.slice(6));

            // 收集完成事件的数据
            if (data.type === 'complete') {
              generatedCode = data.generatedCode || '';
              explanation = data.explanation || '';
              console.log('[generate-ai-code] 代码生成完成,文件数:', data.files);
            }

            // 收集沙箱相关信息
            if (data.sandboxId) {
              sandboxId = data.sandboxId;
            }
            if (data.url) {
              previewUrl = data.url;
            }
          } catch (parseError) {
            // 忽略解析错误,继续处理下一行
          }
        }
      }
    }

    console.log('[generate-ai-code] 响应收集完成');
    console.log('[generate-ai-code] - sandboxId:', sandboxId);
    console.log('[generate-ai-code] - previewUrl:', previewUrl);
    console.log('[generate-ai-code] - 代码长度:', generatedCode.length);

    // 返回Ingenio期望的格式
    return NextResponse.json({
      success: true,
      sandboxId: sandboxId,
      previewUrl: previewUrl,
      generatedCode: generatedCode,
      explanation: explanation,
      message: '前端原型生成成功'
    });

  } catch (error) {
    console.error('[generate-ai-code] 适配器错误:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
