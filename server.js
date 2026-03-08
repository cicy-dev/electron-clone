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
  synced: false, sourceUrl: '', indexStats: null, lastSync: null,
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
      // 在索引中找匹配的 URL（任意白名单域名 + 这个 path）
      const idx = sync.getIndex();
      let entry = null;
      for (const [key, val] of Object.entries(idx)) {
        try {
          const u = new URL(key);
          if (u.pathname === reqPath || u.pathname + u.search === reqPath) {
            entry = val; break;
          }
        } catch {}
      }
      if (!entry) return json({ ok: false });
      const body = await sync.getBody(entry);
      if (!body) return json({ ok: false });
      return json({ ok: true, body: body.toString('utf8'), status: entry.status, content_type: entry.content_type });
    }

    json({ error: 'not found' }, 404);
  } catch (e) {
    log(`错误: ${e.message}`);
    json({ ok: false, error: e.message }, 500);
  }
}

http.createServer(handleAPI).listen(PORT, () => console.log(`Clone API: http://localhost:${PORT}`));
