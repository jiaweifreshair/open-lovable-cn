# Gemini CLI Playwright MCP 配置指南

## 概述

本文档说明如何为 Gemini CLI 配置 Playwright Model Context Protocol (MCP) 服务器，使 Gemini CLI 能够通过 Playwright 进行浏览器自动化操作。

## 前提条件

1. **已安装 Gemini CLI**
   ```bash
   # 检查是否已安装
   gemini --version

   # 如未安装，运行
   npm install -g @google/gemini-cli
   ```

2. **已安装 Playwright 浏览器**
   ```bash
   # 检查浏览器安装路径
   ls -la ~/Library/Caches/ms-playwright

   # 如未安装，运行
   npx playwright install
   ```

## 配置步骤

### 1. 自动配置（推荐）

使用 Gemini CLI 的 `mcp add` 命令自动添加配置：

```bash
gemini mcp add \
  -e PLAYWRIGHT_BROWSERS_PATH="/Users/apus/Library/Caches/ms-playwright" \
  -e npm_config_cache="/Users/apus/Documents/UGit/open-lovable-cn/.npm-cache" \
  -e PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD="1" \
  playwright \
  npx -y @executeautomation/playwright-mcp-server
```

### 2. 手动配置

编辑 `~/.gemini/settings.json` 文件，添加以下配置：

```json
{
  "security": {
    "auth": {
      "selectedType": "oauth-personal"
    }
  },
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": [
        "-y",
        "@executeautomation/playwright-mcp-server"
      ],
      "env": {
        "PLAYWRIGHT_BROWSERS_PATH": "/Users/apus/Library/Caches/ms-playwright",
        "npm_config_cache": "/Users/apus/Documents/UGit/open-lovable-cn/.npm-cache",
        "PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD": "1"
      },
      "timeout": 30000,
      "trust": false
    }
  }
}
```

### 配置参数说明

| 参数 | 说明 | 默认值 |
|-----|------|-------|
| `command` | MCP 服务器执行命令 | `npx` |
| `args` | 命令行参数数组 | `["-y", "@executeautomation/playwright-mcp-server"]` |
| `env.PLAYWRIGHT_BROWSERS_PATH` | Playwright 浏览器安装路径 | `~/Library/Caches/ms-playwright` |
| `env.npm_config_cache` | npm 缓存目录（避免权限问题） | `./.npm-cache` |
| `env.PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD` | 跳过浏览器下载 | `1` |
| `timeout` | 请求超时时间（毫秒） | `30000` (30秒) |
| `trust` | 是否跳过确认对话框 | `false` |

## 验证配置

### 1. 列出所有 MCP 服务器

```bash
gemini mcp list
```

**预期输出**：
```
Configured MCP servers:

✓ playwright: npx -y @executeautomation/playwright-mcp-server (stdio) - Connected
```

### 2. 查看 Playwright 可用工具

```bash
gemini mcp tools playwright
```

**常见工具**：
- `playwright_navigate` - 导航到指定URL
- `playwright_screenshot` - 截取页面截图
- `playwright_click` - 点击页面元素
- `playwright_fill` - 填写表单字段
- `playwright_evaluate` - 在页面中执行 JavaScript

## 使用示例

### 在 Gemini CLI 中使用 Playwright

启动 Gemini CLI 交互式会话：

```bash
gemini chat
```

在会话中，你可以这样使用 Playwright 工具：

```
你: 使用 playwright 打开 https://example.com 并截图

Gemini: [调用 playwright_navigate 和 playwright_screenshot 工具]
```

### 命令行调用示例

```bash
# 导航到网页
gemini mcp call playwright playwright_navigate '{"url": "https://example.com"}'

# 截取截图
gemini mcp call playwright playwright_screenshot '{"name": "example"}'
```

## 编程方式调用

项目中提供了两个辅助脚本用于编程方式调用 MCP 工具：

### 1. mcp_bridge.ts - 通用 MCP 工具调用

