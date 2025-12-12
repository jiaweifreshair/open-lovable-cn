#!/bin/bash

# Gemini CLI Playwright MCP 测试脚本

echo "=========================================="
echo "Gemini CLI Playwright MCP 配置测试"
echo "=========================================="
echo ""

# 1. 检查 Gemini CLI 版本
echo "1. 检查 Gemini CLI 版本"
gemini --version
echo ""

# 2. 列出所有 MCP 服务器
echo "2. 列出配置的 MCP 服务器"
gemini mcp list
echo ""

# 3. 检查配置文件
echo "3. 检查配置文件内容"
echo "位置: ~/.gemini/settings.json"
cat ~/.gemini/settings.json
echo ""

# 4. 测试 MCP Bridge 脚本
echo "4. 测试 MCP Bridge 脚本（可选）"
echo "运行命令: npx tsx mcp_bridge.ts playwright_navigate '{\"url\": \"https://example.com\"}'"
echo "如需测试，请手动运行上述命令"
echo ""

echo "=========================================="
echo "配置验证完成！"
echo "=========================================="
echo ""
echo "下一步："
echo "1. 运行 'gemini chat' 启动交互式会话"
echo "2. 在会话中尝试: '使用 playwright 打开 https://example.com'"
echo "3. 或运行: npx tsx mcp_bridge.ts playwright_navigate '{\"url\": \"https://example.com\"}'"
echo ""
