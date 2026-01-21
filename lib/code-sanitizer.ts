/**
 * 代码清理工具 - 修复AI生成代码的常见问题
 */

/**
 * 修复重复的import语句
 */
export function fixDuplicateImports(code: string): string {
  const lines = code.split('\n');
  const importMap = new Map<string, Set<string>>();
  const nonImportLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    // 匹配 import 语句
    const importMatch = trimmed.match(/^import\s+(?:(\w+)\s*,\s*)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/);

    if (importMatch) {
      const [, defaultImport, namedImports, source] = importMatch;

      if (!importMap.has(source)) {
        importMap.set(source, new Set());
      }

      const imports = importMap.get(source)!;

      // 添加默认导入
      if (defaultImport) {
        imports.add(`default:${defaultImport}`);
      }

      // 添加命名导入
      namedImports.split(',').forEach(imp => {
        const cleaned = imp.trim();
        if (cleaned) {
          imports.add(cleaned);
        }
      });
    } else if (trimmed.startsWith('import ')) {
      // 处理其他import格式 (如 import React from 'react')
      const simpleMatch = trimmed.match(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/);
      if (simpleMatch) {
        const [, defaultImport, source] = simpleMatch;
        if (!importMap.has(source)) {
          importMap.set(source, new Set());
        }
        importMap.get(source)!.add(`default:${defaultImport}`);
      } else {
        nonImportLines.push(line);
      }
    } else {
      nonImportLines.push(line);
    }
  }

  // 重建import语句
  const rebuiltImports: string[] = [];
  for (const [source, imports] of importMap.entries()) {
    const defaultImports = Array.from(imports).filter(i => i.startsWith('default:'));
    const namedImports = Array.from(imports).filter(i => !i.startsWith('default:'));

    if (defaultImports.length > 0 && namedImports.length > 0) {
      const defaultName = defaultImports[0].replace('default:', '');
      rebuiltImports.push(`import ${defaultName}, { ${namedImports.join(', ')} } from '${source}';`);
    } else if (defaultImports.length > 0) {
      const defaultName = defaultImports[0].replace('default:', '');
      rebuiltImports.push(`import ${defaultName} from '${source}';`);
    } else if (namedImports.length > 0) {
      rebuiltImports.push(`import { ${namedImports.join(', ')} } from '${source}';`);
    }
  }

  return [...rebuiltImports, ...nonImportLines].join('\n');
}

/**
 * 清理代码 - 应用所有修复规则
 */
export function sanitizeCode(code: string, filePath: string): string {
  let sanitized = code;

  // 只对JS/TS/JSX/TSX文件应用import修复
  if (/\.(jsx?|tsx?)$/.test(filePath)) {
    sanitized = fixDuplicateImports(sanitized);
  }

  return sanitized;
}
