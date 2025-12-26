import type { FileManifestItem } from '@/types/generation';

/**
 * 生成链路中的依赖/路径兜底工具（纯前端可运行）
 *
 * 目标：
 * - 规范化 manifest / file path（对齐 apply 阶段的 src/ 前缀逻辑）
 * - 解析相对导入并推断缺失的本地文件路径
 *
 * 为什么需要：
 * - 模型可能在生成文件时“先写 import 后漏文件”，或路径不一致（如把组件写到 src 根目录）
 * - Vite 会在 dev 阶段直接报错：Failed to resolve import ...
 */

const CONFIG_FILE_NAMES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'vite.config.js',
  'tailwind.config.js',
  'postcss.config.js',
  'tsconfig.json',
]);

export function normalizeSandboxFilePath(inputPath: string): string {
  const trimmed = (inputPath || '').trim();
  if (!trimmed) return trimmed;

  let normalized = trimmed.replace(/\\/g, '/');
  if (normalized.startsWith('/')) normalized = normalized.slice(1);

  const fileName = normalized.split('/').pop() || '';
  const isConfig = CONFIG_FILE_NAMES.has(fileName);

  if (
    !normalized.startsWith('src/') &&
    !normalized.startsWith('public/') &&
    normalized !== 'index.html' &&
    !isConfig
  ) {
    normalized = `src/${normalized}`;
  }

  return normalized;
}

function isComponentLikeFileName(fileName: string): boolean {
  return /^[A-Z][A-Za-z0-9_]*\.(jsx|tsx)$/.test(fileName);
}

function relocateComponentToSrcComponents(path: string, type?: FileManifestItem['type']): string {
  if (!path.startsWith('src/')) return path;

  const fileName = path.split('/').pop() || '';
  const isEntryOrApp =
    fileName === 'App.jsx' ||
    fileName === 'App.tsx' ||
    fileName === 'main.jsx' ||
    fileName === 'main.tsx' ||
    fileName === 'main.js' ||
    fileName === 'main.ts';
  if (isEntryOrApp) return path;

  const isJsxLike = /\.(jsx|tsx)$/.test(fileName);
  const isTopLevelInSrc = path.split('/').length === 2; // src/<file>
  const shouldRelocate =
    isTopLevelInSrc && isJsxLike && (type === 'component' || isComponentLikeFileName(fileName));

  return shouldRelocate ? `src/components/${fileName}` : path;
}

/**
 * 规范化 manifest：
 * - 对齐 src/ 前缀逻辑
 * - 将疑似组件（PascalCase.jsx/tsx）从 src 根目录移动到 src/components/
 * - 去重（以 path 为准）
 */
export function normalizeManifestForVite(manifest: FileManifestItem[]): FileManifestItem[] {
  const pathMap = new Map<string, string>(); // original → normalized

  for (const item of manifest) {
    const original = (item?.path || '').trim();
    if (!original) continue;
    const p1 = normalizeSandboxFilePath(original);
    const p2 = relocateComponentToSrcComponents(p1, item?.type);
    pathMap.set(original, p2);
  }

  const seen = new Set<string>();
  const normalizedManifest: FileManifestItem[] = [];

  for (const item of manifest) {
    if (!item?.path) continue;
    const normalizedPath = pathMap.get(item.path) || relocateComponentToSrcComponents(normalizeSandboxFilePath(item.path), item.type);
    if (!normalizedPath) continue;
    if (seen.has(normalizedPath)) continue;
    seen.add(normalizedPath);

    const normalizedDependencies = (item.dependencies || [])
      .map(dep => pathMap.get(dep) || relocateComponentToSrcComponents(normalizeSandboxFilePath(dep)))
      .filter(Boolean);

    normalizedManifest.push({
      ...item,
      path: normalizedPath,
      dependencies: normalizedDependencies,
    });
  }

  return normalizedManifest;
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(0, idx) : '';
}

