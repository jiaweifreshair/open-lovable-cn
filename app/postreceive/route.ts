import { NextRequest, NextResponse } from 'next/server';
import { createHmac, timingSafeEqual } from 'crypto';
import { sandboxManager } from '@/lib/sandbox/sandbox-manager';

/**
 * E2B Webhook 接收端点
 *
 * 生产环境 URL: https://open-lovable-cn.com/postreceive
 *
 * 此端点接收 E2B 发送的沙箱生命周期事件通知，实现以下功能：
 * 1. 签名验证确保请求来自 E2B 官方
 * 2. 处理沙箱创建、终止、暂停、恢复、更新事件
 * 3. 自动清理已终止的沙箱，避免费用浪费
 */

/**
 * E2B Webhook 事件类型
 */
interface E2BSandboxEvent {
  eventCategory: 'lifecycle';
  eventLabel: 'create' | 'kill' | 'pause' | 'resume' | 'update';
  sandboxId: string;
  sandboxTeamId: string;
  sandboxTemplateId?: string;
  timestamp: string;
  eventData?: Record<string, any>;
}

/**
 * 验证 E2B Webhook 签名
 *
 * E2B 使用 HMAC-SHA256 签名验证 webhook 请求的真实性
 * 签名算法：HMAC-SHA256(webhook_secret, request_body)
 *
 * @param payload 原始请求体
 * @param signature 从 header 中获取的签名
 * @param secret webhook 签名秘钥
 * @returns 签名是否有效
 */
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  try {
    // 计算预期签名
    const hmac = createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');

    // 使用 timingSafeEqual 防止时序攻击
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return timingSafeEqual(signatureBuffer, expectedBuffer);
  } catch (error) {
    console.error('[e2b-webhook] Signature verification error:', error);
    return false;
  }
}

/**
 * 处理沙箱生命周期事件
 */
async function handleSandboxEvent(event: E2BSandboxEvent): Promise<void> {
  const { eventLabel, sandboxId, timestamp } = event;

  console.log(`[e2b-webhook] Received ${eventLabel} event for sandbox ${sandboxId} at ${timestamp}`);

  switch (eventLabel) {
    case 'create':
      console.log(`[e2b-webhook] Sandbox created: ${sandboxId}`);
      // 沙箱已创建 - 记录创建时间（可选）
      break;

    case 'kill':
      console.log(`[e2b-webhook] Sandbox killed: ${sandboxId}`);
      // 沙箱已终止 - 从管理器中移除
      try {
        await sandboxManager.terminateSandbox(sandboxId);
        console.log(`[e2b-webhook] ✅ Removed sandbox ${sandboxId} from manager`);
      } catch (error) {
        console.error(`[e2b-webhook] ❌ Failed to remove sandbox ${sandboxId}:`, error);
      }
      break;

    case 'pause':
      console.log(`[e2b-webhook] Sandbox paused: ${sandboxId} (billing paused)`);
      // 沙箱已暂停（计费暂停）
      break;

    case 'resume':
      console.log(`[e2b-webhook] Sandbox resumed: ${sandboxId} (billing resumed)`);
      // 沙箱已恢复（计费恢复）
      break;

    case 'update':
      console.log(`[e2b-webhook] Sandbox updated: ${sandboxId}`);
      // 沙箱配置已更新
      break;

    default:
      console.warn(`[e2b-webhook] Unknown event type: ${eventLabel}`);
  }
}

/**
 * POST /postreceive
 *
 * E2B Webhook 接收端点
 *
 * 配置方式：
 * 1. 登录 E2B Dashboard (https://e2b.dev)
 * 2. 进入 Settings > Webhooks
 * 3. 添加 Webhook URL: https://open-lovable-cn.com/postreceive
 * 4. 选择事件类型：All Sandbox Lifecycle Events
 * 5. 使用签名秘钥：Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
 * 6. 激活 Webhook
 */
export async function POST(request: NextRequest) {
  try {
    // 1. 获取原始请求体（用于签名验证）
    const rawBody = await request.text();

    // 2. 获取签名 (支持两种 header 名称)
    const signature = request.headers.get('x-e2b-signature') ||
                      request.headers.get('x-webhook-signature') ||
                      '';

    // 3. 验证签名
    const webhookSecret = process.env.E2B_WEBHOOK_SECRET;
    if (!webhookSecret) {
      console.error('[e2b-webhook] ❌ E2B_WEBHOOK_SECRET not configured');
      return NextResponse.json(
        { error: 'Webhook secret not configured' },
        { status: 500 }
      );
    }

    const isValidSignature = verifyWebhookSignature(rawBody, signature, webhookSecret);
    if (!isValidSignature) {
      console.error('[e2b-webhook] ❌ Invalid signature');
      return NextResponse.json(
        { error: 'Invalid signature' },
        { status: 401 }
      );
    }

    console.log('[e2b-webhook] ✅ Signature verified successfully');

    // 4. 解析事件数据
    let event: E2BSandboxEvent;
    try {
      event = JSON.parse(rawBody) as E2BSandboxEvent;
    } catch (error) {
      console.error('[e2b-webhook] ❌ Failed to parse event:', error);
      return NextResponse.json(
        { error: 'Invalid JSON payload' },
        { status: 400 }
      );
    }

    // 5. 验证事件格式
    if (event.eventCategory !== 'lifecycle') {
      console.warn('[e2b-webhook] ⚠️  Unsupported event category:', event.eventCategory);
      return NextResponse.json(
        { error: 'Unsupported event category' },
        { status: 400 }
      );
    }

    if (!event.sandboxId) {
      console.error('[e2b-webhook] ❌ Missing sandboxId in event');
      return NextResponse.json(
        { error: 'Missing sandboxId' },
        { status: 400 }
      );
    }

    // 6. 处理事件
    await handleSandboxEvent(event);

    // 7. 返回成功响应
    return NextResponse.json({
      success: true,
      message: `Event ${event.eventLabel} processed successfully`,
      sandboxId: event.sandboxId,
      timestamp: event.timestamp
    });

  } catch (error) {
    console.error('[e2b-webhook] ❌ Error processing webhook:', error);
    return NextResponse.json(
      {
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
