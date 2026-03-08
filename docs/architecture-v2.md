# electron-clone v2 架构设计

## 概述

通用的网站克隆系统。基于 mitmproxy + Redis 捕获的流量，在本地 Wrangler dev 环境重建任意网站的 1:1 克隆。不绑定任何特定站点，白名单域名、域名替换规则均为动态配置。

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                    Electron 双窗口                        │
│                                                         │
│  ┌──────────────┐          ┌──────────────────────┐     │
│  │   A (源站)    │          │   B (克隆站)          │     │
│  │  via mitmproxy│          │  via Wrangler dev    │     │
│  │  port 8888   │          │  port 8787           │     │
│  └──────┬───────┘          └──────────┬───────────┘     │
│         │                             │                 │
└─────────┼─────────────────────────────┼─────────────────┘
          │                             │
          ▼                             ▼
┌──────────────────┐          ┌──────────────────────┐
│   mitmproxy      │          │   Wrangler dev       │
│   捕获 HTTP/WS   │          │   托管克隆站          │
│   注入 JS hook   │          │   - static → public/ │
│        │         │          │   - API → Redis mock │
│        ▼         │          └──────────┬───────────┘
│   redis-http     │                     │
│   port 6380      │                     │
│        │         │                     │
│        ▼         │                     │
│     Redis        │◄────────────────────┘
│   (流量存储)      │     API mock 读取
└──────────────────┘
```

## 核心流程

### 同步流程（点击"同步"按钮）

```
1. 从 mitmproxy/Redis 获取 A 的 HTML
2. 写入 Wrangler 项目 public/index.html
3. B 浏览器加载克隆页面
4. 监听 B 的 console error（通过 Electron exec_js）
5. 解析 error → 提取缺失资源 URL
6. 过滤：白名单域名 → 处理，非白名单 → 忽略
7. 从 Redis 拉取资源 body → 写到 public/
8. 对 HTML/JS/CSS 做域名替换（远程域名 → 本地路径）
9. API 请求 → Wrangler worker 从 Redis mock 返回
10. 循环 4-8 直到无资源报错
```

### 域名替换

游戏资源分布在多个域名（主域名、CDN、static server 等），下载到本地后需统一替换：

```
替换前: https://cdn.example.com/js/app.js
替换后: /js/app.js

替换前: https://static.example.com/img/logo.png
替换后: /img/logo.png
```

替换范围：
- HTML 文件中的 src/href
- JS 文件中的 URL 字符串
- CSS 文件中的 url()

### 白名单域名

只处理白名单内的域名，忽略第三方服务：

```json
{
  "whitelist": [
    "example.com",
    "cdn.example.com",
    "static.example.com",
    "api.example.com"
  ],
  "blacklist_examples": [
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.net",
    "doubleclick.net"
  ]
}
```

白名单同时作用于：
- 资源文件下载（console error 解析后过滤）
- API mock（只 mock 白名单域名的 API）
- 域名替换（只替换白名单域名）

## 目录结构（重构后）

```
electron-clone/
├── web/
│   └── index.html              # 控制面板 UI（双窗口 + 同步按钮）
├── worker/
│   └── clone-dev/              # Wrangler dev 项目
│       ├── wrangler.toml
│       ├── index.js            # Worker: static + API mock from Redis
│       └── public/             # 同步过来的静态资源
│           ├── index.html      # A 的 HTML（域名已替换）
│           ├── js/
│           ├── css/
│           └── img/
├── lib/
│   ├── sync.js                 # 同步逻辑：HTML 拉取 + 写入
│   ├── resource-resolver.js    # console error 解析 + Redis 资源拉取
│   ├── domain-rewriter.js      # 域名替换
│   └── config.js               # 白名单 + 项目配置
├── config/
│   └── default.json            # 默认配置（白名单、端口等）
├── docs/
│   ├── architecture-v2.md      # 本文档
│   └── ...
└── README.md
```

## 组件职责

### 1. 控制面板 UI (`web/index.html`)

- 左右双窗口：A（源站）/ B（克隆站）
- 顶部工具栏：
  - URL 输入
  - **同步按钮** — 触发完整同步流程
  - 白名单管理
  - 状态指示（同步中/完成/错误数）
- 现代化 UI 设计

### 2. Wrangler Worker (`worker/clone-dev/index.js`)

- 静态资源：从 `public/` 目录返回
- API 请求：通用匹配，从 Redis 读取捕获的响应返回（按 URL path 查找）
- 不硬编码任何特定站点的路径前缀

### 3. 同步模块 (`lib/sync.js`)

- 从 Redis 获取 A 页面的 HTML
- 域名替换后写入 `public/index.html`
- 触发 Wrangler 热更新

### 4. 资源解析器 (`lib/resource-resolver.js`)

- 通过 Electron exec_js 获取 B 的 console error
- 解析 404/加载失败的资源 URL
- 过滤白名单
- 从 Redis 拉取资源 body
- 写入 `public/` 对应路径

### 5. 域名重写器 (`lib/domain-rewriter.js`)

- 扫描 HTML/JS/CSS 文件
- 将白名单域名的绝对 URL 替换为相对路径
- 支持多域名映射

## Redis 数据格式（已有）

```json
{
  "type": "http",
  "url": "https://cdn.example.com/js/app.js",
  "body": "file:abc123",
  "ts": 1772897554.81
}
```

- `body` 为 `file:hash` 时，实际内容存在 Redis key `file:hash` 中
- `body` 为 `hex` 时，直接是 hex 编码的内容

## Wrangler Worker 逻辑

```
请求进入
  ├── 匹配 public/ 静态文件 → 直接返回
  ├── 未匹配静态文件 → Redis 查询（按完整 URL path）→ 返回 mock
  └── Redis 也没有 → 404
```

Worker 不区分"资源"和"API"，统一逻辑：先查 public/ 本地文件，没有就查 Redis。白名单过滤在同步阶段完成，Worker 本身是通用的。

## 配置文件 (`config/default.json`)

```json
{
  "whitelist_domains": [],
  "wrangler_port": 8787,
  "redis_host": "localhost",
  "redis_port": 6379,
  "mitmproxy_port": 8888,
  "auto_resolve_resources": true
}
```

## 与现有系统的关系

- **mitmproxy + redis-http** — 上游，负责捕获流量到 Redis（不变）
- **electron-clone v2** — 下游，从 Redis 读取数据重建克隆站
- **Electron MCP** — 提供双窗口环境 + console error 获取能力
