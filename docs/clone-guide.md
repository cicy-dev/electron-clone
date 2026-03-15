# 网站克隆工具完整技术文档

## 目标

将任意网站的前端 + 后端 API 响应完整捕获，生成一个可在本地运行的克隆站点，并支持自定义修改页面内容（标题、图片、链接、主题色等）。

本文以 `https://45177.vip/normal/?cid=1733015`（Vue SPA + AES 加密 API）为实战案例。

---

## 架构概览

```
┌─────────────────────────────────────────────────────┐
│  Electron MCP (Windows)                             │
│  ├── Window A: 源站 https://45177.vip/...           │
│  │   └── CDP request capture → request-data/win-A/  │
│  ├── Window B: 克隆站 http://localhost:3210/...     │
│  └── MCP Server :8101 (控制接口)                     │
├─────────────────────────────────────────────────────┤
│  Clone Server (Express :3210)                       │
│  ├── static/          → 静态文件 (HTML/JS/CSS/IMG)  │
│  ├── api-decrypted/   → 解密后的 API JSON (可编辑)  │
│  ├── api-mock/        → 原始加密 API 响应 (备份)    │
│  └── server.js        → 路由: 静态 + API + SPA回退  │
└─────────────────────────────────────────────────────┘
```

---

## 完整流程

### Phase 1: 捕获 (Capture)

#### 1.1 打开源站窗口

```bash
ELECTRON_MCP_NODE=1 cicy-rpc open_window url=https://45177.vip/normal/?cid=1733015
# 返回 window ID，例如 win_id=6
```

Electron MCP 的 CDP request capture 会自动记录该窗口的所有网络请求到：
```
C:\Users\Administrator\request-data\win-6\map.json
```

`map.json` 结构：每个请求一个条目，包含 URL、method、response headers、response body（base64）。

#### 1.2 捕获 index.html

由于 SPA 的 index.html 是服务端渲染后的完整 DOM（包含内联数据），需要用 `exec_js` 获取实际 HTML：

```bash
ELECTRON_MCP_NODE=1 cicy-rpc exec_js win_id=6 \
  code="document.documentElement.outerHTML"
```

保存为 `static/index.html`。

### Phase 2: 构建 (Build)

#### 2.1 从 map.json 提取资源

`clone.js build` 命令读取 `map.json`，执行：

1. **分类请求**：按 URL 路径分为静态文件和 API 响应
2. **提取 response body**：base64 解码，写入对应目录
   - 静态文件 → `static/` (保持原始路径结构)
   - API 响应 → `api-mock/` (保持 API 路径结构)
3. **URL 重写**：将 `index.html` 中的绝对 URL (`https://45177.vip/...`) 改为相对路径 (`./...`)
4. **生成 missing.json**：列出有 response header 但无 body 的文件（需要单独下载）
5. **生成 server.js**：Express 服务器，包含所有 API 路由
6. **生成 package.json**：依赖 express + crypto-js

#### 2.2 下载缺失文件

CDP capture 有时只记录 headers 不记录 body（大文件或缓存命中）。用 `dl-missing.js` 补全：

```bash
cd clone-output/45177.vip && node dl-missing.js
```

从源站 HTTPS 下载 `missing.json` 中列出的文件到 `static/` 对应路径。

本案例缺失 10 个核心文件：vue-core、crypto、polyfills、vant 等 JS/CSS 库。

### Phase 3: 破解加密 (Decrypt)

#### 3.1 发现加密机制

所有 API 响应都是 AES 加密的 Base64 字符串。通过分析 `index-Bd0I69FQ.js` 找到解密函数 `de()`：

```javascript
// 原始代码（混淆后）
function de(t) {
  let e = yt.parse("thanks,pig4cloud"),  // AES key
      n = yt.parse(""),                   // IV (空)
      o = Ie.parse(t),                    // Base64 decode
      s = Ie.stringify(o),
      r = Be.decrypt(s, e, {
        iv: n,
        mode: Eo,      // ECB
        padding: xo    // Pkcs7
      }).toString(yt);  // UTF8
  return JSON.parse(r);
}
window.cryptoDecrypt = de;  // 全局暴露
```

**加密参数：**
| 参数 | 值 |
|------|-----|
| 算法 | AES |
| Key | `thanks,pig4cloud` (UTF8) |
| IV | 空字符串 |
| Mode | ECB |
| Padding | Pkcs7 |
| 编码 | Base64 输入，UTF8 输出 |

#### 3.2 批量解密 API 响应

