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
 * 从生成的代码中提取所有文件
 */
export function extractFiles(generatedCode: string): FileInfo[] {
  const fileRegex = /<file path="([^"]+)">([\s\S]*?)<\/file>/g;
  const files: FileInfo[] = [];
  let match;

  while ((match = fileRegex.exec(generatedCode)) !== null) {
    files.push({
      path: match[1],
      content: match[2].trim()
    });
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
