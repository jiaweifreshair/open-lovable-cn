import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

/**
 * 在沙箱中执行命令
 *
 * 请求体格式：
 * {
 *   "sandboxId": "xxx",      // 可选，如果不提供则使用当前活跃的沙箱
 *   "command": "mvn compile", // 要执行的命令
 *   "timeout": 300           // 超时时间（秒），可选
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const { sandboxId, command, timeout } = await request.json();

    if (!command || typeof command !== 'string') {
      return NextResponse.json({
        success: false,
        error: 'Command is required and must be a string'
      }, { status: 400 });
    }

    // 获取活跃的沙箱提供者
    const provider = sandboxManager.getActiveProvider();

    if (!provider) {
      return NextResponse.json({
        success: false,
        error: 'No active sandbox. Please create a sandbox first.'
      }, { status: 400 });
    }

    // 验证沙箱ID（如果提供）
    const currentSandboxInfo = provider.getSandboxInfo();
    if (sandboxId && currentSandboxInfo?.sandboxId !== sandboxId) {
      return NextResponse.json({
        success: false,
        error: `Sandbox ID mismatch. Active: ${currentSandboxInfo?.sandboxId}, Requested: ${sandboxId}`
      }, { status: 400 });
    }

    console.log(`[sandbox/execute] Running command: ${command}`);
    const startTime = Date.now();

    // 执行命令
    const result = await provider.runCommand(command);

    const duration = Date.now() - startTime;
    console.log(`[sandbox/execute] Command completed in ${duration}ms, exitCode: ${result.exitCode}`);

    return NextResponse.json({
      success: result.success,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      duration,
      message: result.success ? 'Command executed successfully' : 'Command failed'
    });

  } catch (error) {
    console.error('[sandbox/execute] Error:', error);
    return NextResponse.json({
      success: false,
      error: (error as Error).message
    }, { status: 500 });
  }
}
