# 国内 AI 模型配置指南

## 概述

Open Lovable 现已支持国内主流 AI 大模型，包括通义千问、DeepSeek、文心一言、智谱 GLM 等。通过 OpenAI 兼容接口，您可以无缝切换使用国内模型，**无需修改任何代码**。

### ✨ 核心优势

- ✅ **零代码改动**：完全兼容 OpenAI API 格式
- ✅ **快速访问**：国内服务器，无需 VPN
- ✅ **成本更低**：国内模型价格更实惠
- ✅ **模型丰富**：通义千问、DeepSeek、文心一言等
- ✅ **即插即用**：只需配置环境变量

---

## 快速开始

### Step 1: 选择服务提供商

| 提供商 | 优势 | 推荐指数 | 官网 |
|--------|------|----------|------|
| **七牛云 AI** | 稳定、多模型、OpenAI兼容 | ⭐⭐⭐⭐⭐ | https://www.qiniu.com/ai/chat |
| **阿里云通义** | 官方直连、qwen系列全支持 | ⭐⭐⭐⭐⭐ | https://dashscope.aliyun.com |
| **302.AI** | 多模型聚合、一key多用 | ⭐⭐⭐⭐ | https://302.ai |
| **便携AI** | 100+模型、高并发 | ⭐⭐⭐⭐ | https://bianxieai.com |

### Step 2: 获取 API Key

以**七牛云 AI**为例（推荐）：

