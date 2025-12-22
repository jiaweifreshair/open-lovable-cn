#!/bin/bash

# Plan 模式端到端测试脚本
# 用途: 自动化验证 Plan 模式的核心功能
# 使用: ./scripts/test-plan-mode.sh

set -e  # 遇到错误立即退出

echo "🚀 Plan 模式端到端测试开始"
echo "======================================"
echo ""

# 颜色定义
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 测试结果统计
TOTAL_TESTS=0
PASSED_TESTS=0
FAILED_TESTS=0

# 测试函数
test_case() {
    local test_name=$1
    local test_command=$2

    TOTAL_TESTS=$((TOTAL_TESTS + 1))
    echo -e "${BLUE}[TEST $TOTAL_TESTS]${NC} $test_name"

    if eval "$test_command"; then
        echo -e "  ${GREEN}✓ PASSED${NC}"
        PASSED_TESTS=$((PASSED_TESTS + 1))
        return 0
    else
        echo -e "  ${RED}✗ FAILED${NC}"
        FAILED_TESTS=$((FAILED_TESTS + 1))
        return 1
    fi
}

echo "📋 Phase 1: 环境检查"
echo "--------------------------------------"

# Test 1: 服务器健康检查
test_case "服务器健康检查" \
    "curl -s -f http://localhost:3000/api/health > /dev/null 2>&1"

# Test 2: 检查必要的依赖包
test_case "检查 react-markdown 依赖" \
    "grep -q 'react-markdown' package.json"

test_case "检查 react-syntax-highlighter 依赖" \
    "grep -q 'react-syntax-highlighter' package.json"

# Test 3: 检查关键文件存在
test_case "检查 TechnicalPlanView 组件" \
    "test -f components/TechnicalPlanView.tsx"

test_case "检查 generation/page.tsx" \
    "test -f app/generation/page.tsx"

test_case "检查 route.ts API" \
    "test -f app/api/generate-ai-code-stream/route.ts"

echo ""
echo "📋 Phase 2: 代码质量检查"
echo "--------------------------------------"

# Test 4: TypeScript 编译检查
test_case "TypeScript 类型检查" \
    "pnpm tsc --noEmit 2>&1 | grep -q 'error' && exit 1 || exit 0"

# Test 5: 检查编译产物
test_case "检查前端编译产物" \
    "test -f .next/server/app/generation/page.js"

echo ""
echo "📋 Phase 3: API 端点检查"
echo "--------------------------------------"

# Test 6: 健康检查端点
test_case "健康检查 API" \
    "curl -s http://localhost:3000/api/health | grep -q 'healthy'"

# Test 7: 沙箱创建端点
test_case "沙箱创建 API 可访问" \
    "curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/create-ai-sandbox-v2 | grep -qE '^(200|405)$'"

echo ""
echo "📋 Phase 4: 关键代码验证"
echo "--------------------------------------"

# Test 8: 检查 Plan 模式路由
test_case "Plan 模式路由存在" \
    "grep -q \"mode === 'plan'\" app/api/generate-ai-code-stream/route.ts"

# Test 9: 检查 generatePlan 函数
test_case "generatePlan 函数存在" \
    "grep -q 'async function generatePlan' app/api/generate-ai-code-stream/route.ts"

# Test 10: 检查前端 Plan 状态管理
test_case "前端 Plan 状态管理" \
    "grep -q 'const \[planMode, setPlanMode\]' app/generation/page.tsx"

# Test 11: 检查 TechnicalPlanView 导入
test_case "TechnicalPlanView 组件导入" \
    "grep -q \"import TechnicalPlanView from '@/components/TechnicalPlanView'\" app/generation/page.tsx"

# Test 12: 检查错误处理优化
test_case "错误处理优化存在" \
    "grep -q 'hasReceivedData' app/generation/page.tsx && grep -q 'completeEventReceived' app/generation/page.tsx"

echo ""
echo "📋 Phase 5: 文档完整性检查"
echo "--------------------------------------"

# Test 13: 测试指南文档
test_case "测试指南文档存在" \
    "test -f docs/plan-mode-testing-guide.md"

# Test 14: 优化总结文档
test_case "优化总结文档存在" \
    "test -f docs/plan-mode-optimization-summary.md"

# Test 15: 前端集成指南
test_case "前端集成指南存在" \
    "test -f docs/frontend-plan-integration.md"

echo ""
echo "======================================"
echo "📊 测试结果统计"
echo "======================================"
echo -e "总测试数: ${BLUE}$TOTAL_TESTS${NC}"
echo -e "通过数: ${GREEN}$PASSED_TESTS${NC}"
echo -e "失败数: ${RED}$FAILED_TESTS${NC}"

PASS_RATE=$((PASSED_TESTS * 100 / TOTAL_TESTS))
echo -e "通过率: ${YELLOW}${PASS_RATE}%${NC}"
echo ""

if [ $FAILED_TESTS -eq 0 ]; then
    echo -e "${GREEN}✅ 所有测试通过！Plan 模式已准备就绪。${NC}"
    echo ""
    echo "🎯 下一步: 手动测试完整流程"
    echo "   1. 访问 http://localhost:3000"
    echo "   2. 输入 URL 或需求描述"
    echo "   3. 观察技术方案生成"
    echo "   4. 确认方案并生成代码"
    echo "   5. 验证预览功能"
    echo ""
    exit 0
else
    echo -e "${RED}❌ 有 $FAILED_TESTS 个测试失败，请检查！${NC}"
    echo ""
    echo "🔍 调试建议:"
    echo "   1. 检查服务器日志: tail -50 start_err.txt"
    echo "   2. 运行 TypeScript 检查: pnpm tsc --noEmit"
    echo "   3. 检查编译状态: pnpm build"
    echo "   4. 查看详细文档: docs/plan-mode-testing-guide.md"
    echo ""
    exit 1
fi
