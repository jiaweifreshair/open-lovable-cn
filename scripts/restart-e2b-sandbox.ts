/**
 * 用途：本地手动“重启”E2B 沙箱（实际为新建一个沙箱并重新执行 Vite+Tailwind 初始化）。
 * 原因：用于验证沙箱模板依赖是否完整（例如 `@tailwindcss/typography`）。
 *
 * 运行：
 *   pnpm exec tsx scripts/restart-e2b-sandbox.ts
 *
 * 注意：
 * - 需要在 `.env.local` 配置 `E2B_API_KEY`。
 * - 脚本不会自动销毁沙箱（便于你继续打开预览）；如需销毁请在应用内或控制台手动处理。
 */

import { config as loadEnv } from 'dotenv';
import { E2BProvider } from '@/lib/sandbox/providers/e2b-provider';

loadEnv({ path: '.env.local' });

const apiKey = process.env.E2B_API_KEY;
if (!apiKey) {
  console.error('缺少环境变量 `E2B_API_KEY`（请在 `.env.local` 配置）');
  process.exit(1);
}

const provider = new E2BProvider({ e2b: { apiKey } });
const info = await provider.createSandbox();
await provider.setupViteApp();

console.log(`[E2B] sandboxId=${info.sandboxId}`);
console.log(`[E2B] url=${info.url}`);

