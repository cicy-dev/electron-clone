# Clone 系统完整指南

## 系统架构

### 核心组件

| 组件 | 端口 | 访问方式 | 作用 |
|------|------|----------|------|
| **UI 控制面板** | - | https://g-8834.cicy.de5.net | 双 webview + 同步按钮 |
| **API 服务器** | 8835 | https://g-8835.cicy.de5.net | 同步、mock、资源解析 |
| **Wrangler Dev** | 8787 | https://g-8787.cicy.de5.net | 托管克隆站点静态资源 |
| **mitmproxy** | 8888 | 34.150.15.106:8888 | 流量捕获 + Redis 存储 |
| **Redis** | 6379 | localhost | 流量数据存储 |
| **Vite Dev** | 8834 | localhost | UI 开发（可选）|

### 数据流

```
原站流量 → mitmproxy → Redis → API 同步 → public/ → Wrangler → 克隆站
```

## 快速启动

### GCP（服务端）

```bash
# 1. 启动所有服务
clone start

# 2. 添加 Cloudflare Tunnel
bash ~/skills/cf-tunnel.sh add 8787 8835

# 3. 检查状态
clone status
```

### Linux 本地

```bash
# 启动 Electron
xui 1 electron start \
  --url="https://g-8834.cicy.de5.net/" \
  --port=8101 \
  --proxy=http://127.0.0.1:8888 \
  --no-cache
```

### Mac（有 VPN）

```bash
# 1. 启动本地 mitmproxy（upstream 到 GCP）
mitmdump --mode upstream:http://34.150.15.106:8888 -p 18888 --ssl-insecure &

# 2. 启动 Electron
ENCODED_URL=$(python3 -c "import urllib.parse; print(urllib.parse.quote('https://g-8834.cicy.de5.net/', safe=''))")
xui 1 electron start \
  --url="${ENCODED_URL}" \
  --port=8101 \
  --proxy=http://127.0.0.1:18888 \
  --no-cache
```

**流量链路：** Electron → Mac mitmproxy (18888) → GCP mitmproxy (8888) → Redis

### Windows（未来支持）

```bash
# TODO: Windows 配置
```

## 部署

### UI 部署（Cloudflare Pages）

```bash
cd /home/w3c_offical/workers/w-20130/electron-clone/web
npx vite build
npx wrangler pages deploy dist --project-name=electron-clone --commit-dirty=true
```

### 克隆站点部署（Cloudflare Workers）

```bash
# 使用 clone 命令
clone deploy https://example.com

# 手动部署
cd /home/w3c_offical/workers/w-20130/electron-clone
./deploy-clone.sh https://example.com
cd worker/c-example-com
npx wrangler deploy
```

## 配置说明

### mitmproxy 配置

**GCP (supervisor):**
```ini
[program:mitmdump]
command=/home/w3c_offical/.local/bin/mitmdump -p 8888 --ssl-insecure --set block_global=false -s mitm-redis.py
directory=/home/w3c_offical/Private/workers/w-20130
autostart=true
autorestart=true
```

**关键参数：**
- `--set block_global=false` - 允许远程连接
- `-s mitm-redis.py` - 加载 Redis 存储 addon

### Electron 配置

**必需参数：**
- `--no-cache` - 禁用 HTTP 缓存（必须）
- `--proxy=http://...` - 代理地址

**平台差异：**
- Linux: 直接连 GCP mitmproxy
- Mac (VPN): 需要本地 mitmproxy upstream
- Windows: 待支持

### Cloudflare Tunnel

```bash
# 添加路由
bash ~/skills/cf-tunnel.sh add 8787 8835

# 查看路由
bash ~/skills/cf-tunnel.sh list
```

## 常用命令

```bash
# 服务管理
clone start              # 启动所有服务
clone stop               # 停止所有服务
clone status             # 检查状态
clone logs api           # 查看 API 日志
clone logs wrangler      # 查看 Wrangler 日志

# 部署
clone deploy <url>       # 部署克隆站点
clone ui                 # 打开 UI

# 调试
clone reset              # 重置状态
redis-cli FLUSHALL       # 清空 Redis
```

## 故障排查

### Electron 无法加载

1. 检查代理连接：`curl -x http://proxy:port http://ifconfig.me`
2. 检查证书：Electron 需要 `ignore-certificate-errors`
3. Mac VPN：必须用 upstream proxy

### mitmproxy 连接失败

1. 检查 `block_global=false` 配置
2. 检查防火墙：`gcloud compute firewall-rules list | grep 8888`
3. 检查进程：`sudo supervisorctl status mitmdump`

### 克隆站点无资源

1. 检查 Redis：`redis-cli KEYS "*"`
2. 检查 public/：`ls worker/clone-dev/public/`
3. 重新同步：点击 UI 的"同步"按钮

## 项目结构

```
electron-clone/
├── web/                    # UI 源码
│   └── index.html         # 双 webview 控制面板
├── worker/
│   ├── clone-dev/         # 本地开发
│   │   ├── index.js       # Worker 代码
│   │   └── public/        # 同步的资源
│   └── c-*/               # 部署的克隆站点
├── lib/                   # 核心模块
│   ├── sync.js
│   ├── resource-resolver.js
│   └── domain-rewriter.js
├── server.js              # API 服务器
├── clone                  # CLI 工具
└── docs/                  # 文档
```

## 相关链接

- **UI**: https://g-8834.cicy.de5.net
- **GitHub**: https://github.com/cicy-dev/electron-clone
- **Wrangler**: https://g-8787.cicy.de5.net
- **API**: https://g-8835.cicy.de5.net
