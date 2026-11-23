// 页面五: 出图报价 —— 报价单/线缆/吊装/库存/MVR-GDTF/PDF/手机清单
import { h, section, field, numInput, textInput, button, table, badge, toast, select } from './dom.ts';
import type { ViewportHandle } from './viewport.ts';
import { store } from '../core/store.ts';
import { buildQuote, autoRentalLines, summarizeCables, scheduleRigging, autoCableRuns } from '../core/quote.ts';
import { findBookingConflicts, stockGap, checkout, checkIn } from '../core/inventory.ts';
import { exportMVR, importMVR, verifyRoundtrip, downloadBytes } from '../core/mvr.ts';
import { buildPdf, newSheet, type PdfPage } from '../core/pdf.ts';
import { buildChecklistHtml, downloadText, pickFile, fmtMoney, fmt, uid } from '../core/util.ts';
import type { Project } from '../core/types.ts';

type Tab = 'quote' | 'inventory' | 'mvr' | 'drawing';

export function outputPage(_vp: ViewportHandle): HTMLElement {
  let tab: Tab = 'quote';
  const root = h('div', { class: 'layout' });
  const p = (): Project => {
    const proj = store.activeProject;
    if (!proj) throw new Error('无活动工程');
    return proj;
  };
  let rentalDays = 7;
  let taxRate = 0.09;

  const rerender = (): void => root.replaceChildren(buildSidebar(), buildMain());

  const buildSidebar = (): HTMLElement => {
    const tabs: [Tab, string][] = [['quote', '报价/线缆/吊装'], ['inventory', '库存档期/核销'], ['mvr', 'MVR/GDTF'], ['drawing', 'PDF出图/清单']];
    return h('div', { class: 'sidebar wide' },
      h('div', { class: 'tabs' }, ...tabs.map(([id, label]) =>
        h('button', { class: tab === id ? 'active' : '', onClick: () => { tab = id; rerender(); } }, label))),
      tab === 'quote' ? quoteTab() : tab === 'inventory' ? inventoryTab() :
      tab === 'mvr' ? mvrTab() : drawingTab(),
    );
  };

  // ---------------- 报价 ----------------
  const quoteTab = (): HTMLElement => {
    const proj = p();
    const totals = buildQuote(proj, taxRate);
    return h('div', {},
      section('报价参数',
        field('用灯天数', numInput(rentalDays, v => { rentalDays = v; rerender(); })),
        field('税率', numInput(taxRate, v => { taxRate = v; rerender(); }, 0.01)),
        button('按灯具型号自动生成租赁行', () => {
          const dayRate: Record<string, number> = {};
          for (const m of store.state.lampModels) dayRate[m.id] = m.kind.startsWith('moving') ? 350 : 120;
          const auto = autoRentalLines(proj, store.state.lampModels, dayRate, rentalDays);
          proj.quoteLines = [...proj.quoteLines.filter(l => l.kind !== 'rental'), ...auto];
          // 人工与运输默认估算
          if (!proj.quoteLines.some(l => l.kind === 'labor')) {
            proj.quoteLines.push({ kind: 'labor', name: '灯光技术工日', unit: '工日', qty: Math.ceil(proj.fixtures.length / 40) * rentalDays, unitPrice: 450, days: 1 });
            proj.quoteLines.push({ kind: 'transport', name: '9.6m 货车运输', unit: '车次', qty: Math.max(2, Math.ceil(proj.fixtures.length / 120)), unitPrice: 2800, days: 1 });
          }
          persist(); rerender();
        }, true),
      ),
      section('报价明细',
        table(['类别', '项目', '数量', '单价', '天数', '金额'],
          totals.lines.map((l, i) => [
            l.kind, l.name, String(l.qty), fmtMoney(l.unitPrice), String(l.days), fmtMoney(l.amount),
          ]).concat([
            ['', h('strong', {}, '不含税合计') as unknown as string, '', '', '', fmtMoney(totals.subtotal)],
            ['', h('strong', {}, `税金(${(taxRate * 100).toFixed(0)}%)`) as unknown as string, '', '', '', fmtMoney(totals.tax)],
            ['', h('strong', {}, '含税总价') as unknown as string, '', '', '', h('strong', { style: { color: 'var(--warn)' } }, fmtMoney(totals.total)) as unknown as string],
          ]),
        ),
        button('＋ 自定义费用行', () => {
          proj.quoteLines.push({ kind: 'other', name: '自定义项', unit: '项', qty: 1, unitPrice: 1000, days: 1 });
          persist(); rerender();
        }),
        button('导出报价单 JSON', () => {
          downloadText(`${proj.name}-报价单.json`, JSON.stringify({ project: proj.name, lines: totals.lines, totals }, null, 2), 'application/json');
          toast('报价单已导出');
        }),
      ),
      section('线缆清册 (按走线路径算长度 + 接头统计)',
        button('重新自动布线', () => {
          proj.cables = autoCableRunsWrapper(proj);
          persist(); rerender();
        }),
        (() => {
          const sum = summarizeCables(proj.cables);
          return h('div', {},
            h('div', { class: 'btn-row', style: { marginBottom: '8px' } },
              badge(`${proj.cables.length} 根`, 'info'),
              badge(`总长 ${fmt(sum.totalLength, 1)} m`, 'info'),
            ),
            table(['线缆类型', '数量', '总长度(m)', '接头型号'],
              Object.entries(sum.byType).map(([type, s]) =>
                [type, String(s.count), s.totalLength.toFixed(1), [...s.connectors].join('; ')])),
          );
        })(),
      ),
      section('吊装工序 (带时间的班组任务)',
        button('按桁架自动排程', () => {
          proj.rigTasks = scheduleRigging(proj);
          persist(); rerender();
        }),
        proj.rigTasks.length ? table(['日期', '开始', '工时(h)', '班组', '任务'],
          proj.rigTasks.map(t => [
            t.day, `${t.startHour}:00`, String(t.durationHours), t.crew, t.description,
          ])) : h('div', { class: 'muted' }, '点击按钮生成排程, 哪天上哪组人装哪根桁架一目了然'),
      ),
    );
  };

  // ---------------- 库存 ----------------
  const inventoryTab = (): HTMLElement => {
    const conflicts = findBookingConflicts(store.state.inventory);
    const gaps = stockGap(p(), store.state.inventory, store.state.lampModels);
    return h('div', {},
      section('档期冲突 (同一序列号被两个项目占用)',
        conflicts.length ? table(['序列号', '型号', '冲突项目'],
          conflicts.map(c => [
            h('span', { class: 'mono' }, c.serialNo) as unknown as string,
            c.modelId,
            c.projectIds.join(' vs ') + ' ' + badge('撞档', 'err'),
          ])) : badge('无档期冲突', 'ok'),
      ),
      section('项目占灯 vs 库存台账',
        table(['型号', '需求', '空闲可用', '缺口'],
          gaps.map(g => [
            g.modelName, String(g.required), String(g.available),
            g.gap ? badge(String(g.gap), 'err') as unknown as string : badge('0', 'ok') as unknown as string,
          ])),
        h('div', { class: 'btn-row' },
          button('按项目出库 (分配序列号)', () => {
            const r = checkout(p(), store.state.inventory);
            store.mutate(s => s.inventory = r.inventory);
            p().fixtures.forEach(fx => { if (r.assignments[fx.id]) fx.serialNo = r.assignments[fx.id]; });
            toast(r.shortage.length ? `出库完成, ${r.shortage.length} 台库存不足: ${r.shortage.slice(0, 5).join(',')}` : `已出库 ${Object.keys(r.assignments).length} 台并写入序列号`);
            rerender();
          }, true),
          button('撤场核销 (按在库序列号全部归还)', () => {
            const outSerials = store.state.inventory.filter(i => i.status === 'out' && i.projectId === p().id).map(i => i.serialNo);
            const r = checkIn(store.state.inventory, outSerials);
            store.mutate(s => s.inventory = r.inventory);
            p().fixtures.forEach(fx => { fx.serialNo = undefined; });
            toast(r.missing.length ? `未归还: ${r.missing.join(',')}` : `已核销归还 ${outSerials.length} 台`);
            rerender();
          }),
        ),
      ),
      section('库存台账 (前 30 条)',
        table(['序列号', '型号', '状态', '占用项目'],
          store.state.inventory.slice(0, 30).map(i => [
            h('span', { class: 'mono' }, i.serialNo) as unknown as string,
            i.modelId,
            badge(i.status, i.status === 'out' ? 'warn' : 'ok') as unknown as string,
            i.projectId ?? '—',
          ]),
          { maxHeight: '260px' },
        ),
      ),
    );
  };

  // ---------------- MVR / GDTF ----------------
  const mvrTab = (): HTMLElement =>
    h('div', {},
      section('GDTF 灯具描述 + MVR 场景打包',
        h('div', { class: 'muted' }, 'MVR 包内含标准 GeneralSceneDescription.xml、每台灯的 GDTF 描述, 以及精确坐标表保证回导零偏差。'),
        button('导出 MVR 包 (.mvr.zip)', () => {
          const bytes = exportMVR(p(), store.state.lampModels);
          downloadBytes(`${p().name}.mvr.zip`, bytes, 'application/zip');
          toast(`MVR 包已导出 (${(bytes.length / 1024).toFixed(1)} KB), 可导去控台/可视化软件`);
        }, true),
      ),
      section('回导校验 (坐标零偏差硬指标)',
        button('选择刚导出的 MVR 包回导并比对', async () => {
          const file = await pickFile('.zip,.mvr');
          const buf = new Uint8Array(await file.arrayBuffer());
          const imported = importMVR(buf);
          const verify = verifyRoundtrip(p().fixtures, imported);
          toast(imported.usedExactTable
            ? `回导 ${imported.fixtures.length} 灯, 最大坐标偏差 ${verify.maxDeviation} m (要求 0)`
            : `标准 XML 回导, 最大偏差 ${verify.maxDeviation.toExponential(2)} m; ${imported.warnings.join(';')}`,
            verify.maxDeviation === 0 ? 'ok' : 'err');
          rerender();
          window.__lastMvrVerify = verify;
        }),
        h('div', { class: 'muted' }, '精确表往返路径最大偏差必须恒为 0; 测试套件 tests/mvr.test.ts 持续守护该指标。'),
      ),
    );

  // ---------------- PDF / 清单 ----------------
  const drawingTab = (): HTMLElement =>
    h('div', {},
      section('施工平面图批量出 PDF (按比例 + 图框图签)',
        field('设计人', textInput('灯光设计组', () => {})),
        button('生成 A3 横向多页 PDF (平面 + 桁架 + 灯位表)', () => {
          const pages = buildPlanPdf(p());
          const bytes = buildPdf(pages);
          downloadBytes(`${p().name}-施工图.pdf`, bytes, 'application/pdf');
          toast(`已生成 ${pages.length} 页 PDF (${(bytes.length / 1024).toFixed(1)} KB)`);
        }, true),
      ),
      section('现场安装清单 (发手机逐项勾选)',
        h('div', { class: 'muted' }, '生成单个自包含 HTML, 离线发到手机; 现场勾选状态存浏览器, 可导出 JSON 回传汇总。'),
        button('生成手机安装清单 HTML', () => {
          const rows = p().fixtures.slice(0, 400).map(fx => ({
            id: fx.id,
            label: fx.label,
            detail: `型号:${fx.modelId} · 桁架:${fx.trussId ?? '—'} · 地址:U${fx.universe}.${fx.dmxStart} · 坐标:(${fx.position.map(n => n.toFixed(2)).join(',')})`,
          }));
          const html = buildChecklistHtml(p().name, rows);
          downloadText(`${p().name}-安装清单.html`, html, 'text/html');
          toast(`清单含 ${rows.length} 项, 用手机浏览器打开即可`);
        }),
        button('导回现场完成状态并汇总', async () => {
          const file = await pickFile('.json');
          const data = JSON.parse(await file.text());
          const done = data.results?.filter((r: { done: boolean }) => r.done).length ?? 0;
          const total = data.results?.length ?? 0;
          toast(`现场进度: ${done}/${total} 项完成 (${(done / Math.max(1, total) * 100).toFixed(1)}%)`);
        }),
      ),
      section('工程归档',
        h('div', { class: 'btn-row' },
          button('导出整工程 JSON (含附件)', async () => {
            const json = await store.exportProject(p().id);
            downloadText(`${p().name}-工程包.json`, json, 'application/json');
            toast('工程包已导出');
          }),
          button('导入工程包', async () => {
            const file = await pickFile('.json');
            await store.importProject(await file.text());
            toast('工程已导入');
            rerender();
          }),
        ),
      ),
    );

  const buildMain = (): HTMLElement =>
    h('div', { class: 'main' },
      h('div', { class: 'bottom-panel' },
        h('div', { class: 'stat-grid' },
          stat(p().fixtures.length, '灯具'),
          stat(p().cables.length, '线缆根数'),
          stat(p().rigTasks.length, '吊装任务'),
          stat(store.state.inventory.filter(i => i.status === 'out').length, '已出库'),
        ),
      ),
    );

  const persist = (): void => store.mutate(() => {});
  rerender();
  return root;
}

