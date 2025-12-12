import { NextRequest, NextResponse } from 'next/server';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

declare global {
  var activeSandbox: any;
  var activeSandboxProvider: any;
  var lastViteRestartTime: number;
  var viteRestartInProgress: boolean;
}

const RESTART_COOLDOWN_MS = 5000; // 5 second cooldown between restarts

/**
 * 重启Vite开发服务器
 *
 * 支持两种调用方式：
 * 1. 带sandboxId参数 - 使用sandboxManager获取正确的provider（推荐）
 * 2. 无参数 - 使用全局变量fallback（向后兼容）
 */
export async function POST(request: NextRequest) {
  try {
    // 解析请求体获取sandboxId
    let sandboxId: string | null = null;
    try {
      const body = await request.json();
      sandboxId = body?.sandboxId || null;
    } catch {
      // 无请求体或解析失败，使用fallback逻辑
    }

    let provider: any = null;

    // 优先使用sandboxId从sandboxManager获取provider
    if (sandboxId) {
      console.log(`[restart-vite] Looking up sandbox by ID: ${sandboxId}`);
      provider = sandboxManager.getProvider(sandboxId);
      if (provider) {
        console.log(`[restart-vite] Found provider via sandboxManager for sandbox: ${sandboxId}`);
      } else {
        console.log(`[restart-vite] No provider found in sandboxManager for sandbox: ${sandboxId}, trying global fallback`);
      }
    }

    // Fallback: 使用全局变量（向后兼容）
    if (!provider) {
      provider = global.activeSandbox || global.activeSandboxProvider;
      if (provider) {
        console.log('[restart-vite] Using global sandbox provider (fallback)');
      }
    }

    if (!provider) {
      return NextResponse.json({
        success: false,
        error: sandboxId
          ? `No sandbox found for ID: ${sandboxId}`
          : 'No active sandbox'
      }, { status: 400 });
    }
    
    // Check if restart is already in progress
    if (global.viteRestartInProgress) {
      console.log('[restart-vite] Vite restart already in progress, skipping...');
      return NextResponse.json({
        success: true,
        message: 'Vite restart already in progress'
      });
    }
    
    // Check cooldown
    const now = Date.now();
    if (global.lastViteRestartTime && (now - global.lastViteRestartTime) < RESTART_COOLDOWN_MS) {
      const remainingTime = Math.ceil((RESTART_COOLDOWN_MS - (now - global.lastViteRestartTime)) / 1000);
      console.log(`[restart-vite] Cooldown active, ${remainingTime}s remaining`);
      return NextResponse.json({
        success: true,
        message: `Vite was recently restarted, cooldown active (${remainingTime}s remaining)`
      });
    }
    
    // Set the restart flag
    global.viteRestartInProgress = true;
    
    console.log('[restart-vite] Using provider method to restart Vite...');
    
    // Use the provider's restartViteServer method if available
    if (typeof provider.restartViteServer === 'function') {
      await provider.restartViteServer();
      console.log('[restart-vite] Vite restarted via provider method');
    } else {
      // Fallback to manual restart using provider's runCommand
      console.log('[restart-vite] Fallback to manual Vite restart...');
      
      // Kill existing Vite processes
      try {
        await provider.runCommand('pkill -f vite');
        console.log('[restart-vite] Killed existing Vite processes');
        
        // Wait a moment for processes to terminate
        await new Promise(resolve => setTimeout(resolve, 2000));
      } catch {
        console.log('[restart-vite] No existing Vite processes found');
      }
      
      // Clear any error tracking files
      try {
        await provider.runCommand('bash -c "echo \'{\\"errors\\": [], \\"lastChecked\\": '+ Date.now() +'}\' > /tmp/vite-errors.json"');
      } catch {
        // Ignore if this fails
      }
      
      // Start Vite dev server in background
      await provider.runCommand('sh -c "nohup npm run dev > /tmp/vite.log 2>&1 &"');
      console.log('[restart-vite] Vite dev server restarted');
      
      // Wait for Vite to start up
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    
    // Update global state
    global.lastViteRestartTime = Date.now();
    global.viteRestartInProgress = false;
    
    return NextResponse.json({
      success: true,
      message: 'Vite restarted successfully'
    });
    
  } catch (error) {
    console.error('[restart-vite] Error:', error);
    
    // Clear the restart flag on error
    global.viteRestartInProgress = false;
    
    return NextResponse.json({ 
      success: false, 
      error: (error as Error).message 
    }, { status: 500 });
  }
}