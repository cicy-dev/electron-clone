E # electron-clone 多站点架构设计

## 总体架构

```
electron-clone/                     # 工具仓库 (Linux 开发机)
├── clone.js                        # 核心 CLI: capture / build / clone
├── lib/
│   ├── crypto.js                   # 通用加解密 (AES-ECB 等)
│   ├── patch.js                    # 通用 patch 工具 (域名替换、base64 内联修改)
│   └── server-template.js          # server.js 模板生成器
├── sites/                          # ★ 每个站点的配置 (版本管理)
│   ├── 45177.vip/
│   │   └── site.json               # 站点专属配置
│   ├── example.com/
│   │   └── site.json
│   └── ...
├── docs/
│   ├── architecture.md             # 本文档
│   └── clone-guide.md              # 操作指南
└── package.json

clone-output/                       # 构建产物 (Windows 运行机)
├── 45177.vip/                      # 站点 A
│   ├── static/
│   ├── api-mock/
│   ├── api-decrypted/
│   ├── server.js
│   └── ...
├── example.com/                    # 站点 B
│   ├── static/
│   ├── api-mock/
│   ├── api-decrypted/
│   ├── server.js
│   └── ...
└── gateway.js                      # ★ 多站点网关 (可选)
```

---

## 站点配置 site.json

每个站点一个 `site.json`，记录该站点的特征参数，让工具脚本通用化：

```jsonc
{
  // 基本信息
  "domain": "45177.vip",
  "entry": "/normal/?cid=1733015",
  "port": 3210,

  // 加密配置 (不同站点可能不同)
  "crypto": {
    "algorithm": "AES",
    "key": "thanks,pig4cloud",
    "iv": "",
    "mode": "ECB",
    "padding": "Pkcs7",
    "encoding": "Base64"
  },

  // 内联配置位置 (index.html 中的 base64 数据)
  "inline": {
    "pattern": "var J=decodeURIComponent(window.atob(",
    "configKey": "LOBBY_SITE_CONFIG",
    "domainField": "INJECT_DATA.ossGetSiteUrlConfig.data.data",
    "titleField": "title",
    "siteNameField": "siteName"
  },

  // 域名替换映射
  "domainFields": [
    "api_domain", "oss_domain", "lobby_domain", "download_domain",
    "web_domain", "h5_domain", "combo_domain", "hotfix_domain",
    "non_ma_domain", "commonOssBucket"
  ],

  // 速度测试文件
  "speedTestFiles": [
    "siteadmin/ssocdn.txt",
    "ipacdn.txt",
    "bewcdn.txt",
    "normal/dscdn.txt"
  ],

  // API 路由 (build 时自动生成，也可手动补充)
  "apiRoutes": [],

  // 自定义内容
  "customization": {
    "title": "My Custom Site",
    "themeColor": "rgba(0,50,100,1)"
  }
}
```

---

## 单站点目录结构

```
clone-output/{domain}/
│
├── site.json                    # 从 sites/{domain}/site.json 复制
│
├── static/                      # 静态文件 (Express static root)
│   ├── index.html               # 主页 (已 patch: URL重写 + 内联配置修改)
│   ├── cocos/config_data.json   # 站点配置 (已解密 + patch)
│   ├── normal/                  # 前端打包产物
│   │   ├── js/*.js              # Vue bundles
│   │   ├── assets/*.css         # 样式
│   │   └── sw.js                # 空文件 (禁用 SW)
│   ├── siteadmin/upload/img/    # 页面图片 (可替换)
│   └── *.txt                    # 速度测试文件
│
├── api-mock/                    # 原始 API 响应 (加密, 只读备份)
│   └── {api-path}/*.json
│
├── api-decrypted/               # ★ 解密后 API 响应 (编辑这里)
│   └── {api-path}/*.json
│
├── server.js                    # Express 服务器 (自动生成)
├── package.json                 # 依赖
├── missing.json                 # 需额外下载的文件列表
│
└── scripts/                     # 站点专属脚本 (自动生成)
    ├── decrypt.js               # 批量解密 api-mock → api-decrypted
    ├── patch-inline.js          # 修改 index.html 内联域名配置
    └── patch-title.js           # 修改标题
```

