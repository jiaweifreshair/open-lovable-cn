/**
 * 多轮修复引擎 - 自动检测并修复代码生成问题
 *
 * 核心功能：
 * 1. 依赖验证 - 检查所有导入是否有对应文件
 * 2. 完整性验证 - 检查文件是否被截断
 * 3. 自动修复 - 尝试自动补全缺失的文件
 * 4. 重试机制 - 失败时自动重试生成
 */

import { streamText, type LanguageModel } from 'ai';

export interface FileInfo {
  path: string;
  content: string;
}

export interface ValidationIssue {
  type: 'missing_import' | 'truncated_file' | 'unclosed_tag' | 'syntax_error' | 'circular_dependency';
  severity: 'error' | 'warning';
  file: string;
  message: string;
  suggestion?: string;
}

export interface FixResult {
  success: boolean;
  fixedFiles: FileInfo[];
  remainingIssues: ValidationIssue[];
  iterations: number;
}

/**
 * 🔥 预处理：规范化 XML 标签格式
 *
 * 解决问题：AI 在 `<file` 和 `path=` 之间输出换行或多个空格，导致正则匹配失败
 *
 * 处理模式：
 * 1. `<file\n path=` → `<file path=`
 * 2. `<file   path=` → `<file path=`
 * 3. `< file path=` → `<file path=`
 * 4. `</file >` → `</file>`
 */
export function normalizeXmlTags(content: string): string {
  let normalized = content;

  // 1. 规范化 <file 标签：移除 <file 和 path= 之间的多余空白（包括换行）
  // 匹配 <file 后跟任意空白字符（包括换行），然后是 path=
  normalized = normalized.replace(/<file\s+path=/g, '<file path=');

  // 2. 移除 < 和 file 之间的空格（极端情况）
  normalized = normalized.replace(/<\s+file\s+path=/g, '<file path=');

  // 3. 规范化闭合标签
  normalized = normalized.replace(/<\s*\/\s*file\s*>/g, '</file>');

  // 4. 修复属性值内的换行（path="...\n..."）
  // 这种情况较少见，但可能发生在路径很长时
  normalized = normalized.replace(/<file path="([^"]*)\n([^"]*)">/g, '<file path="$1$2">');

  return normalized;
}

/**
 * 🔥 修复断裂的 XML 标签
 *
 * 解决问题：AI 输出被截断，导致 `<file path=` 部分出现在代码中间
 *
 * 检测模式：
 * 1. 代码中出现 `path="xxx.jsx">` 这样的残留片段
 * 2. 代码中出现孤立的 `</file>` 标签
 * 3. 代码中出现 `<file path=` 但没有闭合
 * 4. 🆕 跨文件边界截断：`<RotateCcwStep.jsx">` 这种 JSX + 文件名混合
 *
 * 修复策略：
 * 1. 尝试从上下文推断完整的文件边界
 * 2. 移除混入代码中的标签残留
 * 3. 🆕 恢复断裂的文件边界
 */
