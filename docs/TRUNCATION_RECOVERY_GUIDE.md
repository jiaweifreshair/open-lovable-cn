# AI代码生成截断检测和自动恢复指南

## 概述

本文档说明Firecrawl如何自动检测和修复AI生成代码中的截断问题，以及如何调试相关问题。

---

## 问题背景

### 典型错误
```
[plugin:vite:esbuild] Transform failed with 1 error:
/home/user/app/src/components/Hero.jsx:92:37: ERROR: Unexpected end of file
```

### 根本原因
1. AI模型token限制导致代码生成被截断
2. 流式输出中断或网络问题
3. 文件标签未正确闭合
4. 代码语法不完整（括号、标签未闭合）

---

## 自动检测机制

### 检测维度（5个）

#### 1. 大括号匹配 `{}`
```javascript
// ❌ 截断示例
function Component() {
  return (
    <div>
      // 缺少闭合括号
```

**检测规则**：
- `braceDiff > 2` → 触发警告
- 无closing tag + `braceDiff > 0` → 立即触发恢复

#### 2. 圆括号匹配 `()`
```javascript
// ❌ 截断示例
const result = calculateTotal(
  items.map(item =>
    // 缺少闭合括号
```

**检测规则**：
- `parenDiff > 2` → 触发警告
- 无closing tag + `parenDiff > 0` → 立即触发恢复

#### 3. 方括号匹配 `[]`
```javascript
// ❌ 截断示例
const data = [
  { id: 1, name: 'Alice' },
  { id: 2,
  // 缺少闭合括号
```

**检测规则**：
- `bracketDiff > 2` → 触发警告

#### 4. JSX标签匹配 `<Component>`
```jsx
// ❌ 截断示例
return (
  <div className="container">
    <span className="text
    // 缺少闭合标签
```

**检测规则**：
- `jsxTagDiff > 1` → 触发警告
- 仅检测 `.jsx` 和 `.tsx` 文件

#### 5. 悬空代码（Dangling Syntax）
```javascript
// ❌ 截断示例
const config = {
  apiUrl: 'https://api.example.com',
  timeout: 5000,  // ← 不应该是文件结尾
```

**检测规则**：
- 以 `,`, `{`, `(`, `<span`, `<div` 结尾
- 变量赋值无值：`const foo = `

---

## 自动恢复流程

### Step 1: 检测阶段
```typescript
// 解析生成的代码
const fileRegex = /<file path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;

// 检查5个维度
- 大括号匹配
- 圆括号匹配
- 方括号匹配
- JSX标签匹配
- 悬空代码
```

### Step 2: 触发恢复
```typescript
// 条件：truncationWarnings.length > 0 && enableTruncationRecovery
if (truncationWarnings.length > 0 && appConfig.codeApplication.enableTruncationRecovery) {
  // 自动调用AI模型补全截断文件
}
```

### Step 3: 补全文件
```typescript
const completionPrompt = `Complete the following file that was truncated.
Provide the FULL file content.

File: ${filePath}
Original request: ${prompt}

Provide the complete file content without any truncation.
Include all necessary imports, complete all functions, and close all tags properly.`;
```

### Step 4: 替换原文件
```typescript
generatedCode = generatedCode.replace(
  filePattern,
  `<file path="${filePath}">\n${cleanContent}\n</file>`
);
```

---

## 配置说明

### 启用/禁用自动恢复
```typescript
// config/app.config.ts
codeApplication: {
  enableTruncationRecovery: true,  // 设为false禁用
  maxTruncationRecoveryAttempts: 3,
}
```

### 调整检测阈值
```typescript
// app/api/generate-ai-code-stream/route.ts

// 当前阈值（严格模式）
else if (braceDiff > 2 || parenDiff > 2 || jsxTagDiff > 1) {
  // 触发警告
}

// 如需放宽，可改为：
else if (braceDiff > 3 || parenDiff > 3 || jsxTagDiff > 2) {
  // 触发警告
}
```

---

## 调试日志

### 关键日志标识

