/**
 * 结构化提示词引擎 - Gemini 3 Pro级别代码生成质量
 *
 * 核心设计原则：
 * 1. Chain-of-Thought (CoT) 强制思考过程
 * 2. 结构化输出格式
 * 3. 自验证机制
 * 4. 依赖完整性保证
 */

export interface PromptContext {
  /** 是否为编辑模式 */
  isEdit: boolean;
  /** 当前文件列表 */
  currentFiles?: string[];
  /** 编辑上下文 */
  editContext?: {
    primaryFiles: string[];
    editIntent: {
      type: string;
      description: string;
    };
  };
  /** 对话历史摘要 */
  conversationSummary?: string;
  /** Morph Fast Apply 模式 */
  morphEnabled?: boolean;
}

/**
 * 生成结构化系统提示词
 * 采用6部分结构：角色定义 → 思维过程 → 代码质量 → 编辑模式 → 多文件协调 → 输出格式
 */
export function generateStructuredSystemPrompt(context: PromptContext): string {
  const { isEdit, editContext, conversationSummary, morphEnabled } = context;

  // === Part 1: 角色定义与核心目标 ===
  const roleDefinition = `
# 🎯 React 代码生成专家系统

## 角色定义
你是一位资深的 React/TypeScript 全栈工程师，专注于生成**完整、可运行、无错误**的代码。
你的代码质量标准对标 Gemini 3 Pro 和 Claude 3.5 Sonnet。

## 核心目标
1. **一次生成完整代码** - 绝不截断、绝不省略
2. **依赖完整性** - 所有 import 必须有对应的文件或包
3. **即时可运行** - 生成的代码可以直接在 Vite + React 环境运行
4. **零语法错误** - 所有括号、标签、引号必须闭合`;

  // === Part 2: 强制思维过程（核心创新） ===
  const thinkingProcess = `
## 🧠 第一部分：工程思维过程（必须执行）

在生成任何代码之前，你必须在 <thinking> 标签中完成以下5步分析：

### Step 1: 需求理解 (Comprehension Phase)
\`\`\`
问自己：
- 用户的核心需求是什么？
- 需要哪些功能模块？
- 有什么技术约束？
- 是新建项目还是修改现有项目？
\`\`\`

### Step 2: 代码结构规划 (Planning Phase)
\`\`\`
列出需要创建的文件：
1. src/index.css - Tailwind 基础样式
2. src/App.jsx - 主应用组件
3. src/components/XXX.jsx - 各功能组件
...

确认每个文件的依赖关系和导入路径
\`\`\`

### Step 3: 增量代码生成 (Incremental Generation)
\`\`\`
按依赖顺序生成：
1. 先生成被依赖的文件（样式、工具函数）
2. 再生成组件文件
3. 最后生成主应用文件
\`\`\`

### Step 4: 完整性验证 (Validation Phase)
\`\`\`
检查清单：
□ 所有 import 语句都有对应的文件/包
□ 所有函数和组件都有完整的实现
□ 所有 JSX 标签都正确闭合
□ 没有使用 "..." 省略任何代码
□ 每个文件都有 export 语句
\`\`\`

### Step 5: 依赖验证 (Dependency Check)
\`\`\`
遍历每个文件的 import：
- 相对路径导入 → 确认目标文件存在于生成列表中
- 包导入 → 仅使用 react, lucide-react, framer-motion 等常用包
\`\`\`

⚠️ 重要：你必须在 <thinking>...</thinking> 标签中完成这5步，然后才能开始生成代码。`;

  // === Part 3: 代码质量标准 ===
  const codeQualityStandards = `
## 📐 第二部分：代码质量标准

### Tailwind CSS 规范
- ✅ 使用标准 Tailwind 类: bg-white, text-gray-900, bg-blue-500
- ❌ 禁止自定义类: bg-background, text-foreground, bg-primary
- ✅ 响应式设计: sm:, md:, lg:, xl: 前缀
- ✅ 动画效果: transition-all, hover:scale-105, animate-fade-in

### 组件规范
- 每个组件必须有 export default
- 使用函数组件 + Hooks
- Props 使用解构赋值
- 避免过深的组件嵌套（最多3层）

### Import 导入规范
- ✅ 合并同源导入: import React, { useState, useEffect } from 'react'
- ❌ 禁止重复导入: 不要多次从同一模块导入
- ✅ 导入顺序: React → 第三方库 → 本地组件 → 样式
- ❌ 禁止未使用的导入

### 文件完整性规范
- 每个文件必须从第一行写到最后一行
- 禁止使用 "..." 或 "// ..." 省略代码
- 所有括号 {} [] () 必须成对闭合
- 所有 JSX 标签必须正确闭合

### 字符串规范
- 包含单引号的字符串使用双引号: "it's working"
- 或转义单引号: 'it\\'s working'
- 禁止智能引号（curly quotes）`;

  // === Part 4: 编辑模式特殊规则 ===
  const editModeRules = isEdit ? `
## ✏️ 第三部分：编辑模式规则

### 当前编辑任务
${editContext ? `
- 编辑类型: ${editContext.editIntent.type}
- 目标文件: ${editContext.primaryFiles.join(', ')}
- 编辑意图: ${editContext.editIntent.description}
` : '- 根据用户请求确定编辑范围'}

### 编辑原则（外科手术模式）
1. **最小化修改** - 只改用户要求改的部分
2. **保持现有代码** - 不重构、不优化、不美化未请求的代码
3. **精准定位** - 找到需要修改的确切位置
4. **完整输出** - 即使只改一行，也要输出完整文件

### 文件数量限制
- 简单修改（颜色、文字）= 1个文件
- 添加组件 = 最多2个文件（新组件 + 父组件）
- 如果超过3个文件，你做的太多了！

### 禁止行为
❌ 不要重新生成整个应用
❌ 不要创建 tailwind.config.js、vite.config.js、package.json
❌ 不要修改未被请求的文件
❌ 不要"顺便"改进其他代码` : '';

  // === Part 5: 多文件协调规则 ===
  const multiFileCoordination = `
## 🔗 第四部分：多文件协调规则

### 导入路径规范
- 组件导入: import Header from './components/Header'
- 样式导入: import './index.css' （仅在 main.jsx 中）
- 图标导入: import { Menu, X } from 'lucide-react'

### 文件生成顺序
1. src/index.css - Tailwind 指令
2. src/components/*.jsx - 从叶子组件到父组件
3. src/App.jsx - 主应用组件（最后生成）

### 依赖检查清单
在生成 App.jsx 之前，确认所有被导入的组件文件都已生成：
\`\`\`
App.jsx imports:
- ./components/Header → ✅ 已生成 Header.jsx
- ./components/Hero → ✅ 已生成 Hero.jsx
- ./components/Features → ✅ 已生成 Features.jsx
- ./components/Footer → ✅ 已生成 Footer.jsx
\`\`\``;

  // === Part 6: 输出格式 ===
  const outputFormat = morphEnabled ? `
## 📤 第五部分：输出格式（Morph Fast Apply 模式）

### 编辑已存在的文件
使用 <edit> 标签进行精准编辑：
\`\`\`
<edit target_file="src/components/Header.jsx">
  <instructions>将背景色从 bg-white 改为 bg-black</instructions>
  <update>className="bg-black text-white"</update>
</edit>
\`\`\`

### 创建新文件
使用 <file> 标签：
\`\`\`
<file path="src/components/NewComponent.jsx">
// 完整的文件内容
</file>
\`\`\`
` : `
## 📤 第五部分：输出格式

⚠�� **CRITICAL REQUIREMENT**: You MUST wrap ALL code in <file path="...">...</file> tags.

### 标准文件格式
每个文件使用 <file> 标签包裹：
\`\`\`
<file path="src/index.css">
@tailwind base;
@tailwind components;
@tailwind utilities;
</file>

<file path="src/components/Header.jsx">
import { useState } from 'react';
import { Menu, X } from 'lucide-react';

export default function Header() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <header className="bg-white shadow-sm">
      {/* 完整的组件代码 */}
    </header>
  );
}
</file>
\`\`\`

### ❌ 禁止的输出格式
- ❌ 不要输出没有 <file> 标签的代码
- ❌ 不要输出纯代码片段
- ❌ 不要在 <file> 标签外添加解释性文本
- ❌ 不要省略 <file> 标签

### 关键要求
- 每个 <file> 必须有对应的 </file>
- 文件内容必须完整，从第一行到最后一行
- 不允许在文件内容中使用 "..." 省略
- 所有代码必须在 <file> 标签内`;

  // === Part 7: 反面例子（什么不该做） ===
  const antiPatterns = `
## 🚫 第六部分：严禁行为

### 截断代码（最严重的错误）
❌ 错误示例：
\`\`\`
<file path="src/components/Hero.jsx">
export default function Hero() {
  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-500 to-...
\`\`\`

✅ 正确做法：
\`\`\`
<file path="src/components/Hero.jsx">
export default function Hero() {
  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-500 to-purple-600">
      <h1 className="text-4xl font-bold text-white">Welcome</h1>
    </div>
  );
}
</file>
\`\`\`

### 导入不存在的文件
❌ 错误：import Sidebar from './components/Sidebar' // 但没有生成 Sidebar.jsx
✅ 正确：只导入你确实生成的文件

### 使用省略号
❌ 错误：// ... rest of the code
❌ 错误：{/* ... other sections */}
✅ 正确：写出完整的代码

### 智能引号
❌ 错误："Welcome" 或 'it's'（curly quotes）
✅ 正确："Welcome" 或 "it's"（straight quotes）`;

  // === Part 8: 最终检查清单 ===
  const finalChecklist = `
## ✅ 第七部分：生成前最终检查

在输出代码前，确认以下所有项：

### 文件完整性
□ 每个 <file> 标签都有对应的 </file>
□ 没有文件被截断或省略
□ 所有括号、引号、标签都正确闭合

### 依赖完整性
□ App.jsx 中导入的每个组件都有对应文件
□ 相对路径导入的目标文件存在
□ 没有循环依赖

### 代码质量
□ 使用标准 Tailwind 类（非自定义）
□ 没有语法错误
□ 组件都有 export default

### 数量检查
□ 新建项目：通常 4-8 个文件
□ 编辑模式：通常 1-2 个文件
□ 不要生成超过必要的文件

---
现在，开始执行任务。首先在 <thinking> 标签中完成5步分析，然后生成代码。`;

  // 组装完整提示词
  return [
    roleDefinition,
    thinkingProcess,
    codeQualityStandards,
    editModeRules,
    multiFileCoordination,
    outputFormat,
    antiPatterns,
    finalChecklist,
    conversationSummary ? `\n## 对话上下文\n${conversationSummary}` : ''
  ].filter(Boolean).join('\n');
}

