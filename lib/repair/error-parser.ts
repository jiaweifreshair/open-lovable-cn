/**
 * 前端错误解析器
 * 解析Vite/Babel编译错误信息
 */

export interface ParsedError {
  errorType: 'BABEL_SYNTAX_ERROR' | 'VITE_ERROR' | 'UNKNOWN';
  filePath: string;
  line: number;
  column: number;
  message: string;
  rawOutput: string;
}

/**
 * 解析Babel错误
 * 格式: [plugin:vite:react-babel] /path/to/file.jsx: Error message. (line:col)
 */
export function parseFrontendError(errorOutput: string): ParsedError | null {
  if (!errorOutput) return null;

  // Babel错误正则
  const babelPattern = /\[plugin:vite:react-babel\]\s+([^:]+):\s+(.+?)\s+\((\d+):(\d+)\)/;
  const match = errorOutput.match(babelPattern);

  if (match) {
    const [, filePath, message, line, column] = match;

    // 提取相对路径
    const relativePath = filePath.replace('/home/user/app/', '');

    return {
      errorType: 'BABEL_SYNTAX_ERROR',
      filePath: relativePath,
      line: parseInt(line),
      column: parseInt(column),
      message: message.trim(),
      rawOutput: errorOutput
    };
  }

  return null;
}
