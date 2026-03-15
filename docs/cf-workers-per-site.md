# CF Workers 独立部署架构

## 部署环境

### Windows Agent（主要）
- **Electron MCP** - 浏览器捕获
- **clone.js** - 捕获 + 构建 + 部署
- **wrangler 4.71.0** - CF 部署
- **环境变量**：
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- **global.json** - `C:\Users\Administrator\global.json`

### 未来扩展
- Mac Agent（用户日常使用，避免抢资源）
- Linux Agent（GCP，配置较低）

## 工具链流程

### 完整流程（一条命令）
```bash
# 在 Windows 上执行
node clone.js full <win_id> <domain>
```

**自动完成：**
1. 捕获 HTML（exec_js 获取 DOM）
2. 构建静态 + API mock
3. 生成 Worker（c-{slug}/）
4. 上传 R2（静态文件）
5. 上传 KV（API mock）
6. 部署 Worker
7. 输出克隆站 URL

### 远程触发（从 Linux）
```bash
ssh ssh_win 'cd C:\Users\Administrator\projects\electron-clone && node clone.js full 8 example.com'
```

### 分步执行
```bash
# 1. 捕获 + 构建
node clone.js clone <win_id> <domain>

# 2. 部署
node clone.js deploy <win_id> <domain>
```

## Worker 命名规则

**每个站点独立 Worker：**
- 站点：45177.vip → Worker: `c-45177-vip`
- 站点：h2b742.rt1980bvk.top:22964 → Worker: `c-h2b742-rt1980bvk-top`
- 格式：`c-{domain-slug}` (域名中的 `.` 和 `:` 替换为 `-`)

## 数据存储

### R2 Bucket (所有站点共享)
```
clone-sites/
├── 45177-vip/
│   ├── index.html
│   ├── normal/
│   └── siteadmin/
└── h2b742-rt1980bvk-top/
    ├── index.html
    └── ...
```

### KV Namespace (所有站点共享)
```
Key 格式: {slug}:{api-path}

示例:
"45177-vip:/hall/api/lobby/channel/go/getChannelInfoById/id/1733015/info/channel.json"
"h2b742-rt1980bvk-top:/hall/api/user/info.json"
```

## Worker 代码模板

```javascript
const SITE = '{slug}';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. API → KV
    if (url.pathname.startsWith('/hall/api/')) {
      const key = `${SITE}:${url.pathname}`;
      const data = await env.KV.get(key);
      if (data) {
        return new Response(data, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // 2. 静态资源 → R2
    let r2Key = `${SITE}${url.pathname === '/' ? '/index.html' : url.pathname}`;
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      r2Key = `${SITE}${url.pathname}index.html`;
    }
    
    const obj = await env.R2.get(r2Key);
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Access-Control-Allow-Origin', '*');
      
      // Content-Type 自动检测
      if (!headers.has('Content-Type')) {
        const ext = r2Key.split('.').pop().toLowerCase();
        const types = {
          'html': 'text/html; charset=utf-8',
          'js': 'application/javascript; charset=utf-8',
          'css': 'text/css; charset=utf-8',
          'json': 'application/json',
          'avif': 'image/avif',
          'webp': 'image/webp',
          'png': 'image/png',
          'jpg': 'image/jpeg'
        };
        headers.set('Content-Type', types[ext] || 'application/octet-stream');
      }
      
      // HTML 添加 base 标签修复相对路径
      if (r2Key.endsWith('.html')) {
        let html = await obj.text();
        const basePath = url.pathname.endsWith('/') ? url.pathname : url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
        html = html.replace('<head>', `<head><base href="${basePath}">`);
        return new Response(html, { headers });
      }
      
      return new Response(obj.body, { headers });
    }
    
    return new Response(`Not Found: ${r2Key}`, { status: 404 });
  }
};
```

## 共享资源

**Account ID**: `3cd74d293cda341378bb80ea52ff247d`

**KV Namespace**: `a7cc6d7a39764a05a5fe46f56233ca7d`
- Binding: `KV`
- 所有站点共享，通过 key 前缀区分

**R2 Bucket**: `clone-sites`
- Binding: `R2`
- 所有站点共享，通过目录区分

## 对比 UI

**URL**: https://g-8834.cicy.de5.net

**参数格式**:
```
?source={源站URL}&clone={克隆站URL}
```

**示例**:
```
https://g-8834.cicy.de5.net/?source=https%3A%2F%2F45177.vip%2Fnormal%2F%3Fcid%3D1733015&clone=https%3A%2F%2Fc-45177-vip.ob6ha3.workers.dev%2Fnormal%2F%3Fcid%3D1733015
```

**功能**:
- 自动检测 Electron（webview vs iframe）
- URL 参数自动加载
- 并排对比
- 刷新、交换视图

## 已部署站点

### c-45177-vip
- **源站**: https://45177.vip
- **克隆**: https://c-45177-vip.ob6ha3.workers.dev
- **状态**: ✅ 完全正常，0 错误

### c-h2b742-rt1980bvk-top
- **源站**: https://h2b742.rt1980bvk.top:22964
- **克隆**: https://c-h2b742-rt1980bvk-top.ob6ha3.workers.dev
- **状态**: 🚧 Worker 已创建，等待上传数据

## TODO

- [ ] 实现 `deploy` 命令自动化
- [ ] 实现 `full` 命令（capture + build + deploy）
- [ ] 批量上传 R2/KV 优化
- [ ] 自动 HTML 捕获（无需手动 exec_js）
- [ ] 域名配置自动 patch
