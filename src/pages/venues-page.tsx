import { useMemo, useRef, useState } from 'react';
import { useStore } from '../store/use-store';
import { Scene3D } from '../components/scene3d';
import { buildSceneMeshes } from '../renderer/scene-mesh';
import { compareVenues, type VenueCompatReport } from '../core/venue-compat';
import { putBlob } from '../store/storage';
import type { HangPoint, SiteRevision, Venue } from '../types';

export function VenuesPage() {
  const state = useStore();
  const project = state.activeProject();
  const venues = Object.values(state.venues);
  const [selectedId, setSelectedId] = useState(venues[0]?.id ?? '');
  const [report, setReport] = useState<VenueCompatReport | null>(null);
  const [targetVenueId, setTargetVenueId] = useState(venues[1]?.id ?? venues[0]?.id ?? '');
  const [clipZ, setClipZ] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const venue = state.venues[selectedId];

  const meshes = useMemo(() => {
    if (!venue || !project) return [];
    return buildSceneMeshes(project, venue, {
      clipPlane: clipZ != null ? { normal: { x: 0, y: 0, z: 1 }, distance: clipZ } : null,
    });
  }, [venue, project, clipZ]);

  const runCompare = () => {
    if (!project || !venue) return;
    const target = state.venues[targetVenueId];
    if (!target) return;
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const source = state.venues[project.activeVenueId ?? venue.id] ?? venue;
    setReport(compareVenues(project.fixtures, defMap, project.truss, source.hangPoints, target.hangPoints));
  };

  const uploadAttachment = async (file: File) => {
    if (!venue) return;
    const blobId = `blob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    await putBlob(blobId, file);
    state.addAttachment(venue.id, {
      id: `att-${Date.now()}`,
      name: file.name,
      kind: file.name.includes('电') ? 'power-sheet' : 'rigger-drawing',
      mediaType: file.type,
      size: file.size,
      blobId,
      uploadedAt: Date.now(),
    });
  };

  const reviseHeadroom = (hp: HangPoint, value: number) => {
    if (!venue) return;
    const revision: SiteRevision = {
      id: `rev-${Date.now()}`,
      target: 'hangpoint',
      targetId: hp.id,
      field: 'headroomMm',
      oldValue: hp.headroomMm,
      newValue: value,
      note: '三维复勘回写',
      revisedAt: Date.now(),
      revisedBy: '当前用户',
    };
    const updated: Venue = {
      ...venue,
      hangPoints: venue.hangPoints.map((h) => (h.id === hp.id ? { ...h, headroomMm: value } : h)),
      revisions: [...venue.revisions, revision],
    };
    state.upsertVenue(updated);
  };

  return (
    <div className="main">
      <div className="sidebar">
        <div className="panel">
          <h3>场馆档案</h3>
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>{v.name}（{v.city}）</option>
            ))}
          </select>
          {venue && (
            <>
              <div className="metric"><span>馆内尺寸</span><span className="v">{venue.envelope.width}×{venue.envelope.depth}×{venue.envelope.height} mm</span></div>
              <div className="metric"><span>挂点数</span><span className="v">{venue.hangPoints.length}</span></div>
              <div className="metric"><span>柱位</span><span className="v">{venue.columns.length}</span></div>
              <div className="metric"><span>附件</span><span className="v">{venue.attachments.length}</span></div>
              <div className="metric"><span>复勘修订</span><span className="v">{venue.revisions.length}</span></div>
            </>
          )}
        </div>

        <div className="panel">
          <h3>附件（吊杆图 / 用电条件单）</h3>
          <input ref={fileRef} type="file" hidden onChange={(e) => e.target.files?.[0] && uploadAttachment(e.target.files[0])} />
          <button className="btn ghost small" onClick={() => fileRef.current?.click()}>导入附件到档案</button>
          {venue?.attachments.map((a) => (
            <div key={a.id} className="metric">
              <span>📎 {a.name}</span>
              <span className="muted">{(a.size / 1024).toFixed(0)} KB</span>
            </div>
          ))}
        </div>

        <div className="panel">
          <h3>复勘回写（净空）</h3>
          <div className="scroll" style={{ maxHeight: 180 }}>
            {venue?.hangPoints.slice(0, 12).map((hp) => (
              <div key={hp.id} className="inline" style={{ marginBottom: 4 }}>
                <span className="mono" style={{ width: 48 }}>{hp.code}</span>
                <input
                  type="number"
                  defaultValue={hp.headroomMm}
                  onBlur={(e) => reviseHeadroom(hp, Number(e.target.value))}
                />
              </div>
            ))}
            <p className="muted">仅显示前 12 个，修改即回写存档并生成修订记录。</p>
          </div>
        </div>
      </div>

      <div className="content">
        <div className="viewport">
          <Scene3D
            meshes={meshes}
            clipPlane={clipZ != null ? { normal: { x: 0, y: 0, z: 1 }, distance: clipZ } : null}
          />
          <div className="overlay">
            <strong>{venue?.name}</strong>
            <div className="muted">蓝点=挂点 · 橙线=桁架 · 红/绿=灯具</div>
            <label>剖切高度 Z（mm）</label>
            <div className="inline">
              <input type="range" min={0} max={venue?.envelope.height ?? 14000} value={clipZ ?? venue?.envelope.height ?? 14000}
                onChange={(e) => setClipZ(Number(e.target.value))} />
              <button className="btn small ghost" onClick={() => setClipZ(null)}>复位</button>
            </div>
          </div>
          <div className="legend">
            <span><i style={{ background: '#7aa2ff' }} />挂点</span>
            <span><i style={{ background: '#ffb86b' }} />桁架</span>
            <span><i style={{ background: '#ff5d73' }} />摇头灯</span>
            <span><i style={{ background: '#5dffb0' }} />常规灯</span>
          </div>
        </div>

        <div className="panel" style={{ margin: 12, maxHeight: '42%', display: 'flex', flexDirection: 'column' }}>
          <h3>换馆自动比对</h3>
          <div className="inline" style={{ marginBottom: 8 }}>
            <span>目标场馆</span>
            <select value={targetVenueId} onChange={(e) => setTargetVenueId(e.target.value)} style={{ width: 220 }}>
              {venues.filter((v) => v.id !== selectedId).map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
            <button className="btn small" onClick={runCompare}>跑比对</button>
            {report && (
              <span className="muted">
                耗时 {report.stats.elapsedMs.toFixed(0)}ms · 适配 {report.stats.matched}/{report.stats.total}
                · 不可装 {report.stats.incompatibleCount} · 最大偏差 {report.stats.maxDeviationMm.toFixed(0)}mm
              </span>
            )}
          </div>
          <div className="scroll">
            {report && (
              <table>
                <thead><tr><th>灯具</th><th>状态</th><th>偏差 mm</th><th>原因</th><th>替代挂点建议</th></tr></thead>
                <tbody>
                  {report.incompatible.slice(0, 40).map((r) => {
                    const fx = project?.fixtures.find((f) => f.id === r.fixtureId);
                    return (
                      <tr key={r.fixtureId}>
                        <td className="mono">{fx?.uid}</td>
                        <td><span className="tag bad">{r.targetPointId ? '装不上' : '无挂点'}</span></td>
                        <td>{Number.isFinite(r.deviationMm) ? r.deviationMm.toFixed(0) : '—'}</td>
                        <td>{r.reasons.join('、')}</td>
                        <td>{r.suggestions.map((s) => `${state.venues[targetVenueId]?.hangPoints.find((h) => h.id === s.pointId)?.code ?? s.pointId}${s.violations.length ? '⚠' : '✓'}`).join('，') || '无'}</td>
                      </tr>
                    );
                  })}
                  {report.incompatible.length === 0 && <tr><td colSpan={5} className="ok-text">全部灯具可在目标场馆落地 ✓</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
