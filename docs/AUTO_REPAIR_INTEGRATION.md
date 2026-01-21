# Open-Lovable-CN 自动修复系统集成指南

## 概述

本文档说明如何在Open-Lovable-CN中使用自动修复系统，实现前端代码语法错误的自动检测和修复。

## 已完成的工作

### 1. 核心组件实现 ✅

**error-parser.ts** (`lib/repair/error-parser.ts`)
- 解析Vite/Babel编译错误信息
- 提取文件路径、行号、列号、错误消息
- 支持Babel语法错误（如Unterminated string constant）

**ai-repair.ts** (`lib/repair/ai-repair.ts`)
- 使用OpenAI API实现AI自动修复
- 使用Vercel AI SDK（`@ai-sdk/openai`）
- 低温度（0.1）确保输出稳定
- 智能提取修复后的代码

**babel-error-fixer.ts** (`lib/repair/babel-error-fixer.ts`)
- 封装Babel错误修复逻辑
- 集成error-parser和ai-repair
- 返回修复后的文件列表和问题列表
- 可直接集成到multi-turn-fix-engine

## 架构说明

### 正确的架构（已实现）

```
Ingenio (Java后端)
  ↓ 调用生成API
Open-Lovable-CN (Node.js服务)
  ↓ 生成代码
  ↓ 沙箱编译
  ↓ 检测错误
  ↓ AI自动修复（内置）
  ↓ 重新编译
  ↓ 返回成功结果
Ingenio
  ↓ 接收已修复的代码
```

**优势**：
1. 职责清晰：Open-Lovable-CN负责完整的生成+验证+修复闭环
2. 减少耦合：Ingenio不需要了解前端错误的细节
3. 性能更好：修复在沙箱所在的服务中进行，减少网络传输

## 使用方法

### 方式1：使用封装好的修复器（推荐）

```typescript
import { fixBabelSyntaxErrors } from '@/lib/repair/babel-error-fixer';
import type { FileInfo } from '@/lib/multi-turn-fix-engine';

// 当沙箱编译失败时
const files: FileInfo[] = [
  { path: 'src/pages/Login.jsx', content: '...' },
  // ... 其他文件
];

const babelErrorOutput = `
[plugin:vite:react-babel] /home/user/app/src/pages/Login.jsx: Unterminated string constant. (7:36)
`;

// 自动修复
const { fixedFiles, issues } = await fixBabelSyntaxErrors(files, babelErrorOutput);

if (issues.length === 0) {
  console.log('修复成功！');
  // 使用 fixedFiles 继续编译
} else {
  console.log('修复失败:', issues);
}
```

### 方式2：手动使用各个组件

```typescript
import { parseFrontendError } from '@/lib/repair/error-parser';
import { autoRepairCode } from '@/lib/repair/ai-repair';

// 1. 解析错误
const error = parseFrontendError(errorOutput);

if (error) {
  // 2. 查找对应文件
  const targetFile = files.find(f => f.path === error.filePath);

  if (targetFile) {
    // 3. AI自动修复
    const fixedCode = await autoRepairCode(error, targetFile.content);

    if (fixedCode) {
      // 4. 更新文件
      targetFile.content = fixedCode;
    }
  }
}
```

### 集成到代码生成流程（实际使用示例）

在 `generate-ai-code-stream/route.ts` 中集成自动修复：

```typescript
// app/api/generate-ai-code-stream/route.ts

import { fixBabelSyntaxErrors } from '@/lib/repair/babel-error-fixer';
import { extractFiles } from '@/lib/multi-turn-fix-engine';

export async function POST(request: Request) {
  // ... 现有的代码生成逻辑

  // 生成代码后
  let files = extractFiles(generatedCode);

  // 如果有Babel错误信息（从前端沙箱返回）
  if (babelErrorOutput) {
    console.log('[generate] 检测到Babel错误，尝试AI修复...');

    const { fixedFiles, issues } = await fixBabelSyntaxErrors(files, babelErrorOutput);

    if (issues.length === 0) {
      console.log('[generate] AI修复成功！');
      files = fixedFiles;
    } else {
      console.log('[generate] AI修复失败:', issues);
    }
  }

  // 返回修复后的文件
  return files;
}
```

### 在multi-turn-fix-engine中集成（高级用法）

如果需要在现有的多轮修复引擎中集成Babel错误修复：

