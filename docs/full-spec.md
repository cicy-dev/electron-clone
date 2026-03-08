# 1:1 网站克隆系统 - 完整规格

## 目标

构建一个全自动的网站克隆系统，支持：
- 前端完整克隆（HTML + JS + CSS + 图片）
- 后端 API 智能分析和重建（D1 数据库）
- 实时同步操作对比（源站 vs 克隆站）
- 多 Agent 分布式部署（Windows/Mac/Linux）

## 系统架构

### Agent 架构
```
Linux (控制中心)
├── ssh ssh_win → Windows Agent (主力，当前闲置)
├── ssh ssh_mac → Mac Agent (未来，避免抢用户资源)
└── 本地 Agent (未来，GCP 低配)
```

每个 Agent 独立运行，部署到同一个 CF 账号。

### 数据流
```
用户操作 webview
  ↓
Electron CDP 捕获请求/响应
  ↓
clone.js 分析 + 构建
  ↓
自动生成 D1 schema + Worker API
  ↓
部署到 Cloudflare
  ↓
双 webview 同步对比
```

## 核心功能

### 1. 智能捕获（capture）

**输入：**
- Electron 窗口 ID
- 目标域名

**过程：**
- 用户在 webview 中操作（点击、滚动、输入）
- Electron CDP 自动记录所有请求/响应
- 捕获完整 DOM HTML
- 下载所有静态资源

**输出：**
- `request-data/win-{id}/` - 所有请求/响应
- `request-data/win-{id}/_captured/index.html` - DOM HTML

### 2. 智能分析（analyze）

**输入：**
- 捕获的请求数据

**过程：**
- 解析所有 API 接口
- 识别 RESTful 模式（/user/:id, /game/list?page=1）
- 推断数据结构（JSON schema）
- 识别实体关系（用户、游戏、订单等）
- 推断字段类型（string, int, boolean, timestamp）
- 检测加密 API（自动解密）

**输出：**
```json
{
  "apis": [
    {
      "path": "/hall/api/lobby/channel/go/getChannelInfoById/id/:id/info/channel.json",
      "method": "GET",
      "params": ["id"],
      "response_schema": {
        "code": "int",
        "msg": "string",
        "data": {
          "channelId": "int",
          "channelName": "string"
        }
      },
      "entity": "channel",
      "encrypted": true
    }
  ],
  "entities": {
    "channel": {
      "fields": {
        "channelId": "INTEGER PRIMARY KEY",
        "channelName": "TEXT"
      }
    }
  }
}
```

### 3. 自动建表（create-db）

**输入：**
- 分析结果

**过程：**
- 生成 SQL CREATE TABLE 语句
- 创建 D1 表
- 提取 mock 数据
- 插入到 D1

**输出：**
- D1 数据库已填充数据
- `schema.sql` - 表结构
- `data-import.log` - 导入日志

### 4. 自动生成 API（generate-api）

**输入：**
- 分析结果
- D1 表结构

**过程：**
- 生成 Worker 路由代码
- 生成 SQL 查询逻辑
- 生成参数解析
- 生成响应格式化

**输出：**
```javascript
// 自动生成的 Worker 代码
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // GET /hall/api/lobby/channel/go/getChannelInfoById/id/:id/info/channel.json
    const m1 = url.pathname.match(/^\/hall\/api\/lobby\/channel\/go\/getChannelInfoById\/id\/(\d+)\/info\/channel\.json$/);
    if (m1) {
      const channelId = m1[1];
      const result = await env.DB.prepare(
        'SELECT * FROM channels WHERE channelId = ?'
      ).bind(channelId).first();
      
      return Response.json({
        code: 0,
        msg: 'success',
        data: result
      });
    }
    
    // ... 其他 API 自动生成
  }
};
```

### 5. 同步对比（sync-compare）

**双 webview UI 增强：**

**功能：**
- 用户在右侧（克隆站）操作
- 左侧（源站）自动同步操作
- 实时对比两边的 UI 和 API 响应
- 高亮显示差异

**实现：**
```javascript
// 获取两个 webview 的 webContentsId
const leftWcId = leftWebview.getWebContentsId();
const rightWcId = rightWebview.getWebContentsId();

// 监听右侧的输入事件
rightWebview.addEventListener('dom-ready', () => {
  rightWebview.executeJavaScript(`
    document.addEventListener('click', (e) => {
      window.chrome.webview.postMessage({
        type: 'sync-input',
        event: 'click',
        x: e.clientX,
        y: e.clientY
      });
    }, true);
  `);
});

// 同步到左侧
rightWebview.addEventListener('ipc-message', (e) => {
  if (e.channel === 'sync-input') {
    leftWebview.sendInputEvent({
      type: 'mouseDown',
      x: e.args[0].x,
      y: e.args[0].y,
      button: 'left',
      clickCount: 1
    });
    leftWebview.sendInputEvent({
      type: 'mouseUp',
      x: e.args[0].x,
      y: e.args[0].y,
      button: 'left',
      clickCount: 1
    });
  }
});
```

