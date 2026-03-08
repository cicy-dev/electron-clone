# electron-clone v2

通用网站克隆系统。基于 mitmproxy + Redis 捕获的流量，本地 Wrangler dev 重建任意网站的 1:1 克隆。

## 架构

```
A (源站 via mitmproxy) → Redis ← Wrangler Worker (API mock)
                           ↓
                     B (克隆站 via Wrangler dev)
                           ↓
                   console error → 自动拉取缺失资源 → public/
```

## 核心功能

1. **同步按钮** — 把 A 的 HTML 同步到 Wrangler 项目
2. **资源自动补全** — 解析 B 的 console error，从 Redis 拉取缺失资源到 `public/`
3. **域名替换** — 多域名（CDN/static）统一替换为本地路径
4. **API Mock** — Wrangler worker 从 Redis 返回捕获的 API 响应
5. **白名单** — 只处理白名单域名，忽略 Google Analytics 等第三方

## 项目结构

```
electron-clone/
├── web/index.html              # 控制面板 UI（双窗口 + 同步按钮）
├── worker/clone-dev/           # Wrangler dev 项目
│   ├── index.js                # Worker: static + API mock
│   ├── wrangler.toml
│   └── public/                 # 同步的静态资源
├── lib/
│   ├── sync.js                 # 同步逻辑
│   ├── resource-resolver.js    # console error 解析 + 资源拉取
│   ├── domain-rewriter.js      # 域名替换
│   └── config.js               # 配置管理
├── config/default.json         # 白名单、端口配置
└── docs/
```

## 同步流程

```
点击"同步"
→ Redis 获取 A 的 HTML → 域名替换 → public/index.html
→ B 加载页面 → console error
→ 解析缺失 URL → 白名单过滤
→ Redis 拉取资源 → public/
→ 循环直到无报错
```

## 启动

```bash
# 1. Wrangler dev（常驻）
cd worker/clone-dev && npx wrangler dev

# 2. 控制面板
# 在 Electron 中打开 web/index.html
```

## 配置

`config/default.json`:
```json
{
  "whitelist_domains": ["example.com", "cdn.example.com"],
  "wrangler_port": 8787,
  "redis_host": "localhost",
  "redis_port": 6379
}
```

## 文档

- [架构设计 v2](docs/architecture-v2.md)
