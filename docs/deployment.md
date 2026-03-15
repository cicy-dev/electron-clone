# Clone Studio 部署规范

## 项目命名规范

**严格遵守以下命名，不得随意创建新项目：**

### Cloudflare Pages 项目（UI）
- **项目名**: `electron-clone` （已存在，不要改）
- **自定义域名**: `g-8834.cicy.de5.net` （已绑定，不要改）
- **主域名**: `electron-clone.pages.dev`

### Cloudflare Workers 项目（克隆站点）
- **命名规则**: `c-<domain>` （域名中的 `.` 替换为 `-`）
- **示例**: 
  - `45177.vip` → `c-45177-vip`
  - `example.com` → `c-example-com`
- **访问地址**: `https://c-<domain>.ob6ha3.workers.dev`

### 本地项目
- **项目目录**: `/home/w3c_offical/workers/w-20130/electron-clone`
- **Tmux session**: `w-20130`
- **Tmux panes**: `api`, `wrangler`, `vite`

### 端口分配
- **8835**: API 服务器 (`server.js`)
- **8787**: Wrangler dev (本地开发)
- **8834**: Vite dev (UI 开发)

## 部署流程

### 1. 部署 UI（控制面板）
```bash
cd /home/w3c_offical/workers/w-20130/electron-clone/web
npx vite build
npx wrangler pages deploy dist --project-name=electron-clone --commit-dirty=true
```

访问: https://g-8834.cicy.de5.net

### 2. 部署克隆站点（独立 Worker）
```bash
cd /home/w3c_offical/workers/w-20130/electron-clone

# 1. 创建 Worker 配置
./deploy-clone.sh https://45177.vip

# 2. 同步资源（通过 UI 或 API）
curl -X POST http://localhost:8835/api/sync \
  -H "Content-Type: application/json" \
  -d '{"url":"https://45177.vip/normal/?cid=1733015"}'

# 3. 复制资源到 Worker 目录
cp -r worker/clone-dev/public/* worker/c-45177-vip/public/

# 4. 部署到 Cloudflare Workers
cd worker/c-45177-vip
npx wrangler deploy
```

访问: https://c-45177-vip.ob6ha3.workers.dev

## 禁止操作

❌ **不要创建新的 Pages 项目**（如 `clone-studio`）
❌ **不要修改项目名称**（保持 `electron-clone`）
❌ **不要修改自定义域名**（保持 `g-8834.cicy.de5.net`）
❌ **不要修改 tmux session 名称**（保持 `w-20130`）
❌ **不要在 wrangler.toml 中配置 routes**（只需要 name）
❌ **不要提交 public/ 目录到 git**（已在 .gitignore）

## 快速命令

```bash
# 启动所有服务
clone start

# 部署 UI
cd /home/w3c_offical/workers/w-20130/electron-clone/web
npx vite build && npx wrangler pages deploy dist --project-name=electron-clone --commit-dirty=true

# 部署克隆站点
clone deploy https://example.com

# 检查服务状态
clone status

# 查看日志
clone logs api
clone logs wrangler
clone logs vite
```

## 文件结构

```
/home/w3c_offical/workers/w-20130/electron-clone/
├── server.js              # API 服务器 (端口 8835)
├── start.sh               # 一键启动所有服务
├── clone                  # clone 命令行工具 (→ ~/.local/bin/clone)
├── deploy-clone.sh        # 克隆站点部署脚本
├── .gitignore             # Git 忽略规则
├── config/
│   └── default.json       # 配置文件（白名单、并发数）
├── lib/                   # 核心模块
│   ├── sync.js            # Redis 同步 + HTML 处理
│   ├── resource-resolver.js  # 资源解析 + 并发下载
│   ├── domain-rewriter.js    # 域名替换
│   └── config.js          # 配置管理
├── worker/
│   ├── clone-dev/         # 本地开发（不部署）
│   │   ├── index.js       # Worker 代码
│   │   ├── wrangler.toml  # Wrangler 配置
│   │   └── public/        # 同步的资源（不提交 git）
│   ├── c-45177-vip/       # 生产 Worker（部署）
│   │   ├── index.js
│   │   ├── wrangler.toml
│   │   └── public/        # 复制自 clone-dev/public/
│   └── c-example-com/     # 其他克隆站点...
├── web/                   # UI 项目
│   ├── index.html         # 控制面板 UI（双 webview + 同步）

## Electron 使用说明

### 启动 Electron（禁用缓存）

Clone 项目需要禁用 HTTP 缓存以确保实时同步，使用 `--no-cache` 参数：

```bash
# Linux 启动 Electron（禁用缓存）
xui 1 electron start --url="http://localhost:8834/" --port=8101 --no-cache