**API 对比：**
- 监听两边的网络请求（CDP）
- 对比请求参数和响应数据
- 显示差异（JSON diff）
- 自动记录不一致的 API

### 6. 一键部署（full）

**命令：**
```bash
node clone.js full <win_id> <domain>
```

**自动完成：**
1. 捕获 HTML（exec_js 获取 DOM）
2. 构建静态文件
3. 分析 API（analyze）
4. 创建 D1 表（create-db）
5. 生成 Worker API（generate-api）
6. 上传 R2（静态文件）
7. 上传 D1（API 数据）
8. 部署 Worker
9. 输出克隆站 URL

**输出：**
```
✅ 分析了 50 个 API
✅ 创建了 12 个表
✅ 生成了 Worker API 代码
✅ 上传了 218 个静态文件
✅ 导入了 1,234 条数据
✅ 部署到 https://c-example-com.ob6ha3.workers.dev

🔗 对比 URL:
https://clone.deepfetch.de5.net/?source=https://example.com&clone=https://c-example-com.ob6ha3.workers.dev&sync=true
```

## 数据存储

### D1 数据库
- **名称**: `clone-api-db`
- **ID**: `077de9d1-9a3d-4f12-85d6-477fef7e21b7`
- **用途**: 所有站点的 API 数据

**表结构（通用）：**
```sql
-- 每个站点的表前缀: {site}_
-- 例如: 45177_vip_channels, h2b742_games

-- 或者用单表 + site 字段区分
CREATE TABLE api_responses (
  site TEXT NOT NULL,
  path TEXT NOT NULL,
  response TEXT NOT NULL,
  created_at INTEGER DEFAULT (unixepoch()),
  PRIMARY KEY (site, path)
);
```

### R2 Bucket
- **名称**: `clone-sites`
- **结构**: `{slug}/path/to/file`
- **用途**: 静态资源（HTML, JS, CSS, 图片）

## Worker 架构

### 命名规则
- 格式：`c-{domain-slug}`
- 示例：
  - 45177.vip → `c-45177-vip`
  - h2b742.rt1980bvk.top:22964 → `c-h2b742-rt1980bvk-top`

### Worker 代码结构
```javascript
const SITE = '{slug}';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. API 路由（自动生成）
    // ... 匹配各种 API 模式
    
    // 2. 静态资源 → R2
    let r2Key = `${SITE}${url.pathname}`;
    const obj = await env.R2.get(r2Key);
    if (obj) {
      // 返回静态文件
    }
    
    return new Response('Not Found', { status: 404 });
  }
};
```

## 对比 UI

### URL 参数
```
https://clone.deepfetch.de5.net/?source={源站}&clone={克隆站}&sync={true|false}
```

**参数：**
- `source` - 源站 URL
- `clone` - 克隆站 URL
- `sync` - 是否启用同步操作（默认 false）

### 功能
- 并排对比
- 同步操作（sync=true 时）
- API 响应对比
- 差异高亮

## 实现优先级

### P0 - 核心功能
- [ ] API 分析器（analyze 命令）
- [ ] Schema 生成器（create-db 命令）
- [ ] Worker 生成器（generate-api 命令）
- [ ] 一键部署（full 命令）

### P1 - 增强功能
- [ ] 同步操作（sync-compare）
- [ ] API 对比和差异显示
- [ ] 批量上传优化

### P2 - 扩展功能
- [ ] Mac/Linux Agent 支持
- [ ] 站点管理面板
- [ ] 数据编辑器
- [ ] 多站点批量克隆

## 技术细节

### API 分析算法
1. 解析所有 API 路径，提取模式
2. 识别路径参数（:id, :name）
3. 分析响应 JSON，推断 schema
4. 检测数据关系（外键）
5. 推断字段类型和约束

### Schema 生成规则
- 数字 → INTEGER
- 字符串 → TEXT
- 布尔 → INTEGER (0/1)
- 时间戳 → INTEGER
- 数组 → JSON TEXT
- 对象 → JSON TEXT 或关联表

### Worker 生成规则
- 每个 API 模式 → 一个路由匹配
- 路径参数 → 正则捕获组
- Query 参数 → URLSearchParams
- SQL 查询 → 参数化查询（防注入）

## 环境配置

### Windows Agent
- **Electron MCP**: localhost:8101
- **wrangler**: 4.71.0
- **环境变量**:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- **global.json**: `C:\Users\Administrator\global.json`

### Cloudflare 资源
- **Account ID**: `3cd74d293cda341378bb80ea52ff247d`
- **D1 Database**: `clone-api-db` (077de9d1-9a3d-4f12-85d6-477fef7e21b7)
- **R2 Bucket**: `clone-sites`
- **Zone**: `deepfetch.de5.net` (1dd043bbdeddd602532acbf133aa2349)

## 成功标准

**克隆站必须：**
1. UI 100% 一致（像素级）
2. 所有 API 正常工作
3. 用户操作流程完全一致
4. 性能不低于源站

**对比验证：**
- 同步操作，两边 UI 一致
- API 响应数据一致
- 无 404 或错误