export function repairBrokenXmlTags(content: string): { repaired: string; issues: string[] } {
  const issues: string[] = [];
  let repaired = content;

  // 🆕 模式0：检测跨文件边界截断（最复杂的情况）
  // 例如：`<RotateCcwStep.jsx">` 或 `classNameWorryStep.jsx">`
  // 这是 AI 在输出 `<file path="src/components/ResultStep.jsx">` 时被截断
  // 丢失了 `</file>\n<file path="src/components/Result` 部分
  // 特征：小写字母/JSX标签 + 大写开头的组件名 + 文件扩展名 + `">`
  const crossFileBoundaryPattern = /([a-zA-Z<>="'\s]+?)([A-Z][a-zA-Z]*(?:Step|Page|Component|View|Form|Modal|Card|List|Item|Button|Input|Header|Footer|Nav|Sidebar|Layout|Container|Wrapper|Section|Panel|Box|Grid|Row|Col|Cell|Table|Menu|Tab|Tabs|Icon|Badge|Alert|Toast|Dialog|Popup|Tooltip|Dropdown|Select|Option|Checkbox|Radio|Switch|Slider|Progress|Spinner|Loader|Avatar|Image|Video|Audio|Map|Chart|Graph|Canvas|SVG|Path|Rect|Circle|Line|Text|Span|Div|Main|Article|Aside|Figure|Caption|Label|Legend|Field|Group|Stack|Flex|Block|Inline)?)\.(jsx|tsx|js|ts)">/g;

  const crossFileMatches = [...repaired.matchAll(crossFileBoundaryPattern)];

  for (const match of crossFileMatches) {
    const fullMatch = match[0];
    const beforePart = match[1]; // 例如 `<RotateCcw` 或 `className`
    const componentName = match[2]; // 例如 `Step` 或 `WorryStep`
    const extension = match[3]; // jsx, tsx, js, ts

    // 检查这是否真的是断裂的文件边界
    // 如果 beforePart 包含 JSX 相关的内容（<、className、onClick 等），很可能是断裂
    const looksLikeTruncation =
      beforePart.includes('<') ||
      beforePart.includes('className') ||
      beforePart.includes('onClick') ||
      beforePart.includes('onChange') ||
      beforePart.includes('style') ||
      beforePart.includes('=') ||
      /[a-z]$/.test(beforePart.trim()); // 以小写字母结尾（未完成的属性或标签）

    if (looksLikeTruncation && componentName) {
      // 推断完整的文件路径
      const inferredPath = `src/components/${componentName}.${extension}`;

      issues.push(`检测到跨文件边界截断: "${fullMatch}" -> 推断文件: ${inferredPath}`);

      // 修复策略：
      // 1. 保留 beforePart 中有效的代码部分
      // 2. 插入正确的文件边界
      // 3. 继续后面的 import 语句

      // 找到 import 语句的开始位置
      const matchIndex = match.index!;
      const afterMatch = repaired.substring(matchIndex + fullMatch.length);
      const importMatch = afterMatch.match(/^(import\s+)/);

      if (importMatch) {
        // 这确认了后面是新文件的开始
        // 截取 beforePart 中可能有效的代码（如果它像是未完成的 JSX 标签，尝试闭合它）
        let fixedBefore = beforePart;

        // 如果以 < 开头且没有 >，可能是未闭合的自闭合标签
        if (beforePart.includes('<') && !beforePart.includes('>')) {
          // 尝试闭合：`<RotateCcw` -> `<RotateCcw />`
          fixedBefore = beforePart + ' />';
        }

        // 构建修复后的内容
        const beforeMatchContent = repaired.substring(0, matchIndex);
        const afterMatchContent = repaired.substring(matchIndex + fullMatch.length);

        // 检查 beforeMatchContent 是否在一个文件内
        // 如果是，需要先闭合当前文件
        const needsClosingTag = !beforeMatchContent.trimEnd().endsWith('</file>');

        repaired = beforeMatchContent +
                   fixedBefore +
                   (needsClosingTag ? '\n</file>' : '') +
                   `\n<file path="${inferredPath}">\n` +
                   afterMatchContent;

        issues.push(`已修复跨文件边界: 插入 </file> 和 <file path="${inferredPath}">`);
      }
    }
  }

  // 模式1：检测代码中间混入的 path="xxx.jsx"> 片段
  // 例如：`export default function App() { path="src/components/Result.jsx">`
  const brokenPathPattern = /([^<])(path="[^"]+">)/g;
  const brokenPathMatches = repaired.matchAll(brokenPathPattern);

  for (const match of brokenPathMatches) {
    const beforeChar = match[1];
    const brokenPart = match[2];

    // 如果 path= 前面不是 <file，说明这是一个断裂的标签
    if (beforeChar !== ' ' || !repaired.substring(0, match.index!).includes('<file')) {
      issues.push(`检测到断裂的标签: ${brokenPart}`);

      // 尝试修复：在 path= 前插入 <file
      // 但首先检查这是否在代码字符串内
      const lineStart = repaired.lastIndexOf('\n', match.index!) + 1;
      const lineContent = repaired.substring(lineStart, match.index! + match[0].length);

      // 如果这一行看起来像代码而不是 XML 标签，移除断裂部分
      if (lineContent.includes('export') || lineContent.includes('import') ||
          lineContent.includes('function') || lineContent.includes('const') ||
          lineContent.includes('return') || lineContent.includes('className')) {
        repaired = repaired.replace(match[0], beforeChar); // 只保留前一个字符
        issues.push(`已移除代码中混入的标签片段: ${brokenPart}`);
      }
    }
  }

  // 模式2：检测孤立的 </file> 标签（前面没有对应的 <file path=）
  const lines = repaired.split('\n');
  const cleanedLines: string[] = [];
  let insideFile = false;
  let openTagCount = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    // 检测 <file path= 开始
    if (/<file\s+path="[^"]+">/i.test(line)) {
      insideFile = true;
      openTagCount++;
    }

    // 检测孤立的 </file>
    if (trimmed === '</file>' && !insideFile) {
      issues.push('检测到孤立的 </file> 标签，已移除');
      continue; // 跳过这一行
    }

    // 检测 </file> 闭合
    if (/<\/file>/i.test(line)) {
      if (openTagCount > 0) {
        openTagCount--;
        if (openTagCount === 0) {
          insideFile = false;
        }
      } else {
        // 孤立的 </file>，移除
        issues.push('检测到多余的 </file> 标签，已移除');
        continue;
      }
    }

    cleanedLines.push(line);
  }

  repaired = cleanedLines.join('\n');

  // 模式3：检测代码块中混入的 <file path= 开始标签
  // 例如：在 JSX return 语句中突然出现 <file path=
  const codeBlockFilePattern = /(return\s*\([^]*?)(<file\s+path="[^"]+">)/g;
  const codeBlockMatches = [...repaired.matchAll(codeBlockFilePattern)];

  for (const match of codeBlockMatches) {
    const jsxContent = match[1];
    const fileTag = match[2];

    // 计算 return ( 后的括号深度
    const openParens = (jsxContent.match(/\(/g) || []).length;
    const closeParens = (jsxContent.match(/\)/g) || []).length;

    // 如果括号没有闭合，说明 <file path= 出现在 JSX 内部
    if (openParens > closeParens) {
      issues.push(`检测到 JSX 内部混入的 <file> 标签: ${fileTag}`);
      // 这种情况需要更复杂的处理，暂时只记录
    }
  }

  return { repaired, issues };
}

/**
 * 🔥 尝试从无标签的代码中推断文件边界
 *
 * 解决问题：AI 输出完全没有 <file> 标签包裹，代码片段混合在一起
 *
 * 推断策略：
 * 1. 检测多个 `export default function/class` 作为文件边界
 * 2. 检测 import 语句重复（说明是新文件开始）
 * 3. 根据组件名称推断文件路径
 */
export function inferFileBoundaries(content: string): FileInfo[] {
  const files: FileInfo[] = [];

  // 如果内容已经有 <file> 标签，不需要推断
  if (/<file\s+path="[^"]+">/i.test(content)) {
    return files; // 返回空数组，让正常的 extractFiles 处理
  }

  // 检测多个 export default 语句作为文件边界
  const exportDefaultPattern = /export\s+default\s+(function|class|const)\s+([A-Z][a-zA-Z0-9]*)/g;
  const exportMatches = [...content.matchAll(exportDefaultPattern)];

  if (exportMatches.length <= 1) {
    // 只有一个或零个 export default，可能是单个文件
    if (exportMatches.length === 1) {
      const componentName = exportMatches[0][2];
      files.push({
        path: `src/components/${componentName}.jsx`,
        content: content.trim()
      });
      console.log(`[inferFileBoundaries] 推断单文件: ${componentName}.jsx`);
    }
    return files;
  }

  // 多个 export default，按位置分割
  console.log(`[inferFileBoundaries] 检测到 ${exportMatches.length} 个 export default，尝试分割...`);

  // 找到每个 export default 的起始位置
  // 向前搜索到该组件的 import 语句开始
  for (let i = 0; i < exportMatches.length; i++) {
    const match = exportMatches[i];
    const componentName = match[2];
    const exportPosition = match.index!;

    // 找到这个组件代码块的结束位置
    const nextExportPosition = i < exportMatches.length - 1
      ? exportMatches[i + 1].index!
      : content.length;

    // 向前搜索 import 语句（这个组件的开始）
    // 从当前位置向前找最近的 import 块
    let startPosition = exportPosition;

    // 从 export 位置向前找
    const beforeExport = content.substring(0, exportPosition);
    const lastImportBlock = beforeExport.lastIndexOf('import ');

    if (lastImportBlock !== -1) {
      // 找到 import 块的真正开始（可能有多个连续的 import）
      let importStart = lastImportBlock;
      while (importStart > 0) {
        const prevImport = beforeExport.lastIndexOf('import ', importStart - 1);
        if (prevImport === -1) break;

        // 检查两个 import 之间是否只有空白和其他 import
        const between = beforeExport.substring(prevImport, importStart);
        if (/^import\s+[\s\S]*?['"][^'"]+['"];?\s*$/.test(between)) {
          importStart = prevImport;
        } else {
          break;
        }
      }

      startPosition = importStart;
    }

    // 提取这个组件的代码
    const componentCode = content.substring(startPosition, nextExportPosition).trim();

    if (componentCode.length > 50) { // 确保有足够的内容
      files.push({
        path: `src/components/${componentName}.jsx`,
        content: componentCode
      });
      console.log(`[inferFileBoundaries] 推断文件: ${componentName}.jsx (${componentCode.length} chars)`);
    }
  }

  return files;
}

