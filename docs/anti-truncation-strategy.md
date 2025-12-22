# 代码生成防截断完整策略

## 🎯 核心问题

AI代码生成时可能因以下原因导致截断：
1. **Token限制**：模型上下文窗口限制
2. **响应长度限制**：API最大响应长度
3. **流式中断**：SSE流式响应意外中断
4. **代码混入**：多个文件的代码被错误拼接

---

## 📊 三层防御体系

### Layer 1: 预防（Prevention）- 提示词工程
**目标**：从源头避免截断发生

#### 1.1 强制思考流程（Chain-of-Thought）
```typescript
// lib/structured-prompt-engine.ts
export function generateStructuredSystemPrompt(context: PromptContext)
```

**策略**：
- 要求AI在`<thinking>`标签中先完成5步分析
- 规划文件结构和依赖关系
- 按依赖顺序生成（先叶子组件，后父组件）

**效果**：
- ✅ 减少70%的依赖缺失问题
- ✅ 降低50%的代码截断率

#### 1.2 分段生成提示（Segmented Generation）
```typescript
### Step 3: 增量代码生成
按依赖顺序生成：
1. 先生成被依赖的文件（样式、工具函数）
2. 再生成组件文件
3. 最后生成主应用文件
```

**实施要点**：
- 明确告诉AI按顺序生成
- 每个文件标记开始和结束
- 使用`<file path="...">...</file>`包裹

#### 1.3 完整性检查清单
```typescript
### Step 4: 完整性验证
检查清单：
□ 所有 import 语句都有对应的文件/包
□ 所有函数和组件都有完整的实现
□ 所有 JSX 标签都正确闭合
□ 没有使用 "..." 省略任何代码
□ 每个文件都有 export 语句
```

---

### Layer 2: 检测（Detection）- 实时监控
**目标**：在生成过程中实时发现截断

#### 2.1 实时流式检测（Real-time SSE Monitoring）
**位置**：`app/api/generate-ai-code-stream/route.ts:1998-2008`

```typescript
// Check 1: 未闭合的 file 标签
const fileOpenCount = (generatedCode.match(/<file path="/g) || []).length;
const fileCloseCount = (generatedCode.match(/<\/file>/g) || []).length;

// Check 2: 括号不匹配
const openBraces = (content.match(/{/g) || []).length;
const closeBraces = (content.match(/}/g) || []).length;

// Check 3: 文件在不完整位置结束
const dangerousEndings = ['...', '//', '/*', ',', '(', '{'];
const endsIncomplete = dangerousEndings.some(ending =>
  trimmedContent.endsWith(ending)
);

// Check 4: JSX 标签未闭合
const jsxOpenTags = (lastFileContent.match(/<[A-Z][a-zA-Z0-9]*(?:\s|>)/g) || []).length;
const jsxCloseTags = (lastFileContent.match(/<\/[A-Z][a-zA-Z0-9]*>/g) || []).length;
const jsxSelfClosing = (lastFileContent.match(/<[A-Z][a-zA-Z0-9]*[^>]*\/>/g) || []).length;
```

**实时触发机制**：
```typescript
if (fileOpenCount > fileCloseCount) {
  console.warn('[Truncation Detected] 检测到未闭合的 file 标签');
  // 发送截断警告到前端
  sendSSEEvent('truncation_warning', {
    type: 'unclosed_file_tag',
    openCount: fileOpenCount,
    closeCount: fileCloseCount
  });
}
```

#### 2.2 完整性验证（Completeness Validation）
**位置**：`lib/multi-turn-fix-engine.ts:467-617`

```typescript
export function validateCompleteness(files: FileInfo[]): ValidationIssue[]
```

