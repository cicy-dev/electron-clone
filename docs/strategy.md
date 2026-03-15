# Clone Studio 克隆策略

## 策略 A：被动捕获 + 智能匹配

### 工作流程

1. **A 加载源站** - 通过 mitmproxy 捕获所有网络流量到 Redis（原始响应）
2. **B 从 Redis 读取** - 直接使用 A 捕获的原始响应数据（body + headers）
3. **404 智能匹配** - 当 B 请求的 URL 在 Redis 里找不到时，使用相似度匹配

### 关键特性

- **B 不通过代理** - 直接从 Wrangler/API 获取资源
- **零网络请求** - B 的所有资源都来自 Redis，不访问真实源站
- **原始数据复用** - B 返回的是 A 捕获的原始 HTTP 响应（包括 body、Content-Type、状态码）

### 技术细节

#### 数据流

```
A webview (源站)
  ↓ 通过代理
Windows mitmproxy (18888)
  ↓ upstream
GCP mitmproxy (8888)
  ↓ 保存
Redis (traffic:queue)
  ↓ 建索引
API Server (8835)
  ↓ mock API
Wrangler (8787)
  ↓ 返回原始数据
B webview (克隆站)
```

**B 完全离线运行**，所有资源都来自 A 捕获的 Redis 数据。

#### 流量存储
- 所有 HTTP/HTTPS 请求响应存入 Redis
- 大文件（>1KB）存储为 `data/traffic/{hash}.bin`
- 小文件直接存储为 hex
- 保存完整响应：body、headers、status、content_type

#### 资源索引
```javascript
// sync.js buildIndex()
urlIndex[fullUrl] = entry;           // 完整 URL
urlIndex[origin + pathname] = entry; // 路径 key
urlIndex[modKey] = entry;            // 模块 key（去掉版本号）
```

#### Blob 智能匹配
```javascript
// server.js mock API
// 1. 精确匹配
// 2. 模块名匹配（去掉开头数字和 &rt=N）
// 3. 相似度匹配（前5个模块，80%阈值）
const score = matchCount / checkLen;
if (score >= 0.8) return bestMatch;
```

### 优势
- 无需修改源站
- 自动处理动态 API
- 支持增量同步

### 局限
- 动态参数变化大时匹配率下降
- 首次加载可能有部分 404
- 依赖 A 完整加载所有资源

### 适用场景
- 静态内容为主的网站
- API 参数相对稳定
- 可接受部分资源缺失

---

## 策略 B：主动代理 + 自我修复（待实现）

### 工作流程
1. A 和 B 都通过代理
2. B 的 404 请求也被捕获
3. 自动触发重新同步
4. 最终收敛到完整克隆

### 优势
- 完全自动化
- 最终一致性保证
- 无需人工干预

### 实现要点
- B 也需要配置代理
- 区分 A/B 的流量（通过 User-Agent 或 Referer）
- 实现增量同步触发机制

---

## 策略 C：双向代理 + 实时透传（推荐）

### 核心思路
B 也通过代理，但代理逻辑改为：
1. 先查 Redis（A 的缓存）
2. 如果没有，**透传到真实源站**并保存到 Redis
3. 下次 A 或 B 请求时直接用缓存

### 工作流程
```
B 请求 /api/xxx
  ↓
Wrangler 查 Redis
  ↓ 没有
透传到源站 (bet365.com)
  ↓
保存响应到 Redis
  ↓
返回给 B
```

### 优势
- **100% 完整克隆** - B 缺失的资源会自动从源站获取
- **自动收敛** - 多次访问后 Redis 越来越完整
- **零配置** - 不需要智能匹配，精确匹配即可
- **实时更新** - 源站更新后 B 也能获取最新内容

### 实现要点
```javascript
// worker/clone-dev/index.js
if (!entry) {
  // 透传到源站
  const realUrl = 'https://www.bet365.com' + url.pathname + url.search;
  const realResp = await fetch(realUrl, {
    headers: request.headers,
    method: request.method
  });
  
  // 保存到 Redis
  await saveToRedis(realUrl, realResp);
  
  return realResp;
}
```

### 局限
- B 首次访问时会请求真实源站（可能触发反爬）
- 需要处理 Cookie/Session（可能需要登录态）

---

## 策略 D：预加载 + 懒加载（最优）

### 核心思路
结合策略 A 和 C：
1. **预加载阶段** - A 完整浏览网站，捕获所有常见资源
2. **懒加载阶段** - B 访问时优先用缓存，缺失时透传
3. **增量更新** - 定期让 A 重新访问，更新 Redis

### 工作流程
```
阶段1: A 预加载
  → 捕获 90% 资源到 Redis

阶段2: B 首次访问
  → 90% 来自 Redis
  → 10% 透传源站（并保存）

阶段3: B 后续访问
  → 100% 来自 Redis（已完整）
```

### 优势
- **最佳性能** - 大部分请求零延迟（Redis）
- **完整性保证** - 缺失资源自动补全
- **反爬友好** - 只有少量请求到源站
- **可扩展** - 支持多个源站、多个用户

### 实现要点
1. 添加透传逻辑到 Wrangler
2. 实现 Redis 写入 API
3. 添加 TTL 机制（资源过期后重新获取）
4. 可选：添加白名单（只透传特定域名）

---

## 推荐方案

**短期（当前）**: 策略 A - 已实现，适合演示和测试

**中期（生产）**: 策略 D - 预加载 + 懒加载
- 保留策略 A 的智能匹配作为兜底
- 添加透传逻辑处理真正的 404
- 最佳的性能和完整性平衡

**长期（企业级）**: 策略 D + CDN
- Redis 作为一级缓存
- R2/S3 作为二级存储
- Cloudflare Workers 全球分发