/**
 * 从生成的代码中提取所有文件
 *
 * 🔥 增强版：支持多种格式的输入
 * 1. 标准 <file path="...">...</file> 格式
 * 2. 格式不规范的标签（空白问题）
 * 3. 完全没有标签的代码（推断边界）
 */
export function extractFiles(generatedCode: string): FileInfo[] {
  // 🔥 STEP 1: 预处理规范化
  let normalizedCode = normalizeXmlTags(generatedCode);

  // 🔥 STEP 2: 修复断裂的标签
  const { repaired, issues } = repairBrokenXmlTags(normalizedCode);
  if (issues.length > 0) {
    console.log(`[extractFiles] 修复了 ${issues.length} 个标签问题:`, issues);
  }
  normalizedCode = repaired;

  // 🔥 STEP 3: 使用灵活的正则提取文件
  // 改进：支持 <file 和 path= 之间有空白
  const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)<\/file>/g;
  const files: FileInfo[] = [];
  let match;

  while ((match = fileRegex.exec(normalizedCode)) !== null) {
    files.push({
      path: match[1],
      content: match[2].trim()
    });
  }

  // 🔥 STEP 4: 如果没有提取到文件，尝试推断文件边界
  if (files.length === 0) {
    const inferredFiles = inferFileBoundaries(generatedCode);
    if (inferredFiles.length > 0) {
      console.log(`[extractFiles] 从无标签内容中推断出 ${inferredFiles.length} 个文件`);
      return inferredFiles;
    }
  }

  return files;
}

/**
 * 验证文件依赖完整性
 */
