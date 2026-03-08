# CF Workers 一键克隆架构

## 目标
`node clone.js <domain>` → 自动部署到 CF → 返回可访问 URL

## 架构

```
┌─────────────────────────────────────────────────────────┐
│ 1. Capture (Electron CDP)                               │
│    → request-data/win-{id}/map.json                     │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Build (本地处理)                                      │
│    → 下载静态资源                                         │
│    → 解密 API 响应                                        │
│    → Patch 域名配置                                       │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Deploy to CF (自动)                                   │
│    ├─ 静态资源 → R2 Bucket                               │
│    ├─ API mock → KV Store                               │
│    └─ Worker 代码 → CF Workers                           │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 4. 交付                                                  │
│    https://{domain-slug}.clone.yourdomain.com           │
└─────────────────────────────────────────────────────────┘
```

## Worker 代码结构

```javascript
// worker.js - 单个 Worker 处理所有克隆站点
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const site = url.hostname.split('.')[0]; // 45177-vip
    
    // 静态资源 → R2
    if (!url.pathname.startsWith('/hall/api/')) {
      const obj = await env.R2.get(`${site}${url.pathname}`);
      if (obj) return new Response(obj.body, {
        headers: { 'Content-Type': obj.httpMetadata.contentType }
      });
    }
    
    // API → KV
    const key = `${site}:${url.pathname}`;
    const data = await env.KV.get(key);
    if (data) return new Response(data, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    return new Response('Not Found', { status: 404 });
  }
}
```

## 数据存储

### R2 Bucket (静态资源)
```
clone-sites/
├── 45177-vip/
│   ├── index.html
│   ├── normal/js/index-xxx.js
│   ├── normal/assets/xxx.css
│   └── siteadmin/upload/img/xxx.avif
└── another-site/
    └── ...
```

### KV Namespace (API mock)
```
Key: "45177-vip:/hall/api/lobby/channel/go/getChannelInfoById/id/1733015/info/channel.json"
Value: {"code":0,"data":{...}}
```

## 部署流程

```bash
# 1. 克隆 + 构建
node clone.js 45177.vip

# 2. 自动部署 (clone.js 内部调用)
node deploy-cf.js 45177.vip

# 输出:
# ✅ Uploaded 156 files to R2
# ✅ Uploaded 12 API mocks to KV
# ✅ Deployed worker
# 🌐 https://45177-vip.clone.yourdomain.com
```

## deploy-cf.js 实现

```javascript
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

async function deploy(domain) {
  const slug = domain.replace(/\./g, '-');
  const outputDir = `C:\\Users\\Administrator\\clone-output\\${domain}`;
  
  // 1. 上传静态资源到 R2
  console.log('📦 Uploading static files to R2...');
  execSync(`wrangler r2 object put clone-sites/${slug}/index.html --file="${outputDir}/static/index.html"`, {stdio: 'inherit'});
  // ... 批量上传其他文件
  
  // 2. 上传 API mock 到 KV
  console.log('📦 Uploading API mocks to KV...');
  const apiDir = path.join(outputDir, 'api-decrypted');
  for (const file of getAllFiles(apiDir)) {
    const key = `${slug}:${file.replace(apiDir, '').replace(/\\/g, '/')}`;
    const value = fs.readFileSync(file, 'utf8');
    execSync(`wrangler kv:key put --namespace-id=${KV_ID} "${key}" "${value.replace(/"/g, '\\"')}"`, {stdio: 'inherit'});
  }
  
  // 3. 部署 Worker (已存在，无需重复部署)
  console.log('✅ Worker already deployed');
  
  // 4. 添加自定义域名路由 (可选)
  console.log(`🌐 https://${slug}.clone.yourdomain.com`);
}
```

## 域名配置

### 方案 A: 通配符子域名 (推荐)
```
*.clone.yourdomain.com → CNAME → clone-worker.workers.dev
```
Worker 根据 hostname 自动路由到对应站点

### 方案 B: 每个站点独立域名
```
45177-vip.pages.dev
another-site.pages.dev
```
每次部署创建新 Pages 项目

## 成本估算 (免费额度)

| 服务 | 免费额度 | 单站点用量 | 可支持站点数 |
|------|---------|-----------|-------------|
| Workers | 100k req/day | ~1k req/day | 100 站点 |
| R2 | 10GB 存储 | ~50MB | 200 站点 |
| KV | 1GB 存储 | ~1MB | 1000 站点 |

## 优势

1. **零运维** - 无需服务器
2. **全球 CDN** - 自动边缘缓存
3. **按需付费** - 免费额度够用
4. **秒级部署** - wrangler 自动化
5. **多站点** - 单个 Worker 处理所有
6. **可分享** - 公网 HTTPS URL

## 下一步

1. 实现 `deploy-cf.js` 脚本
2. 集成到 `clone.js` 的 deploy 阶段
3. 配置通配符域名
4. 测试完整流程
