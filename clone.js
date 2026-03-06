/**
 * electron-clone: 1:1 website cloner
 * 
 * Phase 1: Capture - run while page is loaded in Electron
 *   node clone.js capture <win_id> [domain]
 * 
 * Phase 2: Build - assemble clone from captured data  
 *   node clone.js build <win_id> [domain]
 *
 * Reads ~/request-data/win-{id}/ (auto-saved by Electron MCP window-monitor)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const [,, cmd, winId = '1', targetDomain] = process.argv;

if (!cmd || !['capture', 'build', 'clone'].includes(cmd)) {
  console.log('Usage:');
  console.log('  node clone.js capture <win_id> [domain]  - capture index.html from live page');
  console.log('  node clone.js build <win_id> [domain]    - build clone from request-data');
  console.log('  node clone.js clone <win_id> [domain]    - capture + build');
  process.exit(1);
}

const DATA_DIR = path.join(os.homedir(), 'request-data', `win-${winId}`);
const OUTPUT_BASE = path.join(os.homedir(), 'clone-output');

// Read map.json
function readMap() {
  const mapFile = path.join(DATA_DIR, 'map.json');
  if (!fs.existsSync(mapFile)) {
    console.error(`map.json not found: ${mapFile}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(mapFile, 'utf8'));
}

// Detect primary domain from map
function detectDomain(map) {
  if (targetDomain) return targetDomain;
  const count = {};
  for (const url of Object.keys(map)) {
    try { const d = new URL(url).hostname; count[d] = (count[d] || 0) + 1; } catch {}
  }
  return Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0];
}

// Find body file from response entries (latest first)
function findBodyFile(responses) {
  for (let i = (responses || []).length - 1; i >= 0; i--) {
    const ref = responses[i];
    if (!ref?.__file) continue;
    try {
      const h = JSON.parse(fs.readFileSync(ref.__file, 'utf8'));
      if (h.body?.__file && fs.existsSync(h.body.__file)) {
        return { bodyFile: h.body.__file, mimeType: h.mimeType || '', status: h.status || 200 };
      }
    } catch {}
  }
  return null;
}

// URL pathname to local file path
function urlToFilePath(url, mimeType) {
  const parsed = new URL(url);
  let p = parsed.pathname || '/';
  if (p === '/' || p.endsWith('/')) p += 'index.html';
  if (!path.extname(p)) {
    if (mimeType.includes('html')) p += '.html';
    else if (mimeType.includes('json')) p += '.json';
    else if (mimeType.includes('javascript')) p += '.js';
    else if (mimeType.includes('css')) p += '.css';
    else p += '.txt';
  }
  return p;
}

// ============ CAPTURE ============
// Save index.html that CDP can't capture (initial navigation)
function capture() {
  const map = readMap();
  const domain = detectDomain(map);
  const captureDir = path.join(DATA_DIR, '_captured');
  fs.mkdirSync(captureDir, { recursive: true });
  
  // Write a helper script that Electron will execute to grab the HTML
  const grabScript = `
    // This runs inside Electron's exec_js
    // Returns the full HTML of the current page
    return '<!DOCTYPE html>' + document.documentElement.outerHTML;
  `;
  
  const grabFile = path.join(captureDir, 'grab-html.js');
  fs.writeFileSync(grabFile, grabScript);
  
  console.log(`Capture helper written to: ${grabFile}`);
  console.log(`\nNow run this to capture index.html:`);
  console.log(`  curl-rpc exec_js id=${winId} code="return '<!DOCTYPE html>'+document.documentElement.outerHTML" > ${path.join(captureDir, 'index.html')}`);
  console.log(`\nOr use the Electron MCP API to exec_js and save the result.`);
  console.log(`Then run: node clone.js build ${winId} ${domain || ''}`);
}

// ============ BUILD ============
function build() {
  const map = readMap();
  const domain = detectDomain(map);
  if (!domain) { console.error('No domain detected'); process.exit(1); }
  
  const OUTPUT_DIR = path.join(OUTPUT_BASE, domain);
  const staticDir = path.join(OUTPUT_DIR, 'static');
  const apiDir = path.join(OUTPUT_DIR, 'api-mock');
  fs.mkdirSync(staticDir, { recursive: true });
  fs.mkdirSync(apiDir, { recursive: true });
  
  console.log(`Cloning: ${domain}`);
  console.log(`Source: ${DATA_DIR}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  
  const apiRoutes = [];
  let staticCount = 0, apiCount = 0, skipCount = 0;
  
  for (const [url, entry] of Object.entries(map)) {
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.hostname !== domain) continue;
    
    const found = findBodyFile(entry.responses);
    if (!found) { skipCount++; continue; }
    
    const { bodyFile, mimeType, status } = found;
    const filePath = urlToFilePath(url, mimeType);
    
    // API detection: JSON responses to /api/ paths or XHR-like
    const isApi = mimeType.includes('json') && (
      filePath.includes('/api/') || filePath.includes('/graphql')
    );
    
    if (isApi) {
      const apiFile = filePath.replace(/[^a-zA-Z0-9/._-]/g, '_');
      const out = path.join(apiDir, apiFile);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(bodyFile, out);
      
      // Get method from request
      let method = 'GET';
      const reqRef = entry.requests?.[entry.requests.length - 1];
      if (reqRef?.__file) {
        try { method = JSON.parse(fs.readFileSync(reqRef.__file, 'utf8')).method || 'GET'; } catch {}
      }
      apiRoutes.push({ method, path: parsed.pathname + parsed.search, file: apiFile, status });
      apiCount++;
    } else {
      const out = path.join(staticDir, filePath);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.copyFileSync(bodyFile, out);
      staticCount++;
    }
  }
  
  // Copy captured index.html if exists, rewrite absolute URLs to relative
  const capturedIndex = path.join(DATA_DIR, '_captured', 'index.html');
  if (fs.existsSync(capturedIndex)) {
    let html = fs.readFileSync(capturedIndex, 'utf8');
    // Rewrite absolute URLs to relative: https://domain/path -> /path
    const domainPattern = new RegExp(`https?://${domain.replace(/\./g, '\\.')}`, 'g');
    html = html.replace(domainPattern, '');
    fs.writeFileSync(path.join(staticDir, 'index.html'), html);
    console.log('  + index.html (captured, URLs rewritten)');
    staticCount++;
  }
  
  // Report missing files (have response header but no body)
  const missing = [];
  for (const [url, entry] of Object.entries(map)) {
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.hostname !== domain) continue;
    
    const resps = entry.responses || [];
    if (resps.length === 0) continue;
    
    const found = findBodyFile(resps);
    if (found) continue; // already cloned
    
    // Has response headers but no body - needs download
    let mimeType = '';
    for (let i = resps.length - 1; i >= 0; i--) {
      if (!resps[i]?.__file) continue;
      try {
        const h = JSON.parse(fs.readFileSync(resps[i].__file, 'utf8'));
        if (h.status === 200) { mimeType = h.mimeType || ''; break; }
      } catch {}
    }
    missing.push({ url, path: parsed.pathname, mimeType });
  }
  
  if (missing.length > 0) {
    const missingFile = path.join(OUTPUT_DIR, 'missing.json');
    fs.writeFileSync(missingFile, JSON.stringify(missing, null, 2));
    console.log(`\n  Missing body (need download): ${missing.length}`);
    console.log(`  Saved to: ${missingFile}`);
    console.log(`  Run: node clone.js download ${winId} ${domain}`);
  }
  
  // Generate server.js
  fs.writeFileSync(path.join(OUTPUT_DIR, 'server.js'), `const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.static(path.join(__dirname, 'static')));
app.use('/api-mock', express.static(path.join(__dirname, 'api-mock')));
app.use('/api-decrypted', express.static(path.join(__dirname, 'api-decrypted')));

const routes = ${JSON.stringify(apiRoutes, null, 2)};
for (const r of routes) {
  const h = (req, res) => {
    // Serve decrypted JSON if available, otherwise raw
    const dec = path.join(__dirname, 'api-decrypted', r.file);
    const raw = path.join(__dirname, 'api-mock', r.file);
    const f = fs.existsSync(dec) ? dec : raw;
    if (fs.existsSync(f)) res.status(r.status).send(fs.readFileSync(f, 'utf8'));
    else res.status(404).json({error:'not found'});
  };
  app[r.method.toLowerCase()](r.path.split('?')[0], h);
}

app.get('*', (req, res) => {
  const f = path.join(__dirname, 'static', 'index.html');
  if (fs.existsSync(f)) res.sendFile(f);
  else res.status(404).send('Not found');
});

app.listen(process.env.PORT || 3210, () => console.log('Clone: http://localhost:' + (process.env.PORT || 3210)));
`);
  
  fs.writeFileSync(path.join(OUTPUT_DIR, 'package.json'), JSON.stringify({
    name: `clone-${domain}`,
    scripts: { start: 'node server.js' },
    dependencies: { express: '^4.18.0' }
  }, null, 2));
  
  console.log(`\nDone!`);
  console.log(`  Static: ${staticCount}`);
  console.log(`  API mock: ${apiCount}`);
  console.log(`  Skipped: ${skipCount}`);
  console.log(`\nRun: cd ${OUTPUT_DIR} && npm install && npm start`);
}

// ============ DOWNLOAD missing files ============
async function download() {
  const map = readMap();
  const domain = detectDomain(map);
  const OUTPUT_DIR = path.join(OUTPUT_BASE, domain);
  const missingFile = path.join(OUTPUT_DIR, 'missing.json');
  
  if (!fs.existsSync(missingFile)) {
    console.log('No missing.json found. Run build first.');
    process.exit(1);
  }
  
  const missing = JSON.parse(fs.readFileSync(missingFile, 'utf8'));
  console.log(`Downloading ${missing.length} missing files...`);
  
  const staticDir = path.join(OUTPUT_DIR, 'static');
  
  for (const item of missing) {
    let filePath = item.path || '/';
    if (filePath === '/' || filePath.endsWith('/')) filePath += 'index.html';
    if (!path.extname(filePath)) {
      const m = item.mimeType || '';
      if (m.includes('javascript')) filePath += '.js';
      else if (m.includes('css')) filePath += '.css';
      else if (m.includes('html')) filePath += '.html';
      else if (m.includes('json')) filePath += '.json';
    }
    
    const outPath = path.join(staticDir, filePath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    
    // Use session_download_url via Electron MCP RPC
    const http = require('http');
    const configPath = path.join(os.homedir(), 'data', 'electron', 'curl-rpc.json');
    let baseUrl = 'http://localhost:8101', token = '';
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const node = cfg[0]; // local node
      baseUrl = node.base_url;
      token = node.api_token;
    }
    
    try {
      const body = JSON.stringify({
        name: 'session_download_url',
        arguments: { win_id: parseInt(winId), url: item.url, save_path: outPath }
      });
      
      const url = new URL(baseUrl + '/rpc/call');
      const res = await new Promise((resolve, reject) => {
        const req = http.request({
          hostname: url.hostname, port: url.port, path: url.pathname,
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        }, resolve);
        req.on('error', reject);
        req.write(body);
        req.end();
      });
      
      let data = '';
      for await (const chunk of res) data += chunk;
      console.log(`  ✓ ${filePath}`);
    } catch (e) {
      console.log(`  ✗ ${filePath}: ${e.message}`);
    }
  }
  
  console.log('Done! Missing files downloaded.');
}

// ============ MAIN ============
if (cmd === 'capture') capture();
else if (cmd === 'build') build();
else if (cmd === 'download') download();
else { capture(); build(); }
