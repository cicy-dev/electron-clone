// clone-dev worker: static assets from public/ + API mock fallback
export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // assets 模块会自动处理 public/ 里的文件
    // 到这里说明 public/ 里没有 → 尝试从 Redis API mock
    // 由于 wrangler dev 不能直连 Redis，走 server.js 的 /api/mock
    try {
      const mockResp = await fetch(`http://localhost:8835/api/mock?path=${encodeURIComponent(url.pathname + url.search)}`);
      if (mockResp.ok) {
        const data = await mockResp.json();
        if (data.ok && data.body) {
          return new Response(data.body, {
            status: data.status || 200,
            headers: {
              'Content-Type': data.content_type || 'application/json',
              'Access-Control-Allow-Origin': '*'
            }
          });
        }
      }
    } catch {}

    return new Response(`Not Found: ${url.pathname}`, {
      status: 404,
      headers: { 'Access-Control-Allow-Origin': '*' }
    });
  }
};