`decrypt.js` — 遍历 `api-mock/` 目录，解密每个文件，输出到 `api-decrypted/`：

```bash
cd clone-output/45177.vip && node decrypt.js
```

解密后得到 2 个 API 的明文 JSON：
- `getChannelInfoById` — 渠道配置（语言、货币、模板 ID）
- `getDownloadTemplate` — 完整页面模板（标题、主题、模块、下载链接、footer 等）

#### 3.3 解密 config_data.json

`static/cocos/config_data.json` 也是加密的，包含站点域名配置：

```bash
node decrypt-config.js  # 解密 config_data.json
node patch-config.js    # 将所有域名替换为 localhost:3210
```

### Phase 4: 域名劫持 (Domain Override)

这是最关键也最复杂的一步。前端有多层域名配置加载机制。

#### 4.1 前端配置加载流程

```
index.html 加载
  ↓
<script> 解析内联 base64 → window.LOBBY_SITE_CONFIG
  ↓ (包含 INJECT_DATA.ossGetSiteUrlConfig = 加密的域名列表)
  ↓
Vue app 启动
  ↓
读取 LOBBY_SITE_CONFIG.INJECT_DATA.ossGetSiteUrlConfig
  ↓
解密 → 得到 api_domain[], oss_domain[], lobby_domain[] 等
  ↓
对每组域名做速度测试 (ipacdn.txt / bewcdn.txt / ssocdn.txt)
  ↓
选出最快的域名作为 API 基础 URL
  ↓
所有后续 API 请求发往该域名
```

#### 4.2 内联 base64 配置结构

`index.html` 中有一段关键脚本：

```javascript
var J = decodeURIComponent(window.atob("JTdCJTIy..."));
// J 解码后是一个巨大的 JSON 对象 (LOBBY_SITE_CONFIG)
// 包含: siteName, title, siteCode, OSS_MODE, INJECT_DATA 等
// INJECT_DATA.ossGetSiteUrlConfig.data.data = AES加密的域名配置
```

解密 `ossGetSiteUrlConfig` 后得到：

```json
{
  "api_domain": ["https://xxx.nnsti.com", "https://153.43.11.20", ...],
  "oss_domain": ["https://bot65a6f.k1980vtrm.top:5002", ...],
  "lobby_domain": [...],
  "download_domain": [...],
  "web_domain": [...],
  "h5_domain": [...],
  "combo_domain": [...],
  "hotfix_domain": [...],
  "commonOssBucket": "https://sweykpro.pubs3static.com",
  "tg_domain": {"botId": "...", "tgDomain": "https://..."},
  ...
}
```

#### 4.3 patch-inline.js — 修改内联域名配置

核心操作：
1. 从 index.html 提取 base64 编码的 `LOBBY_SITE_CONFIG`
2. 解码 → JSON 对象
3. 解密 `INJECT_DATA.ossGetSiteUrlConfig.data.data`
4. 将所有域名数组替换为 `["http://localhost:3210"]`
5. 重新加密域名配置
6. 重新编码为 base64，替换回 index.html

```bash
node patch-inline.js static/index.html
```

#### 4.4 index.html 内置的 URL 替换

index.html 还有一段自动 URL 替换逻辑：

```javascript
// 将 OSS 域名替换为 location.origin
var U = "ntvpog-2698-ppp.oss-accelerate.aliyuncs.com";
var M = new RegExp("https?://" + U, "g");
J = J.replace(M, location.origin);
```

这意味着当页面在 `localhost:3210` 运行时，所有 OSS 图片 URL 会自动指向本地服务器。这是前端自带的功能，对我们有利。

#### 4.5 速度测试文件

前端会对域名列表做速度测试，请求以下文件：

```
/siteadmin/ssocdn.txt  → 测试 api_domain
/ipacdn.txt            → 测试 web_domain / h5_domain
/bewcdn.txt            → 测试 oss_domain / lobby_domain
/normal/dscdn.txt      → 测试 download_domain
```

需要在 `static/` 对应路径创建这些文件，内容为 `ok`：

```bash
echo ok > static/siteadmin/ssocdn.txt
echo ok > static/ipacdn.txt
echo ok > static/bewcdn.txt
echo ok > static/normal/dscdn.txt
```

#### 4.6 禁用 Service Worker

前端注册了 SW 用于缓存，会干扰本地开发。放置空文件：

```bash
echo "" > static/normal/sw.js
```

### Phase 5: 自定义内容 (Customize)

#### 5.1 API 响应的 fallback 机制

前端的 `cryptoDecrypt()` 函数有 try/catch：

