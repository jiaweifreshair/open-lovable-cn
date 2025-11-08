# E2B Webhook 生产环境配置指南

## 🌐 生产环境信息

- **域名**：https://open-lovable-cn.com
- **Webhook URL**：https://open-lovable-cn.com/postreceive
- **签名秘钥**：`Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS`

---

## 📋 快速配置步骤

### Step 1: 登录 E2B Dashboard

访问：https://e2b.dev

使用您的账户登录。

---

### Step 2: 进入 Webhooks 设置

1. 点击左侧菜单的 **Settings**
2. 选择 **Webhooks** 标签
3. 或直接访问：https://e2b.dev/dashboard/webhooks

---

### Step 3: 创建新 Webhook

点击 **"Add Webhook"** 或 **"Create Webhook"** 按钮。

---

### Step 4: 填写 Webhook 配置

请按照以下信息填写：

| 配置项 | 值 | 说明 |
|--------|---|------|
| **Webhook URL** | `https://open-lovable-cn.com/postreceive` | ⚠️ 必须使用 HTTPS |
| **Events** | ☑️ **All Sandbox Lifecycle Events** | 或选择以下所有事件： |
|  | ☑️ `sandbox.create` | 沙箱创建时 |
|  | ☑️ `sandbox.kill` | 沙箱终止时（重要） |
|  | ☑️ `sandbox.pause` | 沙箱暂停时 |
|  | ☑️ `sandbox.resume` | 沙箱恢复时 |
|  | ☑️ `sandbox.update` | 沙箱更新时 |
| **Signing Secret** | `Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS` | 用于验证请求真实性 |
| **Description** | `Open Lovable 生产环境` | 可选，便于识别 |
| **Active** | ☑️ **Enabled** | 确保勾选 |

**重要提醒**：
- ⚠️ URL 必须使用 **HTTPS**（不能使用 HTTP）
- ⚠️ Signing Secret 必须与环境变量中的 `E2B_WEBHOOK_SECRET` 完全一致

---

### Step 5: 保存并激活

1. 点击 **"Create"** 或 **"Save"** 按钮
2. 确认 webhook 状态显示为 **"Active"** 或 **"Enabled"**

---

### Step 6: 测试 Webhook

在 E2B Dashboard 的 Webhooks 页面：

1. 找到刚创建的 webhook
2. 点击右侧的 **"Send Test Event"** 或 **"Test"** 按钮
3. 选择事件类型（如 `sandbox.kill`）
4. 点击 **"Send"**

**预期结果**：
- ✅ 状态显示：**200 OK**
- ✅ 响应内容：
  ```json
  {
    "success": true,
    "message": "Event kill processed successfully",
    "sandboxId": "test-xxx",
    "timestamp": "2025-11-08T..."
  }
  ```

**如果测试失败**：
- ❌ 401 Unauthorized → 检查签名秘钥是否正确
- ❌ 404 Not Found → 检查 URL 是否正确
- ❌ 500 Internal Server Error → 查看服务器日志

---

## ✅ 环境变量确认

确保生产环境的 `.env.docker` 文件包含：

```bash
# E2B Webhook签名秘钥
E2B_WEBHOOK_SECRET=Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
```

**验证方式**：
```bash
# SSH 到生产服务器
ssh your-server

# 检查环境变量
docker compose exec app printenv | grep E2B_WEBHOOK_SECRET

# 预期输出：
# E2B_WEBHOOK_SECRET=Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
```

---

## 📊 监控 Webhook

### 查看实时日志

```bash
# 在生产服务器上
docker compose logs -f app | grep "\[e2b-webhook\]"
```

**成功日志示例**：
```
[e2b-webhook] ✅ Signature verified successfully
[e2b-webhook] Received kill event for sandbox ib7ytj0t12tujbnxkwva0
[e2b-webhook] ✅ Removed sandbox ib7ytj0t12tujbnxkwva0 from manager
```

**失败日志示例**：
```
[e2b-webhook] ❌ Invalid signature
[e2b-webhook] ❌ E2B_WEBHOOK_SECRET not configured
```

---

### E2B Dashboard 监控

在 E2B Dashboard 的 Webhooks 页面可以看到：

| 指标 | 说明 |
|------|------|
| **Delivery History** | 最近的 webhook 投递记录 |
| **Success Rate** | 投递成功率（目标：>99%） |
| **Response Times** | 平均响应时间（目标：<2秒） |
| **Failed Deliveries** | 失败的投递和错误原因 |