// 线缆自动布线直接复用 core/quote 的纯函数
function autoCableRunsWrapper(proj: Project) {
  return autoCableRuns(proj);
}

function buildPlanPdf(proj: Project): PdfPage[] {
  const pages: PdfPage[] = [];
  const date = new Date().toISOString().slice(0, 10);
  // 第 1 页: 平面示意 (按 1:100 比例缩放到 A3 图框内)
  const p1 = newSheet({
    projectName: proj.name, drawingName: '灯光施工平面图 · 桁架与灯位',
    scale: '1:100', sheetNo: 'DL-01', designer: '灯光设计组', date,
  });
  const ox = 25, oy = 240, scaleMm = 3.2; // 1m -> 3.2mm
  // 桁架
  for (const tr of proj.trusses) {
    p1.lines.push({
      x1: ox + tr.from[0] * scaleMm, y1: oy - tr.from[1] * scaleMm,
      x2: ox + tr.to[0] * scaleMm, y2: oy - tr.to[1] * scaleMm,
      width: 0.8, gray: 0.2,
    });
  }
  // 灯位 (前 300 个, 避免页面过载)
  for (const fx of proj.fixtures.slice(0, 300)) {
    p1.circles.push({ x: ox + fx.position[0] * scaleMm, y: oy - fx.position[1] * scaleMm, r: 0.9, width: 0.3 });
  }
  p1.texts.push({ x: ox, y: oy + 12, size: 4, text: `灯具总数 ${proj.fixtures.length} (本页标注前 300), 桁架 ${proj.trusses.length} 根` });
  pages.push(p1);

  // 第 2 页: 灯位表
  const p2 = newSheet({
    projectName: proj.name, drawingName: '灯位地址表', scale: 'NTS', sheetNo: 'DL-02', designer: '灯光设计组', date,
  });
  let y = 265;
  p2.texts.push({ x: 25, y, size: 4.5, bold: true, text: '灯号        型号              桁架        坐标 X/Y/Z (m)              Art-Net 地址' });
  y -= 7;
  for (const fx of proj.fixtures.slice(0, 32)) {
    p2.texts.push({
      x: 25, y, size: 3.4,
      text: `${fx.label.padEnd(10)} ${fx.modelId.padEnd(16)} ${(fx.trussId ?? '-').padEnd(10)} ${fx.position.map(n => n.toFixed(2).padStart(7)).join(' ')}        U${fx.universe}.${fx.dmxStart}`,
    });
    y -= 5.5;
  }
  pages.push(p2);
  return pages;
}

const stat = (n: number, label: string): HTMLElement =>
  h('div', { class: 'stat' }, h('div', { class: 'num' }, String(n)), h('div', { class: 'lbl' }, label));

void select; void uid;
declare global {
  interface Window { __lastMvrVerify?: unknown; }
}
