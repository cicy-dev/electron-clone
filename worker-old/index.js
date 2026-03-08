// CF Workers 克隆站点代理
// 单个 Worker 处理所有克隆站点

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 从 URL 参数或 hostname 提取站点标识
    // ?site=45177-vip 或 45177-vip.yourdomain.com
    let site = url.searchParams.get('site');
    if (!site) {
      const hostname = url.hostname.split('.')[0];
      // 如果是 clone 或 electron-clone-worker，默认使用 45177-vip
      site = (hostname === 'clone' || hostname === 'electron-clone-worker') ? '45177-vip' : hostname;
    }
    
    // 1. API 请求 → KV (去掉 .json 后缀)
    if (url.pathname.startsWith('/hall/api/')) {
      const key = `${site}:${url.pathname}`;
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
    let r2Key = `${site}${url.pathname === '/' ? '/index.html' : url.pathname}`;
    
    // 处理目录请求 (如 /normal/ → /index.html)
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      r2Key = `${site}/index.html`;
    }
    
    const obj = await env.R2.get(r2Key);
    
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Access-Control-Allow-Origin', '*');
      
      return new Response(obj.body, { headers });
    }
    
    // 3. 404
    return new Response(`Not Found: ${r2Key}`, { status: 404 });
  }
};