| Emoji | 含义 | 示例 |
|-------|------|------|
| 🚨 | 检测到截断 | `🚨 Truncation detected, attempting to fix` |
| ⚠️ | 具体警告 | `⚠️ Warning 1: File src/Hero.jsx is truncated` |
| 🔄 | 尝试恢复 | `🔄 Attempting to regenerate 2 truncated files` |
| 📝 | 处理文件 | `📝 Processing file: src/components/Header.jsx` |
| ✅ | 恢复成功 | `✅ Successfully completed src/Hero.jsx` |
| ❌ | 恢复失败 | `❌ Failed to complete src/Hero.jsx` |
| 📊 | 统计信息 | `📊 Total warnings: 3`, `📊 Completed content length: 1234 chars` |

### 查看日志
```bash
# 实时查看日志（开发环境）
pnpm dev 2>&1 | grep "generate-ai-code-stream"

# 筛选截断相关日志
pnpm dev 2>&1 | grep -E "(🚨|⚠️|🔄|✅|❌)"
```

---

## 测试验证

### 手动触发测试

#### 1. 创建截断测试
在Firecrawl界面输入：
```
克隆 https://www.jet-bay.com/ 的设计，
但故意生成超长代码导致截断
```

#### 2. 检查控制台
观察是否出现：
```
[generate-ai-code-stream] 🚨 Truncation detected, attempting to fix: [...]
[generate-ai-code-stream] 📊 Total warnings: 2
[generate-ai-code-stream] ⚠️  Warning 1: File src/Hero.jsx is truncated (missing closing tag, braces: 3, parens: 1, JSX tags: 2)
[generate-ai-code-stream] 🔄 Attempting to regenerate 1 truncated files: ['src/Hero.jsx']
[generate-ai-code-stream] 📝 Processing file: src/Hero.jsx
[generate-ai-code-stream] ✅ Successfully completed src/Hero.jsx
[generate-ai-code-stream] 📊 Completed content length: 2456 chars
```

#### 3. 验证Vite构建
```bash
# 应该无报错
pnpm dev
```

---

## 常见问题

### Q1: 自动恢复失败怎么办？
**A**: 检查以下几点：
1. `enableTruncationRecovery` 是否为 `true`
2. AI模型是否可用（检查API密钥）
3. 查看错误日志中的 `❌ Failed to complete` 信息
4. 尝试手动编辑修复

### Q2: 如何临时禁用自动恢复？
**A**:
```typescript
// config/app.config.ts
codeApplication: {
  enableTruncationRecovery: false,  // 临时禁用
}
```

### Q3: 检测过于敏感导致误报？
**A**: 调整阈值：
```typescript
// 从 braceDiff > 2 改为 braceDiff > 3
else if (braceDiff > 3 || parenDiff > 3 || jsxTagDiff > 2) {
  truncationWarnings.push(...);
}
```

### Q4: 如何查看截断统计？
**A**:
```bash
# 统计最近10次生成的截断次数
pnpm dev 2>&1 | grep "🚨 Truncation detected" | tail -10
```

---

## 性能影响

### 额外开销
- **检测**：~10-20ms（正则表达式匹配）
- **恢复**：~2-5秒（调用AI模型API）

### 优化建议
1. 仅在生成完成后检测（不影响流式输出）
2. 最多恢复3次（避免无限循环）
3. 并行恢复多个文件（如果有多个截断）

---

## 未来改进

### 计划中的功能
- [ ] 使用AST解析代替正则表达式（更准确）
- [ ] 支持自定义检测规则配置
- [ ] 添加截断统计面板（Dashboard）
- [ ] 支持Python/Java等其他语言的截断检测
- [ ] 机器学习预测截断风险

---

## 相关文件

| 文件 | 说明 |
|------|------|
| `app/api/generate-ai-code-stream/route.ts` | 主要检测和恢复逻辑 |
| `lib/multi-turn-fix-engine.ts` | 多轮修复引擎（备用） |
| `config/app.config.ts` | 配置文件 |
| `docs/TRUNCATION_RECOVERY_GUIDE.md` | 本文档 |

---

## 贡献

如果发现新的截断模式未被检测到，请：
1. 提交Issue附带截断的代码样本
2. 说明AI模型和生成提示词
3. 提供完整的错误日志

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.0 | 2025-12-07 | 增强检测（5个维度）+ 详细日志 |
| 1.0 | 2024-XX-XX | 初始版本（仅检测大括号） |

---

**最后更新**: 2025-12-07
**维护者**: Claude Code Team
