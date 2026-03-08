const os = require('os');
const path = require('path');
const fs = require('fs');

const CFG_PATH = path.join(__dirname, '..', 'config', 'default.json');
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')); } catch {}

module.exports = {
  whitelist: cfg.whitelist_domains || [],
  wranglerPort: cfg.wrangler_port || 8787,
  redisHost: cfg.redis_host || 'localhost',
  redisPort: cfg.redis_port || 6379,
  mitmDataDir: (cfg.mitm_data_dir || '~/mitm-data').replace('~', os.homedir()),
  concurrency: cfg.concurrency || 20,
  publicDir: path.join(__dirname, '..', 'worker', 'clone-dev', 'public'),
  configPath: CFG_PATH,

  load() {
    try {
      Object.assign(cfg, JSON.parse(fs.readFileSync(CFG_PATH, 'utf8')));
      this.whitelist = cfg.whitelist_domains || [];
      this.concurrency = cfg.concurrency || 20;
      this.mitmDataDir = (cfg.mitm_data_dir || '~/mitm-data').replace('~', os.homedir());
    } catch {}
    return this;
  },

  save() {
    cfg.whitelist_domains = this.whitelist;
    cfg.concurrency = this.concurrency;
    fs.writeFileSync(CFG_PATH, JSON.stringify(cfg, null, 2));
  },

  isWhitelisted(url) {
    if (this.whitelist.length === 0) return true;
    try {
      const host = new URL(url).hostname;
      return this.whitelist.some(d => host === d || host.endsWith('.' + d));
    } catch { return false; }
  }
};
