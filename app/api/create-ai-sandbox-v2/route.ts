import { NextRequest, NextResponse } from 'next/server';
import { SandboxFactory } from '@/lib/sandbox/factory';
// SandboxProvider type is used through SandboxFactory
import type { SandboxState } from '@/types/sandbox';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';
import { heartbeatManager } from '@/lib/sandbox/heartbeat-manager';

// Store active sandbox globally
declare global {
  var activeSandboxProvider: any;
  var sandboxData: any;
  var existingFiles: Set<string>;
  var sandboxState: SandboxState;
  var sandboxCreationInProgress: boolean;
  var sandboxCreationPromise: Promise<any> | null;
}

export async function POST(request: NextRequest) {
  try {
    // ✅ E2E/离线测试模式：跳过真实沙箱创建（避免依赖外部 E2B/Vercel 服务）
    if (process.env.OPEN_LOVABLE_E2E === '1') {
      return NextResponse.json({
        success: true,
        sandboxId: 'mock-sandbox',
        url: 'about:blank',
        provider: 'mock',
        message: 'Mock sandbox created (OPEN_LOVABLE_E2E=1)'
      });
    }

    const body = await request.json().catch(() => ({}));
    const forceNew = body?.forceNew === true;
    const terminateExisting = body?.terminateExisting === true;
    // 项目类型：vite（默认前端）| maven（Java/Maven项目）
    const projectType = body?.projectType || body?.template || 'vite';

    // 并发保护：避免重复创建触发“互相清理”导致沙箱不存在
    if (global.sandboxCreationInProgress && global.sandboxCreationPromise) {
      console.log('[create-ai-sandbox-v2] 沙箱创建进行中，复用同一创建结果');
      const existingResult = await global.sandboxCreationPromise;
      return NextResponse.json(existingResult);
    }

    // 默认复用现有沙箱：禁止未确认就销毁
    const existingProvider = sandboxManager.getActiveProvider() || global.activeSandboxProvider;
    const existingInfo = existingProvider?.getSandboxInfo?.();
    const existingSandboxId = existingInfo?.sandboxId || global.sandboxData?.sandboxId;
    const existingUrl = existingInfo?.url || global.sandboxData?.url;

    if (existingSandboxId && existingUrl && !forceNew) {
      console.log('[create-ai-sandbox-v2] 复用现有沙箱:', existingSandboxId);
      // 兼容：确保 legacy 全局状态可用
      if (!global.activeSandboxProvider && existingProvider) {
        global.activeSandboxProvider = existingProvider;
      }
      if (!global.sandboxData) {
        global.sandboxData = { sandboxId: existingSandboxId, url: existingUrl };
      }
      return NextResponse.json({
        success: true,
        sandboxId: existingSandboxId,
        url: existingUrl,
        provider: existingInfo?.provider || 'e2b',
        reused: true,
        message: '已复用现有沙箱'
      });
    }

    // 如果请求强制新建，但未明确允许销毁旧沙箱，直接拒绝（交由前端弹窗确认）
    if (existingSandboxId && forceNew && !terminateExisting) {
      return NextResponse.json(
        {
          success: false,
          requiresConfirmation: true,
          error: '检测到已有沙箱，需要用户确认后才能销毁并重建。'
        },
        { status: 409 }
      );
    }

    // 设置创建锁
    global.sandboxCreationInProgress = true;
    global.sandboxCreationPromise = (async () => {
      console.log('[create-ai-sandbox-v2] Creating sandbox...');

      // 仅在明确确认时才清理旧沙箱
      if (terminateExisting) {
        console.log('[create-ai-sandbox-v2] 已确认：销毁现有沙箱并重建');
        await sandboxManager.terminateAll();

        if (global.activeSandboxProvider) {
          try {
            await global.activeSandboxProvider.terminate();
          } catch (e) {
            console.error('终止 legacy 全局沙箱失败:', e);
          }
          global.activeSandboxProvider = null;
        }
      }
    
      // Clear existing files tracking
      if (global.existingFiles) {
        global.existingFiles.clear();
      } else {
        global.existingFiles = new Set<string>();
      }

      // Create new sandbox using factory
      const provider = SandboxFactory.create();
      const sandboxInfo = await provider.createSandbox();

      // 根据项目类型设置环境
      if (projectType === 'maven' || projectType === 'maven-jdk17' || projectType === 'java') {
        console.log('[create-ai-sandbox-v2] Setting up Maven/JDK environment...');
        await provider.setupMavenEnvironment();
      } else {
        console.log('[create-ai-sandbox-v2] Setting up Vite React app...');
        await provider.setupViteApp();
      }

      // Register with sandbox manager
      sandboxManager.registerSandbox(sandboxInfo.sandboxId, provider);

      // Register with heartbeat manager immediately
      heartbeatManager.recordHeartbeat(sandboxInfo.sandboxId);

      // Also store in legacy global state for backward compatibility
      global.activeSandboxProvider = provider;
      global.sandboxData = {
        sandboxId: sandboxInfo.sandboxId,
        url: sandboxInfo.url
      };

      // Initialize sandbox state
      global.sandboxState = {
        fileCache: {
          files: {},
          lastSync: Date.now(),
          sandboxId: sandboxInfo.sandboxId
        },
        sandbox: provider, // Store the provider instead of raw sandbox
        sandboxData: {
          sandboxId: sandboxInfo.sandboxId,
          url: sandboxInfo.url
        }
      };

      console.log('[create-ai-sandbox-v2] Sandbox ready at:', sandboxInfo.url);

      const setupMessage = (projectType === 'maven' || projectType === 'maven-jdk17' || projectType === 'java')
        ? '沙箱已创建并初始化 Maven/JDK 环境'
        : '沙箱已创建并初始化 Vite React 应用';

      return {
        success: true,
        sandboxId: sandboxInfo.sandboxId,
        url: sandboxInfo.url,
        provider: sandboxInfo.provider,
        projectType: projectType,
        message: setupMessage
      };
    })();

    try {
      const result = await global.sandboxCreationPromise;
      return NextResponse.json(result);
    } finally {
      global.sandboxCreationInProgress = false;
      global.sandboxCreationPromise = null;
    }

  } catch (error) {
    console.error('[create-ai-sandbox-v2] Error:', error);
    
    // Clean up on error
    // 注意：这里不再强制 terminateAll（避免误杀用户仍在使用的沙箱）
    global.sandboxCreationInProgress = false;
    global.sandboxCreationPromise = null;
    
    return NextResponse.json(
      { 
        error: error instanceof Error ? error.message : 'Failed to create sandbox',
        details: error instanceof Error ? error.stack : undefined
      },
      { status: 500 }
    );
  }
}
