/**
 * 沙箱心跳 API
 *
 * 功能：接收前端发送的心跳信号，更新沙箱最后活跃时间
 *
 * 使用场景：
 * - 前端每60秒发送一次心跳
 * - 后端记录最后心跳时间
 * - 超过5分钟无心跳则自动清理沙箱
 */

import { NextRequest, NextResponse } from 'next/server';
import { heartbeatManager } from '@/lib/sandbox/heartbeat-manager';

/**
 * POST /api/sandbox-heartbeat
 * 接收沙箱心跳信号
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 解析请求体
    const body = await request.json();
    const { sandboxId } = body;

    // 2. 验证参数
    if (!sandboxId || typeof sandboxId !== 'string') {
      console.error('[sandbox-heartbeat] Invalid sandboxId:', sandboxId);
      return NextResponse.json(
        {
          success: false,
          error: 'Missing or invalid sandboxId'
        },
        { status: 400 }
      );
    }

    // 3. 记录心跳
    heartbeatManager.recordHeartbeat(sandboxId);

    // 4. 返回成功响应
    return NextResponse.json({
      success: true,
      sandboxId,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('[sandbox-heartbeat] Error processing heartbeat:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/sandbox-heartbeat
 * 获取心跳统计信息（用于调试和监控）
 */
export async function GET() {
  try {
    const stats = heartbeatManager.getStats();
    const allHeartbeats = heartbeatManager.getAllHeartbeats();

    return NextResponse.json({
      success: true,
      stats,
      heartbeats: allHeartbeats.map(h => ({
        sandboxId: h.sandboxId,
        lastHeartbeat: h.lastHeartbeat.toISOString(),
        createdAt: h.createdAt.toISOString(),
        age: Date.now() - h.createdAt.getTime(),
        timeSinceLastHeartbeat: Date.now() - h.lastHeartbeat.getTime()
      }))
    });

  } catch (error) {
    console.error('[sandbox-heartbeat] Error getting stats:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error'
      },
      { status: 500 }
    );
  }
}
