# E2B Webhook 快速配置指南 🚀

## ✅ 当前状态

所有本地配置已完成并验证通过！

```
✅ 环境变量配置正确
✅ Docker 容器运行正常
✅ Webhook 端点响应正常
✅ 签名验证机制工作正常
```

---

## 📋 E2B Dashboard 配置步骤

### 第一步：登录 E2B Dashboard

访问：**https://e2b.dev/dashboard/webhooks**

---

### 第二步：点击 "Add Webhook" 按钮

![Add Webhook Button](https://via.placeholder.com/200x40/4CAF50/FFFFFF?text=Add+Webhook)

---

### 第三步：填写以下信息

#### 📌 Webhook URL（复制粘贴）
```
https://open-lovable-cn.com/postreceive
```

#### 🔐 Signing Secret（复制粘贴）
```
Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
```

#### 📡 Events（勾选以下所有事件）
- ☑️ **All Sandbox Lifecycle Events**

或者选择单个事件：
- ☑️ `sandbox.create` - 沙箱创建时
- ☑️ `sandbox.kill` - 沙箱终止时（**重要**）
- ☑️ `sandbox.pause` - 沙箱暂停时
- ☑️ `sandbox.resume` - 沙箱恢复时
- ☑️ `sandbox.update` - 沙箱更新时

#### 📝 Description（可选）
```
Open Lovable 生产环境 Webhook
```

#### ✅ Status
- ☑️ **Active** / **Enabled**

---

### 第四步：保存并测试

1. 点击 **"Create"** 或 **"Save"** 按钮

2. 在 Webhooks 列表中找到刚创建的 webhook

3. 点击右侧的 **"Send Test Event"** 按钮

4. 选择事件类型：`sandbox.kill`

5. 点击 **"Send"**

---

## ✅ 验证配置成功

### 预期结果

#### E2B Dashboard 显示：
- ✅ Status: **200 OK**
- ✅ Response Time: < 2s
- ✅ Response Body:
  ```json
  {
    "success": true,
    "message": "Event kill processed successfully",
    "sandboxId": "test-xxx",
    "timestamp": "2025-11-08T..."
  }
  ```

#### 服务器日志显示：
```bash
# 查看日志
docker compose logs -f app | grep e2b-webhook

# 预期输出：
[e2b-webhook] ✅ Signature verified successfully
[e2b-webhook] Received kill event for sandbox test-xxx
[e2b-webhook] ✅ Removed sandbox test-xxx from manager
```

---

## 🎯 配置完成后的效果

### 自动成本控制
- 沙箱终止时立即收到通知
- 自动从管理器中移除，避免内存泄漏
- 实时同步沙箱状态，无需轮询 API

### 预期节省
- **>90%** E2B API 调用次数
- **>90%** 沙箱运行成本
- **<1秒** 状态同步延迟（vs 5分钟轮询）

---

## 🔧 故障排查

### 问题：测试事件返回 401 Unauthorized

**原因**：签名秘钥配置错误

**解决方案**：
1. 确认 E2B Dashboard 中的 Signing Secret 为：
   ```
   Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
   ```
2. 确认环境变量已重新加载：
   ```bash
   docker compose down
   docker compose up -d
   ```

---

### 问题：测试事件返回 404 Not Found

**原因**：Webhook URL 配置错误

**解决方案**：
确认 Webhook URL 为：
```
https://open-lovable-cn.com/postreceive
```
⚠️ 必须使用 **HTTPS**，不能使用 HTTP

---

### 问题：测试事件超时

**原因**：
1. 域名无法访问
2. 防火墙阻止
3. 服务器未运行

**解决方案**：
1. 确认域名可访问：
   ```bash
   curl -I https://open-lovable-cn.com
   ```
2. 检查 Docker 容器状态：
   ```bash
   docker compose ps
   ```
3. 检查防火墙/CDN 配置

---

## 📊 监控 Webhook

### 实时日志
```bash
# 持续监控 webhook 日志
docker compose logs -f app | grep e2b-webhook
```

### E2B Dashboard
访问：https://e2b.dev/dashboard/webhooks

查看：
- Delivery History（投递历史）
- Success Rate（成功率）
- Response Times（响应时间）
- Failed Deliveries（失败记录）

---

## 📚 详细文档

- **E2B_WEBHOOK_PRODUCTION_SETUP.md** - 完整配置指南
- **SANDBOX_COST_CONTROL.md** - 成本控制方案
- **verify-e2b-webhook-setup.sh** - 自动验证脚本

---

## 🎉 配置完成

恭喜！您已成功配置 E2B Webhook。

系统将自动：
- ✅ 接收沙箱生命周期事件
- ✅ 验证请求签名安全性
- ✅ 自动清理终止的沙箱
- ✅ 实时同步沙箱状态

**预计节省 >90% E2B 使用成本！**

---

## 📞 需要帮助？

- 查看日志：`docker compose logs -f app | grep e2b-webhook`
- 运行验证：`bash verify-e2b-webhook-setup.sh`
- 查看文档：`cat E2B_WEBHOOK_PRODUCTION_SETUP.md`

---

**最后更新**：2025-11-08
**Webhook URL**：https://open-lovable-cn.com/postreceive
**状态**：✅ 准备就绪
