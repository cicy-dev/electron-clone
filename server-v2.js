#!/usr/bin/env node
/**
 * server-v2.js - 简化版 API 服务器
 * 策略 D: 预加载 + 懒加载 + 透传
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const sync = require('./lib/sync');

const PORT = 8835;
let urlIndex = {};

// 建索引
async function buildIndex() {
  const stats = await sync.buildIndex();
  urlIndex = sync.getIndex();
  console.log(`[索引] ${stats.indexed} 个 URL`);
  return stats;
}

// 匹配资源
function matchResource(reqPath) {
  const qIdx = reqPath.indexOf('?');
  const pathname = qIdx >= 0 ? reqPath.slice(0, qIdx) : reqPath;
  const search = qIdx >= 0 ? reqPath.slice(qIdx + 1) : '';
  
  // 1. 精确匹配完整路径
  for (const [key, val] of Object.entries(urlIndex)) {
    try {
      const u = new URL(key);
      if (u.pathname + u.search === reqPath) return val;
    } catch {}
  }
  
  // 2. Blob 模糊匹配（去掉版本号）
  if (pathname.includes('/Blob') && search) {
    const normalized = pathname + '?' + decodeURIComponent(search).replace(/^\d+,/, '').replace(/&rt=\d+/g, '');
    if (urlIndex[normalized]) return urlIndex[normalized];
    
    // 前缀匹配（前3个模块）
    const prefix = normalized.split('|').slice(0, 3).join('|');
    for (const [key, val] of Object.entries(urlIndex)) {
      if (key.includes('/Blob') && key.startsWith(prefix)) {
        console.log(`[模糊匹配] ${prefix.slice(0, 80)}...`);
        return val;
      }
    }
  }
  
  // 3. pathname 匹配（仅静态资源）
  if (!pathname.includes('/Blob') && !pathname.includes('/Api/')) {
    for (const [key, val] of Object.entries(urlIndex)) {
      try {
        if (new URL(key).pathname === pathname) return val;
      } catch {}
    }
  }
  
  return null;
}

// 处理请求
async function handleRequest(req, res) {
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
      if (!reqPath) return json({ ok: false, error: 'Missing path' });
      
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
    
    // /api/save - 保存透传资源
    if (p === '/api/save' && req.method === 'POST') {
      const body = await readBody();
      const { url: fullUrl, status, content_type, body: hexBody } = JSON.parse(body);
      
      if (!fullUrl || !hexBody) return json({ ok: false, error: 'Missing url or body' });
      
      const c = await sync.getClient();
      const entry = {
        type: 'http',
        url: fullUrl,
        method: 'GET',
        status: status || 200,
        req_headers: {},
        resp_headers: { 'content-type': content_type || '' },
        req_body: '',
        resp_body: hexBody,
        content_type: content_type || '',
        content_length: hexBody.length / 2,
        ts: Date.now() / 1000
      };
      
      await c.lPush('traffic:queue', JSON.stringify(entry));
      console.log(`[保存] ${fullUrl} (${(hexBody.length / 2 / 1024).toFixed(1)}KB)`);
      
      // 异步重建索引
      setTimeout(() => buildIndex(), 100);
      
      return json({ ok: true });
    }
    
    json({ error: 'not found' }, 404);
  } catch (e) {
    console.error('[错误]', e.message);
    json({ ok: false, error: e.message }, 500);
  }
}

// 启动服务器
http.createServer(handleRequest).listen(PORT, async () => {
  console.log(`Clone API v2: http://localhost:${PORT}`);
  await buildIndex();
  
  // 监听新流量
  let lastLen = Object.keys(urlIndex).length;
  setInterval(async () => {
    try {
      const c = await sync.getClient();
      const len = await c.lLen('traffic:queue');
      if (len > lastLen + 10) {
        console.log(`[新流量] ${len - lastLen} 条`);
        await buildIndex();
        lastLen = len;
      }
    } catch (e) {
      console.error('[监听错误]', e.message);
    }
  }, 5000);
});
