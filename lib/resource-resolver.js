/**
 * resource-resolver.js — 自动扫描 public/ 提取引用 URL，
 * 优先从 Redis 取，没有就直接 HTTP 请求源站，递归补全
 */
const fs = require('fs');
const path = require('path');
const config = require('./config');
const sync = require('./sync');
const rewriter = require('./domain-rewriter');

const TEXT_EXTS = ['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.xml'];
const URL_PATTERNS = [
  // src="..." href="..." (带引号)
  /(?:src|href|action|poster|data)\s*=\s*["']([^"'#\s][^"']*)["']/gi,
  // src=./path (不带引号)
  /(?:src|href)\s*=\s*(\.[^\s>]+)/gi,
  // url(...)
  /url\(\s*["']?([^"')#\s]+)["']?\s*\)/gi,
  // import "..." / import('...')
  /import\s*(?:\(?\s*["']([^"']+)["']\s*\)?)/gi,
  // fetch("...") / XMLHttpRequest.open("...", "...")
  /(?:fetch|open)\s*\(\s*["']([^"'\s]+)["']/gi,
  // JS string URLs
  /["']((?:https?:)?\/\/[^"'\s]+\.(?:js|css|png|jpg|jpeg|gif|svg|webp|avif|woff2?|ttf|eot|ico|json|wasm))["']/gi,
];

function isTextFile(p) { return TEXT_EXTS.includes(path.extname(p).toLowerCase()); }

function extractUrls(content, baseUrl) {
  const urls = new Set();
  for (const pat of URL_PATTERNS) {
    pat.lastIndex = 0;
    let m;
    while ((m = pat.exec(content)) !== null) {
      let u = m[1];
      if (!u || u.startsWith('data:') || u.startsWith('blob:') || u.startsWith('javascript:') || u.startsWith('{')) continue;
      // 过滤 JS 变量误匹配：含有 . 但不是文件扩展名的（如 t.apiDomain）
      if (/^[a-z]\.[a-zA-Z]/.test(u)) continue;
      // 过滤单字母
      if (/^[a-z]$/.test(u)) continue;
      // 过滤含逗号的
      if (u.includes(',')) continue;
      try {
        if (u.startsWith('//')) u = 'https:' + u;
        else if (!u.startsWith('http')) u = new URL(u, baseUrl).href;
        urls.add(u);
      } catch {}
    }
  }
  return [...urls];
}

async function parallel(tasks, concurrency) {
  const results = [];
  let i = 0;
  async function run() { while (i < tasks.length) { const idx = i++; results[idx] = await tasks[idx](); } }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, run));
  return results;
}

async function resolve(urls, pathPrefix) {
  config.load();
  const resolved = [], notFound = [], errors = [];

  const tasks = urls.map(url => async () => {
    if (!config.isWhitelisted(url)) return;

    // 如果有路径前缀限制，只处理该前缀下的资源
    if (pathPrefix) {
      try {
        const u = new URL(url);
        if (!u.pathname.startsWith(pathPrefix)) return;
      } catch {}
    }

    const u = new URL(url);
    let localPath = u.pathname;
    if (localPath === '/' || localPath.endsWith('/')) localPath += 'index.html';
    const outPath = path.join(config.publicDir, localPath);
    if (fs.existsSync(outPath)) return; // 已存在

    // 优先 Redis
    let body = null, contentType = '';
    const entry = sync.lookup(url);
    if (entry) {
      body = await sync.getBody(entry);
      contentType = entry.content_type || '';
    }

    // Redis 没有 → 直接请求源站
    if (!body) {
      try {
        const resp = await sync.fetchUrl(url);
        if (resp.status === 200 && resp.body.length > 0) {
          body = resp.body;
          contentType = resp.contentType || '';
        }
      } catch {}
    }

    if (!body || body.length === 0) { notFound.push(url); return; }

    try {
      fs.mkdirSync(path.dirname(outPath), { recursive: true });
      if (isTextFile(outPath)) {
        fs.writeFileSync(outPath, rewriter.rewrite(body.toString('utf8'), config.whitelist));
      } else {
        fs.writeFileSync(outPath, body);
      }
      resolved.push(url);
    } catch (e) {
      errors.push({ url, error: e.message });
    }
  });

  await parallel(tasks, config.concurrency);
  return { resolved, notFound, errors };
}

/**
 * 全自动递归：扫描 public/ → 提取 URL → 拉取 → 再扫描新文件，最多 10 轮
 */
async function resolveAll(sourceUrl) {
  const allResolved = [], allNotFound = new Set(), allErrors = [];
  const processed = new Set();
  const baseUrl = sourceUrl || (config.whitelist[0] ? `https://${config.whitelist[0]}` : 'http://localhost');

  // 提取路径前缀（如 /normal/）
  let pathPrefix = null;
  try {
    const u = new URL(baseUrl);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts.length > 0) pathPrefix = '/' + parts[0] + '/';
  } catch {}

  for (let round = 0; round < 10; round++) {
    const urls = new Set();
    scanDir(config.publicDir, filePath => {
      if (!isTextFile(filePath)) return;
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        // baseUrl 基于文件在 public/ 中的相对路径
        const relPath = '/' + path.relative(config.publicDir, filePath).replace(/\\/g, '/');
        const dirPath = relPath.substring(0, relPath.lastIndexOf('/') + 1);
        const fileBaseUrl = (config.whitelist[0] ? `https://${config.whitelist[0]}` : 'http://localhost') + dirPath;
        for (const url of extractUrls(content, fileBaseUrl)) {
          if (!processed.has(url) && config.isWhitelisted(url)) urls.add(url);
        }
      } catch {}
    });

    if (urls.size === 0) break;
    for (const u of urls) processed.add(u);

    const result = await resolve([...urls], pathPrefix);
    allResolved.push(...result.resolved);
    result.notFound.forEach(u => allNotFound.add(u));
    allErrors.push(...result.errors);

    if (result.resolved.length === 0) break;
  }

  return { resolved: allResolved, notFound: [...allNotFound], errors: allErrors };
}

function scanDir(dir, cb) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scanDir(full, cb);
    else cb(full);
  }
}

module.exports = { resolve, resolveAll, extractUrls };
