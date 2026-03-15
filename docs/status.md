# Clone Studio 状态文档

## 架构

```
Mac Electron (UI: g-8834.cicy.de5.net)
  → A webview (www.bet365.com) → Mac mitmproxy (18888) → GCP mitmproxy (8888) → Redis
  → B webview (g-8787.cicy.de5.net) → Cloudflare Tunnel → Wrangler dev (8787) → public/ + Redis mock API
```

## 已完成 ✅

### 基础设施
- GCP mitmproxy 捕获流量到 Redis（1400+ 条记录）
- Mac mitmproxy upstream 模式转发到 GCP
- Electron 双 webview UI，A/B 并排显示
- Cloudflare Tunnel: g-8835 (API), g-8787 (Wrangler), g-8834.cicy.de5.net (UI)
- Electron webview partition=persist:main，代理已配置

### 数据层
- Redis traffic:queue 存储全量 HTTP/WS 流量
- 大 body (>1K) 存文件 `data/traffic/*.bin`，Redis 存 `file:hash` 引用
- buildIndex 只索引 status=200 的 HTTP 记录
- buildIndex 生成三种 key：完整 URL、origin+pathname、模块名 key（decoded, 去掉版本号前缀）

### 同步
- 手动同步：POST /api/sync 从 Redis 取 HTML 写入 public/index.html
- 自动同步：每 3 秒轮询 Redis 新流量，自动 buildIndex + fetchAndSync
- HTML 注入 XHR/fetch 拦截脚本，把白名单域名请求重写为相对路径
- HTML 注入 window.onerror + setTimeout ping beacon 用于远程调试

### Worker (Wrangler dev)
- 先查 ASSETS binding 返回静态文件（public/）
- 没有则调 mock API 从 Redis 获取资源
- hex decode body 返回正确 Content-Type
- `/__err` 和 `/__ping` beacon 端点用于远程调试
- wrangler.toml 配置 `not_found_handling = "none"` + `binding = "ASSETS"`

### Mock API
- 精确匹配：pathname+search 完全一致
- 模块名匹配：去掉 query 开头数字（1, vs 2,），decodeURIComponent 后比较，去掉 &rt=N 重试参数
- pathname 兜底：仅非 Blob 请求使用

### 验证结果（通过 CDP 远程调试确认）
- B webview JS 正常执行（boot=object, ns_weblib_util=object）
- B webview 成功请求：routingdata ✅, manifest ✅, sports-configuration ✅, rll Blob ✅
- B webview 标题正确显示 "bet365 - 在線體育投注"
- ping beacon 正常回传

## 当前问题 ❌

### P0: buildIndex 变量重复声明导致 API 崩溃
- **文件**: `lib/sync.js` 第 34-37 行
- **原因**: 加 hostname 过滤时重复写了 `const u = new URL(d.url)`
- **修复**: 删掉第二个 `const u` 即可，一行改动

### P1: Blob 模块匹配返回错误内容
- **现象**: B 窗口请求 `brl/7/SL|log/11/|...` Blob 时，返回了 `rll/21/` 的内容，导致 bootjs 重试 5 次后放弃
- **根因**: mitmproxy 捕获了 B 窗口对 g-8787 的请求（错误的 200 响应），这些 entry 在 buildIndex 时覆盖了 www.bet365.com 的正确 entry
- **修复**: buildIndex 过滤掉 hostname 含 g-8787/g-8835 的记录（已写代码，被 P0 阻塞）

### P2: Electron 启动参数 `&` 被 shell 截断
- **现象**: `ssh ssh_mac_ton "xui ... --url='...&urlB=...'"` 中 `&` 被 shell 解释
- **解决方案**: 把 `&` 编码为 `%26` 传给 xui，xui 会 decode 后传给 Electron
- **正确命令**:
  ```bash
  ssh ssh_mac_ton "~/.local/bin/xui 1 electron restart '--url=https://g-8834.cicy.de5.net/?urlA=https%3A%2F%2Fwww.bet365.com%2F%26urlB=https%3A%2F%2Fg-8787.cicy.de5.net' --port=8101 --proxy=http://127.0.0.1:18888 --no-cache"
  ```

### P3: B 窗口只加载了第一批资源，后续 Blob 模块未加载
- **现象**: rll Blob 加载成功，但 brl 等后续 Blob 失败，UI 只显示 preloader 背景色
- **依赖**: P0 + P1 修复后应自动解决

### P4: Wrangler 偶发 500
- **现象**: public/ 文件写入时 Wrangler 偶尔返回 500 Internal Server Error
- **优先级**: 低，不影响主流程

## 关键文件

| 文件 | 作用 |
|------|------|
| `lib/sync.js` | buildIndex, fetchAndSync, getBody, lookup |
| `server.js` | API 服务: /api/sync, /api/mock, /api/status, 自动同步轮询 |
| `worker/clone-dev/index.js` | Wrangler worker: ASSETS → mock API fallback |
| `worker/clone-dev/wrangler.toml` | assets binding + not_found_handling=none |
| `lib/domain-rewriter.js` | 域名替换（当前未使用，改用注入拦截脚本） |
| `web/index.html` | UI 控制面板，双 webview |
| `config/default.json` | 白名单域名、端口、路径配置 |

## 下一步

1. 修 P0（删重复 `const u`）→ 修 P1（过滤 g-8787 数据）→ 重启 API → 刷新 Electron → 验证 B 窗口所有 Blob 加载
2. 确认 B 窗口 UI 渲染后，分析剩余缺失资源（CSS/图片/字体等）
3. API 重建方案：用 Worker 直接从 Redis 返回资源，不经过 Node.js mock API 中转
