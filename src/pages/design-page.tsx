import { useMemo, useState } from 'react';
import { useStore } from '../store/use-store';
import { Scene3D } from '../components/scene3d';
import { buildSceneMeshes } from '../renderer/scene-mesh';
import { checkMovingHeadCollisions, type CollisionReport } from '../core/collision';
import { applyFx, activeMembers } from '../core/fx';
import { forkBranch } from '../core/cue';
import { deg } from '../core/math3d';
import type { FxConfig, FxMode, PresetType } from '../types';

type Tab = 'layout' | 'fx' | 'preset' | 'collision';

export function DesignPage() {
  const state = useStore();
  const project = state.activeProject()!;
  const venue = project.activeVenueId ? state.venues[project.activeVenueId] : undefined;
  const [tab, setTab] = useState<Tab>('layout');
  const [collision, setCollision] = useState<CollisionReport | null>(null);
  const [clipOn, setClipOn] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fxDraft, setFxDraft] = useState<FxConfig>(project.fx['fx-1'] ?? {
    mode: 'wave', param: 'pan', base: 0, amplitude: 0.78, phaseStep: 0.35, periodMs: 4000, direction: 1, shape: 'gradient',
  });

  const meshes = useMemo(
    () => buildSceneMeshes(project, venue, {
      clipPlane: clipOn ? { normal: { x: 0, y: 0, z: 1 }, distance: 9600 } : null,
      highlightFixtureIds: selected,
    }),
    [project, venue, clipOn, selected],
  );

  const group = project.groups[0];
  const runCollision = () => {
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    setCollision(checkMovingHeadCollisions(project.fixtures, defMap, project.truss, {
      stepRad: Math.PI / 90,
      onProgress: () => undefined,
    }));
  };

  const fxPreview = group ? applyFx(group, fxDraft, performance.now()) : [];

  return (
    <div className="main">
      <div className="sidebar wide">
        <div className="tabs">
          {([['layout', '布置'], ['fx', '组联动'], ['preset', '预设'], ['collision', '干涉']] as [Tab, string][]).map(
            ([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>,
          )}
        </div>

        {tab === 'layout' && (
          <div className="panel">
            <h3>灯具布置（{project.fixtures.length} 台）</h3>
            <div className="btn-row">
              <button className="btn small ghost" onClick={() => setClipOn(!clipOn)}>{clipOn ? '关闭剖切' : '剖切吊挂层'}</button>
              <button className="btn small ghost" onClick={() => setSelected(new Set(project.fixtures.slice(0, 12).map((f) => f.id)))}>选前12台</button>
              <button className="btn small ghost" onClick={() => setSelected(new Set())}>清空选择</button>
            </div>
            <p className="muted">三维视图：左键旋转、Shift/右键平移、滚轮缩放、点击灯拾取选中。</p>
            <div className="scroll" style={{ maxHeight: 260 }}>
              <table>
                <tbody>
                  {project.fixtures.slice(0, 30).map((f) => (
                    <tr key={f.id}>
                      <td className="mono">{f.uid}</td>
                      <td>{f.kind}</td>
                      <td className="mono">{f.position.x.toFixed(0)},{f.position.y.toFixed(0)},{f.position.z.toFixed(0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'fx' && group && (
          <div className="panel">
            <h3>组联动 · {group.name}（{activeMembers(group).length} 台有效，剔除 {group.excludedIds.length}）</h3>
            <label>模式</label>
            <select value={fxDraft.mode} onChange={(e) => setFxDraft({ ...fxDraft, mode: e.target.value as FxMode })}>
              <option value="symmetric">对称 symmetric</option>
              <option value="wave">波浪 wave</option>
              <option value="chase">追逐 chase</option>
            </select>
            <label>参数</label>
            <select value={fxDraft.param} onChange={(e) => setFxDraft({ ...fxDraft, param: e.target.value as FxConfig['param'] })}>
              {['pan', 'tilt', 'dimmer', 'rgb', 'strobeHz', 'zoom'].map((p) => <option key={p}>{p}</option>)}
            </select>
            <label>相位步进（rad）：{fxDraft.phaseStep.toFixed(2)}</label>
            <input type="range" min={0.05} max={1.5} step={0.05} value={fxDraft.phaseStep}
              onChange={(e) => setFxDraft({ ...fxDraft, phaseStep: Number(e.target.value) })} />
            <label>周期（ms）：{fxDraft.periodMs}</label>
            <input type="range" min={500} max={10000} step={100} value={fxDraft.periodMs}
              onChange={(e) => setFxDraft({ ...fxDraft, periodMs: Number(e.target.value) })} />
            <label>幅度：{fxDraft.amplitude.toFixed(2)}</label>
            <input type="range" min={0} max={1.5} step={0.05} value={fxDraft.amplitude}
              onChange={(e) => setFxDraft({ ...fxDraft, amplitude: Number(e.target.value) })} />
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn small ghost" onClick={() => setFxDraft({ ...fxDraft, direction: 1 })}>方向 +1</button>
              <button className="btn small ghost" onClick={() => setFxDraft({ ...fxDraft, direction: -1 })}>方向 -1</button>
              <button className="btn small ghost" onClick={() => setFxDraft({ ...fxDraft, shape: 'circle' })}>圆形</button>
              <button className="btn small ghost" onClick={() => setFxDraft({ ...fxDraft, shape: 'spiral' })}>螺旋</button>
              <button className="btn small ghost" onClick={() => setFxDraft({ ...fxDraft, shape: 'gradient' })}>渐变</button>
            </div>
            <h4>临时剔除（不影响其余灯继续跑）</h4>
            <div className="scroll" style={{ maxHeight: 140 }}>
              {group.fixtureIds.slice(0, 20).map((fid) => {
                const fx = project.fixtures.find((f) => f.id === fid);
                const excluded = group.excludedIds.includes(fid);
                return (
                  <label key={fid} className="inline" style={{ display: 'inline-flex', marginRight: 8 }}>
                    <input type="checkbox" checked={!excluded} onChange={() => state.toggleGroupExclude(group.id, fid)} />
                    <span className={excluded ? 'muted' : ''}>{fx?.uid}</span>
                  </label>
                );
              })}
            </div>
            <h4>实时输出预览（前 8 台）</h4>
            <table><tbody>
              {fxPreview.slice(0, 8).map((o) => (
                <tr key={o.fixtureId}>
                  <td className="mono">{project.fixtures.find((f) => f.id === o.fixtureId)?.uid}</td>
                  <td className="mono">相位 {deg(o.phase).toFixed(0)}°</td>
                  <td className="mono">{JSON.stringify(o.params).slice(0, 40)}</td>
                </tr>
              ))}
            </tbody></table>
          </div>
        )}

        {tab === 'preset' && (
          <div className="panel">
            <h3>预设集中维护（改预设，引用它的 cue 自动跟随）</h3>
            {project.presets.map((p) => (
              <div key={p.id} style={{ marginBottom: 10 }}>
                <div className="inline">
                  <span className={`tag info`}>{p.type}</span>
                  <strong>{p.name}</strong>
                </div>
                <div className="mono muted" style={{ fontSize: 12 }}>{JSON.stringify(p.value)}</div>
              </div>
            ))}
            <PresetEditor />
          </div>
        )}

        {tab === 'collision' && (
          <div className="panel">
            <h3>摇头灯运动包络干涉</h3>
            <button className="btn" onClick={runCollision}>跑整周干涉检查</button>
            {collision && (
              <>
                <div className="metric"><span>耗时</span><span className="v">{collision.elapsedMs.toFixed(0)} ms</span></div>
                <div className="metric"><span>碰撞灯具</span><span className="v danger-text">{collision.collidingFixtures}</span></div>
                <div className="scroll" style={{ maxHeight: 360 }}>
                  <table>
                    <thead><tr><th>灯号</th><th>碰撞对象</th><th>pan 区间</th><th>tilt 区间</th><th>最小间隙 mm</th></tr></thead>
                    <tbody>
                      {collision.perFixture.filter((r) => r.hasCollision).flatMap((r) =>
                        r.intervals.slice(0, 3).map((iv, i) => (
                          <tr key={`${r.fixtureId}-${i}`}>
                            <td className="mono">{project.fixtures.find((f) => f.id === r.fixtureId)?.uid}</td>
                            <td>{iv.against.kind === 'truss' ? '桁架' : '邻灯'} {iv.against.id}</td>
                            <td className="mono">{deg(iv.panFrom).toFixed(0)}°~{deg(iv.panTo).toFixed(0)}°</td>
                            <td className="mono">{deg(iv.tiltFrom).toFixed(0)}°~{deg(iv.tiltTo).toFixed(0)}°</td>
                            <td className="danger-text">{iv.minClearanceMm.toFixed(0)}</td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        <div className="panel">
          <h3>分支与盲编</h3>
          <div className="metric"><span>当前分支</span><span className="v">{project.branches.find((b) => b.id === project.activeBranchId)?.name}</span></div>
          <div className="btn-row">
            <button className="btn small ghost" onClick={() => state.updateProject(project.id, (p) => forkBranch(p, `试验 ${p.branches.length + 1}`))}>开分支试效果</button>
            <button className="btn small ghost" onClick={() => state.setBlindMode(!state.blindMode)}>{state.blindMode ? '退出盲编' : '进入盲编'}</button>
          </div>
          <p className="muted">盲编模式下调 cue 不碰正在播放的预演画面。</p>
        </div>
      </div>

      <div className="content">
        <div className="viewport">
          <Scene3D meshes={meshes} onPick={(id) => {
            const fx = project.fixtures[id - 1];
            if (!fx) return;
            setSelected((prev) => {
              const next = new Set(prev);
              if (next.has(fx.id)) next.delete(fx.id); else next.add(fx.id);
              return next;
            });
          }} />
          <div className="overlay">
            <strong>方案设计 · {project.name}</strong>
            <div className="muted">选中 {selected.size} 台 · {clipOn ? '剖切到吊挂层 z=9600' : '完整视图'}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function PresetEditor() {
  const state = useStore();
  const project = state.activeProject()!;
  const [type, setType] = useState<PresetType>('color');
  const [name, setName] = useState('');
  const add = () => {
    if (!name) return;
    state.updateProject(project.id, (p) => ({
      ...p,
      presets: [...p.presets, { id: `preset-${Date.now()}`, type, name, value: { dimmer: 0.8 } }],
    }));
    setName('');
  };
  return (
    <div className="inline">
      <select value={type} onChange={(e) => setType(e.target.value as PresetType)} style={{ width: 110 }}>
        <option value="position">位置</option><option value="color">颜色</option><option value="beam">光束</option>
      </select>
      <input placeholder="新预设名" value={name} onChange={(e) => setName(e.target.value)} />
      <button className="btn small" onClick={add}>新增</button>
    </div>
  );
}