---

## 工作流

### 克隆新站点

```bash
# 1. 在 Electron 中打开目标站点
ELECTRON_MCP_NODE=1 curl-rpc open_window url=https://newsite.com/page

# 2. 等页面加载完成，执行克隆 (capture + build 一步完成)
node clone.js clone <win_id> newsite.com

# 3. 分析加密方式 (如果 API 是加密的)
#    - 在浏览器 console 搜索 decrypt/crypto 相关函数
#    - 找到 key/iv/mode/padding
#    - 写入 sites/newsite.com/site.json

# 4. 解密 + patch
cd clone-output/newsite.com
node scripts/decrypt.js          # 解密 API
node scripts/patch-inline.js     # 修改域名配置

# 5. 自定义内容
#    编辑 api-decrypted/ 下的 JSON 文件

# 6. 启动
node server.js
```

### 更新已有站点

```bash
# 重新捕获 (源站有更新时)
node clone.js capture <win_id> 45177.vip
node clone.js build <win_id> 45177.vip

# 重新应用 patch (build 会覆盖 index.html)
cd clone-output/45177.vip
node scripts/patch-inline.js
node scripts/patch-title.js

# api-decrypted/ 不会被覆盖，自定义内容保留
```

---

## 多站点网关 (可选)

当需要同时运行多个克隆站时，用一个网关按域名/端口分发：

```
gateway.js (:80)
  ├── site-a.local → clone-output/45177.vip/   (:3210)
  ├── site-b.local → clone-output/example.com/ (:3211)
  └── site-c.local → clone-output/other.net/   (:3212)
```

或者每个站点独立端口，在 `site.json` 中配置 `port`，用一个脚本批量启动：

```bash
# start-all.js
const sites = fs.readdirSync('clone-output').filter(d => 
  fs.existsSync(`clone-output/${d}/server.js`)
);
sites.forEach(s => {
  const cfg = JSON.parse(fs.readFileSync(`clone-output/${s}/site.json`));
  exec(`node server.js`, { cwd: `clone-output/${s}`, env: { PORT: cfg.port } });
  console.log(`${s} → :${cfg.port}`);
});
```

---

## 站点差异处理

不同站点可能有不同的技术栈和加密方式：

| 特征 | 45177.vip | 可能的其他站点 |
|------|-----------|---------------|
| 框架 | Vue 3 SPA | React / Next.js / 静态 HTML |
| API 加密 | AES-ECB | AES-CBC / RSA / 无加密 / 自定义 |
| 配置位置 | index.html 内联 base64 | localStorage / 外部 config.js / meta 标签 |
| 域名切换 | 速度测试选最快 | 固定域名 / CDN |
| 认证 | 无 (公开页面) | Cookie / JWT / Token |

`site.json` 的 `crypto` 和 `inline` 字段就是为了适配这些差异。对于无加密的站点，`crypto` 设为 `null`，跳过解密步骤。对于配置不在内联 base64 里的站点，`inline` 设为 `null`，用其他方式 patch。

---

## 文件职责总结

```
electron-clone/          (工具层 - 通用逻辑)
  clone.js               捕获 + 构建
  lib/crypto.js          加解密
  lib/patch.js           域名替换
  lib/server-template.js server.js 生成

sites/{domain}/          (配置层 - 每站一份)
  site.json              站点参数

clone-output/{domain}/   (产物层 - 可运行的克隆)
  static/                前端文件
  api-decrypted/         ★ 可编辑的 API 数据
  server.js              本地服务器
  scripts/               站点专属脚本
```

三层分离：工具代码复用，配置独立管理，产物互不干扰。