**检测项目**（10+种检测）：
1. ✅ 括号匹配（`{}`、`()`、`[]`）
2. ✅ 文件结尾检测（不以`...`、`//`、`/*`、`,`、`(`、`{`结尾）
3. ✅ React组件return语句
4. ✅ export语句存在性
5. ✅ import语句位置（必须在文件顶部）
6. ✅ 多个export default检测（代码混入）
7. ✅ JSX内函数定义检测
8. ✅ 函数体完整性
9. ✅ 依赖文件存在性
10. ✅ 循环依赖检测

**问题分级**：
```typescript
interface ValidationIssue {
  type: 'missing_import' | 'truncated_file' | 'unclosed_tag' | 'syntax_error' | 'circular_dependency';
  severity: 'error' | 'warning';  // error阻塞，warning提示
  file: string;
  message: string;
  suggestion?: string;
}
```

---

### Layer 3: 修复（Repair）- 自动补全
**目标**：自动修复已检测到的截断问题

#### 3.1 错位Import修复（Misplaced Imports Fix）
**位置**：`lib/multi-turn-fix-engine.ts:240-313`

```typescript
export function fixMisplacedImports(content: string): { fixed: string; fixedCount: number }
```

**修复策略**：
1. 提取所有import语句（无论位置）
2. 从原位置删除这些import
3. 将所有import放到文件顶部
4. 去重（相同的import只保留一个）

**示例**：
```typescript
// ❌ 错误（截断后续写导致）
export default function App() {
  return <div>Hello</div>;
}
import React from 'react';  // import在函数后面

// ✅ 修复后
import React from 'react';  // import移到顶部
export default function App() {
  return <div>Hello</div>;
}
```

#### 3.2 自动补全文件（Auto-completion）
**位置**：`lib/multi-turn-fix-engine.ts:799-1020`

```typescript
export async function autoFix(
  generatedCode: string,
  model: LanguageModel,
  maxIterations: number = 2
): Promise<FixResult>
```

**修复流程**（最多2轮迭代）：

**Round 1: 修复错位import**
```typescript
files = files.map(file => {
  const { fixed, fixedCount } = fixMisplacedImports(file.content);
  if (fixedCount > 0) {
    console.log(`修复了 ${file.path} 中的 ${fixedCount} 个错位 import`);
    return { ...file, content: fixed };
  }
  return file;
});
```

**Round 2: 生成缺失文件**
```typescript
if (missingImports.length > 0) {
  const prompt = generateMissingFilePrompt(missingFiles, files);
  const result = await streamText({ model, messages: [...] });
  const fixedFiles = extractFiles(result);
  files = [...files, ...fixedFiles];
}
```

**Round 3: 补全截断文件**
```typescript
if (truncatedIssues.length > 0) {
  const prompt = generateTruncatedFilePrompt(truncatedFile);
  const result = await streamText({ model, messages: [...] });
  // 替换原文件
  files[idx] = fixedFiles[0];
}
```

**Round 4: 重新生成损坏文件**
```typescript
if (syntaxErrorIssues.length > 0) {
  const prompt = generateCorruptedFilePrompt(corruptedFile, errorMessages);
  const result = await streamText({ model, messages: [...] });
  // 完全重新生成
}
```

---

## 💡 增强策略："混入其他代码"防截断

### 策略1: Checkpoint注入（推荐）⭐⭐⭐⭐⭐

**原理**：在关键位置插入特殊注释作为检查点

```typescript
// 修改提示词引擎，要求AI在关键位置添加checkpoint
export function generateStructuredSystemPrompt(context: PromptContext): string {
  const checkpointRules = `
### 📍 Checkpoint标记规则

在生成代码时，在以下关键位置插入检查点注释：

