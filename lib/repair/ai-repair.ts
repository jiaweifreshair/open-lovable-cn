/**
 * AI自动修复服务
 * 使用OpenAI API修复前端代码错误
 */

import { openai } from '@ai-sdk/openai';
import { generateText } from 'ai';
import { ParsedError } from './error-parser';

/**
 * 自动修复前端代码错误
 */
export async function autoRepairCode(
  error: ParsedError,
  fileContent: string
): Promise<string | null> {
  try {
    const systemPrompt = `你是一个专业的代码修复助手。你的任务是修复代码中的语法错误。

要求：
1. 只修复错误，不要添加额外功能
2. 保持代码风格一致
3. 返回完整的修复后的代码
4. 使用\`\`\`javascript或\`\`\`jsx包裹代码
5. 不要添加任何解释，只返回代码`;

    const userPrompt = `请修复以下代码中的错误：

错误类型：${error.errorType}
错误位置：第${error.line}行，第${error.column}列
错误信息：${error.message}

原始代码：
\`\`\`javascript
${fileContent}
\`\`\`

请返回修复后的完整代码。`;

    const { text } = await generateText({
      model: openai('gpt-4o-mini'),
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.1
    });

    // 提取代码块
    const codeBlockPattern = /```(?:javascript|jsx|typescript|tsx)?\s*\n([\s\S]*?)\n```/;
    const match = text.match(codeBlockPattern);

    if (match) {
      return match[1].trim();
    }

    // 如果没有代码块，返回整个响应
    return text.trim();

  } catch (error) {
    console.error('AI修复失败:', error);
    return null;
  }
}
