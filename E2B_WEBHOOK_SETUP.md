# E2B Webhook 配置指南

## 📋 概述

E2B Webhook 允许您的应用接收沙箱生命周期事件的实时通知，无需轮询 API。每当沙箱创建、终止、暂停或恢复时，E2B 会自动向您配置的 webhook URL 发送 POST 请求。

### 主要优势
- ✅ **实时通知**：立即接收沙箱状态变化
- ✅ **降低成本**：避免频繁轮询 API
- ✅ **自动清理**：沙箱终止时自动从管理器中移除
- ✅ **安全验证**：HMAC-SHA256 签名确保请求真实性

---

## 🔧 配置步骤

### Step 1: 部署应用到公网

Webhook 需要公开可访问的 HTTPS URL。

**本地开发**（使用 ngrok）:
```bash
# 安装 ngrok
brew install ngrok

# 启动 ngrok 隧道
ngrok http 3000

# 示例输出：
# Forwarding  https://abc123.ngrok.io -> http://localhost:3000
```

**生产环境**：
- 部署到 Vercel/Netlify/Railway 等平台
- 确保使用 HTTPS（E2B 要求）
- Webhook URL 示例：`https://your-domain.com/api/webhooks/e2b`

---

### Step 2: 在 E2B Dashboard 中配置 Webhook

1. **登录 E2B Dashboard**
   - 访问：https://e2b.dev
   - 登录您的账户

2. **进入 Webhooks 设置**
   - 导航到：**Settings** > **Webhooks**
   - 或直接访问：https://e2b.dev/dashboard/webhooks

3. **创建新 Webhook**
   - 点击 **"Add Webhook"** 按钮
   - 填写以下信息：

| 字段 | 值 | 说明 |
|------|---|------|
| **Webhook URL** | `https://your-domain.com/api/webhooks/e2b` | 您的 webhook 接收端点（必须是 HTTPS） |
| **Events** | ☑️ All Sandbox Lifecycle Events | 或选择特定事件：create, kill, pause, resume, update |
| **Secret** | `Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS` | 用于签名验证的秘钥（复制此值到 `.env.docker`） |
| **Description** | `Open Lovable Production Webhook` | 可选，方便识别 |

4. **保存并激活**
   - 点击 **"Create"** 保存 webhook
   - 确保 webhook 状态为 **"Active"**

---

### Step 3: 配置环境变量

将 webhook 签名秘钥添加到环境变量：

**.env.docker** (生产环境):
```bash
# E2B Webhook签名秘钥（从 E2B Dashboard 获取）
E2B_WEBHOOK_SECRET=Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
```

**.env.local** (本地开发):
```bash
# E2B Webhook签名秘钥（与生产环境相同）
E2B_WEBHOOK_SECRET=Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
```

**重要**：
- ⚠️ 不要将秘钥硬编码到代码中
- ⚠️ 确保 `.env.docker` 和 `.env.local` 在 `.gitignore` 中
- ⚠️ 生产和开发环境使用相同的秘钥

---

### Step 4: 重启应用

确保应用加载新的环境变量：

**Docker 部署**:
```bash
docker compose down
docker compose up -d
```

**本地开发**:
```bash
# 停止开发服务器 (Ctrl+C)
pnpm dev
```

---

## 📡 Webhook 事件详解

### 支持的事件类型

| 事件 | 触发时机 | 处理逻辑 |
|------|---------|---------|
| **create** | 沙箱创建成功 | 记录创建时间（可选） |
| **kill** | 沙箱被终止 | 从 `sandboxManager` 中移除 |
| **pause** | 沙箱暂停（计费暂停） | 记录暂停状态 |
| **resume** | 沙箱恢复运行 | 记录恢复时间 |
| **update** | 沙箱配置更新 | 同步配置变更 |

### Webhook Payload 格式

E2B 发送的 webhook 请求格式：

```json
{
  "eventCategory": "lifecycle",
  "eventLabel": "kill",
  "sandboxId": "ib7ytj0t12tujbnxkwva0",
  "sandboxTeamId": "team_abc123xyz",
  "sandboxTemplateId": "vite-react-ts",
  "timestamp": "2025-11-08T12:34:56.789Z",
  "eventData": {
    "reason": "timeout",
    "duration": 1800
  }
}
```