```javascript
function de(t) {
  try {
    // AES 解密 + JSON.parse
    return JSON.parse(decryptedText);
  } catch(e) {
    // 解密失败时，直接 JSON.parse 原始输入
    return JSON.parse(t);
  }
}
```

这意味着：**server 可以直接返回明文 JSON**，前端会自动 fallback 处理。无需重新加密。

#### 5.2 server.js 路由逻辑

```javascript
// 优先返回 api-decrypted/ (明文JSON)，否则返回 api-mock/ (加密原文)
const dec = path.join(__dirname, 'api-decrypted', r.file);
const raw = path.join(__dirname, 'api-mock', r.file);
const f = fs.existsSync(dec) ? dec : raw;
```

#### 5.3 可编辑字段

编辑 `api-decrypted/hall/api/agent/downloadSite/getDownloadTemplate/tid/4501163.json`：

| 字段路径 | 作用 | 示例值 |
|----------|------|--------|
| `data.template.pageSetting.titleMark` | 页面标题 | "My Custom Site" |
| `data.template.pageSetting.ico` | Favicon URL | "/favicon.ico" |
| `data.template.themeColor` | 主题色 | "rgba(0,50,100,1)" |
| `data.template.downloadPageContentVOS[].formData.picList` | Banner 图片 | 图片路径数组 |
| `data.template.footerConfig` | 底部栏配置 | 按钮文字、颜色等 |
| `data.template.websiteTitleStyleVOS` | 顶部标题栏 | 样式配置 |

编辑 `api-decrypted/hall/api/lobby/channel/go/getChannelInfoById/id/1733015/info/channel.json`：

| 字段路径 | 作用 |
|----------|------|
| `data.languageCode` | 默认语言 |
| `data.currencyCode` | 默认货币 |

#### 5.4 修改页面标题

标题来自两个地方，都需要修改：

1. **API 响应**：`getDownloadTemplate` 的 `titleMark` 字段
2. **index.html 内联配置**：`LOBBY_SITE_CONFIG.title` 和 `<title>` 标签

`patch-title.js` 一次性处理所有标题相关字段：

```bash
node patch-title.js static/index.html
# 修改: <title>, og:title, twitter:title, LOBBY_SITE_CONFIG.title, .siteName
```

#### 5.5 替换图片

直接替换 `static/siteadmin/upload/img/` 下的 `.avif` 文件即可。保持文件名不变，或修改 `getDownloadTemplate` JSON 中的图片路径。

### Phase 6: 运行

```bash
cd clone-output/45177.vip
npm install          # 安装 express + crypto-js
node server.js       # 启动 http://localhost:3210
```

访问 `http://localhost:3210/normal/?cid=1733015` 即可看到克隆站点。

---

## 目录结构

```
clone-output/45177.vip/
├── static/                          # 静态文件根目录 (Express static)
│   ├── index.html                   # 主页 (含内联 base64 配置，已 patch)
│   ├── cocos/config_data.json       # 站点域名配置 (已解密+patch)
│   ├── normal/
│   │   ├── js/                      # Vue 打包产物
│   │   │   ├── index-Bd0I69FQ.js    # 主 bundle (含 cryptoDecrypt)
│   │   │   ├── vue-core-CG8P7S6d.js
│   │   │   ├── crypto-BgUpi7_6.js   # CryptoJS
│   │   │   ├── vue-ecosystem-FwATy-Od.js
│   │   │   ├── utils-DP5omx3I.js
│   │   │   ├── vant-lYLyX3cy.js     # Vant UI
│   │   │   ├── zh-jMNo120K.js       # 中文语言包
│   │   │   └── ...
│   │   ├── assets/                  # CSS 文件
│   │   ├── sw.js                    # 空文件 (禁用 Service Worker)
│   │   └── dscdn.txt                # 速度测试文件
│   ├── siteadmin/
│   │   ├── upload/img/*.avif        # 11 张页面图片
│   │   └── ssocdn.txt               # 速度测试文件
│   ├── ipacdn.txt                   # 速度测试文件
│   └── bewcdn.txt                   # 速度测试文件
│
├── api-mock/                        # 原始加密 API 响应 (备份)
│   └── hall/api/
│       ├── agent/downloadSite/getDownloadTemplate/tid/4501163.json
│       └── lobby/channel/go/getChannelInfoById/id/1733015/info/channel.json
│
├── api-decrypted/                   # ★ 解密后的 API JSON (编辑这里!)
│   └── hall/api/
│       ├── agent/downloadSite/getDownloadTemplate/tid/4501163.json
│       └── lobby/channel/go/getChannelInfoById/id/1733015/info/channel.json
│
├── server.js                        # Express 服务器
├── package.json                     # 依赖: express, crypto-js
├── decrypt.js                       # 批量解密 api-mock → api-decrypted
├── decrypt-config.js                # 解密 config_data.json
├── patch-config.js                  # 替换 config_data.json 中的域名
├── patch-inline.js                  # ★ 修改 index.html 内联域名配置
├── patch-title.js                   # ★ 修改页面标题
└── missing.json                     # 需要额外下载的文件列表
```

