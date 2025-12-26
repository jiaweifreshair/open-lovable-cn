import { getE2eMockManifest, runE2eMockGeneration } from '../lib/e2e/mock-generation.ts';
import type { GenerationConfig } from '../types/generation.ts';

/**
 * E2E Mock 生成烟囱测试（不启动 Next Server、不依赖外部网络）
 *
 * 目的：
 * - 在 OPEN_LOVABLE_E2E=1 环境下，确保生成链路的核心输出结构稳定：
 *   manifest_complete / file_complete / complete
 *
 * 使用：
 * - `OPEN_LOVABLE_E2E=1 npx tsx tests/run-e2e-mock-generation.ts`
 */

type Event = { type: string; [key: string]: any };

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

async function capture(generation: GenerationConfig): Promise<Event[]> {
  const events: Event[] = [];
  await runE2eMockGeneration(generation, async (data) => {
    events.push(data);
  });
  return events;
}

async function main() {
  const manifest = getE2eMockManifest();
  assert(manifest.length > 0, 'mock manifest 不能为空');

  // 0) 超长输入兜底：这里只验证“不会因输入超长而崩溃”（真实模型调用在 E2E mock 中不会发生）
  const veryLong = 'x'.repeat(700000);
  assert(veryLong.length > 98000, '构造的超长输入应超过常见网关限制');

  // 1) manifest
  const manifestEvents = await capture({ mode: 'manifest' });
  const manifestComplete = manifestEvents.find(e => e.type === 'manifest_complete');
  assert(manifestComplete, '应输出 manifest_complete 事件');
  assert(Array.isArray(manifestComplete.manifest), 'manifest_complete.manifest 应为数组');
  assert(manifestComplete.manifest.length === manifest.length, 'manifest 文件数应与 mock manifest 一致');

  // 2) file
  const fileEvents = await capture({ mode: 'file', manifest, fileIndex: 0 });
  const fileComplete = fileEvents.find(e => e.type === 'file_complete');
  assert(fileComplete, '应输出 file_complete 事件');
  assert(fileComplete.file?.path, 'file_complete.file.path 不应为空');
  assert(typeof fileComplete.file?.content === 'string', 'file_complete.file.content 应为字符串');

  // 3) full
  const fullEvents = await capture({ mode: 'full' });
  const complete = fullEvents.find(e => e.type === 'complete');
  assert(complete, '应输出 complete 事件');
  assert(typeof complete.generatedCode === 'string', 'complete.generatedCode 应为字符串');
  assert(complete.generatedCode.includes('<file path="src/App.jsx">'), 'generatedCode 应包含 src/App.jsx 的 <file> 块');

  console.log('[run-e2e-mock-generation] ✅ OK');
}

main().catch((err) => {
  console.error('[run-e2e-mock-generation] ❌ FAILED:', err instanceof Error ? err.message : err);
  process.exit(1);
});
