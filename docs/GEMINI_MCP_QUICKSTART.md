# Gemini CLI Playwright MCP 快速开始

## 一分钟配置指南

### 1. 确认环境

```bash
# 检查 Gemini CLI（应该已安装）
gemini --version

# 检查 Playwright 浏览器
ls ~/Library/Caches/ms-playwright
```

### 2. 配置已完成 ✅

Playwright MCP 服务器已配置到 `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "/Users/apus/Library/Caches/ms-playwright",
        "npm_config_cache": "/Users/apus/Documents/UGit/open-lovable-cn/.npm-cache",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"
      },
      "timeout": 30000
    }
  }
}
```

### 3. 验证配置

```bash
# 运行测试脚本
./test_gemini_mcp.sh

# 或手动验证
gemini mcp list
```

**预期输出**:
```
✓ playwright: npx -y @executeautomation/playwright-mcp-server (stdio) - Connected
```

## 三种使用方式

### 方式 1: Gemini Chat 交互式（推荐）

```bash
gemini chat
```

然后在会话中：
```
你: 使用 playwright 打开 https://example.com 并截图
```

Gemini 会自动调用 Playwright MCP 工具来完成任务。

### 方式 2: MCP Bridge 脚本

```bash
# 导航到网页
npx tsx mcp_bridge.ts playwright_navigate '{"url": "https://example.com"}'

# 截图
npx tsx mcp_bridge.ts playwright_screenshot '{"name": "example"}'
```

### 方式 3: 演示脚本

```bash
# 运行完整的演示流程
npx tsx demo_playwright_mcp.ts
```

## 常用 Playwright 工具

| 工具名称 | 功能 | 参数示例 |
|---------|------|---------|
| `playwright_navigate` | 导航到URL | `{"url": "https://example.com"}` |
| `playwright_screenshot` | 截图 | `{"name": "screenshot"}` |
| `playwright_click` | 点击元素 | `{"selector": "button.submit"}` |
| `playwright_fill` | 填写输入框 | `{"selector": "input#email", "value": "test@example.com"}` |
| `playwright_evaluate` | 执行JS | `{"script": "return document.title"}` |

## 实际应用场景

### 场景 1: 自动化网页测试

```bash
gemini chat

你: 帮我测试登录流程：
1. 打开 https://example.com/login
2. 填写用户名 'test@example.com'
3. 填写密码 '123456'
4. 点击登录按钮
5. 截图保存结果
```

### 场景 2: 网页数据采集

```bash
gemini chat

你: 从 https://news.ycombinator.com 抓取前10条新闻标题
```

### 场景 3: UI 自动化截图

```bash
gemini chat

你: 打开我们的产品页面 https://example.com/product，
滚动到页面底部，然后截图保存为 'product-full.png'
```

## 故障排查

### 问题: MCP 服务器未连接

```bash
# 重新安装 Playwright 浏览器
npx playwright install

# 重启 Gemini CLI
pkill -f gemini
gemini mcp list
```

### 问题: 权限错误

```bash
# 确保 npm 缓存目录存在且可写
mkdir -p .npm-cache
chmod 755 .npm-cache
```

## 进阶资源

- 📖 **完整文档**: `docs/GEMINI_CLI_MCP_SETUP.md`
- 🧪 **测试脚本**: `test_gemini_mcp.sh`
- 🛠️ **MCP Bridge**: `mcp_bridge.ts`
- 🎬 **演示脚本**: `demo_playwright_mcp.ts`

## 配置状态

- ✅ Gemini CLI 版本: **0.19.1**
- ✅ Playwright MCP: **已配置并连接**
- ✅ 浏览器路径: `/Users/apus/Library/Caches/ms-playwright`
- ✅ 配置文件: `~/.gemini/settings.json`

---

**配置完成时间**: 2025-12-07
**状态**: 生产就绪 🚀
