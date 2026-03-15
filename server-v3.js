#!/usr/bin/env node
/**
 * server-v3.js - 组件化克隆 API
 * 策略 E: 直接复制 A 的 innerHTML 到 B
 */
const http = require('http');
const sync = require('./lib/sync');
process.on('uncaughtException', e => console.error('[crash]', e.message));
process.on('unhandledRejection', e => console.error('[reject]', e?.message || e));

const PORT = 8835;
let urlIndex = {};

async function buildIndex() {
  const stats = await sync.buildIndex();
  urlIndex = sync.getIndex();
  console.log(`[索引] ${stats.indexed} 个 URL`);
  return stats;
}

function matchResource(reqPath) {
  // 1. 精确匹配
  for (const [key, val] of Object.entries(urlIndex)) {
    try {
      const u = new URL(key);
      if (u.pathname + u.search === reqPath) return val;
    } catch {}
  }
  
  // 2. Blob 模糊匹配
  const qIdx = reqPath.indexOf('?');
  if (qIdx > 0 && reqPath.includes('/Blob')) {
    const pathname = reqPath.slice(0, qIdx);
    const search = reqPath.slice(qIdx + 1);
    const normalized = pathname + '?' + decodeURIComponent(search).replace(/^\d+,/, '').replace(/&rt=\d+/g, '');
    
    if (urlIndex[normalized]) return urlIndex[normalized];
    
    // 前缀匹配
    const prefix = normalized.split('|').slice(0, 3).join('|');
    for (const [key, val] of Object.entries(urlIndex)) {
      if (key.includes('/Blob') && key.startsWith(prefix)) return val;
    }
  }
  
  // 3. pathname 匹配
  const pathname = qIdx > 0 ? reqPath.slice(0, qIdx) : reqPath;
  for (const [key, val] of Object.entries(urlIndex)) {
    try {
      if (new URL(key).pathname === pathname) return val;
    } catch {}
  }
  
  return null;
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;
  
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  
  const json = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };
  
  const readBody = () => new Promise(r => {
    let d = '';
    req.on('data', c => d += c);
    req.on('end', () => r(d));
  });
  
  try {
    // /api/status
    if (p === '/api/status') {
      return json({ ok: true, indexed: Object.keys(urlIndex).length });
    }
    
    // /api/mock?path=xxx
    if (p === '/api/mock') {
      const reqPath = url.searchParams.get('path');
      if (!reqPath) return json({ ok: false });
      
      const entry = matchResource(reqPath);
      if (!entry) return json({ ok: false });
      
      const body = await sync.getBody(entry);
      if (!body) return json({ ok: false });
      
      return json({
        ok: true,
        body: body.toString('hex'),
        status: entry.status || 200,
        content_type: entry.content_type || 'application/octet-stream'
      });
    }
    
    // /api/clone - 获取 A 的 innerHTML
    if (p === '/api/clone') {
      const sourceUrl = url.searchParams.get('url') || 'https://www.bet365.com/';
      
      // 从文件读取（临时方案）
      const fs = require('fs');
      const htmlPath = '/tmp/bet365.html';
      if (fs.existsSync(htmlPath)) {
        const html = fs.readFileSync(htmlPath, 'utf-8');
        return json({ ok: true, html, url: sourceUrl });
      }
      
      return json({ ok: false, error: 'HTML not found' });
    }
    
    // /clone.html - 直接托管 HTML
    if (p === '/clone.html') {
      const fs = require('fs');
      const htmlPath = '/tmp/bet365.html';
      if (fs.existsSync(htmlPath)) {
        let html = fs.readFileSync(htmlPath, 'utf-8');
        html = html.replace('<head>', '<head><base href="https://www.bet365.com/">');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(html);
      }
      res.writeHead(404);
      return res.end('Not found');
    }
    
    json({ error: 'not found' }, 404);
  } catch (e) {
    console.error('[错误]', e.message);
    json({ ok: false, error: e.message }, 500);
  }
}).listen(PORT, async () => {
  console.log(`Clone API v3: http://localhost:${PORT}`);
  await buildIndex();
  
  // 监听新流量（暂时禁用，避免崩溃）
  // setInterval(async () => {
  //   try {
  //     const c = await sync.getClient();
  //     const len = await c.lLen('traffic:queue');
  //     const current = Object.keys(urlIndex).length;
  //     if (len > current + 10) {
  //       console.log(`[新流量] 重建索引`);
  //       await buildIndex();
  //     }
  //   } catch {}
  // }, 5000);
});