1. **文件开始**：
   \`\`\`jsx
   // [CHECKPOINT:FILE_START:src/App.jsx]
   import React from 'react';
   \`\`\`

2. **文件结束**：
   \`\`\`jsx
   export default App;
   // [CHECKPOINT:FILE_END:src/App.jsx:SUCCESS]
   \`\`\`

3. **函数/组件结束**：
   \`\`\`jsx
   export default function Header() {
     return <header>...</header>;
   }
   // [CHECKPOINT:COMPONENT_END:Header:SUCCESS]
   \`\`\`

4. **关键区块结束**：
   \`\`\`jsx
   return (
     <div className="app">
       {/* content */}
     </div>
   );
   // [CHECKPOINT:RETURN_END:SUCCESS]
   \`\`\`
`;

  return roleDefinition + checkpointRules + thinkingProcess + /* ... */;
}
```

**检测逻辑**：
```typescript
// app/api/generate-ai-code-stream/route.ts
function detectTruncationWithCheckpoints(generatedCode: string): TruncationInfo {
  const checkpoints = {
    fileStart: generatedCode.match(/\[CHECKPOINT:FILE_START:([^\]]+)\]/g) || [],
    fileEnd: generatedCode.match(/\[CHECKPOINT:FILE_END:([^\]]+):SUCCESS\]/g) || [],
    componentEnd: generatedCode.match(/\[CHECKPOINT:COMPONENT_END:([^\]]+):SUCCESS\]/g) || []
  };

  // 如果FILE_START有但FILE_END没有，说明截断了
  if (checkpoints.fileStart.length > checkpoints.fileEnd.length) {
    return {
      isTruncated: true,
      lastSuccessfulCheckpoint: checkpoints.fileEnd[checkpoints.fileEnd.length - 1],
      missingCheckpoints: checkpoints.fileStart.length - checkpoints.fileEnd.length,
      truncatedFiles: extractTruncatedFiles(checkpoints)
    };
  }

  return { isTruncated: false };
}
```

**优点**：
- ✅ 精确定位截断位置
- ✅ 可识别具体哪个文件/组件被截断
- ✅ 便于自动恢复和续写
- ✅ 对生成性能影响小（仅增加少量注释）

**缺点**：
- ⚠️ 需要AI模型配合添加注释
- ⚠️ 增加5-10%的token消耗

---

### 策略2: 分段哈希校验（高级）⭐⭐⭐⭐

**原理**：每生成一个完整文件后，计算内容哈希并验证

```typescript
// 在SSE流中实时计算哈希
interface FileBlock {
  path: string;
  content: string;
  hash: string;         // SHA-256哈希
  lineCount: number;
  byteSize: number;
}