function resolvePosixPath(baseDir: string, relativePath: string): string {
  const rel = relativePath.replace(/\\/g, '/');
  const rawParts = `${baseDir}/${rel}`.split('/');
  const stack: string[] = [];

  for (const part of rawParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }

  return stack.join('/');
}

function stripImportQuery(specifier: string): string {
  return specifier.split(/[?#]/)[0] || specifier;
}

function extractRelativeSpecifiers(content: string): string[] {
  const specifiers: string[] = [];

  // import ... from '...'
  const importRegex = /import\s+(?:[\w*\s{},]*\s+from\s+)?['"]([^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRegex.exec(content)) !== null) {
    const s = stripImportQuery(m[1] || '');
    if (s.startsWith('.')) specifiers.push(s);
  }

  // export ... from '...'
  const exportFromRegex = /export\s+(?:[\w*\s{},]+)\s+from\s+['"]([^'"]+)['"]/g;
  while ((m = exportFromRegex.exec(content)) !== null) {
    const s = stripImportQuery(m[1] || '');
    if (s.startsWith('.')) specifiers.push(s);
  }

  // 动态 import('...')
  const dynamicImportRegex = /import\(\s*['"]([^'"]+)['"]\s*\)/g;
  while ((m = dynamicImportRegex.exec(content)) !== null) {
    const s = stripImportQuery(m[1] || '');
    if (s.startsWith('.')) specifiers.push(s);
  }

  return specifiers;
}

function hasKnownExtension(specifier: string): boolean {
  return /\.(jsx|js|tsx|ts|css|scss|sass|less)$/.test(specifier);
}

function inferPreferredExtensions(importerPath: string, hasTypeScript: boolean): string[] {
  const importerExt = importerPath.split('.').pop()?.toLowerCase();
  const prefersTs = importerExt === 'ts' || importerExt === 'tsx' || hasTypeScript;

  return prefersTs
    ? ['.tsx', '.ts', '.jsx', '.js']
    : ['.jsx', '.js', '.tsx', '.ts'];
}

/**
 * 找出某个文件内容里缺失的“本地相对导入”文件路径（返回建议生成的 path 列表）。
 */
export function findMissingLocalFilesFromContent(params: {
  importerPath: string;
  content: string;
  knownPaths: Set<string>;
}): string[] {
  const importerPath = normalizeSandboxFilePath(params.importerPath);
  const content = params.content || '';
  const knownPaths = params.knownPaths;

  const hasTypeScript = Array.from(knownPaths).some(p => p.endsWith('.ts') || p.endsWith('.tsx'));
  const preferredExts = inferPreferredExtensions(importerPath, hasTypeScript);

  const baseDir = dirname(importerPath);
  const missing: string[] = [];
  const seen = new Set<string>();

  const specifiers = extractRelativeSpecifiers(content);
  for (const spec of specifiers) {
    // CSS 导入在 apply 阶段会被统一剔除（只保留 index.css），这里不作为缺失文件补全目标
    if (spec.endsWith('.css') || spec.endsWith('.scss') || spec.endsWith('.sass') || spec.endsWith('.less')) {
      continue;
    }

    const resolvedBase = resolvePosixPath(baseDir, spec);
    const normalizedBase = normalizeSandboxFilePath(resolvedBase);

    const candidates: string[] = [];
    if (hasKnownExtension(spec)) {
      candidates.push(normalizeSandboxFilePath(resolvePosixPath(baseDir, spec)));
    } else {
      for (const ext of preferredExts) {
        candidates.push(`${normalizedBase}${ext}`);
      }
      for (const ext of preferredExts) {
        candidates.push(`${normalizedBase}/index${ext}`);
      }
    }

    const exists = candidates.some(p => knownPaths.has(p));
    if (exists) continue;

    const suggested = candidates[0];
    if (!suggested || seen.has(suggested)) continue;
    seen.add(suggested);
    missing.push(suggested);
  }

  return missing;
}