# 如果需要代理监控流量
xui 1 electron start --url="http://localhost:8834/" --port=8101 --proxy=http://127.0.0.1:8888 --no-cache
```

### Mac 启动（需要 upstream proxy）

Mac 如果有 VPN，不能直接连远程代理，需要本地 mitmproxy upstream：

```bash
# 1. Mac 启动本地 mitmproxy（upstream 到 GCP）
GCP_IP=34.150.15.106
mitmdump --mode upstream:http://${GCP_IP}:8888 -p 18888 --ssl-insecure &

# 2. 启动 Electron
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('https://g-8834.cicy.de5.net/', safe=''))")
xui 1 electron start --url="${ENCODED_URL}" --port=8101 --proxy=http://127.0.0.1:18888 --no-cache
```

**流量链路：**
```
Electron → Mac mitmproxy (127.0.0.1:18888) → GCP mitmproxy (34.150.15.106:8888) → Redis
```

### 为什么需要 --no-cache？

- Clone 系统依赖实时从 Redis 获取最新资源
- 浏览器缓存会导致资源不更新
- `--no-cache` 确保每次都从服务器获取最新内容

### 流量监控（可选）

如果需要监控 Electron 的网络流量：

1. 启动 mitmproxy：
```bash
mitmdump -p 8888 --ssl-insecure --set block_global=false -s mitm-redis.py
```

2. 启动 Electron 并配置代理：
```bash
xui 1 electron start --url="http://localhost:8834/" --port=8101 --proxy=http://127.0.0.1:8888 --no-cache
```

3. 所有 HTTP/HTTPS 流量会经过 mitmproxy 并存入 Redis
│   ├── dist/              # 构建产物（不提交 git）
│   ├── vite.config.js
│   └── package.json
└── docs/
    ├── architecture-v2.md
    └── deployment.md      # 本文件
```

## 域名访问

### UI（控制面板）
- **生产环境**: https://g-8834.cicy.de5.net
- **开发环境**: http://localhost:8834

### 克隆站点
- **生产环境**: https://c-<domain>.ob6ha3.workers.dev
- **开发环境**: http://localhost:8787

## 注意事项

1. UI 部署前必须先 `npx vite build`
2. UI 部署时必须指定 `--project-name=electron-clone`
3. 克隆站点每个域名独立 Worker，命名规则 `c-<domain>`
4. Worker 不需要配置 routes，只需要正确的 name
5. `public/` 目录不提交 git，每次部署前从 `clone-dev/public/` 复制
6. 如果有未提交的 git 更改，加 `--commit-dirty=true`

## Electron 流量监控

通过 mitmproxy 监控 Electron 流量：

```bash
# 1. 启动 mitmproxy
mitmdump -p 8888 --ssl-insecure -s mitm-redis.py

# 2. 启动 Electron 并配置代理
xui 1 electron start --url=http://localhost:8834/ --port=8101 --proxy=http://127.0.0.1:8888

# 3. Electron 的所有流量会经过 mitmproxy 并存入 Redis
```

**注意：** Electron MCP 需要 v1.1.0+ 版本才支持 `--proxy` 参数。
