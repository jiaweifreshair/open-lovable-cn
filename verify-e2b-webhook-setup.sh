#!/bin/bash

###############################################################################
# E2B Webhook 生产环境配置验证脚本
#
# 使用方法：
#   bash verify-e2b-webhook-setup.sh
#
# 功能：
#   1. 验证环境变量配置
#   2. 验证 Docker 容器状态
#   3. 测试 webhook 端点
#   4. 生成配置报告
###############################################################################

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 配置
WEBHOOK_URL="https://open-lovable-cn.com/postreceive"
LOCAL_WEBHOOK_URL="http://localhost:3000/postreceive"
WEBHOOK_SECRET="Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS"

echo ""
echo "╔═══════════════════════════════════════════════════════════╗"
echo "║     E2B Webhook 生产环境配置验证                            ║"
echo "╚═══════════════════════════════════════════════════════════╝"
echo ""

###############################################################################
# Step 1: 检查环境变量
###############################################################################

echo -e "${BLUE}[1/6] 检查环境变量配置...${NC}"

if [ -f .env.docker ]; then
  if grep -q "E2B_WEBHOOK_SECRET=$WEBHOOK_SECRET" .env.docker; then
    echo -e "${GREEN}✅ .env.docker 中 E2B_WEBHOOK_SECRET 配置正确${NC}"
  else
    echo -e "${RED}❌ .env.docker 中 E2B_WEBHOOK_SECRET 配置错误或不存在${NC}"
    echo -e "${YELLOW}   预期值: E2B_WEBHOOK_SECRET=$WEBHOOK_SECRET${NC}"
    exit 1
  fi
else
  echo -e "${RED}❌ .env.docker 文件不存在${NC}"
  exit 1
fi

echo ""

###############################################################################
# Step 2: 检查 Docker 容器状态
###############################################################################

echo -e "${BLUE}[2/6] 检查 Docker 容器状态...${NC}"

if docker compose ps | grep -q "open-lovable.*Up.*healthy"; then
  echo -e "${GREEN}✅ Docker 容器运行正常 (healthy)${NC}"
else
  echo -e "${RED}❌ Docker 容器未运行或不健康${NC}"
  echo -e "${YELLOW}   请运行: docker compose up -d${NC}"
  exit 1
fi

echo ""

###############################################################################
# Step 3: 验证容器内环境变量
###############################################################################

echo -e "${BLUE}[3/6] 验证容器内环境变量...${NC}"

CONTAINER_SECRET=$(docker compose exec app printenv E2B_WEBHOOK_SECRET 2>/dev/null | tr -d '\r\n')

if [ "$CONTAINER_SECRET" = "$WEBHOOK_SECRET" ]; then
  echo -e "${GREEN}✅ 容器内 E2B_WEBHOOK_SECRET 配置正确${NC}"
else
  echo -e "${RED}❌ 容器内 E2B_WEBHOOK_SECRET 配置错误${NC}"
  echo -e "${YELLOW}   容器内值: $CONTAINER_SECRET${NC}"
  echo -e "${YELLOW}   预期值: $WEBHOOK_SECRET${NC}"
  echo -e "${YELLOW}   解决方案: docker compose down && docker compose up -d${NC}"
  exit 1
fi

echo ""

###############################################################################
# Step 4: 测试本地 Webhook 端点
###############################################################################

echo -e "${BLUE}[4/6] 测试本地 Webhook 端点...${NC}"

# 生成测试 payload
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%S.000Z")
PAYLOAD="{\"eventCategory\":\"lifecycle\",\"eventLabel\":\"kill\",\"sandboxId\":\"verify-test-$RANDOM\",\"sandboxTeamId\":\"team-abc\",\"timestamp\":\"$TIMESTAMP\"}"

# 生成签名
SIGNATURE=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | cut -d' ' -f2)

# 发送测试请求
HTTP_CODE=$(curl -s -o /tmp/webhook-response.json -w "%{http_code}" \
  -X POST "$LOCAL_WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-E2B-Signature: $SIGNATURE" \
  -d "$PAYLOAD")

if [ "$HTTP_CODE" = "200" ]; then
  echo -e "${GREEN}✅ 本地 Webhook 端点响应正常 (HTTP $HTTP_CODE)${NC}"
  cat /tmp/webhook-response.json | jq '.' 2>/dev/null || cat /tmp/webhook-response.json
else
  echo -e "${RED}❌ 本地 Webhook 端点响应异常 (HTTP $HTTP_CODE)${NC}"
  cat /tmp/webhook-response.json
  exit 1
fi

echo ""

###############################################################################
# Step 5: 检查 Docker 日志
###############################################################################

echo -e "${BLUE}[5/6] 检查最近的 Webhook 日志...${NC}"

if docker compose logs --tail=20 app 2>/dev/null | grep -q "\[e2b-webhook\]"; then
  echo -e "${GREEN}✅ 发现 Webhook 处理日志${NC}"
  echo ""
  echo "最近的日志："
  docker compose logs --tail=10 app | grep "\[e2b-webhook\]" || true
else
  echo -e "${YELLOW}⚠️  暂无 Webhook 处理日志（正常，因为还未收到真实事件）${NC}"
fi

echo ""

###############################################################################
# Step 6: 生成配置报告
###############################################################################

echo -e "${BLUE}[6/6] 生成配置报告...${NC}"
echo ""

cat << EOF

╔═══════════════════════════════════════════════════════════╗
║              配置验证报告                                   ║
╚═══════════════════════════════════════════════════════════╝

✅ 环境变量配置正确
✅ Docker 容器运行正常
✅ 容器内环境变量已加载
✅ Webhook 端点响应正常

📌 生产环境信息：

  域名:          https://open-lovable-cn.com
  Webhook URL:   https://open-lovable-cn.com/postreceive
  签名秘钥:      Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS

📋 下一步操作：

  1. 登录 E2B Dashboard
     https://e2b.dev/dashboard/webhooks

  2. 创建 Webhook 配置：
     - Webhook URL: https://open-lovable-cn.com/postreceive
     - Signing Secret: Yy0HXieFpJifYp0xfa8HUPR5BKBflpvS
     - Events: ☑️ All Sandbox Lifecycle Events
     - Status: ☑️ Active

  3. 发送测试事件验证配置

  4. 监控 Webhook 日志：
     docker compose logs -f app | grep e2b-webhook

📚 详细文档：

  - E2B_WEBHOOK_PRODUCTION_SETUP.md
  - SANDBOX_COST_CONTROL.md

╔═══════════════════════════════════════════════════════════╗
║          ✅ 所有验证通过！准备好接收 E2B Webhook           ║
╚═══════════════════════════════════════════════════════════╝

EOF

# 清理临时文件
rm -f /tmp/webhook-response.json

exit 0
