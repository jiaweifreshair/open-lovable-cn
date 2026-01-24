import { NextRequest, NextResponse } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createEcaGatewayFetch, isEcaGatewayHttpError } from '@/lib/eca-gateway';
import { appConfig } from '@/config/app.config';
import {
  extractFiles,
  validateDependencies,
  validateCompleteness,
  autoFix,
  assembleGeneratedCode,
  type FileInfo as FixFileInfo
} from '@/lib/multi-turn-fix-engine';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

declare global {
  var activeSandbox: any;
  var activeSandboxProvider: any;
}

/**
 * 智能刷新预览：
 * 1. 读取当前 sandbox 里的小体量源码文件
 * 2. 校验相对 import 依赖与截断情况
 * 3. 若有严重问题则自动补全缺失文件/补全截断文件并写回 sandbox
 * 4. 返回修复结果给前端决定刷新
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const model: string = body?.model || appConfig.ai.defaultModel;

    const sandbox = sandboxManager.getActiveProvider() || global.activeSandbox || global.activeSandboxProvider;
    if (!sandbox) {
      return NextResponse.json({ success: false, error: 'No active sandbox' }, { status: 400 });
    }

    // 当前 sandbox 提供者信息：用于判断执行环境与转义策略。
    const providerInfo = typeof sandbox?.getSandboxInfo === 'function'
      ? sandbox.getSandboxInfo()
      : null;
    // 是否为 E2B（shell 执行）：需要额外转义括号与通配符，避免命令解析失败。
    const isShellProvider = providerInfo?.provider === 'e2b';

    // 统一封装 runCommand/stdout 读取，兼容 Provider(string) 与 Direct(object) 两种 sandbox
    const runCmd = async (cmd: string, args: string[] = []) => {
      // 兼容 E2B 的 shell 执行方式，避免括号与通配符被 shell 误解析
      const normalizedArgs = isShellProvider
        ? args.map(arg => {
          if (arg === '(' || arg === ')') return `\\${arg}`;
          if (arg.includes('*') || arg.includes('?') || arg.includes('[')) return `"${arg}"`;
          return arg;
        })
        : args;
      const commandStr = [cmd, ...normalizedArgs].join(' ');
      try {
        return await sandbox.runCommand(commandStr);
      } catch {
        return await sandbox.runCommand({ cmd, args });
      }
    };

    const readStdout = async (res: any) => {
      if (!res) return '';
      if (typeof res.stdout === 'function') return await res.stdout();
      return res.stdout || '';
    };

    const readExitCode = (res: any) => {
      if (res && typeof res.exitCode === 'number') return res.exitCode;
      if (res && typeof res.success === 'boolean') return res.success ? 0 : 1;
      return 0;
    };

    // === 读取 sandbox 文件 ===
    const findResult = await runCmd('find', [
      '.',
      '-name', 'node_modules', '-prune', '-o',
      '-name', '.git', '-prune', '-o',
      '-name', 'dist', '-prune', '-o',
      '-name', 'build', '-prune', '-o',
      '-type', 'f',
      '(',
      '-name', '*.jsx',
      '-o', '-name', '*.js',
      '-o', '-name', '*.tsx',
      '-o', '-name', '*.ts',
      '-o', '-name', '*.css',
      ')',
      '-print'
    ]);

    if (readExitCode(findResult) !== 0) {
      throw new Error('Failed to list sandbox files');
    }

    const fileList = (await readStdout(findResult)).split('\n').filter((f: string) => f.trim());
    const originalFiles: FixFileInfo[] = [];

    for (const filePath of fileList) {
      try {
        // 兼容不同 sandbox 的 stat 实现：优先 BSD 风格 -f，失败则回退到 wc -c
        let fileSize = NaN;
        const statResult = await runCmd('stat', ['-f', '%z', filePath]);
        if (readExitCode(statResult) === 0) {
          fileSize = parseInt(await readStdout(statResult));
        } else {
          const wcResult = await runCmd('wc', ['-c', filePath]);
          if (readExitCode(wcResult) === 0) {
            fileSize = parseInt((await readStdout(wcResult)).trim().split(/\s+/)[0]);
          }
        }

        if (Number.isNaN(fileSize) || fileSize >= 10000) continue;

        const catResult = await runCmd('cat', [filePath]);
        if (readExitCode(catResult) !== 0) continue;
        const content = await readStdout(catResult);

        const relativePath = filePath.replace(/^\.\//, '');
        originalFiles.push({ path: relativePath, content: content.trim() });
      } catch {
        continue;
      }
    }

    if (originalFiles.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: false,
        issues: [],
        message: 'No readable source files found'
      });
    }

    // === 兜底修复：入口文件未挂载会导致预览白屏（#root 永远为空），但不一定会被依赖/截断校验识别 ===
    // 说明：
    // - 该问题常见于 AI 把 src/main.jsx 写成“纯组件文件”（只有 export default），缺少 ReactDOM.createRoot(...).render(...)
    // - 点击“一键修复”时需要优先兜底，否则用户会看到“Code looks complete”但仍然白屏
    const originalMap = new Map(originalFiles.map(f => [f.path, f.content]));
    const filesCreated: string[] = [];
    const filesUpdated: string[] = [];
    const pushUnique = (arr: string[], value: string) => {
      if (!arr.includes(value)) arr.push(value);
    };

    const writeSandboxFile = async (filePath: string, content: string) => {
      const dirPath = filePath.includes('/')
        ? filePath.substring(0, filePath.lastIndexOf('/'))
        : '';
      if (dirPath) await runCmd('mkdir', ['-p', dirPath]);

      if (sandbox.writeFile) {
        await sandbox.writeFile(filePath, content);
        return;
      }
      if (sandbox.files?.write) {
        await sandbox.files.write(`/home/user/app/${filePath}`, content);
        return;
      }
      throw new Error('Unsupported sandbox type for write');
    };

    const ensureViteEntryPointMountsApp = async (): Promise<boolean> => {
      const entryCandidates = ['src/main.jsx', 'src/main.tsx', 'src/main.js'];
      let entryPath: string | null = entryCandidates.find(p => originalMap.has(p)) || null;
      let entryExists = !!entryPath;

      if (!entryPath) {
        for (const candidate of entryCandidates) {
          const testRes = await runCmd('test', ['-f', candidate]);
          if (readExitCode(testRes) === 0) {
            entryPath = candidate;
            entryExists = true;
            break;
          }
        }
      }

      // 如果入口文件不存在，兜底创建 main.jsx（与模板默认一致）
      if (!entryPath) {
        entryPath = 'src/main.jsx';
        entryExists = false;
      }

      let entryContent: string = originalMap.get(entryPath) ?? '';
      if (!originalMap.has(entryPath)) {
        const catRes = await runCmd('cat', [entryPath]);
        if (readExitCode(catRes) === 0) {
          entryContent = (await readStdout(catRes)).trim();
        } else {
          entryContent = '';
        }
        originalMap.set(entryPath, entryContent);
        const idx = originalFiles.findIndex(f => f.path === entryPath);
        if (idx >= 0) originalFiles[idx] = { path: entryPath, content: entryContent };
        else originalFiles.push({ path: entryPath, content: entryContent });
      }

      const hasMountCall =
        /ReactDOM\s*\.\s*(createRoot|render)\s*\(/.test(entryContent) || /\bcreateRoot\s*\(/.test(entryContent);
      const targetsRoot =
        /getElementById\s*\(\s*['"]root['"]\s*\)/.test(entryContent) || /querySelector\s*\(\s*['"]#root['"]\s*\)/.test(entryContent);
      const looksMounted = hasMountCall && targetsRoot;
      if (looksMounted) return false;

      const appCandidates = [
        { file: 'src/App.tsx', importPath: './App.tsx' },
        { file: 'src/App.jsx', importPath: './App.jsx' },
        { file: 'src/App.ts', importPath: './App.ts' },
        { file: 'src/App.js', importPath: './App.js' }
      ];

      let appImport: string | null = null;
      for (const candidate of appCandidates) {
        if (originalMap.has(candidate.file)) {
          appImport = candidate.importPath;
          break;
        }
        const testRes = await runCmd('test', ['-f', candidate.file]);
        if (readExitCode(testRes) === 0) {
          appImport = candidate.importPath;
          break;
        }
      }

      // 没有 App 文件时，无法安全修复入口挂载（避免引入新的 import 错误）
      if (!appImport) return false;

      const fixedEntry = `import React from 'react'
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

      const wasDifferent = (entryContent || '').trim() !== fixedEntry.trim();
      if (!wasDifferent && entryExists) return false;

      await writeSandboxFile(entryPath, fixedEntry);

      // 更新本地缓存，保证后续校验基于最新内容
      originalMap.set(entryPath, fixedEntry);
      const idx = originalFiles.findIndex(f => f.path === entryPath);
      if (idx >= 0) originalFiles[idx] = { path: entryPath, content: fixedEntry };
      else originalFiles.push({ path: entryPath, content: fixedEntry });

      if (!entryExists) pushUnique(filesCreated, entryPath);
      else pushUnique(filesUpdated, entryPath);

      return true;
    };

    const entryFixed = await ensureViteEntryPointMountsApp();

    const generatedCode = assembleGeneratedCode(originalFiles);
    const extracted = extractFiles(generatedCode);
    const depIssues = validateDependencies(extracted);
    const completenessIssues = validateCompleteness(extracted);
    const errors = [...depIssues, ...completenessIssues].filter(i => i.severity === 'error');

    if (errors.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: entryFixed,
        filesCreated,
        filesUpdated,
        issues: [...depIssues, ...completenessIssues],
        message: entryFixed ? '已修复入口挂载导致的白屏问题' : 'Code looks complete'
      });
    }

    // === 自动补全（复用生成阶段 autoFix）===
    const { modelProvider, actualModel } = resolveModelProvider(model);
    let fixResult: any;
    try {
      fixResult = await autoFix(generatedCode, modelProvider(actualModel), 2);
    } catch (e) {
      if (filesCreated.length > 0 || filesUpdated.length > 0) {
        return NextResponse.json({
          success: true,
          fixed: true,
          filesCreated,
          filesUpdated,
          issues: [...depIssues, ...completenessIssues],
          message: `入口挂载已修复，但模型自动修复失败：${(e as Error).message}`
        });
      }
      throw e;
    }

    if (!fixResult.success) {
      return NextResponse.json({
        success: true,
        fixed: entryFixed,
        filesCreated,
        filesUpdated,
        issues: fixResult.remainingIssues,
        message: entryFixed ? '入口挂载已修复，但 Auto-fix 未完全解决其余问题' : 'Auto-fix did not resolve all issues'
      });
    }

    // === 计算差异并写回 sandbox ===
    for (const fixedFile of fixResult.fixedFiles) {
      const oldContent = originalMap.get(fixedFile.path);
      const newContent = fixedFile.content;

      if (oldContent == null) {
        pushUnique(filesCreated, fixedFile.path);
      } else if (oldContent.trim() !== newContent.trim()) {
        pushUnique(filesUpdated, fixedFile.path);
      } else {
        continue;
      }

      const dirPath = fixedFile.path.includes('/')
        ? fixedFile.path.substring(0, fixedFile.path.lastIndexOf('/'))
        : '';
      if (dirPath) {
        await runCmd('mkdir', ['-p', dirPath]);
      }

      if (sandbox.writeFile) {
        await sandbox.writeFile(fixedFile.path, newContent);
      } else if (sandbox.files?.write) {
        await sandbox.files.write(`/home/user/app/${fixedFile.path}`, newContent);
      } else {
        throw new Error('Unsupported sandbox type for write');
      }
    }

    return NextResponse.json({
      success: true,
      fixed: true,
      filesCreated,
      filesUpdated,
      issues: fixResult.remainingIssues,
      message: `Auto-fixed: ${filesCreated.length} created, ${filesUpdated.length} updated`
    });
  } catch (error) {
    console.error('[smart-refresh-preview] Error:', error);

    if (isEcaGatewayHttpError(error)) {
      return NextResponse.json({
        success: false,
        error: error.message,
        requestId: error.details.requestId,
        code: error.details.code || error.details.type,
      }, { status: error.details.status });
    }

    if ((error as Error)?.message?.includes('ECA 网关未配置')) {
      return NextResponse.json({
        success: false,
        error: (error as Error).message
      }, { status: 400 });
    }

    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}

/**
 * 复用 generate-ai-code-stream 的模型路由规则（简化版）
 */
