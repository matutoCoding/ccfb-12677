import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/use-store';
import { buildQuote, cableLedger, findBookingConflicts, reconcileProjectInventory, rigProgress } from '../core/inventory';
import { buildInstallChecklist, buildPlanSvg, quoteToHtml, rigCalendar, summarizeChecklist, type InstallChecklistItem } from '../core/document';
import { exportMvr, importMvr, roundTripCheck, type MvrImportResult } from '../core/mvr';
import { downloadBytes, downloadText, readFileAsBytes } from '../store/storage';

type Tab = 'mvr' | 'drawing' | 'quote' | 'cable' | 'rig' | 'checklist' | 'inventory';

export function OutputPage() {
  const state = useStore();
  const project = state.activeProject()!;
  const venue = project.activeVenueId ? state.venues[project.activeVenueId] : undefined;
  const [tab, setTab] = useState<Tab>('mvr');
  const [mvrResult, setMvrResult] = useState<MvrImportResult | null>(null);
  const [scale, setScale] = useState(100);
  const importRef = useRef<HTMLInputElement>(null);
  const checklistRef = useRef<HTMLInputElement>(null);
  const [checklist, setChecklist] = useState<InstallChecklistItem[]>([]);
  const defMap = useMemo(() => new Map(project.fixtureDefinitions.map((d) => [d.id, d])), [project]);
  const conflicts = useMemo(() => findBookingConflicts(state.bookings), [state.bookings]);
  const reconcile = useMemo(() => reconcileProjectInventory(project.fixtures, state.inventory, project.id), [project, state.inventory]);

  const doRoundTrip = () => setMvrResult(roundTripCheck(project));
  const doExportMvr = () => downloadBytes(`${project.name}.mvr`, exportMvr(project), 'application/octet-stream');
  const doImportMvr = async (file: File) => {
    const bytes = await readFileAsBytes(file);
    setMvrResult(importMvr(bytes, project.fixtures));
  };

  const quote = useMemo(
    () => buildQuote({
      title: project.name,
      venueId: venue?.id,
      fixtures: project.fixtures,
      definitions: defMap,
      showDays: 3, installDays: 2, strikeDays: 1,
      laborDayRate: 800, laborPersonDays: 24, truckTripRate: 3500, truckTrips: 5,
    }),
    [project, defMap, venue],
  );
  const ledger = useMemo(() => cableLedger(project.cables.length ? project.cables : demoCables()), [project.cables]);
  const calendar = rigCalendar(project.rigTasks);
  const progress = rigProgress(project.rigTasks);

  const planSvg = useMemo(
    () => buildPlanSvg(project, venue, project.fixtures, {
      scaleDenominator: scale,
      sheetMm: { w: 420, h: 297 },
      title: `${project.name} 施工平面图`,
      drawer: 'TourLight',
    }),
    [project, venue, scale],
  );

  const exportChecklist = () => {
    const pkg = buildInstallChecklist(project, venue);
    setChecklist(pkg.items);
    downloadText(`install-${project.id}.json`, JSON.stringify(pkg, null, 2), 'application/json');
  };
  const importChecklist = async (file: File) => {
    const pkg = JSON.parse(await file.text()) as { items: InstallChecklistItem[] };
    setChecklist(pkg.items);
  };

  return (
    <div className="main">
      <div className="sidebar">
        <div className="tabs" style={{ flexDirection: 'column' }}>
          {([
            ['mvr', 'GDTF / MVR'], ['drawing', '施工平面图'], ['quote', '报价单'],
            ['cable', '线缆清册'], ['rig', '吊装工序'], ['checklist', '安装清单'], ['inventory', '库存档期'],
          ] as [Tab, string][]).map(([k, label]) => (
            <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)} style={{ textAlign: 'left' }}>{label}</button>
          ))}
        </div>
      </div>

      <div className="content scroll" style={{ padding: 16 }}>
        {tab === 'mvr' && (
          <div className="panel">
            <h3>GDTF / MVR 标准打包与往返核对</h3>
            <div className="btn-row">
              <button className="btn" onClick={doExportMvr}>导出 .mvr（含 GDTF 描述）</button>
              <button className="btn ghost" onClick={doRoundTrip}>工程内往返自检</button>
              <button className="btn ghost" onClick={() => importRef.current?.click()}>导入 .mvr</button>
              <input ref={importRef} type="file" accept=".mvr" hidden onChange={(e) => e.target.files?.[0] && doImportMvr(e.target.files[0])} />
            </div>
            {mvrResult && (
              <>
                <div className={`metric ${mvrResult.maxDeviationMm === 0 ? 'ok-text' : 'danger-text'}`}>
                  <span>灯位坐标最大偏差</span>
                  <span className="v">{mvrResult.maxDeviationMm} mm {mvrResult.maxDeviationMm === 0 ? '✓ 零偏差' : '✗'}</span>
                </div>
                <div className="metric"><span>导回灯具数</span><span className="v">{mvrResult.fixtures.length}</span></div>
                <div className="metric"><span>桁架数</span><span className="v">{mvrResult.truss.length}</span></div>
                <div className="metric"><span>GDTF 规格</span><span className="v">{mvrResult.gdtfSpecs.map((g) => g.model).join('、') || '内嵌解析'}</span></div>
                <table><thead><tr><th>灯具</th><th>期望坐标(mm)</th><th>导回坐标(mm)</th><th>偏差</th></tr></thead>
                  <tbody>
                    {mvrResult.coordinateCheck.slice(0, 12).map((c) => (
                      <tr key={c.fixtureId}>
                        <td className="mono">{project.fixtures.find((f) => f.id === c.fixtureId)?.uid}</td>
                        <td className="mono">{fmt(c.expected)}</td>
                        <td className="mono">{fmt(c.actual)}</td>
                        <td className={c.deviationMm === 0 ? 'ok-text' : 'danger-text'}>{c.deviationMm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {tab === 'drawing' && (
          <div className="panel">
            <h3>施工平面图（按比例 · 图框图签 · 批量 PDF）</h3>
            <div className="inline" style={{ marginBottom: 10 }}>
              <label style={{ margin: 0 }}>比例 1:</label>
              <select value={scale} onChange={(e) => setScale(Number(e.target.value))} style={{ width: 100 }}>
                {[50, 100, 150, 200].map((s) => <option key={s}>{s}</option>)}
              </select>
              <button className="btn small" onClick={() => {
                downloadText(`${project.name}-plan.svg`, planSvg, 'image/svg+xml');
                setTimeout(() => window.print(), 300);
              }}>导出 SVG 并打印 PDF</button>
            </div>
            <div style={{ overflow: 'auto', background: '#fff', padding: 8, borderRadius: 8 }}
              dangerouslySetInnerHTML={{ __html: planSvg }} />
          </div>
        )}

        {tab === 'quote' && (
          <div className="panel">
            <h3>报价单（租赁按天 + 人工工日 + 运输车次）</h3>
            <button className="btn small" onClick={() => {
              const w = window.open('', '_blank');
              w?.document.write(quoteToHtml(quote));
              w?.document.close();
            }}>打印 / 另存 PDF</button>
            <table>
              <thead><tr><th>项目</th><th>数量</th><th>单价</th><th>天数</th><th>小计(元)</th></tr></thead>
              <tbody>{quote.lines.map((l, i) => (
                <tr key={i}><td>{l.label}</td><td>{l.qty}{l.unit}</td><td>{l.unitPrice.toFixed(2)}</td>
                  <td>{l.days ?? '—'}</td><td className="mono">{l.subtotal.toFixed(2)}</td></tr>
              ))}</tbody>
              <tfoot><tr><td colSpan={4}>合计</td><td className="mono">{quote.total.toFixed(2)}</td></tr></tfoot>
            </table>
          </div>
        )}

        {tab === 'cable' && (
          <div className="panel">
            <h3>线缆清册（按走线路径折线计算长度）</h3>
            <div className="metric"><span>线缆总数</span><span className="v">{ledger.runs.length}</span></div>
            <div className="metric"><span>总长度</span><span className="v">{ledger.totalLengthM.toFixed(1)} m</span></div>
            <h4>接头型号统计</h4>
            {Object.entries(ledger.connectorSummary).map(([k, v]) => (
              <span key={k} className="tag info" style={{ marginRight: 6 }}>{k} × {v}</span>
            ))}
            <table style={{ marginTop: 10 }}>
              <thead><tr><th>信号</th><th>起点</th><th>终点</th><th>长度 m</th><th>接头</th></tr></thead>
              <tbody>{ledger.runs.map((c) => (
                <tr key={c.id}><td>{c.signal}</td><td className="mono">{c.fromNode}</td><td className="mono">{c.toNode}</td>
                  <td className="mono">{c.lengthM.toFixed(2)}</td><td>{c.connectorFrom}→{c.connectorTo}</td></tr>
              ))}</tbody>
            </table>
          </div>
        )}

        {tab === 'rig' && (
          <div className="panel">
            <h3>吊装工序（带时间的班组任务）</h3>
            <div className="metric"><span>总进度</span><span className="v">{(progress.percent * 100).toFixed(0)}%（{progress.done}/{progress.total}）</span></div>
            <div className="progress-track" style={{ margin: '8px 0' }}><div style={{ width: `${progress.percent * 100}%` }} /></div>
            {Object.entries(calendar).map(([day, tasks]) => (
              <div key={day} style={{ marginBottom: 12 }}>
                <h4>{day}</h4>
                {tasks.map((t) => (
                  <div key={t.id} className="cue-row">
                    <span className="mono">{t.startHm}-{t.endHm}</span>
                    <span className="tag info">{t.crew}</span>
                    <span style={{ flex: 1 }}>{t.description}</span>
                    <input type="checkbox" checked={t.done} onChange={() => state.updateProject(project.id, (p) => ({
                      ...p, rigTasks: p.rigTasks.map((x) => x.id === t.id ? { ...x, done: !x.done } : x),
                    }))} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        {tab === 'checklist' && (
          <div className="panel">
            <h3>现场安装清单（手机勾选 → 导回汇总）</h3>
            <div className="btn-row">
              <button className="btn" onClick={exportChecklist}>导出清单 JSON（发手机）</button>
              <button className="btn ghost" onClick={() => checklistRef.current?.click()}>导回勾选结果</button>
              <input ref={checklistRef} type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importChecklist(e.target.files[0])} />
            </div>
            {checklist.length > 0 && (() => {
              const sum = summarizeChecklist(checklist);
              return (
                <>
                  <div className="metric"><span>完成</span><span className="v">{sum.done}/{sum.total}（{(sum.percent * 100).toFixed(0)}%）</span></div>
                  <div className="progress-track" style={{ margin: '8px 0' }}><div style={{ width: `${sum.percent * 100}%` }} /></div>
                  <table><tbody>
                    {checklist.slice(0, 40).map((it) => (
                      <tr key={it.fixtureId}>
                        <td className="mono">{it.uid}</td><td>{it.hangPointCode ?? '—'}</td>
                        <td className="mono">{it.serialNo ?? '—'}</td>
                        <td><input type="checkbox" checked={it.done} onChange={() => setChecklist((prev) => prev.map((x) => x.fixtureId === it.fixtureId ? { ...x, done: !x.done, checkedAt: Date.now() } : x))} /></td>
                      </tr>
                    ))}
                  </tbody></table>
                </>
              );
            })()}
            {checklist.length === 0 && <p className="muted">导出后在手机上逐项勾选，再把 JSON 导回这里汇总进度。</p>}
          </div>
        )}

        {tab === 'inventory' && (
          <div className="panel">
            <h3>库存台账与档期</h3>
            <div className={`metric ${conflicts.length ? 'danger-text' : 'ok-text'}`}>
              <span>档期撞期冲突</span><span className="v">{conflicts.length} 起</span>
            </div>
            {conflicts.map((c, i) => (
              <div key={i} className="cue-row danger-text">
                <span className="tag bad">撞期</span>
                <span className="mono">{c.serialNo}</span>
                <span style={{ fontSize: 12 }}>{c.bookings.map((b) => `${b.projectId}:${b.fromDate}~${b.toDate}`).join(' ⚆ ')}</span>
              </div>
            ))}
            <h4>项目占灯核对</h4>
            <div className="metric"><span>满足</span><span className="v ok-text">{reconcile.satisfied.length}</span></div>
            <div className="metric"><span>缺失/异常</span><span className="v danger-text">{reconcile.missing.length}</span></div>
            <table><tbody>
              {reconcile.serials.slice(0, 20).map((s) => (
                <tr key={s.fixtureId}>
                  <td className="mono">{project.fixtures.find((f) => f.id === s.fixtureId)?.uid}</td>
                  <td className="mono">{s.serialNo ?? '—'}</td>
                  <td>{s.ok ? <span className="tag ok">已配</span> : <span className="tag bad">{s.reason}</span>}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}
      </div>
    </div>
  );
}

function fmt(p: { x: number; y: number; z: number }): string {
  return `${p.x}, ${p.y}, ${p.z}`;
}

/** 演示用走线（项目未配置时给一组示例线缆） */
function demoCables() {
  return [
    { id: 'c1', signal: 'artnet' as const, fromNode: 'sw0', toNode: 'an0', path: [{ x: 0, y: 0, z: 0 }, { x: 3000, y: 0, z: 0 }, { x: 3000, y: 4000, z: 0 }], lengthMm: 0, connectorFrom: 'RJ45', connectorTo: 'RJ45' },
    { id: 'c2', signal: 'dmx' as const, fromNode: 'an0', toNode: 'f1', path: [{ x: 3000, y: 4000, z: 0 }, { x: 3000, y: 6000, z: 0 }], lengthMm: 0, connectorFrom: 'XLR5', connectorTo: 'XLR5' },
    { id: 'c3', signal: 'power' as const, fromNode: 'PD', toNode: 'an0', path: [{ x: 0, y: 0, z: 0 }, { x: 5000, y: 0, z: 0 }, { x: 5000, y: 4000, z: 0 }], lengthMm: 0, connectorFrom: 'CEE16', connectorTo: 'PowerCon' },
  ];
}
