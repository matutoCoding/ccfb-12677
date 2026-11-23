// 通用工具: ID 生成、数值格式化、下载/上传、本地 HTML 清单
export const uid = (prefix = 'id'): string =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export const fmt = (n: number, digits = 2): string => {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 0, maximumFractionDigits: digits });
};

export const fmtMoney = (n: number): string =>
  '¥' + n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtTime = (ts: number): string => new Date(ts).toLocaleString('zh-CN', { hour12: false });

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File> {
  return new Promise(resolve => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => { if (input.files?.[0]) resolve(input.files[0]); };
    input.click();
  });
}

/** 现场安装清单: 生成自包含离线 HTML, 手机浏览器打开可逐项勾选, 状态存 localStorage, 可导出汇总 JSON */
export function buildChecklistHtml(title: string, rows: { id: string; label: string; detail: string }[]): string {
  const data = JSON.stringify(rows).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} - 现场安装清单</title>
<style>
body{font-family:system-ui,"Microsoft YaHei",sans-serif;margin:0;background:#0f1420;color:#e6ebf5}
header{position:sticky;top:0;background:#162033;padding:14px 16px;box-shadow:0 2px 8px #0008;z-index:2}
h1{font-size:17px;margin:0 0 8px}.bar{display:flex;gap:10px;align-items:center;font-size:13px;color:#9fb3d1}
progress{flex:1;height:8px}
.item{display:flex;gap:12px;align-items:flex-start;padding:13px 16px;border-bottom:1px solid #24314a}
.item.done{opacity:.45}.item.done .lbl{text-decoration:line-through}
.box{width:24px;height:24px;flex:0 0 24px;border:2px solid #4a6da7;border-radius:6px;display:grid;place-items:center;font-size:16px;color:#7ee2a8}
.item.done .box{background:#1d3a2a;border-color:#3fa56d}
.lbl{font-weight:600;font-size:15px}.det{font-size:12px;color:#8aa0c2;margin-top:3px}
button{background:#2b5cb8;color:#fff;border:0;border-radius:8px;padding:8px 14px;font-size:13px}
</style></head><body>
<header><h1>${title} · 现场安装清单</h1>
<div class="bar"><progress id="p" value="0" max="100"></progress><span id="cnt"></span>
<button onclick="exp()">导出完成状态</button></div></header>
<div id="list"></div>
<script>
const ROWS = ${data};
const KEY = 'tld-checklist-' + ${JSON.stringify(title)};
const state = JSON.parse(localStorage.getItem(KEY) || '{}');
function render(){
  const el = document.getElementById('list');
  el.innerHTML = ROWS.map(r => '<div class="item'+(state[r.id]?' done':'')+'" onclick="toggle(\\''+r.id+'\\')">'
    + '<div class="box">'+(state[r.id]?'✓':'')+'</div>'
    + '<div><div class="lbl">'+r.label+'</div><div class="det">'+r.detail+'</div></div></div>').join('');
  const done = ROWS.filter(r=>state[r.id]).length;
  document.getElementById('p').value = done/ROWS.length*100;
  document.getElementById('cnt').textContent = done+' / '+ROWS.length;
}
function toggle(id){ state[id]=!state[id]; localStorage.setItem(KEY,JSON.stringify(state)); render(); }
function exp(){
  const payload = { title: ${JSON.stringify(title)}, exportedAt: new Date().toISOString(),
    results: ROWS.map(r => ({ id:r.id, label:r.label, done: !!state[r.id] })) };
  const blob = new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);
  a.download='checklist-progress.json';a.click();
}
render();
</script></body></html>`;
}
