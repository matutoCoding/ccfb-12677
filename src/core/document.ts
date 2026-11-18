// ============================================================
// 出图 / 报价单 / 安装清单
// - 施工平面图：SVG（按比例 mm→px，带图框图签），可批量打印为 PDF
// - 报价单：可打印 HTML
// - 现场安装清单：JSON 导入导出，手机端逐项勾选后导回汇总
// 纯本地，无网络依赖；PDF 走浏览器打印（window.print 友好的排版）
// ============================================================
import type { FixtureInstance, Project, Quote, RigTask, Vec3, Venue } from '../types';

export interface DrawingOptions {
  scaleDenominator: number; // 1:50 / 1:100
  sheetMm: { w: number; h: number };
  title: string;
  drawer: string;
}

/** 平面图投影（俯视，x-y 平面），按比例缩放并加图框图签 */
export function buildPlanSvg(
  project: Project,
  venue: Venue | undefined,
  fixtures: FixtureInstance[],
  opts: DrawingOptions,
): string {
  const env = venue?.envelope ?? { width: 20000, depth: 15000, height: 10000 };
  const margin = 1500;
  const worldW = env.width + margin * 2;
  const worldD = env.depth + margin * 2;
  const pxPerMm = opts.sheetMm.w / worldW;
  const pxPerMmY = opts.sheetMm.h / worldD;
  const s = Math.min(pxPerMm, pxPerMmY);
  const W = worldW * s;
  const H = worldD * s;
  const ox = margin;
  const oy = margin;
  const px = (p: Vec3) => ({ x: (p.x + ox) * s, y: (p.y + oy) * s });

  const hangCircles = (venue?.hangPoints ?? [])
    .map((hp) => {
      const p = px(hp.position);
      return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(60 * s).toFixed(1)}" fill="none" stroke="#7aa2ff" stroke-width="1"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y - 90 * s).toFixed(1)}" class="lbl">${hp.code}</text>`;
    })
    .join('\n');

  const trussLines = project.truss
    .map((t) => {
      const a = px(t.from);
      const b = px(t.to);
      return `<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke="#ffb86b" stroke-width="3"/>`;
    })
    .join('\n');

  const fixtureMarkers = fixtures
    .map((fx) => {
      const p = px(fx.position);
      const color = fx.kind === 'moving-head' ? '#ff5d73' : '#5dffb0';
      return `<g><circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${(120 * s).toFixed(1)}" fill="${color}" stroke="#0b0f17" stroke-width="0.8"/>
      <text x="${p.x.toFixed(1)}" y="${(p.y + 260 * s).toFixed(1)}" class="lbl">${fx.uid}</text></g>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${W.toFixed(0)}" height="${H.toFixed(0)}" viewBox="0 0 ${W.toFixed(0)} ${H.toFixed(0)}">
  <style>
    .frame { fill: #ffffff; stroke: #111; stroke-width: 2; }
    .lbl { font: 11px sans-serif; fill: #222; text-anchor: middle; }
    .title { font: bold 16px sans-serif; fill: #111; }
    .meta { font: 12px sans-serif; fill: #333; }
  </style>
  <rect class="frame" x="4" y="4" width="${(W - 8).toFixed(0)}" height="${(H - 8).toFixed(0)}"/>
  <rect x="${(ox * s).toFixed(1)}" y="${(oy * s).toFixed(1)}" width="${(env.width * s).toFixed(1)}" height="${(env.depth * s).toFixed(1)}" fill="none" stroke="#999" stroke-dasharray="6 4"/>
  ${hangCircles}
  ${trussLines}
  ${fixtureMarkers}
  ${titleBlock(W, H, opts, fixtures.length)}
</svg>`;
}

function titleBlock(W: number, H: number, opts: DrawingOptions, fixtureCount: number): string {
  const bw = 340;
  const bh = 110;
  const x = W - bw - 12;
  const y = H - bh - 12;
  const today = new Date().toISOString().slice(0, 10);
  return `<g>
    <rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="#f7f8fa" stroke="#111" stroke-width="1.5"/>
    <line x1="${x}" y1="${y + 28}" x2="${x + bw}" y2="${y + 28}" stroke="#111"/>
    <line x1="${x}" y1="${y + 56}" x2="${x + bw}" y2="${y + 56}" stroke="#111"/>
    <line x1="${x + 170}" y1="${y + 28}" x2="${x + 170}" y2="${y + bh}" stroke="#111"/>
    <text x="${x + 10}" y="${y + 20}" class="title">${opts.title}</text>
    <text x="${x + 10}" y="${y + 48}" class="meta">比例 1:${opts.scaleDenominator} · 灯具 ${fixtureCount} 台</text>
    <text x="${x + 10}" y="${y + 76}" class="meta">制图 ${opts.drawer}</text>
    <text x="${x + 10}" y="${y + 100}" class="meta">日期 ${today}</text>
    <text x="${x + 180}" y="${y + 48}" class="meta">TourLight</text>
    <text x="${x + 180}" y="${y + 76}" class="meta">图号 TL-${today.replaceAll('-', '')}</text>
  </g>`;
}

/** 触发浏览器打印为 PDF（页面须已是打印友好布局） */
export function printToPdf(): void {
  window.print();
}

/** 报价单 HTML（可直接打印） */
export function quoteToHtml(quote: Quote): string {
  const rows = quote.lines
    .map(
      (l) => `<tr><td>${l.label}</td><td>${l.qty}${l.unit}</td><td>${l.unitPrice.toFixed(2)}</td>
      <td>${l.days ?? '-'}</td><td>${l.subtotal.toFixed(2)}</td></tr>`,
    )
    .join('');
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${quote.title}</title>
  <style>body{font-family:sans-serif;margin:40px;color:#111}table{width:100%;border-collapse:collapse;margin-top:16px}
  th,td{border:1px solid #888;padding:8px;text-align:left}tfoot td{font-weight:bold}h1{font-size:22px}</style></head>
  <body><h1>${quote.title} · 报价单</h1>
  <p>演出 ${quote.showDays} 天 · 装台 ${quote.installDays} 天 · 撤场 ${quote.strikeDays} 天</p>
  <table><thead><tr><th>项目</th><th>数量</th><th>单价(元)</th><th>天数</th><th>小计(元)</th></tr></thead>
  <tbody>${rows}</tbody><tfoot><tr><td colspan="4">合计</td><td>${quote.total.toFixed(2)}</td></tr></tfoot></table>
  </body></html>`;
}

// ---------------- 现场安装清单（手机勾选，导回汇总） ----------------

export interface InstallChecklistItem {
  fixtureId: string;
  uid: string;
  hangPointCode?: string;
  serialNo?: string;
  done: boolean;
  checkedBy?: string;
  checkedAt?: number;
}

export function buildInstallChecklist(project: Project, venue?: Venue): {
  exportedAt: number;
  projectId: string;
  items: InstallChecklistItem[];
} {
  const hpMap = new Map(venue?.hangPoints.map((h) => [h.id, h]));
  return {
    exportedAt: Date.now(),
    projectId: project.id,
    items: project.fixtures.map((fx) => ({
      fixtureId: fx.id,
      uid: fx.uid,
      hangPointCode: fx.hangPointId ? hpMap.get(fx.hangPointId)?.code : undefined,
      serialNo: fx.serialNo,
      done: false,
    })),
  };
}

export function summarizeChecklist(
  items: InstallChecklistItem[],
): { done: number; total: number; percent: number; pending: InstallChecklistItem[] } {
  const done = items.filter((i) => i.done).length;
  return {
    done,
    total: items.length,
    percent: items.length ? done / items.length : 0,
    pending: items.filter((i) => !i.done),
  };
}

/** 吊装日历（按天分组） */
export function rigCalendar(tasks: RigTask[]): Record<string, RigTask[]> {
  const cal: Record<string, RigTask[]> = {};
  for (const t of [...tasks].sort((a, b) => a.startHm.localeCompare(b.startHm))) {
    (cal[t.day] ??= []).push(t);
  }
  return cal;
}
