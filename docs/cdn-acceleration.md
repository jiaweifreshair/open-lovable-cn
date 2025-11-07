# Vercel 沙箱 CDN 加速配置指南

## 背景说明

Open Lovable 使用 Vercel Sandbox 作为代码执行沙箱。由于 Vercel 在国内访问速度较慢，本文档提供多种加速方案。

---

## 方案一：Cloudflare CDN 加速（推荐）

### 优势
- ✅ 完全免费
- ✅ 配置简单（5-10分钟）
- ✅ 全球加速网络
- ✅ 自动 HTTPS

### 配置步骤

#### 1. 注册 Cloudflare
访问 [Cloudflare 官网](https://www.cloudflare.com/) 注册账号

#### 2. 添加站点
1. 点击 "Add a Site"
2. 输入您的域名（例如：`myapp.example.com`）
3. 选择免费计划

#### 3. 修改 DNS 记录

在 Cloudflare DNS 设置中添加：

```dns
类型: CNAME
名称: sandbox (或您的子域名)
目标: cname.vercel-dns.com
代理状态: 已代理（橙色云朵）✅
TTL: 自动
```

#### 4. 更新域名服务器

将您的域名 DNS 服务器修改为 Cloudflare 提供的地址：
```
NS1: elsa.ns.cloudflare.com
NS2: sam.ns.cloudflare.com
```

#### 5. 等待生效
DNS 传播通常需要 1-24 小时

### Cloudflare 优化设置

#### 速度优化
```
Speed → Optimization
├── Auto Minify: ✅ JavaScript, CSS, HTML
├── Brotli: ✅ 启用
└── Rocket Loader: ✅ 启用
```

#### 缓存设置
```
Caching → Configuration
├── Caching Level: Standard
├── Browser Cache TTL: 4 hours
└── Always Online: ✅ 启用
```

#### 安全设置
```
Security → Settings
├── Security Level: Medium
├── Bot Fight Mode: ✅ 启用
└── SSL/TLS: Full (strict)
```

---

## 方案二：阿里云 CDN 加速

### 优势
- ✅ 国内节点多
- ✅ 访问速度快
- ⚠️ 需要备案域名

### 配置步骤

#### 1. 购买阿里云 CDN
登录 [阿里云控制台](https://www.aliyun.com/product/cdn)

#### 2. 添加加速域名

```
基本配置：
├── 加速域名: sandbox.yourdomain.com
├── 业务类型: 全站加速
├── 源站类型: 域名
├── 源站地址: cname.vercel-dns.com
└── 端口: 443 (HTTPS)
```

#### 3. 配置回源设置

```
回源配置：
├── 回源协议: 跟随
├── 回源 Host: 与加速域名相同
└── 回源超时时间: 30秒
```

#### 4. 配置缓存规则

```
缓存配置：
├── HTML: 不缓存
├── JS/CSS: 缓存 7 天
├── 图片: 缓存 30 天
└── 其他静态资源: 缓存 7 天
```

#### 5. 配置 HTTPS 证书

```
HTTPS 配置：
├── 证书来源: 阿里云证书服务（免费）
├── 强制 HTTPS: ✅ 启用
└── TLS 版本: TLS 1.2+
```

#### 6. CNAME 配置

在您的 DNS 服务商添加 CNAME 记录：
```
sandbox.yourdomain.com → xxx.w.kunlunsl.com
```

### 成本估算

```
按流量计费（国内）：
├── 0-10TB: ¥0.24/GB
├── 10-50TB: ¥0.23/GB
└── 50-100TB: ¥0.21/GB

预估（100个用户/天）：
└── 约 ¥50-100/月
```

---

## 方案三：腾讯云 CDN 加速

### 配置步骤

与阿里云类似，主要差异：

```
腾讯云 CDN 特点：
├── 价格: 与阿里云相近
├── 节点: 覆盖全国
└── 文档: https://cloud.tencent.com/product/cdn
```

---

## 方案四：自定义域名代理（高级）

### 使用 Nginx 反向代理

适用于有自己服务器的用户。

#### Nginx 配置示例

```nginx
# /etc/nginx/sites-available/vercel-proxy

upstream vercel_sandbox {
    server cname.vercel-dns.com:443;
}

server {
    listen 80;
    server_name sandbox.yourdomain.com;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name sandbox.yourdomain.com;

    # SSL 证书配置
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;

    # 代理配置
    location / {
        proxy_pass https://vercel_sandbox;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # WebSocket 支持
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # 超时设置
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # 缓存配置
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg)$ {
        proxy_pass https://vercel_sandbox;
        proxy_cache_valid 200 7d;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

---

## 性能对比

| 方案 | 配置难度 | 成本 | 国内速度 | 国际速度 | 推荐指数 |
|------|----------|------|----------|----------|----------|
| Cloudflare | ⭐ 简单 | 免费 | ⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ |
| 阿里云 CDN | ⭐⭐ 中等 | ¥50-100/月 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| 腾讯云 CDN | ⭐⭐ 中等 | ¥50-100/月 | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ |
| Nginx 代理 | ⭐⭐⭐⭐ 复杂 | 服务器成本 | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ |

---

## 环境变量配置

### 更新 `.env.local`

```env
# Vercel Sandbox 配置（保持不变）
SANDBOX_PROVIDER=vercel
VERCEL_OIDC_TOKEN=your_token

# 可选：自定义沙箱域名（使用 CDN 加速后）
VERCEL_SANDBOX_CUSTOM_DOMAIN=sandbox.yourdomain.com
```

### 更新 `config/app.config.ts`

```typescript
export const appConfig = {
  vercelSandbox: {
    // ... 现有配置 ...

    // 新增：自定义域名配置
    customDomain: process.env.VERCEL_SANDBOX_CUSTOM_DOMAIN || null,

    // 新增：CDN 加速配置
    cdn: {
      enabled: !!process.env.VERCEL_SANDBOX_CUSTOM_DOMAIN,
      provider: 'cloudflare', // 'cloudflare' | 'aliyun' | 'tencent'
    }
  },
};
```

---

## 验证配置

### 1. 测试访问速度

```bash
# 测试 CDN 延迟
curl -o /dev/null -s -w "Time: %{time_total}s\n" https://sandbox.yourdomain.com

# 对比原始 Vercel 延迟
curl -o /dev/null -s -w "Time: %{time_total}s\n" https://xxx.vercel.app
```

### 2. 检查 CDN 缓存状态

使用浏览器开发者工具查看响应头：

```
✅ 已启用 CDN：
   cf-cache-status: HIT (Cloudflare)
   x-cache: HIT (阿里云/腾讯云)

❌ 未启用 CDN：
   x-vercel-cache: MISS
```

### 3. 全国多点测速

使用在线工具测试：
- [17ce.com](https://www.17ce.com/) - 国内多点测速
- [Pingdom](https://tools.pingdom.com/) - 国际多点测速

---

## 常见问题

### Q1: Cloudflare 免费版够用吗？
**A**: 对于个人项目和小型应用完全够用。Cloudflare 免费版包括：
- ✅ 无限流量
- ✅ 全球 CDN 加速
- ✅ 免费 SSL 证书
- ✅ DDoS 防护

### Q2: 阿里云 CDN 需要备案吗？
**A**:
- ✅ 使用国内节点：需要备案
- ✅ 使用海外节点：不需要备案（但速度提升有限）

### Q3: CDN 会影响 WebSocket 吗？
**A**:
- ✅ Cloudflare: 完全支持 WebSocket
- ✅ 阿里云/腾讯云: 需要开启 WebSocket 支持
- ⚠️ 注意配置超时时间（建议 ≥60s）

### Q4: 如何选择 CDN 方案？
**A**: 推荐策略：
```
个人项目 → Cloudflare（免费）
国内用户为主 → 阿里云/腾讯云 CDN
国际用户为主 → Cloudflare
预算充足 + 定制需求 → 自建 Nginx 代理
```

### Q5: CDN 加速后会不会影响调试？
**A**:
- ✅ 不会影响，沙箱内的代码执行不受影响
- ✅ 只是加速了访问沙箱的网络连接
- ⚠️ 调试时可以暂时禁用 CDN 缓存

---

## 监控和维护

### 设置监控告警

#### Cloudflare Analytics
```
Analytics → Traffic
├── 请求数
├── 带宽使用量
├── 缓存命中率
└── 错误率
```

#### 阿里云监控
```
CDN → 监控信息
├── 带宽峰值
├── 流量统计
├── 请求数
└── 命中率
```

### 定期检查清单

```markdown
每周检查：
- [ ] CDN 缓存命中率 > 80%
- [ ] 平均响应时间 < 500ms
- [ ] 错误率 < 1%
- [ ] SSL 证书有效期 > 30天

每月检查：
- [ ] 流量成本是否在预算内
- [ ] CDN 规则是否需要优化
- [ ] 安全日志是否有异常
```

---

## 应急预案

### CDN 故障时的备选方案

```typescript
// lib/sandbox/cdn-fallback.ts

export async function getSandboxUrl(sandboxId: string): Promise<string> {
  const cdnDomain = process.env.VERCEL_SANDBOX_CUSTOM_DOMAIN;

  if (cdnDomain) {
    try {
      // 尝试使用 CDN 域名
      const cdnUrl = `https://${cdnDomain}/${sandboxId}`;
      const response = await fetch(cdnUrl, { method: 'HEAD', timeout: 3000 });

      if (response.ok) {
        return cdnUrl;
      }
    } catch (error) {
      console.warn('[CDN] Fallback to Vercel direct:', error);
    }
  }

  // 降级到 Vercel 原始域名
  return `https://${sandboxId}.vercel.app`;
}
```

---

## 参考资源

### 官方文档
- [Vercel 自定义域名文档](https://vercel.com/docs/concepts/projects/custom-domains)
- [Cloudflare CDN 文档](https://developers.cloudflare.com/cache/)
- [阿里云 CDN 文档](https://help.aliyun.com/product/27099.html)
- [腾讯云 CDN 文档](https://cloud.tencent.com/document/product/228)

### 社区资源
- [利用阿里云CDN加速Vercel网站](https://blog.csdn.net/weixin_62392149/article/details/135114752)
- [如何提高 Vercel 在国内的访问速度](https://www.cnblogs.com/21yunbox/p/14233870.html)
- [零成本搭建现代博客之优化国内访问速度](https://www.bmpi.dev/dev/guide-to-setup-blog-site-with-zero-cost/5/)

---

**最后更新**: 2025-11-07
**维护人**: Open Lovable Team
**问题反馈**: [GitHub Issues](https://github.com/firecrawl/open-lovable/issues)
