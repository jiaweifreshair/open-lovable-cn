import type { GenerationConfig, FileManifestItem } from '../../types/generation';

/**
 * 判断是否启用 E2E/离线 Mock 模式。
 *
 * 目的：让端到端测试在无外部网络/密钥（E2B、Firecrawl、LLM）时也能跑通。
 */
export function isE2eMockEnabled(): boolean {
  return process.env.OPEN_LOVABLE_E2E === '1';
}

/**
 * E2E/离线模式下的固定 manifest，用于验证：manifest → file → apply 的基础链路。
 */
export function getE2eMockManifest(): FileManifestItem[] {
  return [
    {
      path: 'src/components/Header.jsx',
      description: '页面头部组件，包含站点标题与导航',
      type: 'component',
      dependencies: [],
      isCritical: true,
      estimatedLines: 40,
    },
    {
      path: 'src/App.jsx',
      description: '应用主入口，组合页面结构',
      type: 'page',
      dependencies: ['src/components/Header.jsx'],
      isCritical: true,
      estimatedLines: 80,
    },
    {
      path: 'src/index.css',
      description: '全局样式（用于 Tailwind 指令与基础样式）',
      type: 'style',
      dependencies: [],
      isCritical: false,
      estimatedLines: 20,
    }
  ];
}

/**
 * E2E/离线模式下根据文件路径生成固定文件内容。
 */
export function getE2eMockFileContent(filePath: string): string {
  if (filePath.endsWith('src/components/Header.jsx')) {
    return `import React from 'react';

export default function Header() {
  return (
    <header className="w-full border-b border-gray-200 bg-white">
      <div className="mx-auto max-w-5xl px-6 py-4 flex items-center justify-between">
        <div className="text-lg font-semibold text-gray-900">Open Lovable Mock</div>
        <nav className="text-sm text-gray-600 flex gap-4">
          <a href="#" className="hover:text-gray-900">首页</a>
          <a href="#" className="hover:text-gray-900">关于</a>
        </nav>
      </div>
    </header>
  );
}
`;
  }

  if (filePath.endsWith('src/App.jsx')) {
    return `import React from 'react';
import Header from './components/Header';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-5xl px-6 py-10">
        <h1 className="text-3xl font-bold text-gray-900 mb-3">代码已成功生成</h1>
        <p className="text-gray-700">这是用于 E2E 验证的 Mock 页面内容。</p>
      </main>
    </div>
  );
}
`;
  }

  if (filePath.endsWith('src/index.css')) {
    return `@tailwind base;
@tailwind components;
@tailwind utilities;
`;
  }

  return `// Mock file: ${filePath}\n`;
}

/**
 * E2E/离线 Mock 生成：根据 generation.mode 模拟输出 SSE 事件。
 *
 * 注意：该路由名含 "stream"，因此这里统一走 SSE 输出，便于前端复用解析逻辑。
 */
export async function runE2eMockGeneration(
  generation: GenerationConfig,
  sendProgress: (data: any) => Promise<void>
): Promise<void> {
  const manifest = getE2eMockManifest();

  if (generation.mode === 'plan') {
    const planContent = `# 技术实现方案

## 1. 需求分析
- E2E Mock：验证从 Plan 到代码生成的完整链路

## 4. 文件拆解
### 文件清单
\`\`\`json
{
  "files": ${JSON.stringify(manifest, null, 2)}
}
\`\`\`
`;

    await sendProgress({ type: 'plan_chunk', chunk: planContent, totalLength: planContent.length });
    await sendProgress({
      type: 'plan_complete',
      plan: {
        content: planContent,
        suggestedManifest: manifest,
        summary: {
          requirementAnalysis: 'E2E Mock：验证生成流程',
          techStack: ['React', 'Tailwind CSS'],
          architecture: '单页应用（Mock）',
          totalFiles: manifest.length,
          estimatedTime: 1,
          risks: []
        }
      }
    });
    return;
  }

  if (generation.mode === 'manifest') {
    await sendProgress({ type: 'manifest_complete', manifest, totalFiles: manifest.length });
    return;
  }

  if (generation.mode === 'file') {
    const totalFiles = Array.isArray(generation.manifest) && generation.manifest.length > 0
      ? generation.manifest.length
      : manifest.length;
    const fileIndex = typeof generation.fileIndex === 'number' ? generation.fileIndex : 0;

    const selected = Array.isArray(generation.manifest) && generation.manifest[fileIndex]
      ? generation.manifest[fileIndex]
      : manifest[Math.min(fileIndex, manifest.length - 1)];

    const progress = totalFiles > 0 ? Math.round(((fileIndex + 1) / totalFiles) * 100) : 100;
    const isComplete = fileIndex >= totalFiles - 1;

    await sendProgress({
      type: 'file_complete',
      fileIndex,
      totalFiles,
      file: {
        path: selected.path,
        content: getE2eMockFileContent(selected.path),
      },
      progress,
      isComplete
    });
    return;
  }

  // full 模式：输出 <file> 标签格式，兼容旧的前端解析逻辑
  const generatedCode = manifest
    .map((f) => `<file path="${f.path}">\n${getE2eMockFileContent(f.path)}\n</file>`)
    .join('\n\n');

  await sendProgress({ type: 'stream', raw: true, text: generatedCode });
  await sendProgress({
    type: 'complete',
    generatedCode,
    explanation: 'E2E Mock：已生成固定文件集合'
  });
}