```typescript
// lib/multi-turn-fix-engine.ts

import { fixBabelSyntaxErrors } from './repair/babel-error-fixer';

export async function autoFix(
  generatedCode: string,
  model: LanguageModel,
  babelErrorOutput?: string  // 新增参数
): Promise<FixResult> {
  let files = extractFiles(generatedCode);

  // 如果有Babel错误，先尝试AI修复
  if (babelErrorOutput) {
    const { fixedFiles, issues } = await fixBabelSyntaxErrors(files, babelErrorOutput);

    if (issues.length === 0) {
      files = fixedFiles;
    }
  }

  // ... 继续现有的修复逻辑
}
```

## 配置说明

### 环境变量

自动修复使用OpenAI API，需要配置以下环境变量：

```bash
# .env.local
OPENAI_API_KEY=sk-xxx
```

如果使用OpenAI兼容的API（如DeepSeek），可以配置：

```bash
OPENAI_API_BASE_URL=https://api.deepseek.com/v1
OPENAI_API_KEY=sk-xxx
```

### 修复参数调整

在 `lib/repair/ai-repair.ts` 中可以调整以下参数：

```typescript
const { text } = await generateText({
  model: openai('gpt-4o-mini'),  // 模型选择
  temperature: 0.1,               // 温度（0.0-1.0）
  maxTokens: 4096                 // 最大token数
});
```

## 测试验证

### 单元测试

创建测试文件 `lib/repair/__tests__/error-parser.test.ts`：

```typescript
import { parseFrontendError } from '../error-parser';

describe('parseFrontendError', () => {
  it('should parse Babel unterminated string error', () => {
    const errorOutput = `
[plugin:vite:react-babel] /home/user/app/src/pages/TeacherLogin.jsx: Unterminated string constant. (7:36)
    `;

    const result = parseFrontendError(errorOutput);

    expect(result).not.toBeNull();
    expect(result?.errorType).toBe('BABEL_SYNTAX_ERROR');
    expect(result?.filePath).toBe('src/pages/TeacherLogin.jsx');
    expect(result?.line).toBe(7);
    expect(result?.column).toBe(36);
  });
});
```

### 集成测试

```bash
# 启动Open-Lovable-CN
npm run dev

# 触发生成包含语法错误的代码
# 观察日志确认自动修复流程被触发
```

## 使用示例

### 场景：修复字符串未闭合错误

**错误输入**：
```javascript
const [email, setEmail] = useState(')
const [password, setPassword] = useState(')
```

**错误信息**：
```
[plugin:vite:react-babel] /home/user/app/src/pages/TeacherLogin.jsx: Unterminated string constant. (7:36)
```

**自动修复后**：
```javascript
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
```

## 监控和日志

### 关键日志

```
检测到前端语法错误，尝试自动修复...
自动修复成功: file=src/pages/TeacherLogin.jsx
自动修复后编译成功！
```

### 失败日志

```
无法解析错误信息，跳过自动修复
AI未能生成有效的修复代码
AI修复失败: [错误详情]
```

## 性能影响

- **首次修复时间**：5-10秒（AI推理时间）
- **重新编译时间**：5-10秒（Vite编译）
- **总体影响**：增加10-20秒（相比手动修复节省大量时间）

## 限制和注意事项

1. **仅支持前端语法错误**：当前版本仅支持Babel/Vite错误
2. **最多重试3次**：避免无限循环（需要在集成时实现）
3. **依赖AI质量**：修复质量取决于AI模型能力
4. **需要API Key**：需要配置OpenAI API Key

## ��续优化

### 短期优化（1-2周）

1. 支持更多错误类型（TypeScript类型错误、ESLint错误）
2. 添加修复历史记录和回滚功能
3. 优化AI提示词提高修复成功率
4. 实现重试机制（最多3次）

### 长期优化（1-3个月）

1. 实现多轮对话修复（AI与用户交互）
2. 建立错误修复知识库（常见错误模式）
3. 集成到CI/CD流程
4. 支持自定义修复规则

## 与Ingenio的关系

**重要**：Ingenio后端中的LangChain4j修复代码应该被移除或标记为废弃，因为：

1. Open-Lovable-CN现在负责完整的前端代码生成和修复
2. Ingenio只需要调用Open-Lovable-CN的API并接收结果
3. 这样架构更清晰，职责更明确

## 相关文档

- [Vercel AI SDK文档](https://sdk.vercel.ai/docs)
- [OpenAI API文档](https://platform.openai.com/docs)
- [Open-Lovable-CN架构文档](./ARCHITECTURE.md)

## 变更历史

| 日期 | 版本 | 变更内容 | 作者 |
|-----|------|---------|------|
| 2026-01-19 | 1.0.0 | 初始版本：实现前端语法错误自动修复 | Ingenio Team |

---

**维护者**：Ingenio DevOps Team
**最后更新**：2026-01-19
**状态**：✅ 核心组件已实现，待集成到沙箱执行API
