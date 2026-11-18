import { useMemo, useState } from 'react';
import { useStore } from '../store/use-store';
import { Scene3D } from '../components/scene3d';
import { buildSceneMeshes } from '../renderer/scene-mesh';
import { lintTopology, simulateFailure } from '../core/network';
import type { FailureSimulationResult } from '../types';
import { commentStats } from '../core/review';
import { downloadText } from '../store/storage';
import type { ReviewStatus } from '../types';

type Tab = 'review' | 'network';

export function ReviewPage() {
  const state = useStore();
  const project = state.activeProject()!;
  const venue = project.activeVenueId ? state.venues[project.activeVenueId] : undefined;
  const [tab, setTab] = useState<Tab>('review');
  const [failure, setFailure] = useState<FailureSimulationResult | null>(null);
  const [failedNodeId, setFailedNodeId] = useState('');
  const stats = commentStats(project);

  const darkSet = useMemo(() => new Set<string>(failure?.darkFixtureIds ?? []), [failure]);
  const meshes = useMemo(
    () => buildSceneMeshes(project, venue, { darkFixtureIds: darkSet }),
    [project, venue, darkSet],
  );
  const issues = useMemo(() => lintTopology(project.network), [project.network]);

  const runFailure = (nodeId: string) => {
    if (!nodeId) return;
    setFailedNodeId(nodeId);
    setFailure(simulateFailure(project.network, project.fixtures, nodeId));
  };

  const pinComment = (encodedId: number) => {
    const fx = project.fixtures[encodedId - 1];
    const text = window.prompt('评论内容（可关联 cue 编号 / 灯号）：');
    if (!text) return;
    state.addReviewComment({
      position: fx?.position ?? { x: 0, y: 0, z: 9000 },
      author: '当前用户',
      assignee: '',
      text,
      fixtureRef: fx?.uid,
      cueRef: (text.match(/cue\s*[\d.]+/i) ?? [])[0],
    });
  };

  const exportFeedback = () => {
    downloadText(`feedback-${project.id}.json`, JSON.stringify(project.comments, null, 2), 'application/json');
  };
  const importFeedback = async (file: File) => {
    const text = await file.text();
    state.importFeedback(JSON.parse(text));
  };

  return (
    <div className="main">
      <div className="sidebar wide">
        <div className="tabs">
          {([['review', '评审评论'], ['network', '信号网/断电']] as [Tab, string][]).map(
            ([k, label]) => <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{label}</button>,
          )}
        </div>

        {tab === 'review' && (
          <div className="panel">
            <h3>场景评论（{project.comments.length}）</h3>
            <div className="btn-row" style={{ marginBottom: 8 }}>
              {(['open', 'assigned', 'resolved', 'rejected'] as ReviewStatus[]).map((s) => (
                <span key={s} className={`tag ${s === 'resolved' ? 'ok' : s === 'rejected' ? 'bad' : 'info'}`}>{s}: {stats[s]}</span>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn small ghost" onClick={exportFeedback}>导出客户意见包</button>
              <label className="btn small ghost" style={{ cursor: 'pointer' }}>
                导回合并
                <input type="file" accept="application/json" hidden onChange={(e) => e.target.files?.[0] && importFeedback(e.target.files[0])} />
              </label>
            </div>
            <p className="muted">在三维里点击灯具即可在该位置钉评论。</p>
            <div className="scroll" style={{ maxHeight: 420 }}>
              {project.comments.map((c) => (
                <div key={c.id} className="cue-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                  <div className="inline">
                    <span className={`tag ${c.status === 'resolved' ? 'ok' : c.status === 'open' ? 'bad' : 'warn'}`}>{c.status}</span>
                    <strong>{c.author}</strong>
                    {c.assignee && <span className="muted">→ {c.assignee}</span>}
                    {c.cueRef && <span className="tag info">{c.cueRef}</span>}
                    {c.fixtureRef && <span className="tag info">{c.fixtureRef}</span>}
                  </div>
                  <div style={{ margin: '4px 0' }}>{c.text}</div>
                  <div className="btn-row">
                    <button className="btn small ghost" onClick={() => state.setCommentStatus(c.id, 'assigned')}>指派处理</button>
                    <button className="btn small" onClick={() => state.setCommentStatus(c.id, 'resolved')}>标记解决</button>
                    <button className="btn small danger" onClick={() => state.setCommentStatus(c.id, 'rejected')}>驳回</button>
                  </div>
                </div>
              ))}
              {project.comments.length === 0 && <p className="muted">还没有评论。</p>}
            </div>
          </div>
        )}

        {tab === 'network' && (
          <div className="panel">
            <h3>Art-Net 拓扑校验</h3>
            <div className="metric"><span>节点</span><span className="v">{project.network.nodes.length}</span></div>
            <div className="metric"><span>链路</span><span className="v">{project.network.links.length}</span></div>
            <h4>校验问题（{issues.length}）</h4>
            <div className="scroll" style={{ maxHeight: 160 }}>
              {issues.map((i, k) => (
                <div key={k} className={`cue-row ${i.kind === 'over-100m' ? 'danger-text' : ''}`}>
                  <span className={`tag ${i.kind === 'over-100m' ? 'bad' : 'warn'}`}>{i.kind}</span>
                  <span style={{ fontSize: 12 }}>{i.message}</span>
                </div>
              ))}
              {issues.length === 0 && <p className="ok-text">拓扑无异常 ✓</p>}
            </div>

            <h4>断电 / 断节点模拟</h4>
            <label>选择失效节点</label>
            <select value={failedNodeId} onChange={(e) => runFailure(e.target.value)}>
              <option value="">— 请选择 —</option>
              {project.network.nodes.filter((n) => n.type !== 'console').map((n) => (
                <option key={n.id} value={n.id}>{n.type} · {n.label}</option>
              ))}
            </select>
            {failure && (
              <>
                <div className="metric"><span>失控变黑灯具</span><span className="v danger-text">{failure.darkFixtureIds.length} 台</span></div>
                <div className="metric"><span>断开链路</span><span className="v">{failure.cutLinkIds.length} 条</span></div>
                <div className="metric"><span>丢失 Universe</span><span className="v">{failure.universesLost.join(', ') || '无'}</span></div>
                <div className="scroll" style={{ maxHeight: 160 }}>
                  <table><tbody>
                    {failure.darkFixtureIds.slice(0, 30).map((fid: string) => (
                      <tr key={fid}><td className="mono danger-text">{project.fixtures.find((f) => f.id === fid)?.uid}</td><td>失控</td></tr>
                    ))}
                  </tbody></table>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      <div className="content">
        <div className="viewport">
          <Scene3D meshes={meshes} onPick={tab === 'review' ? pinComment : undefined} />
          <div className="overlay">
            <strong>预演评审 · {project.name}</strong>
            <div className="muted">
              {tab === 'review'
                ? '点击灯具在其位置钉评论，可关联 cue 与灯号'
                : failure
                  ? `节点 ${failedNodeId} 失效：${failure.darkFixtureIds.length} 台灯变灰失控`
                  : '选择左侧节点模拟断电，失控灯在三维中变灰'}
            </div>
          </div>
          <div className="legend">
            <span><i style={{ background: '#888' }} />断电失控</span>
            <span><i style={{ background: '#ff5d73' }} />正常摇头灯</span>
            <span><i style={{ background: '#5dffb0' }} />常规灯</span>
          </div>
        </div>
      </div>
    </div>
  );
}
