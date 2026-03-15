export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    
    // 错误日志 beacon
    if (url.pathname === '/__err') {
      console.log(`JS_ERROR: ${url.searchParams.get('m')} @ ${url.searchParams.get('s')}:${url.searchParams.get('l')}`);
      return new Response('ok');
    }
    if (url.pathname === '/__ping') {
      console.log(`PING: boot=${url.searchParams.get('boot')} ns=${url.searchParams.get('ns')} scripts=${url.searchParams.get('scripts')}`);
      return new Response('ok');
    }

    // 先尝试静态文件
    if (env.ASSETS) {
      const asset = await env.ASSETS.fetch(request);
      if (asset.status !== 404) return asset;
    }

    console.log(`REQ: ${url.pathname}${url.search}`);

    // 从 Redis mock API 获取
    try {
      const apiUrl = url.hostname.includes('localhost') 
        ? 'http://localhost:8835'
        : 'https://g-8835.cicy.de5.net';
      
      const mockResp = await fetch(`${apiUrl}/api/mock?path=${encodeURIComponent(url.pathname + url.search)}`);
      if (mockResp.ok) {
        const data = await mockResp.json();
        if (data.ok && data.body) {
          const bodyBytes = new Uint8Array(data.body.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));
          return new Response(bodyBytes, {
            status: data.status || 200,
            headers: {
              'Content-Type': data.content_type || 'application/octet-stream',
              'Access-Control-Allow-Origin': '*',
              'Cache-Control': 'public, max-age=3600'
            }
          });
        }
      }
    } catch (e) {
      console.error('Mock API error:', e);
    }

    console.log(`MISSING: ${url.pathname}${url.search}`);
    
    // 策略 D: 透传到源站（懒加载）
    try {
      const sourceUrl = 'https://www.bet365.com' + url.pathname + url.search;
      console.log(`[透传] ${sourceUrl}`);
      
      const sourceResp = await fetch(sourceUrl, {
        headers: {
          'User-Agent': request.headers.get('User-Agent') || 'Mozilla/5.0',
          'Accept': request.headers.get('Accept') || '*/*',
          'Accept-Language': 'en-US,en;q=0.9',
          'Referer': 'https://www.bet365.com/'
        }
      });
      
      if (sourceResp.ok) {
        const body = await sourceResp.arrayBuffer();
        console.log(`[透传成功] ${sourceResp.status} ${body.byteLength} bytes`);
        
        // 异步保存到 Redis（不阻塞响应）
        const apiUrl = url.hostname.includes('localhost') 
          ? 'http://localhost:8835'
          : 'https://g-8835.cicy.de5.net';
        
        fetch(`${apiUrl}/api/save`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: sourceUrl,
            status: sourceResp.status,
            content_type: sourceResp.headers.get('Content-Type') || '',
            body: Array.from(new Uint8Array(body)).map(b => b.toString(16).padStart(2, '0')).join('')
          })
        }).catch(e => console.error('[保存失败]', e.message));
        
        return new Response(body, {
          status: sourceResp.status,
          headers: {
            'Content-Type': sourceResp.headers.get('Content-Type') || 'application/octet-stream',
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'public, max-age=3600',
            'X-Clone-Source': 'passthrough'
          }
        });
      }
    } catch (e) {
      console.error('[透传失败]', e.message);
    }
    
    return new Response(`Missing: ${url.pathname}`, {
      status: 404,
      headers: { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' }
    });
  }
};