function resolveModelProvider(model: string): {
  modelProvider: any;
  actualModel: string;
} {
  const isUsingAIGateway = !!process.env.AI_GATEWAY_API_KEY;
  const aiGatewayBaseURL = 'https://ai-gateway.vercel.sh/v1';

  const groq = createGroq({
    apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GROQ_API_KEY,
    baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
  });

  const anthropic = createAnthropic({
    apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.ANTHROPIC_API_KEY,
    baseURL: isUsingAIGateway ? aiGatewayBaseURL : (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1'),
  });

  const googleGenerativeAI = createGoogleGenerativeAI({
    apiKey: process.env.AI_GATEWAY_API_KEY ?? process.env.GEMINI_API_KEY,
    baseURL: isUsingAIGateway ? aiGatewayBaseURL : undefined,
  });

  // ECA 网关默认地址：未配置时兜底，保证自动修复流程可用。
  const DEFAULT_ECA_GATEWAY_ENDPOINT = 'https://aigateway.edgecloudapp.com/v1/6a346ca84941b743a3ea49cd6db8d004/xinbang01';
  // 读取网关地址：优先新变量，兼容旧变量，避免配置迁移中断。
  const rawEcaGatewayEndpoint =
    process.env.ECA_GATEWAY_ENDPOINT ||
    process.env.AIGATEWAY_URL ||
    process.env.CODE_ASSIST_ENDPOINT;
  // 规范化后的网关地址：去除末尾斜杠，并兼容误配的 /chat/completions 后缀。
  const ecaGatewayEndpoint = (rawEcaGatewayEndpoint || DEFAULT_ECA_GATEWAY_ENDPOINT)
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/chat\/completions$/i, '')
    .replace(/\/+$/, '');
  // 读取网关密钥：优先新变量，兼容旧变量，避免迁移期请求失败。
  const ecaGatewayApiKey =
    process.env.ECA_GATEWAY_API_KEY ||
    process.env.GOOGLE_CLOUD_ACCESS_TOKEN ||
    process.env.AIGATEWAY_TOKEN;
  // 是否启用网关：要求地址和密钥同时存在，避免误路由。
  const isUsingEcaGateway = !!ecaGatewayEndpoint && !!ecaGatewayApiKey;
  // ECA 网关模型识别：gemini-/claude- 且网关可用时走同一路由。
  const isEcaModel = (model.startsWith('gemini-') || model.startsWith('claude-')) && isUsingEcaGateway;
  const isEcaStyleModel = model.startsWith('gemini-') || model.startsWith('claude-');

  // 🚧 保护性校验：用户选择了 ECA 风格模型名，但未配置网关时，避免误路由到其他 provider。
  if (isEcaStyleModel && !isUsingEcaGateway) {
    throw new Error('ECA 网关未配置：请设置 ECA_GATEWAY_ENDPOINT 与 ECA_GATEWAY_API_KEY（或兼容变量 CODE_ASSIST_ENDPOINT/GOOGLE_CLOUD_ACCESS_TOKEN）。');
  }

  const ecaGatewayProvider = createOpenAICompatible({
    name: 'eca-gateway',
    apiKey: ecaGatewayApiKey || '',
    baseURL: ecaGatewayEndpoint,
    fetch: createEcaGatewayFetch(),
  });

  const qiniuProvider = createOpenAICompatible({
    name: 'qiniu',
    apiKey: process.env.OPENAI_API_KEY || '',
    baseURL: process.env.OPENAI_BASE_URL || 'https://api.qnaigc.com/v1',
  });

  const openai = qiniuProvider;

  const isAnthropic = model.startsWith('anthropic/');
  const isGoogle = model.startsWith('google/');
  const isOpenAI = model.startsWith('openai/');
  const isChineseModel = /^(qwen|deepseek|glm-|qwq-|kimi-|moonshotai\/|gpt-oss)/.test(model);

  const modelProvider = isAnthropic ? anthropic :
    (isEcaModel ? ecaGatewayProvider :
      (isChineseModel ? qiniuProvider :
        (isOpenAI ? openai :
          (isGoogle ? googleGenerativeAI : qiniuProvider))));

  let actualModel: string;
  if (isAnthropic) {
    actualModel = model.replace('anthropic/', '');
  } else if (isEcaModel) {
    actualModel = model;
  } else if (isOpenAI) {
    actualModel = model.replace('openai/', '');
  } else if (isGoogle) {
    actualModel = model.replace('google/', '');
  } else {
    actualModel = model;
  }

  return { modelProvider, actualModel };
}
