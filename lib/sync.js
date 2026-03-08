/**
 * sync.js — Redis 索引 + 直接 HTTP 抓取源站
 */
const redis = require('redis');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http_mod = require('http');
const config = require('./config');
const rewriter = require('./domain-rewriter');

let client = null;
let urlIndex = {};

async function getClient() {
  if (client && client.isOpen) return client;
  client = redis.createClient({ url: `redis://${config.redisHost}:${config.redisPort}` });
  client.on('error', () => {});
  await client.connect();
  return client;
}

async function buildIndex() {
  const c = await getClient();
  const len = await c.lLen('traffic:queue');
  urlIndex = {};
  const batch = 500;
  for (let i = 0; i < len; i += batch) {
    const items = await c.lRange('traffic:queue', i, Math.min(i + batch - 1, len - 1));
    for (const raw of items) {
      try {
        const d = JSON.parse(raw);
        if (d.type !== 'http' || !d.url) continue;
        const u = new URL(d.url);
        const pathKey = u.origin + u.pathname;
        const entry = {
          fullUrl: d.url, resp_body: d.resp_body || '', content_type: d.content_type || '',
          status: d.status || 0, method: d.method || 'GET', content_length: d.content_length || 0
        };
        urlIndex[pathKey] = entry;
        urlIndex[d.url] = entry;
      } catch {}
    }
  }
  return { total: len, indexed: Object.keys(urlIndex).length };
}

function extractDomains() {
  const count = {};
  for (const key of Object.keys(urlIndex)) {
    try { const h = new URL(key).hostname; count[h] = (count[h] || 0) + 1; } catch {}
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1]).map(e => e[0]);
}

async function getBody(entry) {
  if (!entry || !entry.resp_body) return null;
  const body = entry.resp_body;
  if (body.startsWith('file:')) {
    const hash = body.slice(5);
    const filePath = path.join(config.mitmDataDir, `${hash}.bin`);
    if (fs.existsSync(filePath)) return fs.readFileSync(filePath);
    const c = await getClient();
    return await c.get(redis.commandOptions({ returnBuffers: true }), `file:${hash}`);
  }
  if (body) return Buffer.from(body, 'hex');
  return null;
}

function lookup(url) {
  if (urlIndex[url]) return urlIndex[url];
  try { return urlIndex[new URL(url).origin + new URL(url).pathname] || null; } catch { return null; }
}

function lookupByPath(pathname) {
  for (const [key, entry] of Object.entries(urlIndex)) {
    try { if (new URL(key).pathname === pathname) return entry; } catch {}
  }
  return null;
}

// 直接 HTTP 请求一个 URL，返回 Buffer
function httpGet(url, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
    const mod = url.startsWith('https') ? https : http_mod;
    const req = mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36' }, rejectUnauthorized: false }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const next = new URL(res.headers.location, url).href;
        return httpGet(next, maxRedirects - 1).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ body: Buffer.concat(chunks), status: res.statusCode, headers: res.headers, contentType: res.headers['content-type'] || '' }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// 直接请求源站 HTML，写到 public/ 对应路径
async function fetchAndSync(sourceUrl) {
  config.load();
  try {
    const resp = await httpGet(sourceUrl);
    if (resp.status !== 200) return { ok: false, error: `HTTP ${resp.status}` };

    let html = resp.body.toString('utf8');
    html = rewriter.rewrite(html, config.whitelist);

    // 保留源站路径结构
    const u = new URL(sourceUrl);
    let localPath = u.pathname;
    if (localPath === '/' || localPath.endsWith('/')) localPath += 'index.html';

    const outPath = path.join(config.publicDir, localPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, html);
    return { ok: true, size: html.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// 直接请求一个资源 URL，返回 Buffer + content-type
async function fetchUrl(url) {
  return httpGet(url);
}

module.exports = { buildIndex, getBody, lookup, lookupByPath, fetchAndSync, fetchUrl, getClient, getIndex: () => urlIndex, extractDomains };
