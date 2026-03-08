const SITE = '45177-vip';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 1. API 请求 → D1
    if (url.pathname.startsWith('/hall/api/')) {
      const result = await env.DB.prepare(
        'SELECT response FROM api_responses WHERE site = ? AND path = ?'
      ).bind(SITE, url.pathname).first();
      
      if (result) {
        return new Response(result.response, {
          headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*'
          }
        });
      }
    }
    
    // 2. 静态资源 → R2
    let r2Key = `${SITE}${url.pathname === '/' ? '/index.html' : url.pathname}`;
    
    // 处理目录请求
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      r2Key = `${SITE}${url.pathname}index.html`;
    }
    
    const obj = await env.R2.get(r2Key);
    
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Access-Control-Allow-Origin', '*');
      
      // 设置正确的 Content-Type
      if (!headers.has('Content-Type')) {
        const ext = r2Key.split('.').pop().toLowerCase();
        const types = {
          'html': 'text/html; charset=utf-8',
          'js': 'application/javascript; charset=utf-8',
          'css': 'text/css; charset=utf-8',
          'json': 'application/json',
          'png': 'image/png',
          'jpg': 'image/jpeg',
          'jpeg': 'image/jpeg',
          'gif': 'image/gif',
          'svg': 'image/svg+xml',
          'avif': 'image/avif',
          'webp': 'image/webp'
        };
        headers.set('Content-Type', types[ext] || 'application/octet-stream');
      }
      
      // 如果是 HTML，添加 base 标签修复相对路径
      if (r2Key.endsWith('.html')) {
        let html = await obj.text();
        const basePath = url.pathname.endsWith('/') ? url.pathname : url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
        html = html.replace('<head>', `<head><base href="${basePath}">`);
        return new Response(html, { headers });
      }
      
      return new Response(obj.body, { headers });
    }
    
    // 3. 404
    return new Response(`Not Found: ${r2Key}`, { status: 404 });
  }
};
