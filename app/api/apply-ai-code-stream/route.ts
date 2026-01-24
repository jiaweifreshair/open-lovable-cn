import { NextRequest, NextResponse } from 'next/server';
import { parseMorphEdits, applyMorphEditToFile } from '@/lib/morph-fast-apply';
// Sandbox import not needed - using global sandbox from sandbox-manager
import type { SandboxState } from '@/types/sandbox';
import type { ConversationState } from '@/types/conversation';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import path from 'node:path';
// 🔥 引入修复引擎 - 用于清理截断续写时混入的问题
import {
  detectAndCleanMixedChineseText,
  fixMisplacedImports,
  normalizeXmlTags,
  repairBrokenXmlTags,
  inferFileBoundaries,
  validateDependencies,
  type FileInfo
} from '@/lib/multi-turn-fix-engine';
import {
  buildPlaceholderForMissingImport,
  mergeReactImports,
  parseImportClause,
  type MissingImportStubSpec
} from '@/lib/import-fixes';

declare global {
  var conversationState: ConversationState | null;
  var activeSandboxProvider: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
}

interface ParsedResponse {
  explanation: string;
  template: string;
  files: Array<{ path: string; content: string }>;
  packages: string[];
  commands: string[];
  structure: string | null;
}

/**
 * 确保 Tailwind 的最小“样式链路”完整可用：
 * 1) 入口文件（src/main.*）必须引入 `./index.css`，否则 Tailwind 不会生效，页面会呈现浏览器默认样式。
 * 2) `src/index.css` 必须包含 `@tailwind base/components/utilities` 指令（允许在其后追加自定义规则）。
 * 3) `tailwind.config.js` 的 content 需要覆盖常见目录（AI 可能把组件放到根目录 components/ 或 app/）。
 * 4) `postcss.config.js` 必须启用 tailwindcss 插件，否则 `@tailwind` 指令不会被编译。
 *
 * 为什么要做：
 * - AI 有时会在生成/编辑时误删入口的 CSS import，或覆盖 `src/index.css` 导致 Tailwind 指令丢失。
 * - 这会造成“CSS 渲染不行/像没加载样式”的问题，即使组件里写了大量 Tailwind class 也不会生效。
 *
 * 这里在 apply 阶段做兜底修复，保证预览至少不会“裸奔”。
 */