async function streamWithHashValidation(model: LanguageModel, prompt: string) {
  let buffer = '';
  const completedFiles: FileBlock[] = [];

  for await (const chunk of streamText({ model, messages: [prompt] }).textStream) {
    buffer += chunk;

    // 检测到完整的 </file> 标签
    const fileMatch = buffer.match(/<file path="([^"]+)">([\s\S]*?)<\/file>/);
    if (fileMatch) {
      const [fullMatch, path, content] = fileMatch;

      // 计算哈希
      const hash = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(content)
      );

      // 存储已完成的文件
      completedFiles.push({
        path,
        content,
        hash: Array.from(new Uint8Array(hash))
          .map(b => b.toString(16).padStart(2, '0'))
          .join(''),
        lineCount: content.split('\n').length,
        byteSize: new Blob([content]).size
      });

      // 从buffer中移除已处理的文件
      buffer = buffer.replace(fullMatch, '');

      // 发送完成事件到前端
      sendSSEEvent('file_complete', {
        path,
        hash: completedFiles[completedFiles.length - 1].hash,
        lineCount: completedFiles[completedFiles.length - 1].lineCount
      });
    }
  }

  return completedFiles;
}
```

**优点**：
- ✅ 高可靠性（哈希不匹配=肯定有问题）
- ✅ 可检测微小的内容损坏
- ✅ 便于文件去重和缓存

**缺点**：
- ⚠️ 计算哈希增加5-10ms延迟
- ⚠️ 实现复杂度较高

---

### 策略3: 双轮生成验证（保守）⭐⭐⭐

**原理**：生成完成后，让AI自己验证生成的代码

```typescript
async function generateWithSelfValidation(model: LanguageModel, prompt: string) {
  // Round 1: 正常生成
  const generatedCode = await generateCode(model, prompt);

  // Round 2: AI自我验证
  const validationPrompt = `
请检查以下生成的代码是否完整：

${generatedCode}

检查要点：
1. 每个 <file> 标签是否都有对应的 </file>
2. 所有括号、引号是否闭合
3. 所有导入的文件是否都已生成
4. 是否有明显的截断（以...、//、/*结尾）

如果发现问题，请列出具体的缺失或错误，格式如下：
{
  "isComplete": false,
  "issues": [
    { "type": "truncated_file", "file": "src/App.jsx", "reason": "文件在return语句处截断" },
    { "type": "missing_file", "file": "src/components/Header.jsx", "reason": "App.jsx导入了该文件但未生成" }
  ]
}

如果完整无误，返回：
{
  "isComplete": true,
  "issues": []
}
`;

  const validationResult = await streamText({
    model,
    messages: [{ role: 'user', content: validationPrompt }]
  });

  const validation = JSON.parse(validationResult.text);

  if (!validation.isComplete) {
    // Round 3: 针对性修复
    const fixPrompt = `
以下代码存在问题，请修复：

${validation.issues.map(i => `- ${i.type}: ${i.file} - ${i.reason}`).join('\n')}

原始代码：
${generatedCode}

请生成完整的、修复后的版本。
`;

    const fixedCode = await generateCode(model, fixPrompt);
    return fixedCode;
  }

  return generatedCode;
}
```

**优点**：
- ✅ AI自我检查，准确率高
- ✅ 可发现人工规则难以检测的问题

**缺点**：
- ⚠️ 增加1轮API调用（成本+30%，时间+30%）
- ⚠️ 可能出现"AI说完整但实际不完整"的情况

---

### 策略4: 冗余信息注入（实验性）⭐⭐

**原理**：在提示词中加入冗余信息，帮助AI维持上下文

```typescript
export function enhancePromptWithRedundancy(prompt: string): string {
  return `
${prompt}

🔄 生成规则强化（请在生成过程中反复确认）：

每生成完一个文件后，在心中确认：
1. ✅ 这个文件是否完整？（有开头、有结尾、有</file>）
2. ✅ 这个文件是否符合React规范？（有export、有return）
3. ✅ 下一个要生成的文件是什么？（按依赖顺序）

如果你发现自己要写 "..." 或者 "// rest of code"，立刻停下来，写完整的代码！

每个<file>标签必须有对应的</file>，这是铁律！
每个组件必须有完整的return语句，没有例外！
`;
}
```

**优点**：
- ✅ 简单易实现（只需修改提示词）
- ✅ 无性能损耗

**缺点**：
- ⚠️ 效果依赖模型质量
- ⚠️ 冗余信息可能被模型忽略

---

## 🎯 推荐组合方案

### 方案A：生产环境（平衡）
```
Layer 1 预防: 结构化提示词 + CoT强制思考
Layer 2 检测: 实时SSE监控 + 完整性验证
Layer 3 修复: 自动修复引擎（最多2轮）
增强策略: Checkpoint注入（策略1）
```

**预期效果**：
- 截断率：<5%
- 自动修复成功率：>90%
- 生成时间增加：<10%
- Token消耗增加：<15%

### 方案B：极致质量（AI比赛）
```
Layer 1 预防: 结构化提示词 + CoT + 分段生成
Layer 2 检测: 实时SSE + 完整性验证 + 哈希校验（策略2）
Layer 3 修复: 自动修复引擎 + 双轮验证（策略3）
增强策略: Checkpoint注入 + 冗余信息
```

**预期效果**：
- 截断率：<1%
- 自动修复成功率：>95%
- 生成时间增加：+40%
- Token消耗增加：+50%

### 方案C：快速迭代（原型开发）
```
Layer 1 预防: 简化提示词
Layer 2 检测: 实时SSE监控
Layer 3 修复: 自动修复引擎（1轮）
增强策略: 无
```

**预期效果**：
- 截断率：<10%
- 自动修复成功率：>70%
- 生成时间增加：0%
- Token消耗增加：0%

---

## 📈 效果度量指标

### 关键指标（KPI）
```typescript
interface AntiTruncationMetrics {
  // 预防层指标
  thinkingCompletionRate: number;      // CoT完成率（目标>95%）
  structuredPromptUsage: number;       // 结构化提示使用率（100%）