```typescript
// 使用方式
npx tsx mcp_bridge.ts <tool_name> [json_arguments]

// 示例
npx tsx mcp_bridge.ts playwright_navigate '{"url": "https://example.com"}'
```

**文件位置**: `/Users/apus/Documents/UGit/open-lovable-cn/mcp_bridge.ts:17`

### 2. demo_playwright_mcp.ts - Playwright MCP 完整演示

完整的端到端示例，演示如何：
1. 初始化 MCP 服务器
2. 列出可用工具
3. 导航到网页
4. 截取截图

```bash
npx tsx demo_playwright_mcp.ts
```

**文件位置**: `/Users/apus/Documents/UGit/open-lovable-cn/demo_playwright_mcp.ts:5`

## 常见问题排查

### 问题 1: MCP 服务器无法连接

**症状**: `gemini mcp list` 显示 "Not Connected"

**解决方案**:
```bash
# 检查 Playwright 浏览器是否已安装
npx playwright install

# 检查 npm 缓存目录权限
mkdir -p ./.npm-cache
chmod 755 ./.npm-cache

# 重启 Gemini CLI
pkill -f gemini
gemini mcp list
```

### 问题 2: 权限错误 (EACCES)

**症状**: `npm error code EACCES`

**解决方案**:
在配置中添加本地 npm 缓存目录：
```json
{
  "env": {
    "npm_config_cache": "/Users/apus/Documents/UGit/open-lovable-cn/.npm-cache"
  }
}
```

### 问题 3: 超时错误

**症状**: MCP 调用超时

**解决方案**:
增加超时时间（默认 30 秒）：
```json
{
  "timeout": 60000
}
```

### 问题 4: 浏览器未找到

**症状**: "Executable doesn't exist at ..."

**解决方案**:
```bash
# 确认浏览器安装路径
echo $PLAYWRIGHT_BROWSERS_PATH

# 重新安装 Playwright 浏览器
npx playwright install chromium
```

## 高级配置

### 工具白名单/黑名单

如果只想启用特定的 Playwright 工具：

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["-y", "@executeautomation/playwright-mcp-server"],
      "includeTools": ["playwright_navigate", "playwright_screenshot"],
      "excludeTools": ["playwright_evaluate"]
    }
  }
}
```

### 多环境配置

项目级配置（`.gemini/settings.json`）会覆盖用户级配置（`~/.gemini/settings.json`）：

```bash
# 项目级配置
mkdir -p .gemini
cp ~/.gemini/settings.json .gemini/settings.json

# 编辑项目级配置
nano .gemini/settings.json
```

## 相关资源

- **Gemini CLI 官方文档**: https://geminicli.com/docs/tools/mcp-server/
- **Playwright MCP Server**: https://www.npmjs.com/package/@executeautomation/playwright-mcp-server
- **Model Context Protocol 规范**: https://modelcontextprotocol.io/
- **项目配置文件**: `/Users/apus/Documents/UGit/open-lovable-cn/playwright_mcp_config.json:1`

## 配置文件位置

- **用户级配置**: `~/.gemini/settings.json`
- **项目级配置**: `.gemini/settings.json`
- **Playwright 配置**: `playwright_mcp_config.json`

## 更新配置

### 添加新的 MCP 服务器

```bash
gemini mcp add <server_name> <command> [args...]
```

### 移除 MCP 服务器

```bash
gemini mcp remove playwright
```

### 重新加载配置

```bash
# 重启 Gemini CLI 以重新加载配置
pkill -f gemini
gemini mcp list
```

## 验证清单

配置完成后，请确认：

- [ ] `gemini mcp list` 显示 playwright 服务器状态为 "Connected"
- [ ] `gemini mcp tools playwright` 能列出可用工具
- [ ] 能在 `gemini chat` 中成功调用 playwright 工具
- [ ] 能通过 `mcp_bridge.ts` 脚本成功调用工具

---

**配置完成时间**: 2025-12-07
**Gemini CLI 版本**: 0.19.1
**Playwright MCP 版本**: @executeautomation/playwright-mcp-server (latest)