async function ensureTailwindWiring(
  providerInstance: { readFile: (path: string) => Promise<string>; writeFile: (path: string, content: string) => Promise<void> },
  sendProgress: (data: any) => Promise<void>,
  results: { filesCreated: string[]; filesUpdated: string[] }
): Promise<void> {
  const entryCandidates = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts'];
  let entryPath: string | null = null;
  let entryContent: string | null = null;

  for (const candidate of entryCandidates) {
    try {
      const content = await providerInstance.readFile(candidate);
      if (typeof content === 'string' && content.trim().length > 0) {
        entryPath = candidate;
        entryContent = content;
        break;
      }
    } catch {
      // ignore
    }
  }

  // 1) 入口文件必须 import './index.css'
  if (entryPath && entryContent) {
    const hasIndexCssImport = /import\s+['"]\.\/index\.css['"]\s*;?/m.test(entryContent);
    if (!hasIndexCssImport) {
      const importLineRegex = /^import[^\n]*$/gm;
      let lastImportEnd = -1;
      let match: RegExpExecArray | null;
      while ((match = importLineRegex.exec(entryContent)) !== null) {
        lastImportEnd = match.index + match[0].length;
      }

      const insertion = `\nimport './index.css'\n`;
      const updatedEntryContent = lastImportEnd >= 0
        ? entryContent.slice(0, lastImportEnd) + insertion + entryContent.slice(lastImportEnd)
        : `import './index.css'\n${entryContent}`;

      await providerInstance.writeFile(entryPath, updatedEntryContent);

      if (global.sandboxState?.fileCache) {
        global.sandboxState.fileCache.files[entryPath] = {
          content: updatedEntryContent,
          lastModified: Date.now()
        };
      }

      if (!results.filesUpdated.includes(entryPath)) {
        results.filesUpdated.push(entryPath);
      }

      await sendProgress({
        type: 'file-complete',
        fileName: entryPath,
        action: 'updated (tailwind import fix)'
      });
    }
  }

  // 2) src/index.css 必须包含 Tailwind 指令
  let indexCssContent: string | null = null;
  let indexCssExists = false;
  try {
    indexCssContent = await providerInstance.readFile('src/index.css');
    indexCssExists = typeof indexCssContent === 'string';
  } catch {
    indexCssExists = false;
  }

  const directiveChecks = [
    { name: 'base', text: '@tailwind base;', regex: /@tailwind\s+base\s*;/ },
    { name: 'components', text: '@tailwind components;', regex: /@tailwind\s+components\s*;/ },
    { name: 'utilities', text: '@tailwind utilities;', regex: /@tailwind\s+utilities\s*;/ }
  ];

  if (!indexCssContent || indexCssContent.trim().length === 0) {
    const minimalIndexCss = `${directiveChecks.map(d => d.text).join('\n')}\n`;
    await providerInstance.writeFile('src/index.css', minimalIndexCss);

    if (global.sandboxState?.fileCache) {
      global.sandboxState.fileCache.files['src/index.css'] = {
        content: minimalIndexCss,
        lastModified: Date.now()
      };
    }

    const targetList = indexCssExists ? results.filesUpdated : results.filesCreated;
    if (!targetList.includes('src/index.css')) {
      targetList.push('src/index.css');
    }

    await sendProgress({
      type: 'file-complete',
      fileName: 'src/index.css',
      action: indexCssExists ? 'updated (tailwind directives fix)' : 'created (tailwind directives)'
    });
  } else {
    const missingDirectives = directiveChecks.filter(d => !d.regex.test(indexCssContent as string)).map(d => d.text);

    if (missingDirectives.length > 0) {
      const insertion = `${missingDirectives.join('\n')}\n\n`;

      // @charset 必须位于 CSS 第一行（若存在），否则浏览器会忽略它
      const charsetMatch = (indexCssContent as string).match(/^@charset\s+["'][^"']+["'];\s*\n/i);
      const updatedIndexCss = charsetMatch
        ? (indexCssContent as string).slice(0, charsetMatch[0].length) + insertion + (indexCssContent as string).slice(charsetMatch[0].length)
        : insertion + (indexCssContent as string);

      await providerInstance.writeFile('src/index.css', updatedIndexCss);

      if (global.sandboxState?.fileCache) {
        global.sandboxState.fileCache.files['src/index.css'] = {
          content: updatedIndexCss,
          lastModified: Date.now()
        };
      }

      if (!results.filesUpdated.includes('src/index.css')) {
        results.filesUpdated.push('src/index.css');
      }

      await sendProgress({
        type: 'file-complete',
        fileName: 'src/index.css',
        action: 'updated (tailwind directives fix)'
      });
    }
  }

  // 3) tailwind.config.js：content 必须覆盖常见目录（避免组件放在 src/ 外导致 class 被裁剪）
  try {
    const tailwindConfigPath = 'tailwind.config.js';
    const tailwindConfig = await providerInstance.readFile(tailwindConfigPath);
    if (typeof tailwindConfig === 'string' && tailwindConfig.trim().length > 0) {
      const requiredGlobs = [
        './index.html',
        './src/**/*.{js,ts,jsx,tsx}',
        './components/**/*.{js,ts,jsx,tsx}',
        './app/**/*.{js,ts,jsx,tsx}',
        './*.{js,ts,jsx,tsx}',
      ];

      const missingGlobs = requiredGlobs.filter(glob => !tailwindConfig.includes(glob));
      if (missingGlobs.length > 0) {
        const contentArrayRegex = /content\s*:\s*\[([\s\S]*?)\]\s*,?/m;
        const match = contentArrayRegex.exec(tailwindConfig);
        if (match && typeof match.index === 'number') {
          const body = match[1] ?? '';

          const lineStart = tailwindConfig.lastIndexOf('\n', match.index) + 1;
          const propertyIndent = tailwindConfig.slice(lineStart, match.index).match(/^\s*/)?.[0] ?? '';
          const entryIndent = `${propertyIndent}  `;

          const quote = body.match(/['"]\.\//)?.[0]?.[0] ?? '"';
          const missingLines = missingGlobs.map(glob => `${entryIndent}${quote}${glob}${quote},`).join('\n');

          const bodyWithoutTrailing = body.replace(/\s*$/, '');
          const trailing = body.slice(bodyWithoutTrailing.length);
          const updatedBody = `${bodyWithoutTrailing}\n${missingLines}${trailing || '\n'}`;

          const updatedTailwindConfig = tailwindConfig.slice(0, match.index) +
            match[0].replace(body, updatedBody) +
            tailwindConfig.slice(match.index + match[0].length);

          await providerInstance.writeFile(tailwindConfigPath, updatedTailwindConfig);

          if (global.sandboxState?.fileCache) {
            global.sandboxState.fileCache.files[tailwindConfigPath] = {
              content: updatedTailwindConfig,
              lastModified: Date.now()
            };
          }

          if (!results.filesUpdated.includes(tailwindConfigPath)) {
            results.filesUpdated.push(tailwindConfigPath);
          }

          await sendProgress({
            type: 'file-complete',
            fileName: tailwindConfigPath,
            action: 'updated (tailwind content globs fix)'
          });
        }
      }
    }
  } catch {
    // ignore：有些模板/环境可能不存在 tailwind.config.js
  }

  // 4) postcss.config.js：必须启用 tailwindcss 插件，否则 @tailwind 指令不会生效
  try {
    const postcssConfigPath = 'postcss.config.js';
    let postcssConfig: string | null = null;
    let postcssExists = false;

    try {
      postcssConfig = await providerInstance.readFile(postcssConfigPath);
      postcssExists = typeof postcssConfig === 'string';
    } catch {
      postcssExists = false;
    }

    const hasTailwindPlugin = typeof postcssConfig === 'string' && postcssConfig.includes('tailwindcss');
    if (!hasTailwindPlugin) {
      const minimalPostcssConfig = `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
}
`;

      await providerInstance.writeFile(postcssConfigPath, minimalPostcssConfig);

      if (global.sandboxState?.fileCache) {
        global.sandboxState.fileCache.files[postcssConfigPath] = {
          content: minimalPostcssConfig,
          lastModified: Date.now()
        };
      }

      const targetList = postcssExists ? results.filesUpdated : results.filesCreated;
      if (!targetList.includes(postcssConfigPath)) {
        targetList.push(postcssConfigPath);
      }

      await sendProgress({
        type: 'file-complete',
        fileName: postcssConfigPath,
        action: postcssExists ? 'updated (tailwind postcss fix)' : 'created (tailwind postcss)'
      });
    }
  } catch {
    // ignore
  }
}

/**
 * 确保 Vite/React 的入口文件真正挂载到 #root，避免“预览白屏”。
 *
 * 背景：
 * - 预览模板的 `index.html` 默认执行 `src/main.*`。
 * - AI 生成/续写时偶尔会把 `src/main.jsx` 写成“纯组件文件”（只有 export default），
 *   没有 ReactDOM.createRoot(...).render(...) 的副作用挂载逻辑，导致页面永远空白。
 *
 * 这里在 apply 阶段做兜底：
 * - 若入口文件缺失或未检测到挂载逻辑，则重写为标准入口文件（并保留 Tailwind 的 `./index.css` 导入）。
 */
async function ensureViteEntryPointMountsApp(
  providerInstance: { readFile: (path: string) => Promise<string>; writeFile: (path: string, content: string) => Promise<void> },
  sendProgress: (data: any) => Promise<void>,
  results: { filesCreated: string[]; filesUpdated: string[] }
): Promise<void> {
  const entryCandidates = ['src/main.jsx', 'src/main.tsx', 'src/main.js', 'src/main.ts'];
  let entryPath: string | null = null;
  let entryContent: string | null = null;

  for (const candidate of entryCandidates) {
    try {
      const content = await providerInstance.readFile(candidate);
      if (typeof content === 'string' && content.trim().length > 0) {
        entryPath = candidate;
        entryContent = content;
        break;
      }
    } catch {
      // ignore
    }
  }

  // 尽量选择正确的 App 文件（AI 可能生成 App.tsx 或 App.jsx）
  let appImport = './App.jsx';
  try {
    const appTsx = await providerInstance.readFile('src/App.tsx');
    if (typeof appTsx === 'string' && appTsx.trim().length > 0) {
      appImport = './App.tsx';
    }
  } catch {
    // ignore
  }

  try {
    const appJsx = await providerInstance.readFile('src/App.jsx');
    if (typeof appJsx === 'string' && appJsx.trim().length > 0) {
      appImport = './App.jsx';
    }
  } catch {
    // ignore
  }

  const buildStandardEntry = () => `import React from 'react'
import ReactDOM from 'react-dom/client'
import App from '${appImport}'
import './index.css'

const rootElement = document.getElementById('root')
if (!rootElement) throw new Error('Root element not found')

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)`;

  // 如果入口文件缺失，直接补一个默认入口（与模板保持一致）
  if (!entryPath || !entryContent) {
    const fallbackEntryPath = 'src/main.jsx';
    const fallbackEntryContent = buildStandardEntry();
    await providerInstance.writeFile(fallbackEntryPath, fallbackEntryContent);

    if (global.sandboxState?.fileCache) {
      global.sandboxState.fileCache.files[fallbackEntryPath] = {
        content: fallbackEntryContent,
        lastModified: Date.now()
      };
    }

    if (!results.filesCreated.includes(fallbackEntryPath) && !results.filesUpdated.includes(fallbackEntryPath)) {
      results.filesCreated.push(fallbackEntryPath);
    }

    await sendProgress({
      type: 'file-complete',
      fileName: fallbackEntryPath,
      action: 'created (entry mount fix)'
    });
    return;
  }

  const hasMountCall =
    /ReactDOM\s*\.\s*(createRoot|render)\s*\(/.test(entryContent) || /\bcreateRoot\s*\(/.test(entryContent);
  const targetsRoot =
    /getElementById\s*\(\s*['"]root['"]\s*\)/.test(entryContent) || /querySelector\s*\(\s*['"]#root['"]\s*\)/.test(entryContent);
  const looksMounted = hasMountCall && targetsRoot;

  if (looksMounted) return;

  const updatedEntryContent = buildStandardEntry();
  await providerInstance.writeFile(entryPath, updatedEntryContent);

  if (global.sandboxState?.fileCache) {
    global.sandboxState.fileCache.files[entryPath] = {
      content: updatedEntryContent,
      lastModified: Date.now()
    };
  }

  if (!results.filesUpdated.includes(entryPath)) {
    results.filesUpdated.push(entryPath);
  }

  await sendProgress({
    type: 'file-complete',
    fileName: entryPath,
    action: 'updated (entry mount fix)'
  });
}

/**
 * 确保“本地相对导入”的目标文件存在：
 * - 若缺失：自动创建占位文件，避免 Vite 报错阻塞预览
 *
 * 注意：这里只做“兜底可运行”，完整业务实现应由生成阶段补齐。
 */
async function ensureMissingImportedFilesExist(
  providerInstance: {
    runCommand: (cmd: string) => Promise<any>;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, content: string) => Promise<void>;
  },
  filesWithContent: FileInfo[],
  sendProgress: (data: any) => Promise<void>,
  results: { filesCreated: string[]; filesUpdated: string[]; errors: string[] }
): Promise<void> {
  function normalizeExportName(raw: string): string | null {
    const trimmed = raw.trim().replace(/^type\s+/, '').trim();
    if (!trimmed) return null;
    const parts = trimmed.split(/\s+as\s+/i);
    const exportName = (parts[0] ?? '').trim();
    if (!exportName) return null;
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(exportName) ? exportName : null;
  }

  function upsertStubSpec(map: Map<string, MissingImportStubSpec>, key: string, next: MissingImportStubSpec) {
    const existing = map.get(key);
    if (!existing) {
      map.set(key, next);
      return;
    }

    const mergedNamed = new Set<string>(existing.namedExports ?? []);
    for (const name of next.namedExports ?? []) mergedNamed.add(name);
    map.set(key, {
      defaultImportName: existing.defaultImportName || next.defaultImportName,
      namedExports: Array.from(mergedNamed)
    });
  }

  function buildStubSpecLookup(files: FileInfo[]): Map<string, MissingImportStubSpec> {
    const lookup = new Map<string, MissingImportStubSpec>();
    const importRegex = /^\s*import\s+([^'";]+?)\s+from\s+['"](\.[^'"]+)['"]\s*;?\s*$/gm;

    for (const file of files) {
      if (!file?.path || !file?.content) continue;
      if (!file.path.match(/\.(jsx?|tsx?)$/)) continue;
      importRegex.lastIndex = 0;

      const baseDir = file.path.includes('/') ? file.path.substring(0, file.path.lastIndexOf('/')) : '';
      let match: RegExpExecArray | null;
      while ((match = importRegex.exec(file.content)) !== null) {
        const clause = match[1]?.trim() ?? '';
        const importPath = match[2]?.trim() ?? '';
        if (!importPath || !importPath.startsWith('.')) continue;

        // 仅处理 JS/TS 模块导入；样式导入不需要做 export 兜底
        if (/\.(css|scss|sass|less)$/.test(importPath)) continue;

        const parsed = parseImportClause(clause);
        if (parsed.namespaceImportName) continue;

        const namedExports = parsed.namedImports
          .map(normalizeExportName)
          .filter((v): v is string => Boolean(v));

        const resolved = path.posix.normalize(path.posix.join(baseDir, importPath));
        const resolvedNoExt = resolved.replace(/\.(jsx?|tsx?)$/, '');

        const spec: MissingImportStubSpec = {
          defaultImportName: parsed.defaultImportName,
          namedExports
        };

        upsertStubSpec(lookup, resolved, spec);
        upsertStubSpec(lookup, resolvedNoExt, spec);
      }
    }

    return lookup;
  }

  function resolveExistingModulePath(targetBase: string, allPaths: Set<string>): string | null {
    if (allPaths.has(targetBase)) return targetBase;

    const baseNoExt = targetBase.replace(/\.(jsx?|tsx?)$/, '');
    const exts = ['.jsx', '.js', '.tsx', '.ts'];

    for (const ext of exts) {
      const candidate = `${baseNoExt}${ext}`;
      if (allPaths.has(candidate)) return candidate;
    }

    for (const ext of exts) {
      const candidate = `${baseNoExt}/index${ext}`;
      if (allPaths.has(candidate)) return candidate;
    }

    return null;
  }

  function isAutoStub(content: string): boolean {
    return content.includes('自动补全占位');
  }

  function hasNamedExport(content: string, exportName: string): boolean {
    const escaped = exportName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const direct = new RegExp(`\\bexport\\s+(?:const|function|class)\\s+${escaped}\\b`).test(content);
    const named = new RegExp(`\\bexport\\s*\\{[^}]*\\b${escaped}\\b[^}]*\\}`).test(content);
    return direct || named;
  }

  const byPath = new Map<string, string>();
  for (const f of filesWithContent) {
    if (f?.path) byPath.set(f.path, f.content || '');
  }

  const allPaths = new Set<string>();
  for (const p of byPath.keys()) allPaths.add(p);
  if (global.existingFiles) {
    for (const p of global.existingFiles) allPaths.add(p);
  }

  const filesForValidation: FileInfo[] = [];
  for (const [path, content] of byPath.entries()) {
    filesForValidation.push({ path, content });
  }
  for (const path of allPaths) {
    if (!byPath.has(path)) {
      filesForValidation.push({ path, content: '' });
    }
  }

  const stubSpecLookup = buildStubSpecLookup(filesWithContent);

  const issues = validateDependencies(filesForValidation);
  const missingModuleIssues = issues.filter(i => i.type === 'missing_import' && i.severity === 'error');
  const hasMissingModules = missingModuleIssues.length > 0;

  const maxStubs = 25;
  if (hasMissingModules) {
    await sendProgress({
      type: 'warning',
      message: `检测到 ${missingModuleIssues.length} 个缺失本地导入，正在创建占位文件（最多 ${maxStubs} 个）...`
    });
  }

  let createdCount = 0;
  for (const issue of missingModuleIssues) {
    if (createdCount >= maxStubs) break;

    const pathMatch = issue.suggestion?.match(/需要创建文件:\s*([^\s]+)/);
    if (!pathMatch) continue;

    let targetPath = pathMatch[1].trim().replace(/[,;]$/, '');
    if (!targetPath) continue;

    if (targetPath.startsWith('/')) targetPath = targetPath.slice(1);

    // 与 apply 阶段的规范化逻辑对齐：尽量落在 src/ 下
    const fileName = targetPath.split('/').pop() || '';
    const isConfigFile = ['tailwind.config.js', 'vite.config.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.js'].includes(fileName);
    if (!targetPath.startsWith('src/') && !targetPath.startsWith('public/') && targetPath !== 'index.html' && !isConfigFile) {
      targetPath = `src/${targetPath}`;
    }

    if (global.existingFiles?.has(targetPath)) continue;

    const dirPath = targetPath.includes('/') ? targetPath.substring(0, targetPath.lastIndexOf('/')) : '';
    if (dirPath) {
      await providerInstance.runCommand(`mkdir -p ${dirPath}`);
    }

    const lookupKeyNoExt = targetPath.replace(/\.(jsx?|tsx?)$/, '');
    const spec = stubSpecLookup.get(targetPath) || stubSpecLookup.get(lookupKeyNoExt);
    const placeholder = buildPlaceholderForMissingImport(targetPath, spec);
    await providerInstance.writeFile(targetPath, placeholder);

    if (global.sandboxState?.fileCache) {
      global.sandboxState.fileCache.files[targetPath] = {
        content: placeholder,
        lastModified: Date.now()
      };
    }

    global.existingFiles?.add(targetPath);
    results.filesCreated.push(targetPath);
    createdCount += 1;

    await sendProgress({
      type: 'file-complete',
      fileName: targetPath,
      action: 'created (missing import stub)'
    });
  }

  // 如果目标文件已经存在，但仍是“自动补全占位”且不满足 named exports，则升级占位内容，避免继续抛出运行时报错
  const upgradedTargets = new Set<string>();
  for (const [key, spec] of stubSpecLookup.entries()) {
    const namedExports = spec?.namedExports ?? [];
    if (namedExports.length === 0) continue;

    const resolvedPath = resolveExistingModulePath(key, allPaths);
    if (!resolvedPath) continue;
    if (upgradedTargets.has(resolvedPath)) continue;
    upgradedTargets.add(resolvedPath);

    let existingContent = '';
    try {
      existingContent = await providerInstance.readFile(resolvedPath);
    } catch {
      continue;
    }

    if (!isAutoStub(existingContent)) continue;

    const missingExports = namedExports.filter(name => !hasNamedExport(existingContent, name));
    if (missingExports.length === 0) continue;

    const upgraded = buildPlaceholderForMissingImport(resolvedPath, spec);
    await providerInstance.writeFile(resolvedPath, upgraded);

    if (global.sandboxState?.fileCache) {
      global.sandboxState.fileCache.files[resolvedPath] = {
        content: upgraded,
        lastModified: Date.now()
      };
    }

    if (!results.filesUpdated.includes(resolvedPath)) {
      results.filesUpdated.push(resolvedPath);
    }

    await sendProgress({
      type: 'file-complete',
      fileName: resolvedPath,
      action: 'updated (missing import stub exports)'
    });
  }

  if (missingModuleIssues.length > maxStubs) {
    const msg = `缺失导入过多，仅创建了前 ${maxStubs} 个占位文件，其余请重试生成或简化需求。`;
    results.errors.push(msg);
    await sendProgress({ type: 'warning', message: msg });
  }
}

function parseAIResponse(response: string): ParsedResponse {
  const sections = {
    files: [] as Array<{ path: string; content: string }>,
    commands: [] as string[],
    packages: [] as string[],
    structure: null as string | null,
    explanation: '',
    template: ''
  };

  // 🔥 STEP 0: 预处理规范化 XML 标签
  let normalizedResponse = normalizeXmlTags(response);

  // 🔥 STEP 0.5: 修复断裂的标签
  const { repaired, issues: repairIssues } = repairBrokenXmlTags(normalizedResponse);
  if (repairIssues.length > 0) {
    console.log(`[apply-ai-code-stream] 修复了 ${repairIssues.length} 个标签问题:`, repairIssues);
  }
  normalizedResponse = repaired;

  // Function to extract packages from import statements
  function extractPackagesFromCode(content: string): string[] {
    const packages: string[] = [];
    // Match ES6 imports
    const importRegex = /import\s+(?:(?:\{[^}]*\}|\*\s+as\s+\w+|\w+)(?:\s*,\s*(?:\{[^}]*\}|\*\s+as\s+\w+|\w+))*\s+from\s+)?['"]([^'"]+)['"]/g;
    let importMatch;

    while ((importMatch = importRegex.exec(content)) !== null) {
      const importPath = importMatch[1];
      // Skip relative imports and built-in React
      if (!importPath.startsWith('.') && !importPath.startsWith('/') &&
        importPath !== 'react' && importPath !== 'react-dom' &&
        !importPath.startsWith('@/')) {
        // Extract package name (handle scoped packages like @heroicons/react)
        const packageName = importPath.startsWith('@')
          ? importPath.split('/').slice(0, 2).join('/')
          : importPath.split('/')[0];

        if (!packages.includes(packageName)) {
          packages.push(packageName);

          // Log important packages for debugging
          if (packageName === 'react-router-dom' || packageName.includes('router') || packageName.includes('icon')) {
            console.log(`[apply-ai-code-stream] Detected package from imports: ${packageName}`);
          }
        }
      }
    }

    return packages;
  }

  // Parse file sections - handle duplicates and prefer complete versions
  const fileMap = new Map<string, { content: string; isComplete: boolean }>();

  // First pass: Find all file declarations
  // 🔥 改进：使用 \s+ 支持灵活空白，使用预处理后的 normalizedResponse
  const fileRegex = /<file\s+path="([^"]+)">([\s\S]*?)(?:<\/file>|$)/g;
  let match;
  while ((match = fileRegex.exec(normalizedResponse)) !== null) {
    const filePath = match[1];
    const content = match[2].trim();
    const hasClosingTag = normalizedResponse.substring(match.index, match.index + match[0].length).includes('</file>');

    // Check if this file already exists in our map
    const existing = fileMap.get(filePath);

    // Decide whether to keep this version
    let shouldReplace = false;
    if (!existing) {
      shouldReplace = true; // First occurrence
    } else if (!existing.isComplete && hasClosingTag) {
      shouldReplace = true; // Replace incomplete with complete
      console.log(`[apply-ai-code-stream] Replacing incomplete ${filePath} with complete version`);
    } else if (existing.isComplete && hasClosingTag && content.length > existing.content.length) {
      shouldReplace = true; // Replace with longer complete version
      console.log(`[apply-ai-code-stream] Replacing ${filePath} with longer complete version`);
    } else if (!existing.isComplete && !hasClosingTag && content.length > existing.content.length) {
      shouldReplace = true; // Both incomplete, keep longer one
    }

    if (shouldReplace) {
      // Additional validation: reject obviously broken content
      if (content.includes('...') && !content.includes('...props') && !content.includes('...rest')) {
        console.warn(`[apply-ai-code-stream] Warning: ${filePath} contains ellipsis, may be truncated`);
        // Still use it if it's the only version we have
        if (!existing) {
          fileMap.set(filePath, { content, isComplete: hasClosingTag });
        }
      } else {
        fileMap.set(filePath, { content, isComplete: hasClosingTag });
      }
    }
  }

  // Convert map to array for sections.files
  for (const [path, { content, isComplete }] of fileMap.entries()) {
    if (!isComplete) {
      console.log(`[apply-ai-code-stream] Warning: File ${path} appears to be truncated (no closing tag)`);
    }

    sections.files.push({
      path,
      content
    });

    // Extract packages from file content
    const filePackages = extractPackagesFromCode(content);
    for (const pkg of filePackages) {
      if (!sections.packages.includes(pkg)) {
        sections.packages.push(pkg);
        console.log(`[apply-ai-code-stream] 📦 Package detected from imports: ${pkg}`);
      }
    }
  }

  // Also parse markdown code blocks with file paths
  // 关键修复：使用去重机制，避免同一文件被添加多次导致代码重复
  const markdownFileRegex = /```(?:file )?path="([^"]+)"\n([\s\S]*?)```/g;
  while ((match = markdownFileRegex.exec(response)) !== null) {
    const filePath = match[1];
    const content = match[2].trim();

    // 去重检查：如果该路径已存在于fileMap或sections.files中，跳过
    const existingInMap = fileMap.has(filePath);
    const existingInFiles = sections.files.some(f => f.path === filePath);

    if (existingInMap || existingInFiles) {
      console.log(`[apply-ai-code-stream] Skipping duplicate markdown file: ${filePath}`);
      continue;
    }

    sections.files.push({
      path: filePath,
      content: content
    });

    // Extract packages from file content
    const filePackages = extractPackagesFromCode(content);
    for (const pkg of filePackages) {
      if (!sections.packages.includes(pkg)) {
        sections.packages.push(pkg);
        console.log(`[apply-ai-code-stream] 📦 Package detected from imports: ${pkg}`);
      }
    }
  }

  // Parse plain text format like "Generated Files: Header.jsx, index.css"
  // 关键修复：添加去重检查
  const generatedFilesMatch = response.match(/Generated Files?:\s*([^\n]+)/i);
  if (generatedFilesMatch) {
    // Split by comma first, then trim whitespace, to preserve filenames with dots
    const filesList = generatedFilesMatch[1]
      .split(',')
      .map(f => f.trim())
      .filter(f => f.endsWith('.jsx') || f.endsWith('.js') || f.endsWith('.tsx') || f.endsWith('.ts') || f.endsWith('.css') || f.endsWith('.json') || f.endsWith('.html'));
    console.log(`[apply-ai-code-stream] Detected generated files from plain text: ${filesList.join(', ')}`);

    // Try to extract the actual file content if it follows
    for (const fileName of filesList) {
      const filePath = fileName.includes('/') ? fileName : `src/components/${fileName}`;

      // 去重检查：跳过已存在的文件
      if (fileMap.has(filePath) || sections.files.some(f => f.path === filePath)) {
        console.log(`[apply-ai-code-stream] Skipping duplicate plain text file: ${filePath}`);
        continue;
      }

      // Look for the file content after the file name
      const fileContentRegex = new RegExp(`${fileName}[\\s\\S]*?(?:import[\\s\\S]+?)(?=Generated Files:|Applying code|$)`, 'i');
      const fileContentMatch = response.match(fileContentRegex);
      if (fileContentMatch) {
        // Extract just the code part (starting from import statements)
        const codeMatch = fileContentMatch[0].match(/^(import[\s\S]+)$/m);
        if (codeMatch) {
          sections.files.push({
            path: filePath,
            content: codeMatch[1].trim()
          });
          console.log(`[apply-ai-code-stream] Extracted content for ${filePath}`);

          // Extract packages from this file
          const filePackages = extractPackagesFromCode(codeMatch[1]);
          for (const pkg of filePackages) {
            if (!sections.packages.includes(pkg)) {
              sections.packages.push(pkg);
              console.log(`[apply-ai-code-stream] Package detected from imports: ${pkg}`);
            }
          }
        }
      }
    }
  }

  // Also try to parse if the response contains raw JSX/JS code blocks
  // 关键修复：增强去重检查，同时检查fileMap和sections.files
  const codeBlockRegex = /```(?:jsx?|tsx?|javascript|typescript)?\n([\s\S]*?)```/g;
  while ((match = codeBlockRegex.exec(response)) !== null) {
    const content = match[1].trim();
    // Try to detect the file name from comments or context
    const fileNameMatch = content.match(/\/\/\s*(?:File:|Component:)\s*([^\n]+)/);
    if (fileNameMatch) {
      const fileName = fileNameMatch[1].trim();
      const filePath = fileName.includes('/') ? fileName : `src/components/${fileName}`;

      // 增强去重：同时检查fileMap和sections.files
      if (fileMap.has(filePath) || sections.files.some(f => f.path === filePath)) {
        console.log(`[apply-ai-code-stream] Skipping duplicate code block file: ${filePath}`);
        continue;
      }

      sections.files.push({
        path: filePath,
        content: content
      });

      // Extract packages
      const filePackages = extractPackagesFromCode(content);
      for (const pkg of filePackages) {
        if (!sections.packages.includes(pkg)) {
          sections.packages.push(pkg);
        }
      }
    }
  }

  // Parse commands
  const cmdRegex = /<command>(.*?)<\/command>/g;
  while ((match = cmdRegex.exec(response)) !== null) {
    sections.commands.push(match[1].trim());
  }

  // Parse packages - support both <package> and <packages> tags
  const pkgRegex = /<package>(.*?)<\/package>/g;
  while ((match = pkgRegex.exec(response)) !== null) {
    sections.packages.push(match[1].trim());
  }

  // Also parse <packages> tag with multiple packages
  const packagesRegex = /<packages>([\s\S]*?)<\/packages>/;
  const packagesMatch = response.match(packagesRegex);
  if (packagesMatch) {
    const packagesContent = packagesMatch[1].trim();
    // Split by newlines or commas
    const packagesList = packagesContent.split(/[\n,]+/)
      .map(pkg => pkg.trim())
      .filter(pkg => pkg.length > 0);
    sections.packages.push(...packagesList);
  }

  // Parse structure
  const structureMatch = /<structure>([\s\S]*?)<\/structure>/;
  const structResult = response.match(structureMatch);
  if (structResult) {
    sections.structure = structResult[1].trim();
  }

  // Parse explanation
  const explanationMatch = /<explanation>([\s\S]*?)<\/explanation>/;
  const explResult = response.match(explanationMatch);
  if (explResult) {
    sections.explanation = explResult[1].trim();
  }

  // Parse template
  const templateMatch = /<template>(.*?)<\/template>/;
  const templResult = response.match(templateMatch);
  if (templResult) {
    sections.template = templResult[1].trim();
  }

  // 🔥 STEP 最后: 如果没有解析到任何文件，尝试从无标签内容推断
  if (sections.files.length === 0) {
    console.log('[apply-ai-code-stream] 未能从标签中提取文件，尝试推断文件边界...');
    const inferredFiles = inferFileBoundaries(response);
    if (inferredFiles.length > 0) {
      console.log(`[apply-ai-code-stream] 从无标签内容中推断出 ${inferredFiles.length} 个文件`);
      sections.files = inferredFiles;
    }
  }

  return sections;
}

export async function POST(request: NextRequest) {
  try {
    // 是否允许在无沙箱时自动创建/重建，用于避免需求分析阶段误触发创建。
    const { response, isEdit = false, packages = [], sandboxId, allowSandboxCreate = false } = await request.json();

    if (!response) {
      return NextResponse.json({
        error: 'response is required'
      }, { status: 400 });
    }

    // Debug log the response
    console.log('[apply-ai-code-stream] Received response to parse:');
    console.log('[apply-ai-code-stream] Response length:', response.length);
    console.log('[apply-ai-code-stream] Response preview:', response.substring(0, 500));
    console.log('[apply-ai-code-stream] isEdit:', isEdit);
    console.log('[apply-ai-code-stream] packages:', packages);
    console.log('[apply-ai-code-stream] sandboxId:', sandboxId);
    console.log('[apply-ai-code-stream] allowSandboxCreate:', allowSandboxCreate);

    // Parse the AI response
    const parsed = parseAIResponse(response);
    const morphEnabled = Boolean(isEdit && process.env.MORPH_API_KEY);
    const morphEdits = morphEnabled ? parseMorphEdits(response) : [];
    console.log('[apply-ai-code-stream] Morph Fast Apply mode:', morphEnabled);
    if (morphEnabled) {
      console.log('[apply-ai-code-stream] Morph edits found:', morphEdits.length);
    }
    
    // Log what was parsed
    console.log('[apply-ai-code-stream] Parsed result:');
    console.log('[apply-ai-code-stream] Files found:', parsed.files.length);
    if (parsed.files.length > 0) {
      parsed.files.forEach(f => {
        console.log(`[apply-ai-code-stream] - ${f.path} (${f.content.length} chars)`);
      });
    }
    console.log('[apply-ai-code-stream] Packages found:', parsed.packages);

    // Initialize existingFiles if not already
    if (!global.existingFiles) {
      global.existingFiles = new Set<string>();
    }

    // 记录请求侧的 sandboxId（用于判断是否发生“沙箱切换”）
    const requestedSandboxId = sandboxId;

    // Try to get provider from sandbox manager first
    console.log(`[apply-ai-code-stream] Looking up provider for sandboxId: ${requestedSandboxId}`);
    let provider = requestedSandboxId
      ? sandboxManager.getProvider(requestedSandboxId)
      : sandboxManager.getActiveProvider();
    console.log(`[apply-ai-code-stream] Provider from sandboxManager: ${provider ? 'found' : 'not found'}`);

    // Fall back to global state if not found in manager
    if (!provider) {
      provider = global.activeSandboxProvider;
      console.log(`[apply-ai-code-stream] Provider from global state: ${provider ? 'found' : 'not found'}`);
    }

    // 如果请求传了 sandboxId 但没找到 provider，尝试恢复；失败则创建新沙箱并通知前端切换
    let replacedSandboxId: string | null = null;
    if (!provider && requestedSandboxId) {
      console.log(`[apply-ai-code-stream] No provider found for sandbox ${requestedSandboxId}, attempting to get or create...`);

      try {
        provider = await sandboxManager.getOrCreateProvider(requestedSandboxId);

        // E2B 当前默认不支持 reconnect：如果无法恢复，则创建新沙箱
        if (!provider.getSandboxInfo()) {
          if (!allowSandboxCreate) {
            return NextResponse.json({
              success: false,
              error: '当前请求未允许自动创建沙箱，请先创建沙箱后再应用代码。',
              requiresSandbox: true,
              results: {
                filesCreated: [],
                packagesInstalled: [],
                commandsExecuted: [],
                errors: ['本次请求未允许自动创建沙箱']
              },
              explanation: parsed.explanation,
              structure: parsed.structure,
              parsedFiles: parsed.files,
              message: '缺少可用沙箱且已禁止自动创建。'
            }, { status: 409 });
          }
          console.log(`[apply-ai-code-stream] Reconnect not available, creating new sandbox to replace ${requestedSandboxId}`);
          replacedSandboxId = requestedSandboxId;

          const newSandboxInfo = await provider.createSandbox();
          await provider.setupViteApp();

          // 关键修复：必须使用“新沙箱ID”注册，否则前端仍会指向旧 URL，导致 Sandbox Not Found
          sandboxManager.registerSandbox(newSandboxInfo.sandboxId, provider);
          global.sandboxData = { sandboxId: newSandboxInfo.sandboxId, url: newSandboxInfo.url };
        } else {
          const info = provider.getSandboxInfo();
          if (info) {
            sandboxManager.registerSandbox(info.sandboxId, provider);
            global.sandboxData = { sandboxId: info.sandboxId, url: info.url };
          }
        }

        // Update legacy global state
        global.activeSandboxProvider = provider;
        console.log(`[apply-ai-code-stream] Successfully got provider for sandbox ${requestedSandboxId}`);
      } catch (providerError) {
        console.error(`[apply-ai-code-stream] Failed to get or create provider for sandbox ${requestedSandboxId}:`, providerError);
        return NextResponse.json({
          success: false,
          error: `无法为 sandbox ${requestedSandboxId} 获取/创建 provider（沙箱可能已过期或不可用）。`,
          results: {
            filesCreated: [],
            packagesInstalled: [],
            commandsExecuted: [],
            errors: [`Sandbox provider creation failed: ${(providerError as Error).message}`]
          },
          explanation: parsed.explanation,
          structure: parsed.structure,
          parsedFiles: parsed.files,
          message: `Parsed ${parsed.files.length} files but couldn't apply them - sandbox reconnection failed.`
        }, { status: 500 });
      }
    }

    // 如果仍然没有 provider，创建新沙箱
    if (!provider) {
      if (!allowSandboxCreate) {
        return NextResponse.json({
          success: false,
          error: '当前请求未允许自动创建沙箱，请先创建沙箱后再应用代码。',
          requiresSandbox: true,
          results: {
            filesCreated: [],
            packagesInstalled: [],
            commandsExecuted: [],
            errors: ['本次请求未允许自动创建沙箱']
          },
          explanation: parsed.explanation,
          structure: parsed.structure,
          parsedFiles: parsed.files,
          message: '当前无活跃沙箱且已禁止自动创建。'
        }, { status: 409 });
      }
      console.log(`[apply-ai-code-stream] No active provider found, creating new sandbox...`);
      try {
        const { SandboxFactory } = await import('@/lib/sandbox/factory');
        provider = SandboxFactory.create();
        const sandboxInfo = await provider.createSandbox();
        await provider.setupViteApp();

        // Register with sandbox manager
        sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);

        // Store in legacy global state
        global.activeSandboxProvider = provider;
        global.sandboxData = {
          sandboxId: sandboxInfo.sandboxId,
          url: sandboxInfo.url
        };

        console.log(`[apply-ai-code-stream] Created new sandbox successfully`);
      } catch (createError) {
        console.error(`[apply-ai-code-stream] Failed to create new sandbox:`, createError);
        return NextResponse.json({
          success: false,
          error: `Failed to create new sandbox: ${createError instanceof Error ? createError.message : 'Unknown error'}`,
          results: {
            filesCreated: [],
            packagesInstalled: [],
            commandsExecuted: [],
            errors: [`Sandbox creation failed: ${createError instanceof Error ? createError.message : 'Unknown error'}`]
          },
          explanation: parsed.explanation,
          structure: parsed.structure,
          parsedFiles: parsed.files,
          message: `Parsed ${parsed.files.length} files but couldn't apply them - sandbox creation failed.`
        }, { status: 500 });
      }
    }

    // 二次兜底：provider 存在但底层沙箱可能已被外部超时/回收，先做一次轻量健康检查
    // 失败时自动创建新沙箱，并在 SSE 中通知前端切换预览 URL（不主动销毁旧沙箱）
    try {
      await provider.runCommand('pwd');
    } catch (e) {
      const previousId =
        provider.getSandboxInfo?.()?.sandboxId || requestedSandboxId || null;
      replacedSandboxId = replacedSandboxId ?? previousId;
      if (!allowSandboxCreate) {
        return NextResponse.json({
          success: false,
          error: '当前沙箱不可用且未允许自动重建，请手动创建沙箱后重试。',
          requiresSandbox: true,
          results: {
            filesCreated: [],
            packagesInstalled: [],
            commandsExecuted: [],
            errors: ['本次请求未允许自动重建沙箱']
          },
          explanation: parsed.explanation,
          structure: parsed.structure,
          parsedFiles: parsed.files,
          message: '沙箱不可用且已禁止自动重建。'
        }, { status: 409 });
      }
      console.warn('[apply-ai-code-stream] 沙箱健康检查失败，创建新沙箱用于继续执行:', e);

      const { SandboxFactory } = await import('@/lib/sandbox/factory');
      const newProvider = SandboxFactory.create();
      const newInfo = await newProvider.createSandbox();
      await newProvider.setupViteApp();

      sandboxManager.registerSandbox(newInfo.sandboxId, newProvider);
      global.activeSandboxProvider = newProvider;
      global.sandboxData = { sandboxId: newInfo.sandboxId, url: newInfo.url };
      provider = newProvider;
    }

    // Create a response stream for real-time updates
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Function to send progress updates
    const sendProgress = async (data: any) => {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      await writer.write(encoder.encode(message));
    };

    const sandboxInfoForClient = provider.getSandboxInfo();
    if (!sandboxInfoForClient) {
      return NextResponse.json(
        { success: false, error: 'Sandbox provider has no sandboxInfo' },
        { status: 500 },
      );
    }

    // Start processing in background (pass provider and request to the async function)
    (async (providerInstance, req, sandboxInfo, previousSandboxId) => {
      const results = {
        filesCreated: [] as string[],
        filesUpdated: [] as string[],
        packagesInstalled: [] as string[],
        packagesAlreadyInstalled: [] as string[],
        packagesFailed: [] as string[],
        commandsExecuted: [] as string[],
        errors: [] as string[]
      };
      // 记录本次 apply 写入的文件内容，用于后续依赖校验（缺失导入兜底）
      const filesWithContent: FileInfo[] = [];

      try {
        // 先同步沙箱信息给前端：若发生重建/切换，前端必须更新 iframe URL
        await sendProgress({
          type: 'sandbox',
          sandboxId: sandboxInfo.sandboxId,
          url: sandboxInfo.url,
          provider: sandboxInfo.provider,
          replacedSandboxId: previousSandboxId && previousSandboxId !== sandboxInfo.sandboxId ? previousSandboxId : undefined
        });

        await sendProgress({
          type: 'start',
          message: 'Starting code application...',
          totalSteps: 3
        });
        if (morphEnabled) {
          await sendProgress({ type: 'info', message: 'Morph Fast Apply enabled' });
          await sendProgress({ type: 'info', message: `Parsed ${morphEdits.length} Morph edits` });
          if (morphEdits.length === 0) {
            console.warn('[apply-ai-code-stream] Morph enabled but no <edit> blocks found; falling back to full-file flow');
            await sendProgress({ type: 'warning', message: 'Morph enabled but no <edit> blocks found; falling back to full-file flow' });
          }
        }
        
        // Step 1: Install packages
        const packagesArray = Array.isArray(packages) ? packages : [];
        const parsedPackages = Array.isArray(parsed.packages) ? parsed.packages : [];

        // Combine and deduplicate packages
        const allPackages = [...packagesArray.filter(pkg => pkg && typeof pkg === 'string'), ...parsedPackages];

        // Use Set to remove duplicates, then filter out pre-installed packages
        const uniquePackages = [...new Set(allPackages)]
          .filter(pkg => pkg && typeof pkg === 'string' && pkg.trim() !== '') // Remove empty strings
          .filter(pkg => pkg !== 'react' && pkg !== 'react-dom'); // Filter pre-installed

        // Log if we found duplicates
        if (allPackages.length !== uniquePackages.length) {
          console.log(`[apply-ai-code-stream] Removed ${allPackages.length - uniquePackages.length} duplicate packages`);
          console.log(`[apply-ai-code-stream] Original packages:`, allPackages);
          console.log(`[apply-ai-code-stream] Deduplicated packages:`, uniquePackages);
        }

        if (uniquePackages.length > 0) {
          await sendProgress({
            type: 'step',
            step: 1,
            message: `Installing ${uniquePackages.length} packages...`,
            packages: uniquePackages
          });

          // Use streaming package installation with heartbeat to keep connection alive
          try {
            // 关键修复：使用本地服务器地址而非从请求头获取
            // 当请求从 Ingenio 后端代理过来时，req.headers.get('host') 会返回错误的地址
            const port = process.env.PORT || '3001';
            const apiUrl = `http://localhost:${port}/api/install-packages`;
            console.log(`[apply-ai-code-stream] Calling install-packages API: ${apiUrl}`);

            // 关键修复：启动心跳机制，在 install-packages 期间保持 SSE 连接活跃
            // npm install 可能需要 30-60 秒，期间如果没有数据发送，客户端可能会断开连接
            let heartbeatCount = 0;
            const heartbeatInterval = setInterval(async () => {
              heartbeatCount++;
              try {
                await sendProgress({
                  type: 'heartbeat',
                  message: `Installing packages... (${heartbeatCount * 5}s)`,
                  elapsed: heartbeatCount * 5
                });
                console.log(`[apply-ai-code-stream] Heartbeat sent: ${heartbeatCount * 5}s elapsed`);
              } catch (heartbeatError) {
                console.log('[apply-ai-code-stream] Heartbeat failed, connection may be closed');
              }
            }, 5000); // 每 5 秒发送一次心跳

            try {
              const installResponse = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  packages: uniquePackages,
                  // 关键修复：永远使用 provider 当前绑定的 sandboxId（请求侧 sandboxId 可能已失效）
                  sandboxId: providerInstance.getSandboxInfo()?.sandboxId
                })
              });

              // 关键修复：不要在这里停止心跳！
              // fetch() 在收到响应头时就返回，但 SSE 流的实际数据还在传输中
              // 心跳必须在整个 SSE 流读取完成后才能停止
              console.log(`[apply-ai-code-stream] Received install response headers, starting to read SSE stream...`);

              if (installResponse.ok && installResponse.body) {
                const reader = installResponse.body.getReader();
                const decoder = new TextDecoder();

                while (true) {
                  const { done, value } = await reader.read();
                  if (done) {
                    // SSE 流读取完成，现在可以停止心跳了
                    clearInterval(heartbeatInterval);
                    console.log(`[apply-ai-code-stream] SSE stream complete, stopped heartbeat after ${heartbeatCount * 5}s`);
                    break;
                  }

                  const chunk = decoder.decode(value);
                  if (!chunk) continue;
                  const lines = chunk.split('\n');

                  for (const line of lines) {
                    if (line.startsWith('data: ')) {
                      try {
                        const data = JSON.parse(line.slice(6));

                        // Forward package installation progress
                        // 重要：不要直接spread data，因为data可能包含type: 'complete'
                        // 这会覆盖我们设置的type: 'package-progress'，导致Ingenio后端误认为
                        // apply-ai-code-stream已完成，从而关闭连接
                        await sendProgress({
                          type: 'package-progress',
                          originalType: data.type,  // 保留原始类型用于调试
                          message: data.message,
                          installedPackages: data.installedPackages,
                          alreadyInstalled: data.alreadyInstalled
                        });

                        // Track results
                        if (data.type === 'success' && data.installedPackages) {
                          results.packagesInstalled = data.installedPackages;
                        }
                      } catch (parseError) {
                        console.debug('Error parsing terminal output:', parseError);
                      }
                    }
                  }
                }
              } else {
                // 如果响应失败，也要停止心跳
                clearInterval(heartbeatInterval);
                console.log(`[apply-ai-code-stream] Install response not ok, stopped heartbeat`);
              }
            } finally {
              // 确保心跳被清除，即使出现错误
              clearInterval(heartbeatInterval);
            }
          } catch (error) {
            console.error('[apply-ai-code-stream] Error installing packages:', error);
            await sendProgress({
              type: 'warning',
              message: `Package installation skipped (${(error as Error).message}). Continuing with file creation...`
            });
            results.errors.push(`Package installation failed: ${(error as Error).message}`);
          }
        } else {
          await sendProgress({
            type: 'step',
            step: 1,
            message: 'No additional packages to install, skipping...'
          });
        }

        // Step 2: Create/update files
        const filesArray = Array.isArray(parsed.files) ? parsed.files : [];

        // Filter out config files that shouldn't be created
        const configFiles = ['tailwind.config.js', 'vite.config.js', 'package.json', 'package-lock.json', 'tsconfig.json', 'postcss.config.js'];
        const configFilteredFiles = filesArray.filter(file => {
          if (!file || typeof file !== 'object') return false;
          const fileName = (file.path || '').split('/').pop() || '';
          return !configFiles.includes(fileName);
        });
        const skippedConfigCount = filesArray.length - configFilteredFiles.length;
        let filteredFiles = configFilteredFiles;

        // If Morph is enabled and we have edits, apply them before file writes
        const morphUpdatedPaths = new Set<string>();
        if (morphEnabled && morphEdits.length > 0) {
          const morphSandbox = (global as any).activeSandbox || providerInstance;
          if (!morphSandbox) {
            console.warn('[apply-ai-code-stream] No sandbox available to apply Morph edits');
            await sendProgress({ type: 'warning', message: 'No sandbox available to apply Morph edits' });
          } else {
            await sendProgress({ type: 'info', message: `Applying ${morphEdits.length} fast edits via Morph...` });
            for (const [idx, edit] of morphEdits.entries()) {
              try {
                await sendProgress({ type: 'file-progress', current: idx + 1, total: morphEdits.length, fileName: edit.targetFile, action: 'morph-applying' });
                const result = await applyMorphEditToFile({
                  sandbox: morphSandbox,
                  targetPath: edit.targetFile,
                  instructions: edit.instructions,
                  updateSnippet: edit.update
                });
                if (result.success && result.normalizedPath) {
                  console.log('[apply-ai-code-stream] Morph updated', result.normalizedPath);
                  morphUpdatedPaths.add(result.normalizedPath);
                  if (results.filesUpdated) results.filesUpdated.push(result.normalizedPath);
                  await sendProgress({ type: 'file-complete', fileName: result.normalizedPath, action: 'morph-updated' });
                } else {
                  const msg = result.error || 'Unknown Morph error';
                  console.error('[apply-ai-code-stream] Morph apply failed for', edit.targetFile, msg);
                  if (results.errors) results.errors.push(`Morph apply failed for ${edit.targetFile}: ${msg}`);
                  await sendProgress({ type: 'file-error', fileName: edit.targetFile, error: msg });
                }
              } catch (err) {
                const msg = (err as Error).message;
                console.error('[apply-ai-code-stream] Morph apply exception for', edit.targetFile, msg);
                if (results.errors) results.errors.push(`Morph apply exception for ${edit.targetFile}: ${msg}`);
                await sendProgress({ type: 'file-error', fileName: edit.targetFile, error: msg });
              }
            }
          }
        }

        // Avoid overwriting Morph-updated files in the file write loop
        if (morphUpdatedPaths.size > 0) {
          const beforeMorphFilterCount = filteredFiles.length;
          filteredFiles = filteredFiles.filter(file => {
            if (!file?.path) return true;
            let normalizedPath = file.path.startsWith('/') ? file.path.slice(1) : file.path;
            const fileName = normalizedPath.split('/').pop() || '';
            if (!normalizedPath.startsWith('src/') &&
                !normalizedPath.startsWith('public/') &&
                normalizedPath !== 'index.html' &&
                !configFiles.includes(fileName)) {
              normalizedPath = 'src/' + normalizedPath;
            }
            return !morphUpdatedPaths.has(normalizedPath);
          });
          const skippedMorphCount = beforeMorphFilterCount - filteredFiles.length;
          if (skippedMorphCount > 0) {
            console.log(`[apply-ai-code-stream] Morph updated ${skippedMorphCount} files, skipped overwrite in write loop`);
          }
        }

        console.log(
          `[apply-ai-code-stream] Step 2: Starting file creation, parsed=${filesArray.length}, skippedConfig=${skippedConfigCount}, writing=${filteredFiles.length}`
        );
        await sendProgress({
          type: 'step',
          step: 2,
          message: `Writing ${filteredFiles.length} files... (parsed ${filesArray.length}, skipped config ${skippedConfigCount})`
        });
        
        for (const [index, file] of filteredFiles.entries()) {
          try {
            // Send progress for each file
            await sendProgress({
              type: 'file-progress',
              current: index + 1,
              total: filteredFiles.length,
              fileName: file.path,
              action: 'creating'
            });

            // Normalize the file path
            let normalizedPath = file.path;
            if (normalizedPath.startsWith('/')) {
              normalizedPath = normalizedPath.substring(1);
            }
            if (!normalizedPath.startsWith('src/') &&
              !normalizedPath.startsWith('public/') &&
              normalizedPath !== 'index.html' &&
              !configFiles.includes(normalizedPath.split('/').pop() || '')) {
              normalizedPath = 'src/' + normalizedPath;
            }

            const isUpdate = global.existingFiles.has(normalizedPath);

            // Remove any CSS imports from JSX/JS files (we're using Tailwind)
            let fileContent = file.content;
            if (file.path.endsWith('.jsx') || file.path.endsWith('.js') || file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
              fileContent = fileContent.replace(/import\s+['"]\.\/[^'"]+\.css['"];?\s*\n?/g, '');

              // 🔥 修复1: 清理中文文本混入（截断续写常见问题）
              const { cleaned: cleanedContent, issues: chineseIssues } = detectAndCleanMixedChineseText(fileContent);
              if (chineseIssues.length > 0) {
                console.log(`[apply-ai-code-stream] 🧹 清理了 ${normalizedPath} 中的 ${chineseIssues.length} 处中文文本混入`);
                chineseIssues.forEach(issue => {
                  console.log(`  - 行 ${issue.line}: "${issue.chineseText}" -> "${issue.cleanedLine.substring(0, 50)}..."`);
                });
                fileContent = cleanedContent;
              }

              // 🔥 修复2: 修复错位的import语句
              const { fixed: fixedContent, fixedCount } = fixMisplacedImports(fileContent);
              if (fixedCount > 0) {
                console.log(`[apply-ai-code-stream] 🔧 修复了 ${normalizedPath} 中的 ${fixedCount} 个错位 import`);
                fileContent = fixedContent;
              }

              // 🔥 修复3: 合并 React 导入，避免重复声明 Hook（如 useContext）
              const merged = mergeReactImports(fileContent);
              if (merged.changed) {
                console.log(`[apply-ai-code-stream] 🔧 合并了 ${normalizedPath} 的 React 导入（避免重复声明）`);
                fileContent = merged.content;
              }
            }

            // Fix common Tailwind CSS errors in CSS files
            if (file.path.endsWith('.css')) {
              // Replace shadow-3xl with shadow-2xl (shadow-3xl doesn't exist)
              fileContent = fileContent.replace(/shadow-3xl/g, 'shadow-2xl');
              // Replace any other non-existent shadow utilities
              fileContent = fileContent.replace(/shadow-4xl/g, 'shadow-2xl');
              fileContent = fileContent.replace(/shadow-5xl/g, 'shadow-2xl');
            }

            // Create directory if needed
            const dirPath = normalizedPath.includes('/') ? normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) : '';
            if (dirPath) {
              await providerInstance.runCommand(`mkdir -p ${dirPath}`);
            }

            // Write the file using provider
            console.log(`[apply-ai-code-stream] Writing file ${index + 1}/${filteredFiles.length}: ${normalizedPath} (${fileContent.length} bytes)`);
            await providerInstance.writeFile(normalizedPath, fileContent);
            console.log(`[apply-ai-code-stream] File written successfully: ${normalizedPath}`);

            // Update file cache
            if (global.sandboxState?.fileCache) {
              global.sandboxState.fileCache.files[normalizedPath] = {
                content: fileContent,
                lastModified: Date.now()
              };
            }

            // 记录本次写入的文件内容，用于后续缺失导入兜底（只需要内容，不影响最终落盘）
            filesWithContent.push({ path: normalizedPath, content: fileContent });

            if (isUpdate) {
              if (results.filesUpdated) results.filesUpdated.push(normalizedPath);
            } else {
              if (results.filesCreated) results.filesCreated.push(normalizedPath);
              if (global.existingFiles) global.existingFiles.add(normalizedPath);
            }

            await sendProgress({
              type: 'file-complete',
              fileName: normalizedPath,
              action: isUpdate ? 'updated' : 'created'
            });
          } catch (error) {
            const errorMsg = (error as Error).message || '';

            // 🔥 关键修复：检测沙箱过期错误，自动重建并重试
            const isSandboxExpired = errorMsg.toLowerCase().includes('sandbox') &&
              (errorMsg.toLowerCase().includes('not found') ||
               errorMsg.toLowerCase().includes('no active') ||
               errorMsg.toLowerCase().includes('timeout') ||
               errorMsg.toLowerCase().includes('expired'));

            if (isSandboxExpired) {
              if (!allowSandboxCreate) {
                // 错误提示文案：说明未允许自动重建，避免在非预期阶段触发创建。
                const errorMessage = '沙箱已过期且未允许自动重建，请手动创建沙箱后重试。';
                if (results.errors) {
                  results.errors.push(`Sandbox rebuild blocked for ${file.path}: ${errorMessage}`);
                }
                await sendProgress({
                  type: 'file-error',
                  fileName: file.path,
                  error: errorMessage
                });
                throw new Error(errorMessage);
              }
              console.warn(`[apply-ai-code-stream] 沙箱在文件写入时过期，尝试重建沙箱并重试: ${file.path}`);
              try {
                // 重建沙箱
                const { SandboxFactory } = await import('@/lib/sandbox/factory');
                const newProvider = SandboxFactory.create();
                const newInfo = await newProvider.createSandbox();
                await newProvider.setupViteApp();

                // 更新全局状态
                sandboxManager.registerSandbox(newInfo.sandboxId, newProvider);
                global.activeSandboxProvider = newProvider;
                global.sandboxData = { sandboxId: newInfo.sandboxId, url: newInfo.url };
                providerInstance = newProvider;

                // 通知前端新的沙箱信息
                await sendProgress({
                  type: 'sandbox',
                  sandboxId: newInfo.sandboxId,
                  url: newInfo.url,
                  provider: 'e2b',
                  replacedSandboxId: replacedSandboxId || requestedSandboxId || undefined,
                  message: '沙箱已过期，已自动重建'
                });
                replacedSandboxId = replacedSandboxId || requestedSandboxId || null;

                console.log(`[apply-ai-code-stream] 沙箱重建成功: ${newInfo.sandboxId}，重试写入文件: ${file.path}`);

                // 重试写入当前文件
                let normalizedPath = file.path;
                if (normalizedPath.startsWith('/')) {
                  normalizedPath = normalizedPath.substring(1);
                }
                if (!normalizedPath.startsWith('src/') &&
                  !normalizedPath.startsWith('public/') &&
                  normalizedPath !== 'index.html' &&
                  !configFiles.includes(normalizedPath.split('/').pop() || '')) {
                  normalizedPath = 'src/' + normalizedPath;
                }

                const dirPath = normalizedPath.includes('/') ? normalizedPath.substring(0, normalizedPath.lastIndexOf('/')) : '';
                if (dirPath) {
                  await providerInstance.runCommand(`mkdir -p ${dirPath}`);
                }

                let retryContent = file.content;
                if (file.path.endsWith('.jsx') || file.path.endsWith('.js') || file.path.endsWith('.tsx') || file.path.endsWith('.ts')) {
                  retryContent = retryContent.replace(/import\s+['"]\.\/[^'"]+\.css['"];?\s*\n?/g, '');
                  const { cleaned: cleanedContent } = detectAndCleanMixedChineseText(retryContent);
                  retryContent = cleanedContent;
                  const { fixed: fixedContent } = fixMisplacedImports(retryContent);
                  retryContent = fixedContent;
                }

                await providerInstance.writeFile(normalizedPath, retryContent);
                console.log(`[apply-ai-code-stream] 文件重试写入成功: ${normalizedPath}`);

                filesWithContent.push({ path: normalizedPath, content: retryContent });
                if (results.filesCreated) results.filesCreated.push(normalizedPath);
                if (global.existingFiles) global.existingFiles.add(normalizedPath);

                await sendProgress({
                  type: 'file-complete',
                  fileName: normalizedPath,
                  action: 'created (after sandbox rebuild)'
                });

                // 继续下一个文件
                continue;
              } catch (rebuildError) {
                console.error(`[apply-ai-code-stream] 沙箱重建失败:`, rebuildError);
                if (results.errors) {
                  results.errors.push(`Sandbox rebuild failed for ${file.path}: ${(rebuildError as Error).message}`);
                }
                await sendProgress({
                  type: 'file-error',
                  fileName: file.path,
                  error: `沙箱重建失败: ${(rebuildError as Error).message}`
                });
              }
            } else {
              // 非沙箱过期错误，正常记录
              if (results.errors) {
                results.errors.push(`Failed to create ${file.path}: ${errorMsg}`);
              }
              await sendProgress({
                type: 'file-error',
                fileName: file.path,
                error: errorMsg
              });
            }
          }
        }

        // 🔥 关键修复：检查 App.tsx 或 App.jsx 是否存在
        // AI 可能生成 App.tsx 或 App.jsx，需要同时检查
        const hasAppTsx = filteredFiles.some(f => f.path === 'src/App.tsx' || f.path === 'App.tsx');
        const hasAppJsx = filteredFiles.some(f => f.path === 'src/App.jsx' || f.path === 'App.jsx');
        const hasAnyAppFile = hasAppTsx || hasAppJsx;

        if (hasAppTsx) {
          // 如果有 App.tsx，更新 main.jsx 导入
          try {
            console.log('[apply-ai-code-stream] Detected App.tsx, updating main.jsx import...');
            await sendProgress({
              type: 'info',
              message: 'Updating main.jsx to import App.tsx...'
            });

            const mainJsxContent = await providerInstance.readFile('src/main.jsx');
            if (mainJsxContent) {
              const updatedMainJsx = mainJsxContent.replace(
                /import App from ['"]\.\/App\.(jsx|tsx)['"]/,
                "import App from './App.tsx'"
              );

              if (updatedMainJsx !== mainJsxContent) {
                await providerInstance.writeFile('src/main.jsx', updatedMainJsx);
                console.log('[apply-ai-code-stream] Successfully updated main.jsx to import App.tsx');
                await sendProgress({
                  type: 'file-complete',
                  fileName: 'src/main.jsx',
                  action: 'updated (import fix)'
                });
              }
            }
          } catch (mainJsxError) {
            console.warn('[apply-ai-code-stream] Could not update main.jsx:', mainJsxError);
          }
        } else if (hasAppJsx) {
          // 🔥 如果有 App.jsx，确保 main.jsx 导入正确（不需要修改，因为默认就是 App.jsx）
          console.log('[apply-ai-code-stream] ✅ App.jsx found, no import update needed');
        } else {
          // Fallback: 如果既没有 App.tsx 也没有 App.jsx，但有组件，自动生成汇总 App
          // 这种情况通常发生在AI响应被截断时
          const componentFiles = filteredFiles.filter(f =>
            f.path.includes('/components/') &&
            (f.path.endsWith('.tsx') || f.path.endsWith('.jsx'))
          );

          // 🔥 额外检查：layout 目录中的组件也算
          const layoutFiles = filteredFiles.filter(f =>
            f.path.includes('/layout/') &&
            (f.path.endsWith('.tsx') || f.path.endsWith('.jsx'))
          );

          // 🔥 额外检查：home 目录中的组件也算
          const homeFiles = filteredFiles.filter(f =>
            f.path.includes('/home/') &&
            (f.path.endsWith('.tsx') || f.path.endsWith('.jsx'))
          );

          const allComponentFiles = [...componentFiles, ...layoutFiles, ...homeFiles];

          if (allComponentFiles.length > 0) {
            console.log('[apply-ai-code-stream] ⚠️ No App.tsx/App.jsx found but has components, generating fallback App.jsx...');
            await sendProgress({
              type: 'warning',
              message: 'App file missing (truncated response?), generating fallback...'
            });

            try {
              // 🔥 智能分析组件结构，生成更合理的 App
              const layoutComponent = layoutFiles.find(f => f.path.includes('Layout'));
              const headerComponent = layoutFiles.find(f => f.path.includes('Header'));
              const footerComponent = layoutFiles.find(f => f.path.includes('Footer'));

              // 提取所有组件的导入信息
              const componentImports = allComponentFiles.map(f => {
                const fileName = f.path.split('/').pop()?.replace(/\.(tsx|jsx)$/, '') || '';
                const componentName = fileName.charAt(0).toUpperCase() + fileName.slice(1);
                const importPath = f.path.replace('src/', './').replace(/\.(tsx|jsx)$/, '');
                return { name: componentName, path: importPath, fullPath: f.path };
              });

              // 🔥 生成更智能的 fallback App.jsx
              let fallbackAppContent: string;

              if (layoutComponent) {
                // 如果有 Layout 组件，使用它作为根
                const layoutName = layoutComponent.path.split('/').pop()?.replace(/\.(tsx|jsx)$/, '') || 'Layout';
                const layoutImportPath = layoutComponent.path.replace('src/', './').replace(/\.(tsx|jsx)$/, '');

                // 找出非 layout 的组件
                const contentComponents = componentImports.filter(c =>
                  !c.fullPath.includes('/layout/')
                );

                fallbackAppContent = `// Auto-generated fallback App.jsx
import React from 'react';
import ${layoutName} from '${layoutImportPath}';
${contentComponents.map(c => `import ${c.name} from '${c.path}';`).join('\n')}

export default function App() {
  return (
    <${layoutName}>
      ${contentComponents.map(c => `<${c.name} />`).join('\n      ')}
    </${layoutName}>
  );
}
`;
              } else {
                // 没有 Layout，使用简单结构
                fallbackAppContent = `// Auto-generated fallback App.jsx
import React from 'react';
${componentImports.map(c => `import ${c.name} from '${c.path}';`).join('\n')}

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      ${componentImports.map(c => `<${c.name} />`).join('\n      ')}
    </div>
  );
}
`;
              }

              // 🔥 使用 App.jsx 而不是 App.tsx（与模板默认一致）
              await providerInstance.writeFile('src/App.jsx', fallbackAppContent);
              console.log('[apply-ai-code-stream] ✅ Fallback App.jsx created with', componentImports.length, 'components');
              results.filesCreated.push('src/App.jsx');
              global.existingFiles?.add('src/App.jsx');
              filesWithContent.push({ path: 'src/App.jsx', content: fallbackAppContent });

              if (global.sandboxState?.fileCache) {
                global.sandboxState.fileCache.files['src/App.jsx'] = {
                  content: fallbackAppContent,
                  lastModified: Date.now()
                };
              }

              await sendProgress({
                type: 'file-complete',
                fileName: 'src/App.jsx',
                action: 'created (fallback)'
              });
            } catch (fallbackError) {
              console.error('[apply-ai-code-stream] Failed to create fallback App.jsx:', fallbackError);
              results.errors.push(`Failed to create fallback App.jsx: ${(fallbackError as Error).message}`);
            }
	      }
	    }

        // 🔧 兜底修复：确保入口文件有挂载逻辑，否则 iframe 预览将呈现白屏（#root 永远为空）
        try {
          await ensureViteEntryPointMountsApp(providerInstance, sendProgress, results);
        } catch (entryMountError) {
          console.warn('[apply-ai-code-stream] Entry mount check failed:', entryMountError);
          await sendProgress({
            type: 'warning',
            message: `Entry mount check skipped: ${(entryMountError as Error).message}`
          });
        }

	        // 🔧 兜底修复：确保 Tailwind 样式链路未被 AI 覆盖破坏（避免预览呈现“浏览器默认样式”）
	        try {
	          await ensureTailwindWiring(providerInstance, sendProgress, results);
	        } catch (tailwindError) {
          console.warn('[apply-ai-code-stream] Tailwind wiring check failed:', tailwindError);
          await sendProgress({
            type: 'warning',
            message: `Tailwind wiring check skipped: ${(tailwindError as Error).message}`
          });
        }

        // 🔧 兜底修复：缺失的本地相对导入会导致 Vite 直接报错，这里自动创建占位文件保证可运行
        try {
          await ensureMissingImportedFilesExist(providerInstance, filesWithContent, sendProgress, results);
        } catch (missingImportError) {
          console.warn('[apply-ai-code-stream] Missing import stub step failed:', missingImportError);
          await sendProgress({
            type: 'warning',
            message: `Missing import fix skipped: ${(missingImportError as Error).message}`
          });
        }

        // Step 3: Execute commands
        const commandsArray = Array.isArray(parsed.commands) ? parsed.commands : [];
        if (commandsArray.length > 0) {
          await sendProgress({
            type: 'step',
            step: 3,
            message: `Executing ${commandsArray.length} commands...`
          });

          for (const [index, cmd] of commandsArray.entries()) {
            try {
              await sendProgress({
                type: 'command-progress',
                current: index + 1,
                total: parsed.commands.length,
                command: cmd,
                action: 'executing'
              });

              // Use provider runCommand
              const result = await providerInstance.runCommand(cmd);

              // Get command output from provider result
              const stdout = result.stdout;
              const stderr = result.stderr;

              if (stdout) {
                await sendProgress({
                  type: 'command-output',
                  command: cmd,
                  output: stdout,
                  stream: 'stdout'
                });
              }

              if (stderr) {
                await sendProgress({
                  type: 'command-output',
                  command: cmd,
                  output: stderr,
                  stream: 'stderr'
                });
              }

              if (results.commandsExecuted) {
                results.commandsExecuted.push(cmd);
              }

              await sendProgress({
                type: 'command-complete',
                command: cmd,
                exitCode: result.exitCode,
                success: result.exitCode === 0
              });
            } catch (error) {
              if (results.errors) {
                results.errors.push(`Failed to execute ${cmd}: ${(error as Error).message}`);
              }
              await sendProgress({
                type: 'command-error',
                command: cmd,
                error: (error as Error).message
              });
            }
          }
        }

        // Send final results
        await sendProgress({
          type: 'complete',
          results,
          explanation: parsed.explanation,
          structure: parsed.structure,
          message: `Successfully applied ${results.filesCreated.length} files`
        });

        // Track applied files in conversation state
        if (global.conversationState && results.filesCreated.length > 0) {
          const messages = global.conversationState.context.messages;
          if (messages.length > 0) {
            const lastMessage = messages[messages.length - 1];
            if (lastMessage.role === 'user') {
              lastMessage.metadata = {
                ...lastMessage.metadata,
                editedFiles: results.filesCreated
              };
            }
          }

          // Track applied code in project evolution
          if (global.conversationState.context.projectEvolution) {
            global.conversationState.context.projectEvolution.majorChanges.push({
              timestamp: Date.now(),
              description: parsed.explanation || 'Code applied',
              filesAffected: results.filesCreated || []
            });
          }

          global.conversationState.lastUpdated = Date.now();
        }

      } catch (error) {
        await sendProgress({
          type: 'error',
          error: (error as Error).message
        });
      } finally {
        // Close the writer safely - check if it's not already closed
        try {
          await writer.close();
        } catch (closeError) {
          // Writer might already be closed, log but don't throw
          console.debug('[apply-ai-code-stream] Writer close error (expected if stream ended early):', closeError);
        }
      }
    })(provider, request, sandboxInfoForClient, replacedSandboxId ?? requestedSandboxId);

    // Return the stream
    return new Response(stream.readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

  } catch (error) {
    console.error('Apply AI code stream error:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to parse AI code' },
      { status: 500 }
    );
  }
}
