# 游戏分析工具链

## 工具清单

| 工具 | 位置 | 用途 |
|------|------|------|
| `el` | `~/.local/bin/el` | Electron MCP 管理 (start/stop/restart/status) |
| `cicy-rpc` | `/usr/bin/cicy-rpc` | Electron RPC 调用 |
| `ejs` | `~/.local/bin/ejs` | 在窗口中执行 JS 文件 |
| `ejs-frame` | `~/.local/bin/ejs-frame` | 在窗口 iframe 中执行 JS 文件 |
| `vnc` | `~/.local/bin/vnc` | VNC 桌面管理 |

## 启动流程

```bash
# 1. 启动 VNC 桌面
vnc --start

# 2. 启动 Electron (setsid 隔离，Ctrl+C 不会杀进程)
el start
# 或双击桌面 ~/Desktop/start-electron.sh

# 3. 验证
cicy-rpc ping
```

## 打开游戏

```bash
# 打开新窗口 (reuseWindow=false 很重要)
cicy-rpc open_window url="https://h2b742.rt1980bvk.top:22964/home/embedded?cid=1733015&fixed.from=https%253A%252F%252Fh2b742.rt1980bvk.top%253A22964%252Fgossip%252F%253Fdownload%253D1%2523%252Fhome" reuseWindow=false

# 查看页面状态
cicy-rpc webpage_snapshot win_id=2

# 查看所有窗口
cicy-rpc get_windows
```

## 执行 JS

```bash
# 方式1: 简单代码用 cicy-rpc (单表达式，不能有冒号等特殊字符)
cicy-rpc exec_js win_id=2 code='document.title'

# 方式2: 复杂代码用 ejs (写文件，支持多语句，用 return 返回值)
# 注意: 代码会被包在 async () => { ... } 里，所以用 return
cat > ~/tmp/test.js << 'EOF'
var count = document.querySelectorAll('button').length;
return 'found ' + count + ' buttons';
EOF
ejs ~/tmp/test.js 2

# 方式3: iframe 内执行用 ejs-frame (直接 executeJavaScript，最后一个表达式是返回值)
cat > ~/tmp/test-frame.js << 'EOF'
document.body.innerText.slice(0, 200)
EOF
ejs-frame ~/tmp/test-frame.js 2 0    # win_id=2, frame_index=0

# 方式4: 主进程操作用 control_electron_WebContents
cicy-rpc control_electron_WebContents win_id=2 code='webContents.getURL()'
```

## API 拦截分析

### Step 1: 安装拦截器到 iframe

```bash
cat > ~/tmp/intercept.js << 'JSEOF'
window.__apiLogs=[];
var _f=window.fetch;
window.fetch=function(){var u=arguments[0];if(typeof u==="object")u=u.url;var e={t:"f",u:u,ts:Date.now()};window.__apiLogs.push(e);return _f.apply(this,arguments).then(function(r){var c=r.clone();c.text().then(function(b){e.b=b.slice(0,500)});return r})};
var _o=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){this._u=u;this._m=m;return _o.apply(this,arguments)};
var _s=XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send=function(b){var s=this;var e={t:"x",m:s._m,u:s._u,ts:Date.now(),req:b?String(b).slice(0,200):null};window.__apiLogs.push(e);s.addEventListener("load",function(){e.st=s.status;e.b=s.responseText.slice(0,500)});return _s.apply(this,arguments)};
"interceptor ok";
JSEOF
ejs-frame ~/tmp/intercept.js 2 0
```

### Step 2: 等待 + 在 VNC 里操作游戏触发请求

### Step 3: 导出日志到文件

```bash
cat > ~/tmp/dump-logs.js << 'JSEOF'
var logs = window.__apiLogs || [];
JSON.stringify(logs.map(function(e) {
  return {
    m: e.m || 'FETCH',
    u: (e.u || '').replace(/https?:\/\/[^/]+/, ''),
    req: e.req ? e.req.slice(0, 100) : null,
    st: e.st,
    b: e.b ? e.b.slice(0, 200) : null
  };
}));
JSEOF

# 导出并保存
ejs-frame ~/tmp/dump-logs.js 2 0 | python3 -c "
import sys,json
data=json.load(sys.stdin)
logs=json.loads(data['result']['content'][0]['text'])
with open('~/tmp/api-logs.json','w') as f:
    json.dump(logs,f,indent=2,ensure_ascii=False)
print(f'{len(logs)} APIs saved')
urls=sorted(set(e.get('u','') for e in logs))
for u in urls: print(u)
"
```

### Step 4: 查看具体 API 详情

```bash
# 查看某个路径的完整响应
python3 -c "
import json
logs=json.load(open('~/tmp/api-logs.json'))
for e in logs:
    if 'remindCfg' in e.get('u',''):
        print(json.dumps(e, indent=2, ensure_ascii=False))
        break
"
```

## 查找 iframe

```bash
# 列出窗口中所有 iframe
cicy-rpc control_electron_WebContents win_id=2 code='JSON.stringify(webContents.mainFrame.frames.map(f=>({url:f.url.slice(0,100),name:f.name})))'

# 在 iframe 里执行简单代码
cicy-rpc control_electron_WebContents win_id=2 code='await webContents.mainFrame.frames[0].executeJavaScript("document.title")'
```

## 注意事项

1. **Ctrl+C 安全**: `el start` 用 `setsid` 启动，Ctrl+C 不会杀 Electron
2. **ejs 用 return**: 代码被包在 `async () => {}` 里，必须用 `return` 返回值
3. **ejs-frame 不用 return**: 直接 `executeJavaScript`，最后一个表达式就是返回值
4. **cicy-rpc YAML 限制**: code= 后面不能有复杂内容（冒号、引号嵌套），复杂代码用 ejs
5. **游戏在 iframe 里**: 主页面是大厅，具体游戏加载在 iframe 中，需要用 ejs-frame 分析
