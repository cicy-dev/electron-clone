/**
 * Worker 生成器 - 根据分析结果生成 Worker API 代码
 */

function generateWorker(site, analysis) {
  return `const SITE = '${site}';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // API 请求 → D1
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
    
    // 静态资源 → R2
    let r2Key = \`\${SITE}\${url.pathname === '/' ? '/index.html' : url.pathname}\`;
    if (url.pathname.endsWith('/') && url.pathname !== '/') {
      r2Key = \`\${SITE}\${url.pathname}index.html\`;
    }
    
    const obj = await env.R2.get(r2Key);
    if (obj) {
      const headers = new Headers();
      obj.writeHttpMetadata(headers);
      headers.set('etag', obj.httpEtag);
      headers.set('Access-Control-Allow-Origin', '*');
      
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
      
      if (r2Key.endsWith('.html')) {
        let html = await obj.text();
        const basePath = url.pathname.endsWith('/') ? url.pathname : url.pathname.substring(0, url.pathname.lastIndexOf('/') + 1);
        html = html.replace('<head>', \`<head><base href="\${basePath}">\`);
        return new Response(html, { headers });
      }
      
      return new Response(obj.body, { headers });
    }
    
    return new Response(\`Not Found: \${r2Key}\`, { status: 404 });
  }
};
`;
}

module.exports = { generateWorker };
