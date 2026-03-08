/**
 * API 分析器 - 自动分析捕获的 API 请求/响应
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// AES-ECB 解密
function decrypt(text, key = 'thanks,pig4cloud') {
  const decipher = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  return decipher.update(text, 'base64', 'utf8') + decipher.final('utf8');
}

// 尝试解密 JSON
function tryDecrypt(text) {
  try {
    return JSON.parse(text);
  } catch {
    try {
      const decrypted = decrypt(text);
      return JSON.parse(decrypted);
    } catch {
      return null;
    }
  }
}

// 推断 JSON 值的类型
function inferType(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'boolean') return 'INTEGER';
  if (typeof value === 'number') return Number.isInteger(value) ? 'INTEGER' : 'REAL';
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return 'INTEGER'; // timestamp
    return 'TEXT';
  }
  if (Array.isArray(value)) return 'JSON';
  if (typeof value === 'object') return 'JSON';
  return 'TEXT';
}

// 推断对象的 schema
function inferSchema(obj, depth = 0) {
  if (depth > 2 || !obj || typeof obj !== 'object' || Array.isArray(obj)) return null;
  
  const schema = {};
  for (const [key, value] of Object.entries(obj)) {
    if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      schema[key] = { type: 'array', items: inferSchema(value[0], depth + 1) };
    } else if (typeof value === 'object' && value !== null) {
      schema[key] = { type: 'object', fields: inferSchema(value, depth + 1) };
    } else {
      schema[key] = { type: inferType(value) };
    }
  }
  return schema;
}

// 提取路径参数模式
function extractPattern(pathname) {
  return pathname
    .replace(/\/\d+/g, '/:id')
    .replace(/\/[a-f0-9]{32,}/g, '/:hash')
    .replace(/\/[A-Z]{3,}/g, '/:code');
}

// 分析 API
function analyze(dataDir, domain) {
  const mapFile = path.join(dataDir, 'map.json');
  if (!fs.existsSync(mapFile)) {
    console.error('map.json not found');
    process.exit(1);
  }
  
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const apis = [];
  const entities = {};
  
  for (const [url, entry] of Object.entries(map)) {
    let parsed;
    try { parsed = new URL(url); } catch { continue; }
    if (parsed.hostname !== domain) continue;
    
    // 只分析 API 请求
    if (!parsed.pathname.includes('/api/')) continue;
    
    // 找到响应 body
    const responses = entry.responses || [];
    let bodyFile = null;
    for (let i = responses.length - 1; i >= 0; i--) {
      const ref = responses[i];
      if (!ref?.__file) continue;
      try {
        const h = JSON.parse(fs.readFileSync(ref.__file, 'utf8'));
        if (h.body?.__file && fs.existsSync(h.body.__file)) {
          bodyFile = h.body.__file;
          break;
        }
      } catch {}
    }
    
    if (!bodyFile) continue;
    
    // 读取并解密响应
    const rawBody = fs.readFileSync(bodyFile, 'utf8');
    const jsonData = tryDecrypt(rawBody);
    if (!jsonData) continue;
    
    // 提取模式
    const pattern = extractPattern(parsed.pathname);
    const params = (pattern.match(/:\w+/g) || []).map(p => p.slice(1));
    
    // 推断 schema
    const schema = inferSchema(jsonData.data || jsonData);
    
    // 识别实体
    const entityName = pattern.split('/').filter(p => !p.startsWith(':')).pop()?.replace(/\.json$/, '') || 'unknown';
    
    apis.push({
      path: pattern,
      original: parsed.pathname,
      method: 'GET',
      params,
      response_schema: schema,
      entity: entityName,
      encrypted: rawBody !== JSON.stringify(jsonData)
    });
    
    // 收集实体字段
    if (schema && typeof schema === 'object') {
      if (!entities[entityName]) entities[entityName] = { fields: {} };
      for (const [key, info] of Object.entries(schema)) {
        if (info.type !== 'array' && info.type !== 'object') {
          entities[entityName].fields[key] = info.type;
        }
      }
    }
  }
  
  return { apis, entities };
}

module.exports = { analyze, inferSchema, tryDecrypt };
