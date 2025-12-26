import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { heartbeatManager } from '@/lib/sandbox/heartbeat-manager';

declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
}

/**
 * 销毁沙箱（需要由用户显式触发）
 *
 * 设计原则：
 * - 禁止在未获得用户确认时自动销毁（避免出现 “Sandbox Not Found”）
 * - 默认只销毁“目标沙箱/当前活跃沙箱”，不再一刀切 terminateAll
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const targetSandboxId =
      typeof body?.sandboxId === 'string' && body.sandboxId.trim()
        ? body.sandboxId.trim()
        : null;

    console.log('[kill-sandbox] 请求销毁的 sandboxId:', targetSandboxId ?? '(未提供)');

    let sandboxKilled = false;
    let killedSandboxId: string | null = null;

    // 1) 优先按 sandboxId 精准销毁
    if (targetSandboxId) {
      killedSandboxId = targetSandboxId;
      await sandboxManager.terminateSandbox(targetSandboxId);
      heartbeatManager.removeSandbox(targetSandboxId);
      sandboxKilled = true;
    } else {
      // 2) 兼容旧调用：未传 sandboxId 时，尝试销毁“当前活跃沙箱”
      const activeProvider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;
      const activeId =
        activeProvider?.getSandboxInfo?.()?.sandboxId || global.sandboxData?.sandboxId || null;

      if (activeId) {
        killedSandboxId = activeId;
        await sandboxManager.terminateSandbox(activeId);
        heartbeatManager.removeSandbox(activeId);
        sandboxKilled = true;
      }
    }

    // 3) 清理 legacy 全局状态（仅当与目标一致时）
    if (global.activeSandboxProvider) {
      const legacyId = global.activeSandboxProvider?.getSandboxInfo?.()?.sandboxId;
      if (!killedSandboxId || legacyId === killedSandboxId) {
        try {
          await global.activeSandboxProvider.terminate();
          sandboxKilled = true;
          killedSandboxId = killedSandboxId ?? legacyId ?? null;
          console.log('[kill-sandbox] Legacy global sandbox terminated');
        } catch (e) {
          console.error('[kill-sandbox] Failed to stop legacy sandbox:', e);
        }
        global.activeSandboxProvider = null;
        global.sandboxData = null;
      }
    }

    // Clear existing files tracking
    if (global.existingFiles) {
      global.existingFiles.clear();
    }

    return NextResponse.json({
      success: true,
      sandboxKilled,
      sandboxId: killedSandboxId,
      message: sandboxKilled ? '沙箱已销毁' : '未找到可销毁的沙箱'
    });
    
  } catch (error) {
    console.error('[kill-sandbox] Error:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: (error as Error).message 
      }, 
      { status: 500 }
    );
  }
}
