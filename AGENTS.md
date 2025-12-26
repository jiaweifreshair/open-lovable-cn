# Repository Guidelines

## Project Structure & Module Organization

- `app/`: Next.js App Router（页面 + `app/api/**` 后端路由）。
- `components/` + `atoms/`: 复用 UI 组件与设计系统组件。
- `lib/`: 核心逻辑（AI、爬取、沙箱等；重点看 `lib/sandbox/**`）。
- `config/`: 运行时配置（如 `config/app.config.ts` 模型/端口/超时）。
- `styles/` + `public/`: Fire 设计系统与静态资源（`.container` 由 `styles/fire.css` 提供，Tailwind 的 `container` 已禁用以避免覆盖）。
- `docs/`, `packages/create-open-lovable/`, `tests/`: 文档、脚手架与回归脚本。

## Build, Test, and Development Commands

- `pnpm dev`: 本地启动（Next.js）。
- `pnpm build` / `pnpm start`: 生产构建与启动。
- `pnpm lint`: Next.js ESLint。
- `npx tsc --noEmit`: TypeScript 严格模式类型检查（提交前必跑）。
- `node tests/run-truncation-tests.mjs`: 生成/截断相关回归脚本（改动生成链路时必跑）。

建议在同一个 PR 内统一使用 `pnpm` 或 `npm`，避免不必要的多 lockfile 变更。

## Coding Style & Naming Conventions

- TS/JS 使用 ES Modules（`"type": "module"`），尽量保持类型显式，避免无理由 `any`。
- 延续既有格式（本仓库以 2 空格缩进为主），改动尽量小且聚焦。
- 用户可见文案与新增注释/文档优先中文，贴合“中文版本”定位。

## Testing Guidelines

- 测试/脚本放在 `tests/`，命名清晰（如 `run-*.mjs` 或 `*.test.ts`）。
- 改动沙箱/生成链路时，至少跑一遍 `node tests/run-truncation-tests.mjs` + `npx tsc --noEmit`。

## Commit & Pull Request Guidelines

- 尽量遵循 Conventional Commits：`feat: …` / `fix: …` / `docs: …` / `refactor: …` / `chore: …`（历史提交常见中文描述）。
- PR 需要说明：做了什么/为什么、如何验证（命令 + 预期行为）、UI 变更附截图。

## Security & Configuration Tips

- Never commit secrets. Use `.env.local` for local keys and keep `.env*` out of git.
- If you add an env var, document it in `.env.example` and update `README.md`.
- Sandbox provider selection is controlled by `SANDBOX_PROVIDER` (`e2b` or `vercel`), with credentials in `E2B_API_KEY` / `VERCEL_*`.
- 沙箱生命周期：默认不自动销毁（避免预览 `Sandbox Not Found`）；仅在用户显式操作时调用 `POST /api/kill-sandbox`。如需后端兜底清理超时沙箱，设置 `OPEN_LOVABLE_SANDBOX_AUTOCLEANUP=1`。
- 离线/E2E：可用 `OPEN_LOVABLE_E2E=1` 跳过真实沙箱创建（仅用于测试/CI）。
