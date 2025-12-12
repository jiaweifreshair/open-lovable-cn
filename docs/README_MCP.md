# Gemini CLI MCP 配置文档索引

## 📚 文档列表

### 1. 快速开始指南
**文件**: `GEMINI_MCP_QUICKSTART.md`

适合人群：想要快速使用 Playwright MCP 的用户

内容概览：
- ✅ 一分钟验证配置
- ✅ 三种使用方式
- ✅ 常用工具速查
- ✅ 实际应用场景

### 2. 完整配置指南
**文件**: `GEMINI_CLI_MCP_SETUP.md`

适合人群：需要深入理解和自定义配置的用户

内容概览：
- 📦 安装前提条件
- ⚙️ 详细配置步骤
- 🔧 配置参数说明
- 🐛 常见问题排查
- 🚀 高级配置选项

## 🛠️ 辅助工具

### 测试脚本
```bash
./test_gemini_mcp.sh
```
自动验证所有配置是否正确

### MCP Bridge
```bash
npx tsx mcp_bridge.ts <tool_name> [args]
```
编程方式调用 MCP 工具

### 演示脚本
```bash
npx tsx demo_playwright_mcp.ts
```
端到端演示 Playwright MCP 使用

## 🎯 快速上手

### 方法 1: 使用 Gemini Chat（推荐）

```bash
gemini chat
```

然后输入：
```
使用 playwright 打开 https://example.com 并截图
```

### 方法 2: 直接调用工具

```bash
npx tsx mcp_bridge.ts playwright_navigate '{"url": "https://example.com"}'
```

## 📂 项目文件结构

```
open-lovable-cn/
├── docs/
│   ├── README_MCP.md                    # 本文件
│   ├── GEMINI_MCP_QUICKSTART.md         # 快速开始
│   └── GEMINI_CLI_MCP_SETUP.md          # 完整指南
├── mcp_bridge.ts                         # MCP 通用调用脚本
├── demo_playwright_mcp.ts                # Playwright 演示脚本
├── playwright_mcp_config.json            # Playwright 配置示例
└── test_gemini_mcp.sh                    # 配置验证脚本
```

## ✅ 配置状态检查清单

在开始使用前，确保以下所有项都打勾：

- [ ] Gemini CLI 已安装（`gemini --version`）
- [ ] Playwright MCP 配置已添加到 `~/.gemini/settings.json`
- [ ] `gemini mcp list` 显示 playwright 为 "Connected" 状态
- [ ] 测试脚本运行成功（`./test_gemini_mcp.sh`）

## 🔗 相关资源

- **Gemini CLI 官方文档**: https://geminicli.com/docs/tools/mcp-server/
- **Playwright MCP Server**: https://www.npmjs.com/package/@executeautomation/playwright-mcp-server
- **Model Context Protocol**: https://modelcontextprotocol.io/

## 🆘 获取帮助

### 常见问题
1. **MCP 服务器未连接**: 查看 `GEMINI_CLI_MCP_SETUP.md` 的"常见问题排查"章节
2. **权限错误**: 确保 npm 缓存目录配置正确
3. **超时错误**: 调整 `timeout` 配置参数

### 联系方式
- 查看完整文档：`docs/GEMINI_CLI_MCP_SETUP.md`
- 运行测试脚本：`./test_gemini_mcp.sh`

---

**最后更新**: 2025-12-07
**配置版本**: Gemini CLI 0.19.1
**状态**: ✅ 生产就绪
