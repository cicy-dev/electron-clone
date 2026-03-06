/**
 * electron-clone: 1:1 website cloner
 * 
 * Reads Electron MCP's request-data directory and produces a static clone.
 * Run on Windows via: curl-rpc exec_node_file @clone.js
 * 
 * Usage: node clone.js <win_id> [target_domain]
 *   win_id: window ID (e.g. 1)
 *   target_domain: only clone this domain (optional, auto-detect from most requests)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const args = process.argv.slice(2);
const WIN_ID = args[0] || '1';
const TARGET_DOMAIN = args[1] || null;

const DATA_DIR = path.join(os.homedir(), 'request-data', `win-${WIN_ID}`);
const OUTPUT_DIR = path.join(os.homedir(), 'clone-output', `win-${WIN_ID}`);

// Read map.json
const mapFile = path.join(DATA_DIR, 'map.json');
if (!fs.existsSync(mapFile)) {
  console.error(`map.json not found: ${mapFile}`);
  process.exit(1);
}

const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
const urls = Object.keys(map);

// Detect primary domain
const domainCount = {};
for (const url of urls) {
  try {
    const d = new URL(url).hostname;
    domainCount[d] = (domainCount[d] || 0) + 1;
  } catch {}
}
const primaryDomain = TARGET_DOMAIN || Object.entries(domainCount).sort((a, b) => b[1] - a[1])[0]?.[0];
if (!primaryDomain) {
  console.error('No domain found');
  process.exit(1);
}

console.log(`Cloning domain: ${primaryDomain}`);
console.log(`Total URLs: ${urls.length}`);

// Classify and extract
const staticDir = path.join(OUTPUT_DIR, 'static');
const apiDir = path.join(OUTPUT_DIR, 'api-mock');
fs.mkdirSync(staticDir, { recursive: true });
fs.mkdirSync(apiDir, { recursive: true });

const apiRoutes = [];
let clonedCount = 0;
let apiCount = 0;
let skippedCount = 0;

for (const [url, entry] of Object.entries(map)) {
  let parsed;
  try { parsed = new URL(url); } catch { continue; }
  
  // Only clone target domain
  if (parsed.hostname !== primaryDomain) continue;
  
  // Find latest response with body
  const responses = entry.responses || [];
  let bodyFile = null;
  let mimeType = null;
  let status = 200;
  
  // Iterate responses from latest to earliest
  for (let i = responses.length - 1; i >= 0; i--) {
    const ref = responses[i];
    if (!ref?.__file) continue;
    try {
      const headerData = JSON.parse(fs.readFileSync(ref.__file, 'utf8'));
      if (headerData.body?.__file && fs.existsSync(headerData.body.__file)) {
        bodyFile = headerData.body.__file;
        mimeType = headerData.mimeType || '';
        status = headerData.status;
        break;
      }
    } catch {}
  }
  
  if (!bodyFile) {
    skippedCount++;
    continue;
  }
  
  // Determine output path from URL pathname
  let pathname = parsed.pathname || '/';
  // Remove query params from path consideration
  if (pathname === '/') pathname = '/index.html';
  // Add extension if missing
  if (!path.extname(pathname)) {
    if (mimeType.includes('html')) pathname += '.html';
    else if (mimeType.includes('json')) pathname += '.json';
    else if (mimeType.includes('javascript')) pathname += '.js';
    else if (mimeType.includes('css')) pathname += '.css';
  }
  
  // Check if this is an API request (XHR/fetch returning JSON)
  const isApi = mimeType.includes('json') && (
    pathname.includes('/api/') || 
    pathname.includes('/graphql') ||
    parsed.searchParams.toString().length > 0
  );
  
  if (isApi) {
    // Save API mock
    const reqInfo = entry.requests?.[entry.requests.length - 1];
    let method = 'GET';
    let reqBody = null;
    if (reqInfo?.__file) {
      try {
        const reqData = JSON.parse(fs.readFileSync(reqInfo.__file, 'utf8'));
        method = reqData.method || 'GET';
        reqBody = reqData.postData;
      } catch {}
    }
    
    const apiFile = pathname.replace(/[^a-zA-Z0-9/.-]/g, '_') + '.json';
    const apiOutPath = path.join(apiDir, apiFile);
    fs.mkdirSync(path.dirname(apiOutPath), { recursive: true });
    fs.copyFileSync(bodyFile, apiOutPath);
    
    apiRoutes.push({
      method,
      path: parsed.pathname + parsed.search,
      responseFile: apiFile,
      status,
    });
    apiCount++;
  } else {
    // Save static file
    const outPath = path.join(staticDir, pathname);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.copyFileSync(bodyFile, outPath);
    clonedCount++;
  }
}

// Generate mock server
const mockServer = `const express = require('express');
const fs = require('fs');
const path = require('path');
const app = express();

// Static files
app.use(express.static(path.join(__dirname, 'static')));

// API mock routes
const routes = ${JSON.stringify(apiRoutes, null, 2)};

for (const route of routes) {
  const handler = (req, res) => {
    const file = path.join(__dirname, 'api-mock', route.responseFile);
    if (fs.existsSync(file)) {
      res.status(route.status).type('json').send(fs.readFileSync(file, 'utf8'));
    } else {
      res.status(404).json({ error: 'mock not found' });
    }
  };
  if (route.method === 'POST') app.post(route.path, handler);
  else if (route.method === 'PUT') app.put(route.path, handler);
  else if (route.method === 'DELETE') app.delete(route.path, handler);
  else app.get(route.path, handler);
}

// Fallback to index.html (SPA)
app.get('*', (req, res) => {
  const index = path.join(__dirname, 'static', 'index.html');
  if (fs.existsSync(index)) res.sendFile(index);
  else res.status(404).send('Not found');
});

const PORT = process.env.PORT || 3210;
app.listen(PORT, () => console.log(\`Clone server: http://localhost:\${PORT}\`));
`;

fs.writeFileSync(path.join(OUTPUT_DIR, 'server.js'), mockServer);

// Generate package.json
fs.writeFileSync(path.join(OUTPUT_DIR, 'package.json'), JSON.stringify({
  name: `clone-${primaryDomain}`,
  scripts: { start: 'node server.js' },
  dependencies: { express: '^4.18.0' }
}, null, 2));

// Summary
console.log(`\nDone! Output: ${OUTPUT_DIR}`);
console.log(`  Static files: ${clonedCount}`);
console.log(`  API mocks: ${apiCount}`);
console.log(`  Skipped (no body): ${skippedCount}`);
console.log(`\nTo run: cd ${OUTPUT_DIR} && npm install && npm start`);
