#!/bin/bash
# 部署克隆站点到独立 Worker

if [ -z "$1" ]; then
  echo "用法: ./deploy-clone.sh <source_url>"
  echo "示例: ./deploy-clone.sh https://45177.vip"
  exit 1
fi

SOURCE_URL="$1"
DOMAIN=$(echo "$SOURCE_URL" | sed -E 's|https?://||' | sed 's|/.*||' | sed 's|\.|_|g')
WORKER_NAME="c-${DOMAIN}"
WORKER_DIR="worker/${WORKER_NAME}"

echo "源站: $SOURCE_URL"
echo "Worker 名称: $WORKER_NAME"
echo "Worker 目录: $WORKER_DIR"

# 创建 Worker 目录
mkdir -p "$WORKER_DIR/public"

# 复制 Worker 代码
cat > "$WORKER_DIR/index.js" << 'EOF'
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 静态资源优先
    try {
      return await env.ASSETS.fetch(request);
    } catch (e) {
      // 404 返回首页
      if (url.pathname === '/' || url.pathname.endsWith('/')) {
        try {
          const indexReq = new Request(new URL('/index.html', request.url), request);
          return await env.ASSETS.fetch(indexReq);
        } catch {}
      }
      return new Response('Not Found', { status: 404 });
    }
  }
};
EOF

# 创建 wrangler.toml
cat > "$WORKER_DIR/wrangler.toml" << EOF
name = "$WORKER_NAME"
main = "index.js"
compatibility_date = "2024-01-01"

[assets]
directory = "./public"
EOF

echo ""
echo "✓ Worker 配置已创建"
echo ""
echo "下一步:"
echo "1. 同步资源: curl -X POST http://localhost:8835/api/sync -d '{\"url\":\"$SOURCE_URL\"}'"
echo "2. 复制资源: cp -r worker/clone-dev/public/* $WORKER_DIR/public/"
echo "3. 部署: cd $WORKER_DIR && npx wrangler deploy"
echo "4. 访问: https://${WORKER_NAME}.de5.net"
