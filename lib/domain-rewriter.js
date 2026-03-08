/**
 * domain-rewriter.js — 白名单域名的绝对 URL → 本地相对路径
 */
const config = require('./config');

function buildPattern(domains) {
  if (!domains || !domains.length) return null;
  const escaped = domains.map(d => d.replace(/\./g, '\\.').replace(/:/g, '\\:'));
  return new RegExp('(?:https?:)?//(?:' + escaped.join('|') + ')', 'g');
}

function rewrite(content, domains) {
  domains = domains || config.whitelist;
  const pattern = buildPattern(domains);
  if (!pattern) return content;
  return content.replace(pattern, '');
}

module.exports = { rewrite, buildPattern };
