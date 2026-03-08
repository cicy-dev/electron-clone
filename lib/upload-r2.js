#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const https = require('https');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '3cd74d293cda341378bb80ea52ff247d';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const BUCKET = 'clone-sites';

if (!TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN not set');
  process.exit(1);
}

const [,, site, staticDir] = process.argv;
if (!site || !staticDir) {
  console.log('Usage: node upload-r2.js <site-slug> <static-dir>');
  process.exit(1);
}

function findFiles(dir) {
  const files = [];
  function walk(d) {
    fs.readdirSync(d).forEach(f => {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else files.push(p);
    });
  }
  walk(dir);
  return files;
}

async function upload(file, key) {
  const data = fs.readFileSync(file);
  
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodeURIComponent(key)}`,
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Length': data.length
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve(res.statusCode === 200));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

(async () => {
  const files = findFiles(staticDir);
  console.log(`Found ${files.length} files`);
  
  let count = 0;
  for (const file of files) {
    const rel = path.relative(staticDir, file).replace(/\\/g, '/');
    const key = `${site}/${rel}`;
    await upload(file, key);
    count++;
    if (count % 10 === 0) console.log(`✅ ${count}/${files.length}`);
  }
  
  console.log(`\n✅ Uploaded ${files.length} files to R2`);
})();