---

## 🔍 验证配置

### 手动测试（使用 curl）

在本地运行以下命令测试生产环境 webhook：

```bash
# 生成测试 payload
PAYLOAD='{"eventCategory":"lifecycle","eventLabel":"kill","sandboxId":"test-production-123","sandboxTeamId":"team-abc","timestamp":"'$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")'"}'

# 生成签名
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS" | cut -d' ' -f2)

# 发送测试请求
curl -X POST https://open-lovable-cn.com/postreceive \
  -H "Content-Type: application/json" \
  -H "X-E2B-Signature: $SIGNATURE" \
  -d "$PAYLOAD" | jq .
```

**预期响应**：
```json
{
  "success": true,
  "message": "Event kill processed successfully",
  "sandboxId": "test-production-123",
  "timestamp": "2025-11-08T..."
}
```

---

## 🚨 故障排查

### 问题 1: Webhook 没有收到请求

**可能原因**：
1. Webhook 状态未激活
2. URL 配置错误
3. 防火墙或 CDN 阻止了请求

**解决方案**：
1. 检查 E2B Dashboard 中 webhook 状态是否为 "Active"
2. 确认 URL 为 `https://open-lovable-cn.com/postreceive`
3. 检查 CDN（如 Cloudflare）安全设置

---

### 问题 2: 签名验证失败 (401)

**可能原因**：
1. `E2B_WEBHOOK_SECRET` 配置错误
2. 环境变量未生效
3. 签名算法不匹配

**解决方案**：
```bash
# 1. 确认环境变量
docker compose exec app printenv | grep E2B_WEBHOOK_SECRET

# 2. 如果未配置，添加到 .env.docker
echo "E2B_WEBHOOK_SECRET=Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS" >> .env.docker

# 3. 重启容器
docker compose down
docker compose up -d
```

---

### 问题 3: 响应超时

**可能原因**：
1. 处理逻辑耗时过长
2. 数据库/Redis 连接慢
3. 网络延迟

**解决方案**：
- 优化处理逻辑，避免阻塞操作
- 异步处理耗时任务
- 确保响应时间 < 5秒

---

## 📈 成本节省效果

配置 Webhook 后，预期效果：

| 场景 | 之前 | 之后 | 节省 |
|------|------|------|------|
| **沙箱超时自动终止** | 手动检查 | 自动接收通知 | **100%** |
| **状态同步延迟** | 轮询 API (5分钟) | 实时通知 (<1秒) | **99.7%** |
| **僵尸沙箱检测** | 人工排查 | 自动清理 | **100%** |

**总体节省**：
- 减少 API 调用次数：>90%
- 降低沙箱运行成本：>90%
- 提高状态同步及时性：>99%

---

## ✅ 配置完成检查清单

部署前确认：

- [ ] E2B Dashboard 中 webhook 已创建
- [ ] Webhook URL 设置为 `https://open-lovable-cn.com/postreceive`
- [ ] 签名秘钥设置为 `Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS`
- [ ] Webhook 状态为 **Active**
- [ ] 环境变量 `E2B_WEBHOOK_SECRET` 已配置
- [ ] Docker 容器已重启并加载新环境变量
- [ ] 发送测试事件返回 **200 OK**
- [ ] 日志中显示 "✅ Signature verified successfully"
- [ ] 手动 curl 测试通过

---

## 📞 技术支持

如遇到问题，请检查：

1. **日志**：`docker compose logs -f app | grep e2b-webhook`
2. **环境变量**：`docker compose exec app printenv | grep E2B`
3. **E2B Dashboard**：https://e2b.dev/dashboard/webhooks
4. **测试脚本**：`pnpm tsx test-e2b-webhook.ts`

---

## 📚 相关文档

- [E2B Webhook 官方文档](https://e2b.dev/docs/sandbox/lifecycle-events-webhooks)
- [沙箱成本控制文档](./SANDBOX_COST_CONTROL.md)
- [Docker 部署指南](./DOCKER_DEPLOYMENT.md)

---

**配置完成后，您的系统将自动接收 E2B 沙箱生命周期事件，实现实时状态同步和自动成本控制！**

**预估节省**：**>90%** E2B API 调用 + **>90%** 沙箱运行成本

---

**文档版本**：v1.0
**最后更新**：2025-11-08
**域名**：open-lovable-cn.com
**Webhook URL**：https://open-lovable-cn.com/postreceive
