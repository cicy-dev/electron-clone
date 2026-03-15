const $ = (id) => document.getElementById(id);
const API = 'https://g-8835.cicy.de5.net';

function stab(el,i){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('on'));
  el.classList.add('on');
  for(let j=0;j<4;j++) $('p'+j).style.display=j===i?'':'none';
}

async function api(p,o={}){
  const r=await fetch(API+p,{headers:{'Content-Type':'application/json'},...o});
  return r.json();
}

function wv(url, id) {
  var w = $(id);
  if (w) w.src = url;
  return w;
}

function setInfo(html){$('info').innerHTML=html}
function esc(s){const d=document.createElement('div');d.textContent=s;return d.innerHTML}

async function doSync(){
  const src=$('src').value.trim();
  if(!src)return;
  setInfo('<span class="spin"></span> 正在同步...');

  try{
    const res=await api('/api/sync',{method:'POST',body:JSON.stringify({url:src})});
    if(res.ok){
      setInfo(`<span class="tag tag-g">✓ 修复 ${res.resolved.length}</span> <span class="tag tag-r">404: ${res.notFound.length}</span> <span class="tag tag-o">异常: ${res.errors.length}</span> <span class="tag tag-b">索引: ${res.stats?.indexed||0}</span>`);
      wv(src, 'wv-a'); $('la').textContent = src;
      try {
        const srcUrl = new URL(src);
        const cloneBase = $('dst').value.trim().replace(/\/$/, '');
        const cloneUrl = cloneBase + srcUrl.pathname + srcUrl.search;
        wv(cloneUrl, 'wv-b'); $('lb').textContent = cloneUrl;
      } catch {
        wv($('dst').value.trim(), 'wv-b'); $('lb').textContent = $('dst').value.trim();
      }
      localStorage.setItem('cs-src', src);
    } else {
      setInfo(`<span class="tag tag-r">失败: ${esc(res.error)}</span>`);
    }
    refreshPanel();
  } catch(e) {
    setInfo(`<span class="tag tag-r">错误: ${esc(e.message)}</span>`);
  }
}

async function refreshPanel(){
  const res=await api('/api/status');
  if(!res.ok)return;
  const s=res.state;
  $('p0').innerHTML=s.log.length?s.log.map(l=>`<div class="li">${esc(l)}</div>`).join(''):'<div style="color:var(--t2);padding:20px;text-align:center">无日志</div>';
  $('p0').scrollTop=$('p0').scrollHeight;
  $('n404').textContent=s.notFound.length||'';
  $('p1').innerHTML=s.notFound.length?s.notFound.map(u=>`<div class="li r">${esc(u)}</div>`).join(''):'<div style="color:var(--t2);padding:20px;text-align:center">无</div>';
  $('nerr').textContent=s.errors.length||'';
  $('p2').innerHTML=s.errors.length?s.errors.map(e=>`<div class="li o">${esc(e.url)}<br><small>${esc(e.error)}</small></div>`).join(''):'<div style="color:var(--t2);padding:20px;text-align:center">无</div>';
  const cfg=await api('/api/config');
  if(cfg.ok)renderConfig(cfg.config);
}

function renderConfig(c){
  $('p3').innerHTML=`
    <div class="cfg-row"><span class="lbl">白名单域名</span>
      <div class="wl-row"><input id="wl-in" placeholder="example.com" onkeydown="if(event.key==='Enter')addWL()"/><button class="btn" onclick="addWL()">+</button></div>
      <div id="wl-tags">${(c.whitelist_domains||[]).map(d=>`<span class="wl-tag">${esc(d)} <span class="x" onclick="rmWL('${esc(d)}')">×</span></span>`).join('')}</div>
    </div>
    <div class="cfg-row"><span class="lbl">并发数</span>
      <input id="cfg-c" type="number" value="${c.concurrency}" style="width:50px;padding:3px 6px;border-radius:4px;border:1px solid var(--bd);background:var(--bg);color:var(--t1)"/>
      <button class="btn" onclick="saveCfg()" style="margin-left:4px">保存</button>
    </div>`;
}

async function addWL(){
  const v=$('wl-in').value.trim();if(!v)return;
  const r=await api('/api/config');
  const wl=r.config.whitelist_domains;
  if(!wl.includes(v))wl.push(v);
  await api('/api/config',{method:'POST',body:JSON.stringify({whitelist_domains:wl})});
  refreshPanel();
}
async function rmWL(d){
  const r=await api('/api/config');
  await api('/api/config',{method:'POST',body:JSON.stringify({whitelist_domains:r.config.whitelist_domains.filter(x=>x!==d)})});
  refreshPanel();
}
async function saveCfg(){
  await api('/api/config',{method:'POST',body:JSON.stringify({concurrency:parseInt($('cfg-c').value)||20})});
  refreshPanel();
}

window.stab = stab;
window.addWL = addWL;
window.rmWL = rmWL;
window.saveCfg = saveCfg;

const p=new URLSearchParams(location.search);
const urlA=p.get('urlA');
const urlB=p.get('urlB');
if(urlA) wv(urlA, 'wv-a');
if(urlB) wv(urlB, 'wv-b');

const urlP=p.get('url');
$('src').value=urlP||localStorage.getItem('cs-src')||'https://www.bet365.com/';
$('dst').value='https://g-8787.cicy.de5.net';
$('dst').disabled=true;

console.log('Clone Studio v1.0.2');
setTimeout(doSync, 500);
refreshPanel();
