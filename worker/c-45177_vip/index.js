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
