/**
 * Babel语法错误修复器
 * 集成到multi-turn-fix-engine中
 */

import { parseFrontendError } from './error-parser';
import { autoRepairCode } from './ai-repair';
import type { FileInfo, ValidationIssue } from '../multi-turn-fix-engine';

/**
 * 尝试修复Babel语法错误
 * @param files 当前文件列表
 * @param errorOutput Babel错误输出
 * @returns 修复后的文件列表和问题列表
 */
export async function fixBabelSyntaxErrors(
  files: FileInfo[],
  errorOutput: string
): Promise<{ fixedFiles: FileInfo[]; issues: ValidationIssue[] }> {
  const issues: ValidationIssue[] = [];

  // 解析Babel错误
  const error = parseFrontendError(errorOutput);

  if (!error) {
    return { fixedFiles: files, issues };
  }

  console.log(`[fixBabelSyntaxErrors] 检测到Babel错误: ${error.filePath}:${error.line}:${error.column}`);

  // 查找对应的文件
  const targetFile = files.find(f => f.path === error.filePath);

  if (!targetFile) {
    issues.push({
      type: 'babel_syntax_error',
      severity: 'error',
      file: error.filePath,
      message: `文件不存在: ${error.filePath}`,
      rawOutput: errorOutput
    });
    return { fixedFiles: files, issues };
  }

  // 使用AI修复代码
  console.log(`[fixBabelSyntaxErrors] 尝试AI修复: ${error.filePath}`);
  const fixedCode = await autoRepairCode(error, targetFile.content);

  if (!fixedCode) {
    issues.push({
      type: 'babel_syntax_error',
      severity: 'error',
      file: error.filePath,
      message: `AI修复失败: ${error.message}`,
      rawOutput: errorOutput
    });
    return { fixedFiles: files, issues };
  }

  // 更新文件
  const fixedFiles = files.map(f =>
    f.path === error.filePath
      ? { ...f, content: fixedCode }
      : f
  );

  console.log(`[fixBabelSyntaxErrors] AI修复成功: ${error.filePath}`);

  return { fixedFiles, issues };
}
