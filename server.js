#!/usr/bin/env node
/**
 * server.js — 控制面板后端 API + 自动化引擎
 * 
 * 一键同步流程：
 * 1. 建索引（Redis traffic:queue → 内存 URL map）
 * 2. 自动提取白名单域名（从源站 URL 的域名开始）
 * 3. 同步 HTML 到 public/，做域名替换
 * 4. 扫描 HTML 中引用的资源 URL，并发从 Redis 拉取
 * 5. 对拉取的 JS/CSS 继续扫描引用，递归补全
 * 6. Wrangler worker 对 public/ 没有的请求查 Redis mock
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./lib/config');
const sync = require('./lib/sync');
const resolver = require('./lib/resource-resolver');

const PORT = 8835;

let state = {
  synced: false, sourceUrl: 'https://www.bet365.com/', indexStats: null, lastSync: null,
  notFound: [], errors: [], resolved: [], log: []
};

function log(msg) {
  const line = `[${new Date().toLocaleTimeString()}] ${msg}`;
  state.log.push(line);
  if (state.log.length > 200) state.log = state.log.slice(-100);
  console.log(line);
}

async function handleAPI(req, res) {
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
  const readBody = () => new Promise(r => { let d = ''; req.on('data', c => d += c); req.on('end', () => r(d)); });

  try {
    if (p === '/api/status') return json({ ok: true, state });

    if (p === '/api/config') {
      if (req.method === 'POST') {
        const body = JSON.parse(await readBody());
        if (body.whitelist_domains) config.whitelist = body.whitelist_domains;
        if (body.concurrency) config.concurrency = body.concurrency;
        config.save();
        return json({ ok: true });
      }
      config.load();
      return json({ ok: true, config: { whitelist_domains: config.whitelist, concurrency: config.concurrency } });
    }

    // 一键同步：直接请求源站抓取 + 拉取所有资源
    if (p === '/api/sync' && req.method === 'POST') {
      const body = JSON.parse(await readBody());
      const sourceUrl = body.url;
      if (!sourceUrl) return json({ ok: false, error: 'url required' }, 400);

      // 重置状态
      state = { synced: false, sourceUrl, indexStats: null, lastSync: null, notFound: [], errors: [], resolved: [], log: [] };

      // 清空 public/
      if (fs.existsSync(config.publicDir)) fs.rmSync(config.publicDir, { recursive: true });
      fs.mkdirSync(config.publicDir, { recursive: true });

      log(`开始同步: ${sourceUrl}`);

      // 1. 建索引（已有的 Redis 数据）
      const stats = await sync.buildIndex();
      state.indexStats = stats;
      log(`Redis 索引: ${stats.total} 条流量, ${stats.indexed} 个 URL`);

      // 2. 直接请求源站抓取 HTML
      log('正在请求源站...');
      const htmlResult = await sync.fetchAndSync(sourceUrl);
      if (!htmlResult.ok) {
        log(`抓取失败: ${htmlResult.error}`);
        return json(htmlResult);
      }
      log(`HTML 已抓取: ${(htmlResult.size / 1024).toFixed(1)}KB`);

      // 3. 白名单：重置为源站域名
      try {
        const host = new URL(sourceUrl).hostname;
        config.whitelist = [host];
        config.save();
        log(`白名单: ${config.whitelist.join(', ')}`);
      } catch {}

      // 4. 重建索引（包含刚抓取的）
      const stats2 = await sync.buildIndex();
      state.indexStats = stats2;
      log(`更新索引: ${stats2.indexed} 个 URL`);

      // 5. 自动扫描 + 抓取所有资源（递归）
      const result = await resolver.resolveAll(sourceUrl);
      state.resolved = result.resolved;
      state.notFound = result.notFound;
      state.errors = result.errors;
      state.synced = true;
      state.lastSync = new Date().toISOString();

      log(`完成: 修复 ${result.resolved.length}, 404 ${result.notFound.length}, 异常 ${result.errors.length}`);
      return json({ ok: true, stats: stats2, ...result });
    }

    // 手动补充资源
    if (p === '/api/resolve' && req.method === 'POST') {
      const body = JSON.parse(await readBody());
      const urls = body.urls || [];
      if (!urls.length) return json({ ok: false, error: 'urls required' }, 400);
      const result = await resolver.resolve(urls);
      state.notFound = [...new Set([...state.notFound, ...result.notFound])];
      state.errors = [...state.errors, ...result.errors];
      state.resolved = [...new Set([...state.resolved, ...result.resolved])];
      return json({ ok: true, ...result });
    }

    if (p === '/api/reset' && req.method === 'POST') {
      state = { synced: false, sourceUrl: '', indexStats: null, lastSync: null, notFound: [], errors: [], resolved: [], log: [] };
      if (fs.existsSync(config.publicDir)) fs.rmSync(config.publicDir, { recursive: true });
      fs.mkdirSync(config.publicDir, { recursive: true });
      return json({ ok: true });
    }

    if (p === '/api/search') {
      const q = url.searchParams.get('q') || '';
      const idx = sync.getIndex();
      const results = Object.keys(idx).filter(k => k.includes(q)).slice(0, 100);
      return json({ ok: true, results, total: Object.keys(idx).length });
    }

    // API mock: wrangler worker 调用，查 Redis 返回捕获的响应
    if (p === '/api/mock') {
      const reqPath = url.searchParams.get('path') || '';
      if (!reqPath) return json({ ok: false }, 400);
      
      const idx = sync.getIndex();
      const qIdx = reqPath.indexOf('?');
      const reqPathname = qIdx >= 0 ? reqPath.slice(0, qIdx) : reqPath;
      const reqSearch = qIdx >= 0 ? reqPath.slice(qIdx + 1) : '';
      
      // 1. 精确匹配（含 query）
      let entry = null;
      for (const [key, val] of Object.entries(idx)) {
        try { if (new URL(key).pathname + new URL(key).search === reqPath) { entry = val; break; } } catch {}
      }
      
      // 2. 模块名匹配（去掉开头数字）
      if (!entry && reqSearch) {
        const modKey = reqPathname + '?' + decodeURIComponent(reqSearch).replace(/^\d+,/, '').replace(/&rt=\d+/g, '');
        entry = idx[modKey] || null;
        
        // 3. Blob 前缀匹配（取前5个模块，要求至少匹配80%）
        if (!entry && reqPathname.includes('/Blob')) {
          const reqModules = modKey.split('|').filter(m => m.length > 0);
          let bestMatch = null;
          let bestScore = 0;
          
          for (const [key, val] of Object.entries(idx)) {
            if (!key.includes('/Blob')) continue;
            const keyModules = key.split('|').filter(m => m.length > 0);
            
            // 计算匹配度：前N个模块有多少相同
            let matchCount = 0;
            const checkLen = Math.min(5, reqModules.length, keyModules.length);
            for (let i = 0; i < checkLen; i++) {
              if (reqModules[i] === keyModules[i]) matchCount++;
            }
            
            const score = matchCount / checkLen;
            if (score > bestScore && score >= 0.8) {
              bestScore = score;
              bestMatch = val;
            }
          }
          
          if (bestMatch) {
            entry = bestMatch;
            console.log(`[Blob匹配] 相似度${(bestScore*100).toFixed(0)}%`);
          }
        }
      }
      
      // 3. pathname 兜底（仅非 Blob 请求）
      if (!entry && !reqPathname.includes('/Blob')) {
        entry = idx[Object.keys(idx).find(k => { try { return new URL(k).pathname === reqPathname; } catch { return false; } })] || null;
      }
      
      if (!entry) return json({ ok: false });
      const body = await sync.getBody(entry);
      if (!body) return json({ ok: false });
      return json({ ok: true, body: body.toString('hex'), status: entry.status, content_type: entry.content_type });
    }

    // /api/save - 保存透传的资源到 Redis
    if (p === '/api/save' && req.method === 'POST') {
      const body = await readBody();
      const { url: fullUrl, status, content_type, body: hexBody } = JSON.parse(body);
      
      if (!fullUrl || !hexBody) return json({ ok: false, error: 'Missing url or body' });
      
      // 确保 URL 是源站域名（不是 g-8787）
      const sourceUrl = fullUrl.replace(/g-8787\.cicy\.de5\.net/g, 'www.bet365.com').replace(/^http:/, 'https:');
      
      const c = await sync.getClient();
      const entry = {
        type: 'http',
        url: sourceUrl,
        method: 'GET',
        status: status || 200,
        req_headers: {},
        resp_headers: { 'content-type': content_type || '' },
        req_body: '',
        resp_body: hexBody.length > 2048 ? `file:passthrough_${Date.now()}` : hexBody,
        content_type: content_type || '',
        content_length: hexBody.length / 2,
        ts: Date.now() / 1000
      };
      
      // 保存到队列
      await c.lPush('traffic:queue', JSON.stringify(entry));
      
      // 如果是大文件，保存到磁盘
      if (entry.resp_body.startsWith('file:')) {
        const hash = entry.resp_body.split(':')[1];
        const filePath = path.join(__dirname, 'data/traffic', `${hash}.bin`);
        fs.writeFileSync(filePath, Buffer.from(hexBody, 'hex'));
      }
      
      log(`[保存透传] ${sourceUrl} (${(hexBody.length / 2 / 1024).toFixed(1)}KB)`);
      
      // 重建索引
      await sync.buildIndex();
      
      return json({ ok: true });
    }

    json({ error: 'not found' }, 404);
  } catch (e) {
    log(`错误: ${e.message}`);
    json({ ok: false, error: e.message }, 500);
  }
}

http.createServer(handleAPI).listen(PORT, async () => {
  console.log(`Clone API: http://localhost:${PORT}`);
  const stats = await sync.buildIndex();
  console.log(`自动建索引: ${stats.total} 条流量, ${stats.indexed} 个 URL`);

  // 自动同步：监听 Redis 新流量
  let lastLen = stats.total;
  setInterval(async () => {
    try {
      const c = await sync.getClient();
      const len = await c.lLen('traffic:queue');
      if (len > lastLen) {
        log(`检测到新流量: ${len - lastLen} 条，自动同步...`);
        lastLen = len;
        await sync.buildIndex();
        if (state.sourceUrl) {
          const r = await sync.fetchAndSync(state.sourceUrl);
          log(`自动同步完成: ${JSON.stringify(r)}`);
        }
      }
    } catch {}
  }, 3000);
});