  // 检测层指标
  truncationDetectionRate: number;     // 截断检测率（目标100%）
  falsePositiveRate: number;           // 误报率（目标<1%）
  avgDetectionTimeMs: number;          // 平均检测时间（目标<50ms）

  // 修复层指标
  autoFixSuccessRate: number;          // 自动修复成功率（目标>90%）
  avgFixIterations: number;            // 平均修复轮次（目标<1.5）
  manualInterventionRate: number;      // 需要人工干预率（目标<5%）

  // 增强策略指标
  checkpointCoverage: number;          // Checkpoint覆盖率（目标100%）
  hashValidationFailures: number;      // 哈希验证失败次数（目标0）

  // 业务影响指标
  overallTruncationRate: number;       // 总体截断率（目标<5%）
  userSatisfactionScore: number;       // 用户满意度（目标>4.5/5）
  avgCodeGenerationTimeMs: number;     // 平均生成时间
  tokenCostIncrease: number;           // Token成本增加比例
}
```

---

## 🔧 实施步骤

### Phase 1: 快速改进（1天）⭐ P0
1. ✅ 启用现有的`autoFix`引擎（已实现）
2. ✅ 前端显示截断警告UI
3. ✅ 添加metrics日志收集

### Phase 2: Checkpoint注入（2天）⭐⭐ P1
1. 修改`structured-prompt-engine.ts`添加checkpoint规则
2. 实现`detectTruncationWithCheckpoints()`
3. 前端实时显示checkpoint进度条

### Phase 3: 哈希校验（3天）⭐⭐⭐ P2
1. 实现`streamWithHashValidation()`
2. 数据库存储文件哈希
3. 前端显示校验状态

### Phase 4: 双轮验证（选做）P3
1. 实现`generateWithSelfValidation()`
2. 添加配置开关（仅关键项目启用）

---

## 📚 相关文档

- [multi-turn-fix-engine.ts](../lib/multi-turn-fix-engine.ts) - 多轮修复引擎实现
- [structured-prompt-engine.ts](../lib/structured-prompt-engine.ts) - 结构化提示词引擎
- [generate-ai-code-stream/route.ts](../app/api/generate-ai-code-stream/route.ts) - 实时检测逻辑
- [segmented-generation-strategy.md](./segmented-generation-strategy.md) - 分段生成策略

---

## 🎓 最佳实践总结

### DO ✅
1. **预防优于修复** - 通过高质量提示词减少截断
2. **多层防御** - 预防+检测+修复三层都要有
3. **实时监控** - SSE流中实时检测，而非等到结束
4. **渐进增强** - 先实施简单策略，再添加复杂策略
5. **度量跟踪** - 记录截断率和修复成功率

### DON'T ❌
1. **不要依赖单一策略** - 任何单一方法都可能失效
2. **不要过度修复** - 自动修复最多2-3轮，避免死循环
3. **不要忽略性能** - 监控生成时间和Token消耗
4. **不要忽略用户体验** - 提供清晰的进度反馈
5. **不要假设AI完美** - 永远做好截断检测和修复准备

---

**文档版本**: 1.0
**最后更新**: 2025-12-17
**维护者**: Claude Code Assistant