### HTTP Headers

E2B 发送的请求包含以下 headers：

```
POST /api/webhooks/e2b HTTP/1.1
Host: your-domain.com
Content-Type: application/json
X-E2B-Signature: a1b2c3d4e5f6...
User-Agent: E2B-Webhook/1.0
Content-Length: 245
```

**签名验证**：
- Header: `X-E2B-Signature` 或 `X-Webhook-Signature`
- 算法: HMAC-SHA256
- 输入: 原始请求体 + webhook secret
- 输出: Hex 编码的签名

---

## 🔒 安全最佳实践

### 1. 签名验证（强制）

**我们的实现**（`app/api/webhooks/e2b/route.ts`）：
```typescript
function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const hmac = createHmac('sha256', secret);
  hmac.update(payload);
  const expectedSignature = hmac.digest('hex');

  // 使用 timingSafeEqual 防止时序攻击
  return timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}
```

**为什么重要**：
- 防止恶意请求伪造沙箱事件
- 防止中间人攻击
- 确保事件来自 E2B 官方服务器

### 2. HTTPS 强制

E2B 只发送 webhook 到 HTTPS URL：
- ✅ `https://your-domain.com/api/webhooks/e2b`
- ❌ `http://your-domain.com/api/webhooks/e2b`

### 3. IP 白名单（可选）

E2B webhook 请求来自固定 IP 段，可配置防火墙规则：
```nginx
# Nginx 示例
location /api/webhooks/e2b {
  allow 35.185.44.232/32;  # E2B IP (示例)
  deny all;
  proxy_pass http://localhost:3000;
}
```

### 4. 速率限制

防止 webhook 滥用：
```typescript
// 使用 Redis 实现速率限制（示例）
const key = `webhook:ratelimit:${sandboxTeamId}`;
const count = await redis.incr(key);
if (count === 1) {
  await redis.expire(key, 60); // 60秒窗口
}
if (count > 100) {
  return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
}
```

---

## 🧪 测试 Webhook

### 本地测试

使用提供的测试脚本：

```bash
# 运行完整测试套件
pnpm tsx test-e2b-webhook.ts
```

**测试覆盖**：
- ✅ 沙箱创建事件
- ✅ 沙箱终止事件
- ✅ 无效签名拒绝
- ✅ 格式错误 payload 拒绝
- ✅ 所有生命周期事件

**预期输出**：
```
🧪 测试 1: 沙箱创建事件 (create)
✅ 测试通过：沙箱创建事件处理成功

🧪 测试 2: 沙箱终止事件 (kill)
✅ 测试通过：沙箱终止事件处理成功

🧪 测试 3: 无效签名（安全验证）
✅ 测试通过：正确拒绝无效签名

🧪 测试 4: 格式错误的 Payload
✅ 测试通过：正确拒绝无效 JSON

🧪 测试 5: 所有生命周期事件
✅ 所有生命周期事件测试完成
```

### E2B Dashboard 测试

在 E2B Dashboard 的 Webhooks 页面：

1. 点击 webhook 右侧的 **"Send Test Event"**
2. 选择事件类型（如 `sandbox.kill`）
3. 点击 **"Send"**
4. 查看响应状态和日志

**成功响应示例**：
```json
HTTP 200 OK
{
  "success": true,
  "message": "Event kill processed successfully",
  "sandboxId": "test-sandbox-12345",
  "timestamp": "2025-11-08T12:34:56.789Z"
}
```

---

## 📊 监控和调试

### 查看 Webhook 日志

**Docker 环境**：
```bash
# 实时查看日志
docker compose logs -f app | grep webhook

# 搜索 webhook 相关日志
docker compose logs app | grep "\[e2b-webhook\]"
```

**日志示例**：
```
[e2b-webhook] Received kill event for sandbox ib7ytj0t12tujbnxkwva0
[e2b-webhook] Signature verified successfully
[e2b-webhook] Removed sandbox ib7ytj0t12tujbnxkwva0 from manager
```