---

## 工具脚本说明

| 脚本 | 用途 | 运行时机 |
|------|------|----------|
| `decrypt.js` | 解密 `api-mock/` → `api-decrypted/` | build 后运行一次 |
| `decrypt-config.js` | 解密 `static/cocos/config_data.json` | build 后运行一次 |
| `patch-config.js` | 替换 config_data.json 域名为 localhost | decrypt-config 后 |
| `patch-inline.js` | 修改 index.html 内联 base64 中的域名配置 | build 后运行一次 |
| `patch-title.js` | 修改 `<title>` 和内联配置中的标题 | 需要改标题时 |
| `server.js` | Express 本地服务器 | 运行克隆站 |

---

## 关键技术难点与解决方案

### 1. API 响应全加密

**问题**：所有 API 返回 AES-ECB 加密的 Base64 字符串，无法直接读取或修改。

**解决**：逆向 `index-Bd0I69FQ.js` 找到 `de()` 函数，提取 key (`thanks,pig4cloud`)、mode (ECB)、padding (Pkcs7)。用 `crypto-js` 批量解密。

### 2. 域名配置多层嵌套

**问题**：前端从 `LOBBY_SITE_CONFIG.INJECT_DATA.ossGetSiteUrlConfig` 读取域名列表（加密的），然后做速度测试选最快的。修改 `config_data.json` 无效，因为前端优先用内联数据。

**解决**：`patch-inline.js` 直接修改 index.html 中的 base64 编码内联数据，解密 → 替换域名 → 重新加密 → 重新编码回 base64。

### 3. 明文 JSON 兼容性

**问题**：前端期望加密的 API 响应，直接返回明文会不会报错？

**解决**：`cryptoDecrypt()` 有 try/catch fallback — AES 解密明文会失败，catch 里直接 `JSON.parse(t)` 处理明文。所以 server 可以直接返回明文 JSON，无需重新加密。

### 4. Service Worker 缓存干扰

**问题**：前端注册了 SW，会缓存请求，导致修改不生效。

**解决**：放置空的 `sw.js`，SW 注册后不会拦截任何请求。

### 5. 速度测试请求外泄

**问题**：即使域名配置改为 localhost，前端仍会对原始域名列表做速度测试（`ipacdn.txt`、`bewcdn.txt`）。

**解决**：这些请求不影响功能，只是测速。在 `static/` 放置对应文件让 localhost 的测速最快即可。外泄的测速请求会超时失败，不影响页面渲染。

### 6. index.html 内置 URL 替换

**发现**：index.html 的内联脚本会自动将 OSS 域名 (`ntvpog-2698-ppp.oss-accelerate.aliyuncs.com`) 替换为 `location.origin`。这意味着在 localhost 运行时，所有 OSS 图片 URL 自动指向本地。这是前端自带的功能，无需额外处理。

---

## 快速自定义指南

### 改标题
```bash
# 1. 编辑 API JSON
# 修改 api-decrypted/.../getDownloadTemplate/.../4501163.json
# 字段: data.template.pageSetting.titleMark

# 2. 修改 index.html 内联标题
node patch-title.js static/index.html
# (需要在脚本中修改 newTitle 变量)

# 3. 刷新页面
```

### 改主题色
```bash
# 编辑 api-decrypted/.../getDownloadTemplate/.../4501163.json
# 字段: data.template.themeColor
# 值: "rgba(R,G,B,A)" 格式
```

### 改 Banner 图片
```bash
# 1. 将新图片放入 static/siteadmin/upload/img/
# 2. 编辑 getDownloadTemplate JSON 中的图片路径
# 或直接替换同名文件
```

### 改下载链接
```bash
# 编辑 api-decrypted/.../getDownloadTemplate/.../4501163.json
# 字段: data.downloadList[].value
```

### 改 Footer 按钮文字
```bash
# 编辑 getDownloadTemplate JSON
# 字段: data.template.footerConfig.downloadToWeb.textContent
```