1. 访问 [七牛云 AI 控制台](https://www.qiniu.com/ai/chat)
2. 注册/登录账号
3. 进入 API 管理页面
4. 创建新的 API Key
5. 复制 API Key 备用

### Step 3: 配置环境变量

在项目根目录创建 `.env.local` 文件：

```env
# 七牛云 AI 配置示例
OPENAI_API_KEY=your_qiniu_api_key_here
OPENAI_BASE_URL=https://api.qiniu.com/v1

# 其他必需配置（保持不变）
FIRECRAWL_API_KEY=your_firecrawl_key
SANDBOX_PROVIDER=vercel
# ... 其他配置
```

### Step 4: 选择模型

在 `config/app.config.ts` 中修改默认模型：

```typescript
export const appConfig = {
  ai: {
    // 修改默认模型为国内模型
    defaultModel: 'qwen-max',  // 或 deepseek-chat, ernie-4.0-turbo-8k 等
    // ...
  }
};
```

### Step 5: 启动应用

```bash
pnpm dev
```

打开 http://localhost:3000，选择模型下拉菜单，您会看到带 🇨🇳 标识的国内模型。

---

## 详细配置

### 方案一：七牛云 AI（推荐）

#### 特点
- ✅ 支持 DeepSeek-R1、Qwen2.5 等主流模型
- ✅ 完全兼容 OpenAI 和 Anthropic 协议
- ✅ 一套接口调用站内所有模型
- ✅ 稳定可靠的企业级服务

#### 配置步骤

**1. 获取 API Key**
```
官网: https://www.qiniu.com/ai/chat
注册并创建 API Key
```

**2. 配置 `.env.local`**
```env
OPENAI_API_KEY=your_qiniu_api_key
OPENAI_BASE_URL=https://api.qiniu.com/v1
```

**3. 可用模型**
```
qwen-max          - 通义千问 Max (最强推理)
qwen-plus         - 通义千问 Plus (平衡性能)
qwen-turbo        - 通义千问 Turbo (快速响应)
deepseek-chat     - DeepSeek Chat
deepseek-reasoner - DeepSeek 推理增强
```

**4. 计费方式**
- 按 Token 计费
- Qwen-Max: 约 ¥0.08/千tokens
- DeepSeek: 约 ¥0.005/千tokens

---

### 方案二：阿里云通义千问（官方）

#### 特点
- ✅ 阿里云官方服务
- ✅ 通义千问全系列模型
- ✅ 企业级稳定性
- ✅ OpenAI 兼容模式

#### 配置步骤

**1. 获取 API Key**
```
官网: https://dashscope.aliyun.com
开通 DashScope 服务
创建 API Key
```

**2. 配置 `.env.local`**
```env
OPENAI_API_KEY=your_dashscope_key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

**3. 可用模型**
```
qwen-max          - 最强版本，超长上下文
qwen-plus         - 高性价比
qwen-turbo        - 快速响应
qwen-coder        - 代码专用
qwen-math         - 数学专用
```

**4. 计费方式**
- 按调用次数或 Token 计费
- 新用户有免费额度
- 详见: https://help.aliyun.com/zh/dashscope/developer-reference/tongyi-thousand-questions-metering-and-billing

---

### 方案三：302.AI 聚合平台

#### 特点
- ✅ 一个 Key 访问多个模型
- ✅ 支持国内外主流模型
- ✅ 统一计费管理
- ✅ 支持流式响应

#### 配置步骤

**1. 获取 API Key**
```
官网: https://302.ai
注册并充值
创建 API Key
```

**2. 配置 `.env.local`**
```env
OPENAI_API_KEY=your_302ai_key
OPENAI_BASE_URL=https://api.302.ai/v1
```

**3. 可用模型**
```
# 国内模型
qwen-max
qwen-plus
deepseek-chat
ernie-4.0-turbo-8k
glm-4-plus

# 国际模型（也支持）
gpt-4
claude-3-opus
gemini-pro
```

---

### 方案四：便携AI（高并发）

#### 特点
- ✅ 100+ 模型支持
- ✅ 官方企业高速通道
- ✅ 高并发支持
- ✅ 稳定可靠

#### 配置步骤

**1. 获取 API Key**
```
官网: https://bianxieai.com
注册并充值
获取 API Key
```

**2. 配置 `.env.local`**
```env
OPENAI_API_KEY=your_bianxieai_key
OPENAI_BASE_URL=https://api.bianxieai.com/v1
```

**3. 可用模型**
```
支持 100+ 国内外模型
详见官网模型列表
```

---

## 国内模型对比

### 模型性能对比

| 模型 | 推理能力 | 代码能力 | 速度 | 成本 | 推荐场景 |
|------|----------|----------|------|------|----------|
| **qwen-max** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 中 | 中 | 复杂推理、代码生成 |
| **qwen-plus** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 快 | 低 | 日常开发、平衡性能 |
| **qwen-turbo** | ⭐⭐⭐ | ⭐⭐⭐ | 极快 | 极低 | 快速原型、简单任务 |
| **deepseek-chat** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | 快 | 极低 | 代码生成（推荐） |
| **deepseek-reasoner** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 慢 | 低 | 复杂推理任务 |
| **ernie-4.0** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 中 | 通用对话、内容生成 |
| **glm-4-plus** | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | 中 | 中 | 多轮对话、推理 |

### 成本对比（每百万 tokens）

| 模型 | 输入价格 | 输出价格 | 总体成本 |
|------|----------|----------|----------|
| qwen-max | ¥8 | ¥8 | 中等 |
| qwen-plus | ¥4 | ¥4 | 低 |
| qwen-turbo | ¥0.8 | ¥0.8 | 极低 |
| deepseek-chat | ¥0.5 | ¥1.5 | 极低 |
| ernie-4.0-turbo | ¥6 | ¥6 | 中等 |
| glm-4-plus | ¥10 | ¥10 | 中高 |

---

## 使用建议

### 场景推荐

#### 1. 代码生成（Open Lovable 核心场景）
```
推荐模型：
✅ deepseek-chat    - 性价比最高，代码质量优秀
✅ qwen-max         - 最强能力，复杂需求
✅ qwen-plus        - 平衡选择
```

#### 2. 快速原型
```
推荐模型：
✅ qwen-turbo       - 极速响应，成本最低
✅ deepseek-chat    - 兼顾速度和质量
```

#### 3. 复杂推理
```
推荐模型：
✅ deepseek-reasoner - 推理能力最强
✅ qwen-max          - 综合能力强
```

### 性价比排行

**代码生成场景（推荐顺序）：**
1. 🥇 **deepseek-chat** - 质量高、成本极低
2. 🥈 **qwen-plus** - 平衡性能
3. 🥉 **qwen-turbo** - 快速原型

---

## 常见问题

### Q1: 如何在国际模型和国内模型之间切换？

**A**: 修改 `.env.local` 中的 `OPENAI_BASE_URL`：

```env
# 使用国际 OpenAI（默认）
OPENAI_API_KEY=sk-xxx
# OPENAI_BASE_URL 留空或注释

# 切换到七牛云（国内）
OPENAI_API_KEY=qiniu_key
OPENAI_BASE_URL=https://api.qiniu.com/v1
```

重启应用即可生效。

### Q2: 国内模型支持流式响应吗？

**A**: ✅ 完全支持！所有推荐的服务商都支持 SSE (Server-Sent Events) 流式响应，与 OpenAI 行为一致。

### Q3: 可以同时使用多个服务商吗？

**A**: 目前不直接支持。但您可以：
- 通过环境变量快速切换
- 或使用聚合平台（如 302.AI）一个 Key 访问多个模型

### Q4: 国内模型的代码生成质量如何？

**A**:
- **deepseek-chat**: 代码质量接近 GPT-4，成本极低 ✅
- **qwen-max**: 代码质量优秀，特别是中文注释 ✅
- **qwen-plus**: 性价比高，适合日常开发 ✅

### Q5: 如何监控 API 使用量和成本？

**A**:
- 各服务商控制台都有详细的用量统计
- 推荐设置消费提醒避免超支
- 建议初期使用 qwen-turbo 或 deepseek-chat 测试

### Q6: 国内模型是否完全兼容 OpenAI API？

**A**: ✅ 是的！本项目测试过的所有服务商都完全兼容 OpenAI API 格式，包括：
- Chat Completions API
- Streaming (SSE)
- Function Calling（部分模型）
- 参数格式（temperature, max_tokens 等）

### Q7: 遇到 API 错误怎么办？

**A**: 常见错误排查：

```
❌ 401 Unauthorized
→ 检查 API Key 是否正确
→ 检查是否已充值（部分平台需预充值）

❌ 404 Not Found
→ 检查 OPENAI_BASE_URL 是否正确
→ 注意 URL 末尾不要有多余的斜杠

❌ Model not found
→ 检查模型名称是否正确
→ 确认该服务商支持该模型

❌ Rate limit exceeded
→ 降低并发请求
→ 升级套餐或更换服务商
```

---

## 高级配置

### 自定义模型参数

在 `app/api/generate-ai-code-stream/route.ts` 中可以调整：

```typescript
// 温度参数（创造性）
temperature: 0.7,  // 0.0-1.0，越高越创意

// 最大 tokens
maxTokens: 8000,   // 根据模型上下文长度调整

// Top P
topP: 0.9,         // 核采样参数
```

### 多模型并行测试

使用不同的 `.env` 文件快速切换：

```bash
# .env.local.qiniu
OPENAI_API_KEY=qiniu_key
OPENAI_BASE_URL=https://api.qiniu.com/v1

# .env.local.aliyun
OPENAI_API_KEY=dashscope_key
OPENAI_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1

# 切换使用
cp .env.local.qiniu .env.local
pnpm dev
```

---

## 性能优化建议

### 1. 选择合适的模型

```
简单任务 → qwen-turbo (快+便宜)
日常开发 → deepseek-chat (平衡)
复杂任务 → qwen-max (强大)
```

### 2. 优化 Prompt

- 明确指令，减少不必要的对话轮次
- 使用系统提示词固定输出格式
- 限制输出长度（max_tokens）

### 3. 合理使用流式响应

- 长文本生成必须使用流式
- 短文本可以使用非流式减少延迟

### 4. 监控和降级

```typescript
// 实现降级策略
const models = ['qwen-max', 'qwen-plus', 'qwen-turbo'];
for (const model of models) {
  try {
    return await generateCode(model, prompt);
  } catch (error) {
    console.warn(`Model ${model} failed, trying next...`);
  }
}
```

---

## 企业级使用

### 安全建议

1. **API Key 管理**
   - 使用环境变量，不要硬编码
   - 定期轮换 API Key
   - 为不同环境使用不同 Key

2. **访问控制**
   - 限制 API Key 的 IP 白名单
   - 设置单日最大调用量
   - 实施速率限制

3. **数据安全**
   - 不要在 Prompt 中包含敏感信息
   - 记录和审计 API 调用
   - 使用 HTTPS 传输

### 成本控制

1. **设置预算告警**
   - 各平台控制台设置消费提醒
   - 建议初期设置低额度测试

2. **优化调用策略**
   - 缓存常见结果
   - 批量处理请求
   - 使用更便宜的模型做初步筛选

3. **监控使用情况**
   - 定期查看用量报表
   - 分析高成本调用
   - 优化低效 Prompt

---

## 技术支持

### 官方文档

- **七牛云**: https://developer.qiniu.com/af/12423/api-document
- **阿里云**: https://help.aliyun.com/zh/dashscope/
- **302.AI**: https://302.ai/docs
- **便携AI**: https://bianxieai.com/docs

### 社区支持

- GitHub Issues: [提交问题](https://github.com/firecrawl/open-lovable/issues)
- Discord 社区: [加入讨论](https://discord.gg/firecrawl)

### 反馈建议

如果您在使用国内模型时遇到问题或有改进建议，欢迎：
1. 提交 GitHub Issue
2. 加入 Discord 社区讨论
3. 发送邮件至 support@firecrawl.dev

---

**最后更新**: 2025-11-07
**维护人**: Open Lovable Team
