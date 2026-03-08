#!/usr/bin/env node
/**
 * 批量导入 API mock 数据到 D1
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID || '3cd74d293cda341378bb80ea52ff247d';
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_ID = '077de9d1-9a3d-4f12-85d6-477fef7e21b7';

if (!TOKEN) {
  console.error('CLOUDFLARE_API_TOKEN not set');
  process.exit(1);
}

const [,, site, apiDir] = process.argv;
if (!site || !apiDir) {
  console.log('Usage: node import-d1.js <site-slug> <api-mock-dir>');
  process.exit(1);
}

// 递归查找所有 JSON 文件
function findJsonFiles(dir) {
  const files = [];
  function walk(d) {
    fs.readdirSync(d).forEach(f => {
      const p = path.join(d, f);
      if (fs.statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) files.push(p);
    });
  }
  walk(dir);
  return files;
}

// API 路径转换
function fileToPath(file, baseDir) {
  let rel = path.relative(baseDir, file).replace(/\\/g, '/');
  rel = '/' + rel.replace(/\/default\.json$/, '').replace(/\.json$/, '');
  return rel;
}

// 批量插入
async function importToD1(site, files, baseDir) {
  const statements = [];
  
  for (const file of files) {
    const apiPath = fileToPath(file, baseDir);
    const response = fs.readFileSync(file, 'utf8');
    statements.push({
      sql: 'INSERT OR REPLACE INTO api_responses (site, path, response) VALUES (?, ?, ?)',
      params: [site, apiPath, response]
    });
  }
  
  // 单独执行每条
  let count = 0;
  for (const stmt of statements) {
    const data = JSON.stringify(stmt);
    
    const options = {
      hostname: 'api.cloudflare.com',
      path: `/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };
    
    await new Promise((resolve, reject) => {
      const req = https.request(options, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          const result = JSON.parse(body);
          if (result.success) {
            count++;
            if (count % 5 === 0) console.log(`✅ ${count}/${statements.length}`);
            resolve();
          } else {
            reject(new Error(JSON.stringify(result.errors)));
          }
        });
      });
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }
}

// 主函数
(async () => {
  const files = findJsonFiles(apiDir);
  console.log(`Found ${files.length} API files`);
  await importToD1(site, files, apiDir);
  console.log(`\n✅ Imported ${files.length} APIs to D1`);
})();