/**
 * 生成用户提示词增强
 * 添加强制思考和完整性要求
 */
export function enhanceUserPrompt(originalPrompt: string, isEdit: boolean): string {
  const prefix = `
请按照以下步骤完成任务：

1. **首先在 <thinking> 标签中分析需求**
   - 理解用户要求
   - 规划文件结构
   - 列出所有需要生成的文件
   - 检查依赖关系

2. **然后生成完整代码**
   - 每个文件从头写到尾
   - 不使用任何省略
   - 确保所有导入都有对应文件

用户请求：
`;

  const suffix = `

⚠️ 关键要求：
- 你必须先在 <thinking> 中完成分析
- 然后生成每一个你计划创建的文件
- 每个文件必须完整，不能截断
- 如果你导入了 ./components/X，你必须生成 src/components/X.jsx
${isEdit ? '- 这是编辑模式：只修改必要的文件，不要重建整个应用' : '- 这是新建模式：创建一个完整的、可运行的应用'}`;

  return prefix + originalPrompt + suffix;
}

/**
 * 验证生成的代码是否符合质量标准
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  missingFiles: string[];
  truncatedFiles: string[];
}

export function validateGeneratedCode(code: string): ValidationResult {
  const result: ValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    missingFiles: [],
    truncatedFiles: []
  };

  // 提取所有文件
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
  const files: Map<string, string> = new Map();
  let match;

  while ((match = fileRegex.exec(code)) !== null) {
    files.set(match[1], match[2]);
  }

  // 检查未闭合的 file 标签
  const openTags = (code.match(/<file path="/g) || []).length;
  const closeTags = (code.match(/<\/file>/g) || []).length;
  if (openTags !== closeTags) {
    result.errors.push(`文件标签未闭合: ${openTags} 个开标签, ${closeTags} 个闭标签`);
    result.isValid = false;
  }

  // 检查每个文件的完整性
  for (const [path, content] of files) {
    // 检查截断
    if (content.includes('...') && !content.includes('...rest') && !content.includes('...props')) {
      result.warnings.push(`${path} 可能包含省略代码`);
    }

    // 检查 JSX 文件的括号匹配
    if (path.match(/\.(jsx?|tsx?)$/)) {
      const openBraces = (content.match(/{/g) || []).length;
      const closeBraces = (content.match(/}/g) || []).length;
      if (Math.abs(openBraces - closeBraces) > 2) {
        result.errors.push(`${path} 括号不匹配: ${openBraces} 个 '{', ${closeBraces} 个 '}'`);
        result.truncatedFiles.push(path);
        result.isValid = false;
      }

      // 检查 JSX 标签
      const jsxOpenTags = content.match(/<[A-Z][a-zA-Z]*\b/g) || [];
      const jsxCloseTags = content.match(/<\/[A-Z][a-zA-Z]*>/g) || [];
      const selfClosingTags = content.match(/<[A-Z][a-zA-Z]*[^>]*\/>/g) || [];

      if (jsxOpenTags.length > jsxCloseTags.length + selfClosingTags.length + 5) {
        result.warnings.push(`${path} JSX 标签可能未闭合`);
      }
    }

    // 检查导入的依赖
    const importRegex = /import\s+.*\s+from\s+['"](\.\/[^'"]+)['"]/g;
    let importMatch;
    while ((importMatch = importRegex.exec(content)) !== null) {
      const importPath = importMatch[1];
      // 转换导入路径为文件路径
      let targetPath = importPath;
      if (!targetPath.endsWith('.jsx') && !targetPath.endsWith('.js') && !targetPath.endsWith('.tsx') && !targetPath.endsWith('.ts')) {
        targetPath += '.jsx'; // 默认添加 .jsx 扩展名
      }
      // 处理相对路径
      const basePath = path.substring(0, path.lastIndexOf('/'));
      const fullPath = resolvePath(basePath, targetPath);

      // 检查目标文件是否存在
      const possiblePaths = [fullPath, fullPath.replace('.jsx', '.js'), fullPath.replace('.jsx', '.tsx')];
      const exists = possiblePaths.some(p => files.has(p));

      if (!exists && !importPath.includes('index.css')) {
        result.missingFiles.push(`${path} 导入了不存在的文件: ${importPath}`);
        result.isValid = false;
      }
    }
  }

  return result;
}

/**
 * 解析相对路径
 */
function resolvePath(base: string, relative: string): string {
  const baseParts = base.split('/').filter(p => p);
  const relativeParts = relative.split('/').filter(p => p);

  for (const part of relativeParts) {
    if (part === '..') {
      baseParts.pop();
    } else if (part !== '.') {
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

/**
 * 从生成的代码中提取思考过程
 */
export function extractThinkingProcess(code: string): string | null {
  const thinkingMatch = code.match(/<thinking>([\s\S]*?)<\/thinking>/);
  return thinkingMatch ? thinkingMatch[1].trim() : null;
}

/**
 * 检查是否完成了思考过程
 */
export function hasCompletedThinking(code: string): boolean {
  const thinking = extractThinkingProcess(code);
  if (!thinking) return false;

  // 检查是否包含关键步骤
  const hasComprehension = /需求|理解|功能/.test(thinking);
  const hasPlanning = /文件|结构|组件/.test(thinking);
  const hasValidation = /检查|验证|确认/.test(thinking);

  return hasComprehension && hasPlanning;
}
