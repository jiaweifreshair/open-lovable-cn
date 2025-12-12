import { NextRequest, NextResponse } from 'next/server';
import { createGroq } from '@ai-sdk/groq';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { geminiFetch } from '@/lib/gemini-fetch';
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

    // 统一封装 runCommand/stdout 读取，兼容 Provider(string) 与 Direct(object) 两种 sandbox
    const runCmd = async (cmd: string, args: string[] = []) => {
      const commandStr = [cmd, ...args].join(' ');
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

    const generatedCode = assembleGeneratedCode(originalFiles);
    const extracted = extractFiles(generatedCode);
    const depIssues = validateDependencies(extracted);
    const completenessIssues = validateCompleteness(extracted);
    const errors = [...depIssues, ...completenessIssues].filter(i => i.severity === 'error');

    if (errors.length === 0) {
      return NextResponse.json({
        success: true,
        fixed: false,
        issues: [...depIssues, ...completenessIssues],
        message: 'Code looks complete'
      });
    }

    // === 自动补全（复用生成阶段 autoFix）===
    const { modelProvider, actualModel } = resolveModelProvider(model);
    const fixResult = await autoFix(generatedCode, modelProvider(actualModel), 2);

    if (!fixResult.success) {
      return NextResponse.json({
        success: true,
        fixed: false,
        issues: fixResult.remainingIssues,
        message: 'Auto-fix did not resolve all issues'
      });
    }

    // === 计算差异并写回 sandbox ===
    const originalMap = new Map(originalFiles.map(f => [f.path, f.content]));
    const filesCreated: string[] = [];
    const filesUpdated: string[] = [];

    for (const fixedFile of fixResult.fixedFiles) {
      const oldContent = originalMap.get(fixedFile.path);
      const newContent = fixedFile.content;

      if (oldContent == null) {
        filesCreated.push(fixedFile.path);
      } else if (oldContent.trim() !== newContent.trim()) {
        filesUpdated.push(fixedFile.path);
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

  const isUsingGeminiGCA = !!process.env.CODE_ASSIST_ENDPOINT && !!process.env.GOOGLE_CLOUD_ACCESS_TOKEN;
  const isGeminiGCA = model.startsWith('gemini-') && isUsingGeminiGCA;

  const geminiGCAProvider = createOpenAICompatible({
    name: 'gemini-gca',
    apiKey: process.env.GOOGLE_CLOUD_ACCESS_TOKEN || '',
    baseURL: 'https://cs.imds.ai/api/v1',
    fetch: geminiFetch,
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
    (isGeminiGCA ? geminiGCAProvider :
      (isChineseModel ? qiniuProvider :
        (isOpenAI ? openai :
          (isGoogle ? googleGenerativeAI : qiniuProvider))));

  let actualModel: string;
  if (isAnthropic) {
    actualModel = model.replace('anthropic/', '');
  } else if (isGeminiGCA) {
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
