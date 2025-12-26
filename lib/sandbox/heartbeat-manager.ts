/**
 * 沙箱心跳管理器
 *
 * 功能：
 * 1. 记录沙箱的最后活跃时间
 * 2. 定期检查超时的沙箱
 * 3. 自动清理长时间无活动的沙箱
 *
 * 使用场景：
 * - 覆盖浏览器崩溃导致的沙箱泄漏
 * - 覆盖网络中断导致的清理失败
 * - 自动清理"僵尸"沙箱
 */

import { sandboxManager } from './sandbox-manager';

interface HeartbeatInfo {
  sandboxId: string;
  lastHeartbeat: Date;
  createdAt: Date;
}

class HeartbeatManager {
  private heartbeats: Map<string, HeartbeatInfo> = new Map();
  private checkInterval: NodeJS.Timeout | null = null;

  // 心跳超时时间（30分钟无心跳视为超时）
  private readonly HEARTBEAT_TIMEOUT = 30 * 60 * 1000;

  // 检查间隔（每分钟检查一次）
  private readonly CHECK_INTERVAL = 60 * 1000;

  /**
   * 是否允许后端自动清理沙箱（默认关闭）
   *
   * 说明：
   * - 生产环境中，“自动清理”会导致用户未确认就被销毁，进而出现预览 `Sandbox Not Found`
   * - 只有在明确需要兜底清理“僵尸沙箱”时才开启（例如自建部署希望强制控费）
   *
   * 启用方式：
   * - 设置环境变量 `OPEN_LOVABLE_SANDBOX_AUTOCLEANUP=1`
   */
  private readonly AUTO_CLEANUP_ENABLED =
    process.env.OPEN_LOVABLE_SANDBOX_AUTOCLEANUP === '1';

  /**
   * 启动心跳检查器
   */
  start(): void {
    if (this.checkInterval) {
      console.log('[HeartbeatManager] Already running');
      return;
    }

    console.log('[HeartbeatManager] Starting heartbeat checker...');

    // 立即执行一次检查
    this.checkTimeouts();

    // 定期检查
    this.checkInterval = setInterval(() => {
      this.checkTimeouts();
    }, this.CHECK_INTERVAL);

    console.log(`[HeartbeatManager] Heartbeat checker started (interval: ${this.CHECK_INTERVAL}ms, timeout: ${this.HEARTBEAT_TIMEOUT}ms)`);
  }

  /**
   * 停止心跳检查器
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[HeartbeatManager] Heartbeat checker stopped');
    }
  }

  /**
   * 记录心跳
   */
  recordHeartbeat(sandboxId: string): void {
    const now = new Date();

    if (!this.heartbeats.has(sandboxId)) {
      // 新沙箱，记录创建时间
      this.heartbeats.set(sandboxId, {
        sandboxId,
        lastHeartbeat: now,
        createdAt: now
      });
      console.log(`[HeartbeatManager] ✅ New sandbox registered: ${sandboxId}`);
    } else {
      // 更新最后心跳时间
      const info = this.heartbeats.get(sandboxId)!;
      info.lastHeartbeat = now;
      console.log(`[HeartbeatManager] 💓 Heartbeat received: ${sandboxId}`);
    }
  }

  /**
   * 移除沙箱记录
   */
  removeSandbox(sandboxId: string): void {
    if (this.heartbeats.has(sandboxId)) {
      this.heartbeats.delete(sandboxId);
      console.log(`[HeartbeatManager] ❌ Sandbox removed: ${sandboxId}`);
    }
  }

  /**
   * 获取沙箱心跳信息
   */
  getHeartbeatInfo(sandboxId: string): HeartbeatInfo | undefined {
    return this.heartbeats.get(sandboxId);
  }

  /**
   * 获取所有心跳信息
   */
  getAllHeartbeats(): HeartbeatInfo[] {
    return Array.from(this.heartbeats.values());
  }

  /**
   * 检查超时的沙箱
   */
  private async checkTimeouts(): Promise<void> {
    const now = new Date();
    const timeoutSandboxes: string[] = [];

    // 找出所有超时的沙箱
    for (const [sandboxId, info] of this.heartbeats.entries()) {
      const timeSinceLastHeartbeat = now.getTime() - info.lastHeartbeat.getTime();

      if (timeSinceLastHeartbeat > this.HEARTBEAT_TIMEOUT) {
        timeoutSandboxes.push(sandboxId);
        console.log(`[HeartbeatManager] ⏰ Sandbox timeout detected: ${sandboxId} (${Math.round(timeSinceLastHeartbeat / 1000)}s since last heartbeat)`);
      }
    }

    // 默认不自动清理：避免用户未确认就销毁沙箱
    if (!this.AUTO_CLEANUP_ENABLED) {
      if (timeoutSandboxes.length > 0) {
        console.log(
          `[HeartbeatManager] ⚠️ 检测到 ${timeoutSandboxes.length} 个超时沙箱，但自动清理已关闭（如需开启请设置 OPEN_LOVABLE_SANDBOX_AUTOCLEANUP=1）。`
        );
      }
      return;
    }

    // 开启自动清理时：清理超时的沙箱
    for (const sandboxId of timeoutSandboxes) {
      try {
        console.log(`[HeartbeatManager] 🧹 Cleaning up timeout sandbox: ${sandboxId}`);
        await sandboxManager.terminateSandbox(sandboxId);
        this.heartbeats.delete(sandboxId);
        console.log(`[HeartbeatManager] ✅ Timeout sandbox cleaned up: ${sandboxId}`);
      } catch (error) {
        console.error(`[HeartbeatManager] ❌ Failed to cleanup timeout sandbox ${sandboxId}:`, error);
      }
    }

    // 统计信息
    const activeSandboxes = this.heartbeats.size;
    const cleanedUp = timeoutSandboxes.length;

    if (cleanedUp > 0 || activeSandboxes > 0) {
      console.log(`[HeartbeatManager] 📊 Status: ${activeSandboxes} active, ${cleanedUp} cleaned up`);
    }
  }

  /**
   * 获取统计信息
   */
  getStats(): {
    totalSandboxes: number;
    activeSandboxes: number;
    oldestSandbox: { sandboxId: string; age: number } | null;
  } {
    const now = new Date();
    let oldestSandbox: { sandboxId: string; age: number } | null = null;

    for (const [sandboxId, info] of this.heartbeats.entries()) {
      const age = now.getTime() - info.createdAt.getTime();

      if (!oldestSandbox || age > oldestSandbox.age) {
        oldestSandbox = { sandboxId, age };
      }
    }

    return {
      totalSandboxes: this.heartbeats.size,
      activeSandboxes: this.heartbeats.size,
      oldestSandbox
    };
  }
}

// 单例
export const heartbeatManager = new HeartbeatManager();

// 在模块加载时启动心跳检查器（仅在 Node.js 环境）
if (typeof window === 'undefined') {
  heartbeatManager.start();
}