export function validateDependencies(files: FileInfo[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const filePaths = new Set(files.map(f => f.path));

  // 添加常见的路径变体
  const normalizedPaths = new Set<string>();
  for (const path of filePaths) {
    normalizedPaths.add(path);
    normalizedPaths.add(path.replace('.jsx', '.js'));
    normalizedPaths.add(path.replace('.js', '.jsx'));
    normalizedPaths.add(path.replace('.tsx', '.ts'));
    normalizedPaths.add(path.replace('.ts', '.tsx'));
    // 添加 src/ 前缀变体
    if (!path.startsWith('src/')) {
      normalizedPaths.add('src/' + path);
    }
    if (path.startsWith('src/')) {
      normalizedPaths.add(path.substring(4));
    }
  }

  for (const file of files) {
    // 只检查 JS/TS 文件的导入
    if (!file.path.match(/\.(jsx?|tsx?)$/)) continue;

    // 提取所有相对路径导入
    const importRegex = /import\s+(?:[\w{}\s,*]+\s+from\s+)?['"](\.[^'"]+)['"]/g;
    let importMatch;

    while ((importMatch = importRegex.exec(file.content)) !== null) {
      const importPath = importMatch[1];

      // 跳过样式文件导入
      if (importPath.endsWith('.css') || importPath.endsWith('.scss')) continue;

      // 计算目标文件路径
      const baseDir = file.path.substring(0, file.path.lastIndexOf('/'));
      const targetPath = resolveImportPath(baseDir, importPath);

      // 检查目标文件是否存在
      const possiblePaths = [
        targetPath,
        targetPath + '.jsx',
        targetPath + '.js',
        targetPath + '.tsx',
        targetPath + '.ts',
        targetPath + '/index.jsx',
        targetPath + '/index.js',
        targetPath + '/index.tsx',
        targetPath + '/index.ts'
      ];

      const exists = possiblePaths.some(p => normalizedPaths.has(p));

      if (!exists) {
        issues.push({
          type: 'missing_import',
          severity: 'error',
          file: file.path,
          message: `导入了不存在的模块: ${importPath}`,
          suggestion: `需要创建文件: ${targetPath}.jsx 或确保该文件被生成`
        });
      }
    }
  }

  return issues;
}

/**
 * 解析导入路径
 */
function resolveImportPath(baseDir: string, importPath: string): string {
  const parts = importPath.split('/');
  const baseParts = baseDir.split('/').filter(p => p);

  for (const part of parts) {
    if (part === '..') {
      baseParts.pop();
    } else if (part !== '.') {
      baseParts.push(part);
    }
  }

  return baseParts.join('/');
}

/**
 * 推断缺失文件的扩展名
 * 规则：
 * 1. 如果 import 本身带扩展名，则保持不变
 * 2. 优先跟随导入方文件的扩展名（.tsx/.ts/.jsx/.js）
 * 3. 无法判断时：若项目内已出现 TS 文件，则默认 .tsx，否则默认 .jsx
 */
function inferMissingFileExtension(importerPath: string, existingFiles: FileInfo[]): string {
  const importerExtMatch = importerPath.match(/\.(tsx|ts|jsx|js)$/);
  if (importerExtMatch) {
    const ext = importerExtMatch[1];
    return `.${ext}`;
  }

  const usesTypeScript = existingFiles.some(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx'));
  return usesTypeScript ? '.tsx' : '.jsx';
}

/**
 * 检测并清理混入代码中的中文文本
 *
 * 截断续写时，AI可能会输出解释性中文文本混杂在代码中，例如：
 * - "再次记录bulb, Heart } from 'lucide-react';"
 * - "接下来生成 import React from 'react';"
 *
 * 这些需要被检测并清理
 */
interface MixedTextIssue {
  line: number;
  originalLine: string;
  cleanedLine: string;
  chineseText: string;
}

export function detectAndCleanMixedChineseText(content: string): { cleaned: string; issues: MixedTextIssue[] } {
  const lines = content.split('\n');
  const issues: MixedTextIssue[] = [];
  const cleanedLines: string[] = [];

  // 中文字符正则（包括中文标点）
  const chineseRegex = /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/;
  // import/export 语句特征
  const codeKeywords = /^(import|export|const|let|var|function|class|return|if|else|for|while|switch|case|default|try|catch|finally|throw|new|typeof|instanceof|void|delete|in|of|async|await|yield|from|as|static|get|set|extends|implements|interface|type|enum|namespace|module|declare|abstract|readonly|public|private|protected)/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 检测是否包含中文
    if (chineseRegex.test(trimmedLine)) {
      // 检测是否是代码行混入了中文（而非纯中文注释）
      // 纯中文注释以 // 或 /* 开头是允许的
      if (trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
        cleanedLines.push(line);
        continue;
      }

      // 检测混入模式：中文文字后面紧跟代码关键字
      // 例如："再次记录bulb, Heart } from 'lucide-react';"
      const mixedMatch = trimmedLine.match(/^([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\s]+)(.*)$/);
      if (mixedMatch && mixedMatch[2]) {
        const chineseText = mixedMatch[1];
        const remainingCode = mixedMatch[2].trim();

        // 检查剩余部分是否像代码
        if (remainingCode.length > 0 && (
          codeKeywords.test(remainingCode) ||
          remainingCode.startsWith('{') ||
          remainingCode.startsWith('}') ||
          remainingCode.startsWith('(') ||
          remainingCode.startsWith(')') ||
          remainingCode.startsWith('<') ||
          remainingCode.includes('from \'') ||
          remainingCode.includes('from "') ||
          remainingCode.includes('= ') ||
          remainingCode.includes('=>')
        )) {
          issues.push({
            line: i + 1,
            originalLine: trimmedLine,
            cleanedLine: remainingCode,
            chineseText: chineseText.trim()
          });
          // 使用清理后的代码，保持原始缩进
          const indent = line.match(/^(\s*)/)?.[1] || '';
          cleanedLines.push(indent + remainingCode);
          continue;
        }
      }

      // 检测代码中间混入中文的情况
      // 例如："import { 一些组件 Button } from 'react';"
      const inlineChineseMatch = trimmedLine.match(/([\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]+)/g);
      if (inlineChineseMatch && (
        trimmedLine.includes('import ') ||
        trimmedLine.includes('export ') ||
        trimmedLine.includes('from \'') ||
        trimmedLine.includes('from "')
      )) {
        // 移除所有中文字符
        let cleanedLine = trimmedLine;
        for (const chinese of inlineChineseMatch) {
          cleanedLine = cleanedLine.replace(chinese, '');
        }
        // 清理多余空格
        cleanedLine = cleanedLine.replace(/\s{2,}/g, ' ').trim();

        if (cleanedLine !== trimmedLine) {
          issues.push({
            line: i + 1,
            originalLine: trimmedLine,
            cleanedLine: cleanedLine,
            chineseText: inlineChineseMatch.join(', ')
          });
          const indent = line.match(/^(\s*)/)?.[1] || '';
          cleanedLines.push(indent + cleanedLine);
          continue;
        }
      }
    }

    cleanedLines.push(line);
  }

  return {
    cleaned: cleanedLines.join('\n'),
    issues
  };
}

/**
 * 检测 import 语句是否出现在错误位置（函数体内部）
 *
 * 正确的 import 应该在文件顶部，在任何函数/类定义之前
 * 如果 import 出现在函数体内部，说明代码生成时发生了截断后拼接错误
 */
interface MisplacedImport {
  line: number;
  statement: string;
  position: number;
}

function detectMisplacedImports(content: string): MisplacedImport[] {
  const misplaced: MisplacedImport[] = [];
  const lines = content.split('\n');

  // 追踪是否已经进入代码体（函数、类、组件定义后）
  let inCodeBody = false;
  let braceDepth = 0;
  let lastImportLine = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 跳过空行和注释
    if (!trimmedLine || trimmedLine.startsWith('//') || trimmedLine.startsWith('/*') || trimmedLine.startsWith('*')) {
      continue;
    }

    // 检测 import 语句
    const importMatch = trimmedLine.match(/^import\s+.*\s+from\s+['"].*['"];?$/);
    if (importMatch) {
      lastImportLine = i;

      // 如果已经在代码体内，或者花括号深度 > 0，说明 import 位置错误
      if (inCodeBody || braceDepth > 0) {
        misplaced.push({
          line: i + 1, // 1-indexed for human readability
          statement: trimmedLine,
          position: content.indexOf(line)
        });
      }
      continue;
    }

    // 检测函数/类/组件定义的开始
    // 这些标志着代码体的开始，之后不应再出现 import
    if (!inCodeBody) {
      if (
        trimmedLine.match(/^(export\s+)?(default\s+)?function\s+\w+/) ||
        trimmedLine.match(/^(export\s+)?(default\s+)?class\s+\w+/) ||
        trimmedLine.match(/^(export\s+)?const\s+\w+\s*=\s*\(/) ||
        trimmedLine.match(/^(export\s+)?const\s+\w+\s*=\s*function/) ||
        trimmedLine.match(/^(export\s+)?const\s+\w+:\s*React\.FC/) ||
        trimmedLine.includes('React.createElement') ||
        trimmedLine.includes('createContext') ||
        trimmedLine.includes('createStore')
      ) {
        inCodeBody = true;
      }
    }

    // 追踪花括号深度（用于检测嵌套的 import）
    const openBraces = (line.match(/{/g) || []).length;
    const closeBraces = (line.match(/}/g) || []).length;
    braceDepth += openBraces - closeBraces;
  }

  return misplaced;
}

/**
 * 自动修复 misplaced imports - 将所有 import 语句移动到文件顶部
 *
 * 修复策略：
 * 1. 提取所有 import 语句（无论位置）
 * 2. 从原位置删除这些 import
 * 3. 将所有 import 放到文件顶部（保持原有顺序）
 * 4. 去重（相同的 import 只保留一个）
 */
export function fixMisplacedImports(content: string): { fixed: string; fixedCount: number } {
  const lines = content.split('\n');
  const imports: string[] = [];
  const nonImportLines: string[] = [];
  let fixedCount = 0;
  let inCodeBody = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 检测 import 语句
    const isImport = /^\s*import\s+.*\s+from\s+['"].*['"];?\s*$/.test(line);

    if (isImport) {
      // 去重：检查是否已存在相同的 import
      const normalizedImport = trimmedLine.replace(/;$/, '').trim();
      const isDuplicate = imports.some(existing =>
        existing.replace(/;$/, '').trim() === normalizedImport
      );

      if (!isDuplicate) {
        imports.push(trimmedLine);
      }

      // 如果是在代码体内发现的 import，记录修复
      if (inCodeBody) {
        fixedCount++;
        console.log(`[fixMisplacedImports] 修复错位的 import (行 ${i + 1}): ${trimmedLine.substring(0, 50)}...`);
      }
    } else {
      nonImportLines.push(line);

      // 检测是否进入代码体
      if (!inCodeBody) {
        if (
          trimmedLine.match(/^(export\s+)?(default\s+)?function\s+\w+/) ||
          trimmedLine.match(/^(export\s+)?(default\s+)?class\s+\w+/) ||
          trimmedLine.match(/^(export\s+)?const\s+\w+\s*=\s*\(/) ||
          trimmedLine.match(/^(export\s+)?const\s+\w+\s*=\s*function/)
        ) {
          inCodeBody = true;
        }
      }
    }
  }

  // 如果没有修复任何内容，直接返回原内容
  if (fixedCount === 0) {
    return { fixed: content, fixedCount: 0 };
  }

  // 重组文件：imports 在顶部，然后是其余代码
  // 找到第一个非空、非注释行的位置，在其前面插入 imports
  let insertIndex = 0;
  for (let i = 0; i < nonImportLines.length; i++) {
    const trimmed = nonImportLines[i].trim();
    if (trimmed && !trimmed.startsWith('//') && !trimmed.startsWith('/*') && !trimmed.startsWith('*')) {
      insertIndex = i;
      break;
    }
    insertIndex = i + 1;
  }

  // 构建新的文件内容
  const result = [
    ...nonImportLines.slice(0, insertIndex),
    ...imports.map(imp => imp.endsWith(';') ? imp : imp + ';'),
    '',  // 空行分隔
    ...nonImportLines.slice(insertIndex)
  ].join('\n');

  return { fixed: result, fixedCount };
}

/**
 * 检测 JSX 内出现函数定义的问题
 *
 * 这是截断后续写的典型错误：
 * - 在 JSX 标签内突然出现 export default function
 * - 在字符串或属性中出现函数定义
 */
interface StructureIssue {
  message: string;
  suggestion: string;
  line?: number;
}

function detectJSXFunctionMixup(content: string): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const lines = content.split('\n');

  // 追踪 JSX 深度
  let jsxDepth = 0;
  let inJSXAttribute = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 简单的 JSX 深度追踪
    const jsxOpenTags = (line.match(/<[A-Z][a-zA-Z0-9]*(?:\s|>)/g) || []).length;
    const jsxCloseTags = (line.match(/<\/[A-Z][a-zA-Z0-9]*>/g) || []).length;
    const selfClosingTags = (line.match(/<[A-Z][a-zA-Z0-9]*[^>]*\/>/g) || []).length;

    // 检测是否在属性字符串中
    if (line.includes('className="') || line.includes("className='")) {
      inJSXAttribute = true;
    }
    if (inJSXAttribute && (line.includes('"') || line.includes("'"))) {
      // 简单检测属性结束
      const lastQuote = Math.max(line.lastIndexOf('"'), line.lastIndexOf("'"));
      if (lastQuote > line.indexOf('className')) {
        inJSXAttribute = false;
      }
    }

    jsxDepth += jsxOpenTags - jsxCloseTags - selfClosingTags;
    if (jsxDepth < 0) jsxDepth = 0;

    // 🚨 检测在 JSX 深度 > 0 或属性中出现函数定义
    if ((jsxDepth > 0 || inJSXAttribute) &&
        (trimmedLine.match(/^export\s+default\s+function/) ||
         trimmedLine.match(/^function\s+[A-Z][a-zA-Z0-9]*\s*\(/))) {
      issues.push({
        message: `函数定义出现在 JSX 内部 (行 ${i + 1}): ${trimmedLine.substring(0, 50)}...`,
        suggestion: '这是代码结构严重错误，需要重新生成文件',
        line: i + 1
      });
    }

    // 🚨 检测 JSX 属性值中出现 export/import
    if (line.includes('className=') &&
        (line.includes('export ') || line.includes('import '))) {
      issues.push({
        message: `检测到 export/import 出现在 className 属性中 (行 ${i + 1})`,
        suggestion: '这是严重的代码拼接错误，文件需要重新生成',
        line: i + 1
      });
    }
  }

  return issues;
}

/**
 * 检测函数体不完整的问题
 *
 * 检测模式：
 * - export default function Xxx() { 后紧跟 const/let/var 但没有正确缩进
 * - 函数定义后直接是另一个函数的代码
 */
function detectIncompleteFunctionBody(content: string): StructureIssue[] {
  const issues: StructureIssue[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();

    // 检测函数定义行
    const functionMatch = trimmedLine.match(/^(export\s+)?(default\s+)?function\s+([A-Z][a-zA-Z0-9]*)\s*\([^)]*\)\s*\{?\s*$/);

    if (functionMatch) {
      const functionName = functionMatch[3];
      const hasOpenBrace = trimmedLine.includes('{');

      // 如果函数定义行没有 {，检查下一行
      if (!hasOpenBrace && i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();

        // 下一行应该是 { 或者函数体内容
        if (nextLine && !nextLine.startsWith('{') &&
            !nextLine.startsWith('//') &&
            !nextLine.startsWith('/*')) {
          // 检查是否是另一个函数的代码（比如 const useState）
          if (nextLine.match(/^(const|let|var)\s+\[/) ||
              nextLine.match(/^(const|let|var)\s+\w+\s*=/) ||
              nextLine.match(/^return\s*\(/)) {
            issues.push({
              message: `函数 ${functionName} 定义后缺少开括号 { (行 ${i + 1})`,
              suggestion: '函数定义后应该紧跟 { 开始函数体',
              line: i + 1
            });
          }
        }
      }

      // 如果函数定义行有 {，检查后面是否有完整的函数体
      if (hasOpenBrace) {
        // 检查这个函数是否有对应的 return 语句
        let braceCount = 1;
        let hasReturn = false;
        let foundClosingBrace = false;

        for (let j = i + 1; j < lines.length && braceCount > 0; j++) {
          const checkLine = lines[j];
          braceCount += (checkLine.match(/{/g) || []).length;
          braceCount -= (checkLine.match(/}/g) || []).length;

          if (checkLine.includes('return')) {
            hasReturn = true;
          }

          if (braceCount === 0) {
            foundClosingBrace = true;
            break;
          }
        }

        if (!foundClosingBrace) {
          issues.push({
            message: `函数 ${functionName} 没有正确闭合 (行 ${i + 1})`,
            suggestion: '函数体缺少闭合的 }',
            line: i + 1
          });
        }
      }
    }
  }

  return issues;
}

/**
 * 验证文件完整性（检测截断）
 */
export function validateCompleteness(files: FileInfo[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    // 只检查 JS/TS 文件
    if (!file.path.match(/\.(jsx?|tsx?)$/)) continue;

    const content = file.content;

    // 检查括号匹配
    const openBraces = (content.match(/{/g) || []).length;
    const closeBraces = (content.match(/}/g) || []).length;

    if (openBraces > closeBraces + 2) {
      issues.push({
        type: 'truncated_file',
        severity: 'error',
        file: file.path,
        message: `文件可能被截断: ${openBraces} 个开括号, 只有 ${closeBraces} 个闭括号`,
        suggestion: '需要补全文件的剩余部分'
      });
    }

    // 检查圆括号匹配
    const openParens = (content.match(/\(/g) || []).length;
    const closeParens = (content.match(/\)/g) || []).length;

    if (openParens > closeParens + 2) {
      issues.push({
        type: 'truncated_file',
        severity: 'error',
        file: file.path,
        message: `文件可能被截断: ${openParens} 个开圆括号, 只有 ${closeParens} 个闭圆括号`,
        suggestion: '需要补全文件的剩余部分'
      });
    }

    // 检查方括号匹配
    const openBrackets = (content.match(/\[/g) || []).length;
    const closeBrackets = (content.match(/\]/g) || []).length;

    if (openBrackets > closeBrackets + 2) {
      issues.push({
        type: 'truncated_file',
        severity: 'warning',
        file: file.path,
        message: `文件可能被截断: ${openBrackets} 个开方括号, 只有 ${closeBrackets} 个闭方括号`,
        suggestion: '检查数组或属性访问是否完整'
      });
    }

    // 检查是否有 export 语句
    if (!content.includes('export ')) {
      issues.push({
        type: 'syntax_error',
        severity: 'warning',
        file: file.path,
        message: '文件没有 export 语句',
        suggestion: '添加 export default 或 export const'
      });
    }

    // 检查明显的截断标志
    if (content.trim().endsWith('...') ||
        content.trim().endsWith('//') ||
        content.trim().endsWith('/*') ||
        content.trim().endsWith(',') ||
        content.trim().endsWith('(') ||
        content.trim().endsWith('{')) {
      issues.push({
        type: 'truncated_file',
        severity: 'error',
        file: file.path,
        message: '文件在不完整的位置结束',
        suggestion: '需要补全文件的剩余部分'
      });
    }

    // 检查 React 组件是否有完整的 return 语句
    if (file.path.match(/\.(jsx|tsx)$/) && content.includes('function')) {
      const hasReturn = content.includes('return');
      const hasJSX = content.includes('<');

      if (hasJSX && !hasReturn) {
        issues.push({
          type: 'truncated_file',
          severity: 'error',
          file: file.path,
          message: 'React 组件没有 return 语句',
          suggestion: '添加 return 语句返回 JSX'
        });
      }
    }

    // 🔥 检查 import 语句是否在正确位置（文件顶部）
    const misplacedImports = detectMisplacedImports(content);
    if (misplacedImports.length > 0) {
      for (const misplaced of misplacedImports) {
        issues.push({
          type: 'syntax_error',
          severity: 'error',
          file: file.path,
          message: `import 语句出现在函数体内部 (行 ${misplaced.line}): ${misplaced.statement.substring(0, 50)}...`,
          suggestion: '将 import 语句移动到文件顶部'
        });
      }
    }

    // 🔥 检查跨文件代码混入（一个文件内出现多个 export default）
    const exportDefaultMatches = content.match(/export\s+default\s+(function|class|const)/g) || [];
    if (exportDefaultMatches.length > 1) {
      issues.push({
        type: 'syntax_error',
        severity: 'error',
        file: file.path,
        message: `检测到 ${exportDefaultMatches.length} 个 export default 语句，可能是跨文件代码混入`,
        suggestion: '每个文件只能有一个 export default'
      });
    }

    // 🔥 检查 JSX 内出现函数定义（严重的结构错误）
    const jsxFunctionMixup = detectJSXFunctionMixup(content);
    if (jsxFunctionMixup.length > 0) {
      for (const issue of jsxFunctionMixup) {
        issues.push({
          type: 'syntax_error',
          severity: 'error',
          file: file.path,
          message: issue.message,
          suggestion: issue.suggestion
        });
      }
    }

    // 🔥 检查函数体完整性（function 后是否有正确的 { } 结构）
    const functionBodyIssues = detectIncompleteFunctionBody(content);
    if (functionBodyIssues.length > 0) {
      for (const issue of functionBodyIssues) {
        issues.push({
          type: 'truncated_file',
          severity: 'error',
          file: file.path,
          message: issue.message,
          suggestion: issue.suggestion
        });
      }
    }
  }

  return issues;
}

/**
 * 检测循环依赖
 */
export function detectCircularDependencies(files: FileInfo[]): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const dependencies = new Map<string, Set<string>>();

  // 构建依赖图
  for (const file of files) {
    if (!file.path.match(/\.(jsx?|tsx?)$/)) continue;

    const deps = new Set<string>();
    const importRegex = /import\s+.*\s+from\s+['"](\.[^'"]+)['"]/g;
    let match;

    while ((match = importRegex.exec(file.content)) !== null) {
      const baseDir = file.path.substring(0, file.path.lastIndexOf('/'));
      const targetPath = resolveImportPath(baseDir, match[1]);
      deps.add(targetPath);
    }

    dependencies.set(file.path, deps);
  }

  // 检测循环依赖
  function detectCycle(file: string, visited: Set<string>, path: string[]): string[] | null {
    if (path.includes(file)) {
      return [...path, file];
    }
    if (visited.has(file)) {
      return null;
    }

    visited.add(file);
    path.push(file);

    const deps = dependencies.get(file);
    if (deps) {
      for (const dep of deps) {
        // 匹配依赖路径
        const matchingFile = [...dependencies.keys()].find(f =>
          f === dep ||
          f === dep + '.jsx' ||
          f === dep + '.js' ||
          f === dep + '.tsx' ||
          f === dep + '.ts'
        );

        if (matchingFile) {
          const cycle = detectCycle(matchingFile, visited, [...path]);
          if (cycle) {
            return cycle;
          }
        }
      }
    }

    return null;
  }

  for (const file of dependencies.keys()) {
    const cycle = detectCycle(file, new Set(), []);
    if (cycle) {
      issues.push({
        type: 'circular_dependency',
        severity: 'warning',
        file: file,
        message: `检测到循环依赖: ${cycle.join(' -> ')}`,
        suggestion: '重构代码以打破循环依赖'
      });
      break; // 只报告第一个循环依赖
    }
  }

  return issues;
}

/**
 * 生成缺失文件的提示词
 */
export function generateMissingFilePrompt(missingFiles: string[], existingFiles: FileInfo[]): string {
  const existingFilesInfo = existingFiles.map(f => `- ${f.path}`).join('\n');

  return `
你之前生成的代码缺少以下文件，请补充生成：

缺少的文件:
${missingFiles.map(f => `- ${f}`).join('\n')}

已存在的文件:
${existingFilesInfo}

请只生成缺少的文件，格式如下：
<file path="文件路径">
完整的文件内容
</file>

重要：
1. 每个文件必须完整，不能截断
2. 确保与已存在的文件兼容
3. 使用相同的代码风格和 Tailwind CSS 类名`;
}

/**
 * 生成截断文件的修复提示词
 */
export function generateTruncatedFilePrompt(file: FileInfo): string {
  return `
以下文件被截断了，请补全：

文件: ${file.path}
当前内容:
\`\`\`
${file.content}
\`\`\`

请生成这个文件的完整版本，格式如下：
<file path="${file.path}">
完整的文件内容
</file>

重要：
1. 保持现有代码的风格和逻辑
2. 补全所有缺少的括号、标签和代码
3. 确保文件可以正常运行`;
}

/**
 * 生成严重结构错误文件的重生成提示词
 *
 * 用于处理以下情况：
 * - 多个 export default（代码混入）
 * - 函数定义在 JSX 内部
 * - 严重的括号/标签不匹配
 */
export function generateCorruptedFilePrompt(file: FileInfo, issues: string[]): string {
  // 尝试从损坏的代码中提取组件名称
  const componentMatch = file.content.match(/(?:export\s+default\s+)?function\s+([A-Z][a-zA-Z0-9]*)/);
  const componentName = componentMatch ? componentMatch[1] : file.path.split('/').pop()?.replace(/\.[jt]sx?$/, '') || 'Component';

  // 尝试提取 props
  const propsMatch = file.content.match(/function\s+[A-Z][a-zA-Z0-9]*\s*\(\s*\{([^}]*)\}/);
  const propsHint = propsMatch ? `Props: { ${propsMatch[1].trim()} }` : '';

  // 尝试提取导入的依赖
  const imports = file.content.match(/import\s+.*\s+from\s+['"][^'"]+['"]/g) || [];
  const uniqueImports = [...new Set(imports)].slice(0, 10); // 最多保留10个

  return `
文件 ${file.path} 存在严重的结构错误，需要完全重新生成。

检测到的问题：
${issues.map(i => `- ${i}`).join('\n')}

请根据以下信息重新生成这个文件：

组件名称: ${componentName}
${propsHint}
${uniqueImports.length > 0 ? `可能需要的导入:\n${uniqueImports.join('\n')}` : ''}

文件路径: ${file.path}

请生成一个完整、正确的 React 组件，格式如下：
<file path="${file.path}">
// 完整的组件代码
// 1. 所有 import 语句在文件顶部
// 2. 一个 export default function ${componentName}
// 3. 正确的 JSX 结构
</file>

🚨 关键要求：
1. 所有 import 必须在文件顶部
2. 只能有一个 export default
3. 所有 JSX 标签必须正确闭合
4. 函数体必须完整`;
}

/**
 * 执行自动修复
 */
export async function autoFix(
  generatedCode: string,
  model: LanguageModel,
  maxIterations: number = 2
): Promise<FixResult> {
  let files = extractFiles(generatedCode);
  let iterations = 0;
  let remainingIssues: ValidationIssue[] = [];

  // 🔥 STEP 0: 首先清理中文文本混入（截断续写最常见的问题）
  let totalChineseTextFixes = 0;
  files = files.map(file => {
    if (!file.path.match(/\.(jsx?|tsx?)$/)) return file;

    const { cleaned, issues } = detectAndCleanMixedChineseText(file.content);
    if (issues.length > 0) {
      totalChineseTextFixes += issues.length;
      console.log(`[autoFix] 清理了 ${file.path} 中的 ${issues.length} 处中文文本混入:`);
      issues.forEach(issue => {
        console.log(`  - 行 ${issue.line}: "${issue.chineseText}" -> "${issue.cleanedLine.substring(0, 50)}..."`);
      });
      return { ...file, content: cleaned };
    }
    return file;
  });

  if (totalChineseTextFixes > 0) {
    console.log(`[autoFix] 总共清理了 ${totalChineseTextFixes} 处中文文本混入`);
  }

  // 🔥 STEP 1: 修复 misplaced imports（截断拼接常见的问题）
  let totalImportFixes = 0;
  files = files.map(file => {
    if (!file.path.match(/\.(jsx?|tsx?)$/)) return file;

    const { fixed, fixedCount } = fixMisplacedImports(file.content);
    if (fixedCount > 0) {
      totalImportFixes += fixedCount;
      console.log(`[autoFix] 修复了 ${file.path} 中的 ${fixedCount} 个错位 import`);
      return { ...file, content: fixed };
    }
    return file;
  });

  if (totalImportFixes > 0) {
    console.log(`[autoFix] 总共修复了 ${totalImportFixes} 个错位的 import 语句`);
  }

  while (iterations < maxIterations) {
    iterations++;

    // 验证依赖
    const depIssues = validateDependencies(files);
    // 验证完整性
    const completenessIssues = validateCompleteness(files);
    // 检测循环依赖
    const circularIssues = detectCircularDependencies(files);

    const allIssues = [...depIssues, ...completenessIssues, ...circularIssues];
    const errors = allIssues.filter(i => i.severity === 'error');

    if (errors.length === 0) {
      // 没有严重错误，返回成功
      return {
        success: true,
        fixedFiles: files,
        remainingIssues: allIssues.filter(i => i.severity === 'warning'),
        iterations
      };
    }

    remainingIssues = allIssues;

    // 尝试修复缺失的文件
    const missingImports = depIssues.filter(i => i.type === 'missing_import');
    if (missingImports.length > 0) {
      const missingFiles = [...new Set(missingImports.map(i => {
        // 从消息中提取缺失的文件路径
        const match = i.message.match(/导入了不存在的模块: (\S+)/);
        if (match) {
          const baseDir = i.file.substring(0, i.file.lastIndexOf('/'));
          const resolvedPath = resolveImportPath(baseDir, match[1]);

          // 如果 import 已经带扩展名，直接使用
          if (resolvedPath.match(/\.(jsx?|tsx?)$/)) {
            return resolvedPath;
          }

          const ext = inferMissingFileExtension(i.file, files);
          return resolvedPath + ext;
        }
        return '';
      }).filter(f => f))];

      if (missingFiles.length > 0) {
        try {
          const prompt = generateMissingFilePrompt(missingFiles, files);
          // 使用 as any 绕过类型检查，因为 AI SDK 类型定义可能不完整
          const result = await streamText({
            model,
            messages: [
              { role: 'system', content: '你是一个 React 代码生成专家。请生成缺失的文件，确保完整且可运行。' },
              { role: 'user', content: prompt }
            ]
          } as Parameters<typeof streamText>[0]);

          let fixedCode = '';
          for await (const chunk of result.textStream) {
            fixedCode += chunk;
          }

          // 提取修复的文件
          const fixedFiles = extractFiles(fixedCode);
          files = [...files, ...fixedFiles];

          console.log(`[multi-turn-fix] 第 ${iterations} 轮修复: 添加了 ${fixedFiles.length} 个缺失文件`);
          continue;
        } catch (error) {
          console.error('[multi-turn-fix] 修复缺失文件失败:', error);
        }
      }
    }

    // 尝试修复截断的文件
    const truncatedIssues = completenessIssues.filter(i => i.type === 'truncated_file');
    if (truncatedIssues.length > 0) {
      const truncatedFile = files.find(f => f.path === truncatedIssues[0].file);
      if (truncatedFile) {
        try {
          const prompt = generateTruncatedFilePrompt(truncatedFile);
          // 使用类型断言绕过类型检查
          const result = await streamText({
            model,
            messages: [
              { role: 'system', content: '你是一个 React 代码生成专家。请补全截断的文件，确保完整且可运行。' },
              { role: 'user', content: prompt }
            ]
          } as Parameters<typeof streamText>[0]);

          let fixedCode = '';
          for await (const chunk of result.textStream) {
            fixedCode += chunk;
          }

          // 提取修复的文件
          const fixedFiles = extractFiles(fixedCode);
          if (fixedFiles.length > 0) {
            // 替换原文件
            const idx = files.findIndex(f => f.path === truncatedFile.path);
            if (idx !== -1) {
              files[idx] = fixedFiles[0];
              console.log(`[multi-turn-fix] 第 ${iterations} 轮修复: 补全了 ${truncatedFile.path}`);
              continue;
            }
          }
        } catch (error) {
          console.error('[multi-turn-fix] 修复截断文件失败:', error);
        }
      }
    }

    // 🔥 尝试修复严重结构错误的文件（代码混入、JSX内函数定义等）
    const syntaxErrorIssues = completenessIssues.filter(i => i.type === 'syntax_error');
    if (syntaxErrorIssues.length > 0) {
      // 按文件分组错误
      const fileErrors = new Map<string, string[]>();
      for (const issue of syntaxErrorIssues) {
        if (!fileErrors.has(issue.file)) {
          fileErrors.set(issue.file, []);
        }
        fileErrors.get(issue.file)!.push(issue.message);
      }

      // 处理每个有错误的文件
      for (const [filePath, errorMessages] of fileErrors) {
        const corruptedFile = files.find(f => f.path === filePath);
        if (corruptedFile) {
          try {
            console.log(`[multi-turn-fix] 🔧 尝试重新生成严重错误的文件: ${filePath}`);
            console.log(`[multi-turn-fix] 错误详情: ${errorMessages.join('; ')}`);

            const prompt = generateCorruptedFilePrompt(corruptedFile, errorMessages);
            const result = await streamText({
              model,
              messages: [
                {
                  role: 'system',
                  content: `你是一个 React 代码生成专家。
请完全重新生成一个有严重结构错误的文件。

🚨 关键规则：
1. 所有 import 语句必须在文件最顶部
2. 只能有一个 export default
3. 函数定义必须在文件顶层，不能在 JSX 内部
4. 所有 JSX 标签必须正确闭合
5. 函数体必须完整（有开括号就必须有闭括号）`
                },
                { role: 'user', content: prompt }
              ]
            } as Parameters<typeof streamText>[0]);

            let fixedCode = '';
            for await (const chunk of result.textStream) {
              fixedCode += chunk;
            }

            // 提取修复的文件
            const fixedFiles = extractFiles(fixedCode);
            if (fixedFiles.length > 0) {
              // 验证修复后的文件是否仍有问题
              const newIssues = validateCompleteness(fixedFiles);
              const newErrors = newIssues.filter(i => i.severity === 'error' && i.type === 'syntax_error');

              if (newErrors.length < errorMessages.length) {
                // 修复有效，替换原文件
                const idx = files.findIndex(f => f.path === corruptedFile.path);
                if (idx !== -1) {
                  files[idx] = fixedFiles[0];
                  console.log(`[multi-turn-fix] ✅ 成功重新生成: ${filePath}`);
                }
              } else {
                console.warn(`[multi-turn-fix] ⚠️ 重新生成后仍有问题: ${filePath}`);
              }
            }
          } catch (error) {
            console.error(`[multi-turn-fix] 重新生成 ${filePath} 失败:`, error);
          }
        }
      }
      continue; // 继续下一轮检查
    }

    // 如果没有成功修复任何内容，退出循环
    break;
  }

  return {
    success: remainingIssues.filter(i => i.severity === 'error').length === 0,
    fixedFiles: files,
    remainingIssues,
    iterations
  };
}

/**
 * 将修复后的文件重新组装为生成代码格式
 */
export function assembleGeneratedCode(files: FileInfo[]): string {
  return files.map(f => `<file path="${f.path}">\n${f.content}\n</file>`).join('\n\n');
}
