import { useMemo, useState } from 'react';
import { useStore } from '../store/use-store';
import {
  cameraExposure,
  computeLuxGrid,
  luxFalseColor,
  pwmRollingBands,
  renderSkinUnder,
  zoneUniformity,
} from '../core/photometric';
import { nextCue } from '../core/cue';
import type { CameraModel } from '../core/photometric';

type Tab = 'cue' | 'photometric' | 'macro';

export function ProgrammingPage() {
  const state = useStore();
  const project = state.activeProject()!;
  const [tab, setTab] = useState<Tab>('cue');
  const [currentCueId, setCurrentCueId] = useState<string | undefined>();
  const cues = project.cues
    .filter((c) => c.branchId === project.activeBranchId)
    .sort((a, b) => a.timeMs - b.timeMs);

  const trigger = () => {
    const cue = nextCue(project, currentCueId);
    if (!cue) return;
    state.triggerCue(cue.id, '操作员甲');
    setCurrentCueId(cue.id);
  };

  const stopAndInsert = () => {
    state.insertLiveCue(
      project.fixtures.slice(0, 8).map((f) => ({ fixtureId: f.id, params: { dimmer: 0.6 } })),
      (cues[cues.length - 1]?.timeMs ?? 0) + 4000,
      '导演喊停·现场调整',
      '排练现场在当前状态上改灯后插入',
    );
  };

  return (
    <div className="main">
      <div className="sidebar wide">
        <div className="tabs">
          {([['cue', 'Cue 时间轴'], ['photometric', '照度/摄像机'], ['macro', '宏']] as [Tab, string][]).map(
            ([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>,
          )}
        </div>

        {tab === 'cue' && (
          <div className="panel">
            <h3>Cue 表（分支 {project.branches.find((b) => b.id === project.activeBranchId)?.name}）</h3>
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <button className="btn small" onClick={trigger}>▶ 触发下一 Cue</button>
              <button className="btn small danger" onClick={stopAndInsert}>⏸ 导演喊停·存新 Cue</button>
            </div>
            {state.blindMode && <span className="blind-badge">盲编中：改动不影响预演</span>}
            <div className="scroll">
              {cues.map((c) => (
                <div key={c.id} className={`cue-row ${currentCueId === c.id ? 'selected' : ''}`}
                  style={currentCueId === c.id ? { borderColor: 'var(--accent)' } : undefined}>
                  <span className="num">{c.number}</span>
                  <div style={{ flex: 1 }}>
                    <div>{c.name}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {(c.timeMs / 1000).toFixed(1)}s · 淡入 {c.fadeInMs}ms · {c.states.length} 灯
                      {c.note ? ` · ${c.note}` : ''}
                    </div>
                  </div>
                  <span className={`tag ${c.triggerLog?.length ? 'ok' : 'info'}`}>
                    {c.triggerLog?.length ? `已触发 ${c.triggerLog.length}` : '待触发'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {tab === 'photometric' && <PhotometricPanel />}

        {tab === 'macro' && (
          <div className="panel">
            <h3>宏与快捷键（操作录制绑定）</h3>
            {project.macros.map((m) => (
              <div key={m.id} className="cue-row">
                <span className="tag warn">{m.hotkey}</span>
                <strong>{m.name}</strong>
                <span className="muted">{m.steps.length} 步</span>
              </div>
            ))}
            <p className="muted">在三维或 Cue 表里的操作可录制为宏并绑定快捷键，盲编下同样可用。</p>
          </div>
        )}
      </div>

      <div className="content">
        {tab === 'photometric' ? <LuxCanvas /> : (
          <div className="panel" style={{ margin: 14, overflow: 'auto' }}>
            <h3>触发记录留档</h3>
            <table>
              <thead><tr><th>Cue</th><th>名称</th><th>触发时间</th><th>操作员</th></tr></thead>
              <tbody>
                {project.cues.flatMap((c) =>
                  (c.triggerLog ?? []).map((log, i) => (
                    <tr key={`${c.id}-${i}`}>
                      <td className="mono">{c.number}</td><td>{c.name}</td>
                      <td className="mono">{new Date(log.triggeredAt).toLocaleString('zh-CN')}</td>
                      <td>{log.operator}</td>
                    </tr>
                  )),
                )}
                {project.cues.every((c) => !c.triggerLog?.length) && <tr><td colSpan={4} className="muted">尚无触发记录，演出当天手动逐条触发后在此留档。</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function PhotometricPanel() {
  const state = useStore();
  const project = state.activeProject()!;
  const defMap = useMemo(() => new Map(project.fixtureDefinitions.map((d) => [d.id, d])), [project]);
  const [resMm, setResMm] = useState(1000);
  const [cam, setCam] = useState<CameraModel>({ shutterMs: 10, fps: 50, targetLux: 800 });

  const grid = useMemo(
    () => computeLuxGrid(project.fixtures, defMap, { origin: { x: 2000, y: 2000, z: 0 }, width: 12000, depth: 8000 }, resMm),
    [project, defMap, resMm],
  );
  const zone = zoneUniformity(grid, { x0: 4000, y0: 3000, x1: 10000, y1: 7000 });
  const pwm = pwmRollingBands(123, 0.5, cam, 200, 15);

  return (
    <div className="panel">
      <h3>台面照度与光学模拟</h3>
      <label>网格分辨率（mm）</label>
      <input type="number" value={resMm} step={500} onChange={(e) => setResMm(Number(e.target.value))} />
      <div className="metric"><span>平均照度</span><span className="v">{grid.avgLux.toFixed(0)} lux</span></div>
      <div className="metric"><span>峰值照度</span><span className="v">{grid.maxLux.toFixed(0)} lux</span></div>
      <div className="metric"><span>演区平均</span><span className="v">{zone.avg.toFixed(0)} lux</span></div>
      <div className="metric"><span>均匀度 min/avg</span><span className="v">{(zone.uniformity * 100).toFixed(1)}%</span></div>

      <h4>电视摄像机曝光</h4>
      <label>快门速度（ms）</label>
      <input type="number" value={cam.shutterMs} step={1} onChange={(e) => setCam({ ...cam, shutterMs: Number(e.target.value) })} />
      <label>帧率 fps</label>
      <input type="number" value={cam.fps} onChange={(e) => setCam({ ...cam, fps: Number(e.target.value) })} />
      <div className="metric"><span>暗场曝光</span><span className="v">{cameraExposure(grid.minLux, cam).toFixed(2)}</span></div>
      <div className="metric"><span>峰值曝光（&gt;1 过曝）</span><span className="v">{cameraExposure(grid.maxLux, cam).toFixed(2)}</span></div>

      <h4>PWM 滚动条纹</h4>
      <div className="metric"><span>条纹可见度</span><span className={pwm.bandingStrength > 0.3 ? 'v danger-text' : 'v ok-text'}>{(pwm.bandingStrength * 100).toFixed(0)}%</span></div>

      <h4>色温 / 显色指数 → 演员肤色</h4>
      {project.fixtureDefinitions.map((d) => {
        const skin = renderSkinUnder(d.cctK, d.cri);
        return (
          <div key={d.id} className="inline" style={{ marginBottom: 6 }}>
            <span style={{ width: 24, height: 24, borderRadius: 6, background: `rgb(${skin.rgb.map((c) => (c * 255) | 0).join(',')})`, display: 'inline-block' }} />
            <span style={{ flex: 1 }}>{d.model}</span>
            <span className="muted">{d.cctK}K · Ra{d.cri} · {skin.tone}</span>
          </div>
        );
      })}
    </div>
  );
}

/** lux 伪彩网格画布（2D canvas，独立于 WebGL 三维） */
function LuxCanvas() {
  const state = useStore();
  const project = state.activeProject()!;
  const defMap = useMemo(() => new Map(project.fixtureDefinitions.map((d) => [d.id, d])), [project]);
  const grid = useMemo(
    () => computeLuxGrid(project.fixtures, defMap, { origin: { x: 2000, y: 2000, z: 0 }, width: 12000, depth: 8000 }, 500),
    [project, defMap],
  );
  const cell = Math.max(4, Math.floor(640 / grid.nx));
  return (
    <div className="panel" style={{ margin: 14 }}>
      <h3>台面照度伪彩图（俯视，对数色标 蓝→红）</h3>
      <div className="inline" style={{ alignItems: 'flex-start', gap: 20 }}>
        <canvas
          width={grid.nx * cell}
          height={grid.ny * cell}
          ref={(cv) => {
            if (!cv) return;
            const ctx = cv.getContext('2d')!;
            for (let i = 0; i < grid.samples.length; i++) {
              const [r, g, b] = luxFalseColor(grid.samples[i]!.lux, grid.maxLux);
              ctx.fillStyle = `rgb(${(r * 255) | 0},${(g * 255) | 0},${(b * 255) | 0})`;
              const x = (i % grid.nx) * cell;
              const y = Math.floor(i / grid.nx) * cell;
              ctx.fillRect(x, y, cell, cell);
            }
          }}
        />
        <div>
          <div className="metric"><span>网格</span><span className="v">{grid.nx}×{grid.ny}</span></div>
          <div className="metric"><span>最大</span><span className="v">{grid.maxLux.toFixed(0)} lux</span></div>
          <div className="metric"><span>平均</span><span className="v">{grid.avgLux.toFixed(0)} lux</span></div>
          <div className="metric"><span>最小</span><span className="v">{grid.minLux.toFixed(0)} lux</span></div>
          <p className="muted">色标：蓝=低照度，经青/绿/黄过渡到红=高照度（log10 压缩）。</p>
        </div>
      </div>
    </div>
  );
}
