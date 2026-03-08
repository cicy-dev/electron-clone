# CF Workers 一键部署

## 快速开始

```bash
# 1. 克隆网站
node clone.js clone 2 45177.vip

# 2. 部署到 CF Workers
node clone.js deploy 2 45177.vip

# 输出:
# 🌐 https://45177-vip.electron-clone-worker.workers.dev
```

## 首次设置

### 1. 创建 KV 命名空间
```bash
cd ~/projects/electron-clone/worker
wrangler kv:namespace create "CLONE_API_MOCK"
```

复制输出的 `id`，更新 `wrangler.toml`:
```toml
[[kv_namespaces]]
binding = "KV"
id = "YOUR_KV_NAMESPACE_ID_HERE"
```

### 2. 创建 R2 存储桶
```bash
wrangler r2 bucket create clone-sites
```

### 3. 部署 Worker
```bash
wrangler deploy
```

## 工作流程

```
node clone.js clone <win_id> <domain>
  ↓ 捕获 + 构建
C:\Users\Administrator\clone-output\{domain}\
  ├── static/          (静态资源)
  └── api-decrypted/   (API mock)
  
node clone.js deploy <win_id> <domain>
  ↓ 自动上传
CF Workers
  ├── R2: clone-sites/{domain-slug}/*
  └── KV: {domain-slug}:/hall/api/*
  
  ↓ 访问
https://{domain-slug}.electron-clone-worker.workers.dev
```

## 数据存储

### R2 (静态资源)
```
clone-sites/
└── 45177-vip/
    ├── index.html
    ├── normal/js/index-xxx.js
    ├── normal/assets/xxx.css
    └── siteadmin/upload/img/xxx.avif
```

### KV (API mock)
```
Key: "45177-vip:/hall/api/lobby/channel/go/getChannelInfoById/id/1733015/info/channel.json"
Value: {"code":0,"data":{...}}
```

## 自定义域名

### 方案 A: Workers.dev 子域名 (默认)
```
https://45177-vip.electron-clone-worker.workers.dev
```

### 方案 B: 自定义域名
```bash
# 在 CF Dashboard 添加 Workers Route
# 或在 wrangler.toml 添加:
routes = [
  { pattern = "45177-vip.yourdomain.com/*", zone_name = "yourdomain.com" }
]
```

## 成本

免费额度 (每天):
- Workers: 100,000 请求
- R2: 10GB 存储 + 无限读取
- KV: 100,000 读取 + 1,000 写入

单个克隆站点:
- 静态资源: ~50MB (R2)
- API mock: ~1MB (KV)
- 日均请求: ~1,000 (Workers)

**可免费托管 100+ 站点**

## 故障排查

### 问题: wrangler 未安装
```bash
npm install -g wrangler
wrangler login
```

### 问题: KV_NAMESPACE_ID 未配置
编辑 `worker/wrangler.toml`，填入正确的 KV namespace ID

### 问题: R2 bucket 不存在
```bash
wrangler r2 bucket create clone-sites
```

### 问题: 静态资源 404
检查 R2 key 格式: `{domain-slug}/path/to/file`

### 问题: API 返回 404
检查 KV key 格式: `{domain-slug}:/hall/api/...`