### E2B Dashboard 监控

在 E2B Dashboard 的 Webhooks 页面查看：

- **Delivery History**：最近的 webhook 投递记录
- **Success Rate**：投递成功率统计
- **Response Times**：响应时间分布
- **Failed Deliveries**：失败的投递和原因

### 常见错误和解决方案

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| **401 Unauthorized** | 签名验证失败 | 检查 `E2B_WEBHOOK_SECRET` 配置是否正确 |
| **400 Bad Request** | Payload 格式错误 | 检查 E2B Dashboard 配置的事件类型 |
| **500 Internal Server Error** | 处理逻辑异常 | 查看应用日志 `docker compose logs` |
| **Timeout** | 响应时间 > 30秒 | 优化 webhook 处理逻辑，避免阻塞操作 |

---

## 🚀 高级配置

### 异步处理

对于耗时操作，使用消息队列异步处理：

```typescript
export async function POST(request: NextRequest) {
  // 验证签名
  const isValid = verifyWebhookSignature(/*...*/);
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  // 立即返回 200
  const event = await request.json();

  // 异步处理（使用 Redis 队列、Bull、BullMQ 等）
  await queue.add('sandbox-event', event);

  return NextResponse.json({ success: true });
}
```

### 重试机制

E2B 会自动重试失败的 webhook 投递：

- **重试次数**：最多 3 次
- **退避策略**：指数退避（1min, 10min, 1hour）
- **超时时间**：30 秒

**建议**：
- 快速响应（< 5秒）
- 幂等性处理（同一事件可能被发送多次）

### 批量事件处理

处理大量并发事件：

```typescript
// 使用 Promise.all 批量处理
const events = [event1, event2, event3];
await Promise.all(
  events.map(event => handleSandboxEvent(event))
);
```

---

## 📚 参考资源

- [E2B Webhook 官方文档](https://e2b.dev/docs/sandbox/lifecycle-events-webhooks)
- [E2B Lifecycle Events API](https://e2b.dev/docs/sandbox/lifecycle-events-api)
- [HMAC-SHA256 签名算法](https://en.wikipedia.org/wiki/HMAC)

---

## ✅ 配置检查清单

部署前确认：

- [ ] E2B Dashboard 中 webhook 已创建并激活
- [ ] Webhook URL 使用 HTTPS（生产环境）
- [ ] `E2B_WEBHOOK_SECRET` 已配置到环境变量
- [ ] 环境变量已重新加载（重启应用）
- [ ] 本地测试脚本全部通过 (`pnpm tsx test-e2b-webhook.ts`)
- [ ] E2B Dashboard 测试事件发送成功
- [ ] 日志中显示事件处理成功
- [ ] 签名验证正常工作
- [ ] 沙箱终止后自动从管理器中移除

---

## 💡 故障排除

### Webhook 没有收到请求

1. **检查 URL 可访问性**：
   ```bash
   curl -I https://your-domain.com/api/webhooks/e2b
   # 应该返回 405 Method Not Allowed (因为 GET 不支持)
   ```

2. **检查 E2B Dashboard 状态**：
   - Webhook 是否 **Active**？
   - 投递历史是否有记录？
   - 是否有错误信息？

3. **检查防火墙和 CDN**：
   - Cloudflare 是否阻止了 webhook IP？
   - WAF 规则是否过于严格？

### 签名验证失败

1. **检查秘钥是否正确**：
   ```bash
   docker compose exec app printenv | grep E2B_WEBHOOK_SECRET
   # 应该输出: E2B_WEBHOOK_SECRET=Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
   ```

2. **检查签名计算逻辑**：
   ```typescript
   // 确保使用原始请求体（未解析的 string）
   const rawBody = await request.text();
   const signature = request.headers.get('x-e2b-signature');
   const isValid = verifyWebhookSignature(rawBody, signature, secret);
   ```

3. **检查 header 名称**：
   - E2B 可能使用 `X-E2B-Signature` 或 `X-Webhook-Signature`
   - 我们的实现支持两种 header

---

**文档版本**：v1.0
**最后更新**：2025-11-08
**维护者**：Open Lovable 开发团队
