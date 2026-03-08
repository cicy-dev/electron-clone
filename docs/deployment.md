# Clone Studio 部署规范

## 项目命名规范

**严格遵守以下命名，不得随意创建新项目：**

### Cloudflare Pages 项目
- **项目名**: `electron-clone` （已存在，不要改）
- **自定义域名**: `clone.deepfetch.de5.net` （已绑定，不要改）
- **主域名**: `electron-clone.pages.dev`

### 本地项目
- **项目目录**: `/home/w3c_offical/workers/w-20130/electron-clone`
- **Tmux session**: `w-20130`
- **Tmux panes**: `api`, `wrangler`, `vite`

### 端口分配
- **8835**: API 服务器 (`server.js`)
- **8787**: Wrangler dev (克隆站点)
- **8834**: Vite dev (UI 开发)

## 部署流程

### 1. 构建 UI
```bash
cd /home/w3c_offical/workers/w-20130/electron-clone/web
npx vite build
```

### 2. 部署到 Cloudflare Pages
```bash
cd /home/w3c_offical/workers/w-20130/electron-clone/web
npx wrangler pages deploy dist --project-name=electron-clone --commit-dirty=true
```

### 3. 验证部署
访问: https://clone.deepfetch.de5.net

## 禁止操作

❌ **不要创建新的 Pages 项目**（如 `clone-studio`）
❌ **不要修改项目名称**（保持 `electron-clone`）
❌ **不要修改自定义域名**（保持 `clone.deepfetch.de5.net`）
❌ **不要修改 tmux session 名称**（保持 `w-20130`）

## 快速命令

```bash
# 启动所有服务
clone start

# 部署 UI
cd /home/w3c_offical/workers/w-20130/electron-clone/web
npx vite build && npx wrangler pages deploy dist --project-name=electron-clone --commit-dirty=true

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
├── server.js              # API 服务器
├── start.sh               # 启动脚本
├── config/
│   └── default.json       # 配置文件
├── lib/                   # 核心模块
├── worker/clone-dev/      # Wrangler 项目
│   ├── index.js
│   ├── wrangler.toml
│   └── public/            # 同步的资源
├── web/                   # UI 项目
│   ├── index.html
│   ├── dist/              # 构建产物（部署这个）
│   ├── vite.config.js
│   └── package.json
└── docs/
    ├── architecture-v2.md
    └── deployment.md      # 本文件
```

## 域名访问

- **生产环境**: https://clone.deepfetch.de5.net
- **开发环境**: http://localhost:8834

## 注意事项

1. 部署前必须先 `npx vite build`
2. 部署时必须指定 `--project-name=electron-clone`
3. 如果有未提交的 git 更改，加 `--commit-dirty=true`
4. 部署后自动生效，无需手动操作 DNS
