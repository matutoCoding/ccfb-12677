// 页面二: 方案设计 —— 灯位/桁架、信号网与断电模拟、照度与摄像机、运动干涉
import { h, section, field, numInput, button, table, badge, toast, select } from './dom.ts';
import type { ViewportHandle } from './viewport.ts';
import { store } from '../core/store.ts';
import type { Project, Fixture, Truss } from '../core/types.ts';
import { simulateNodeFailure, findLongCables, validatePortMapping, findDisconnectedNodes } from '../core/topology.ts';
import { checkEnvelopeCollisions, type CollisionReport } from '../core/collision.ts';
import { computeLuxGrid, cameraExposure, pwmBandFactor, skinToneUnderLight } from '../core/photometric.ts';
import { autoCableRuns, summarizeCables } from '../core/quote.ts';
import { uid, fmt } from '../core/util.ts';
import { defaultParams } from '../core/types.ts';

type Tab = 'layout' | 'topology' | 'photo' | 'collision';

export function designPage(vp: ViewportHandle): HTMLElement {
  let tab: Tab = 'layout';
  let selectedFixtureId: string | undefined;
  let darkIds: Set<string> | null = null;
  let collision: CollisionReport | null = null;
  let clipOn = false;
  let failureNodeId = '';
  const root = h('div', { class: 'layout' });

  const project = (): Project => {
    const p = store.activeProject;
    if (!p) throw new Error('无活动工程');
    return p;
  };

  const sync3d = (): void => {
    const p = store.activeProject;
    vp.sync(p, store.activeVenue, store.state.lampModels, {
      selectedId: selectedFixtureId,
      darkFixtureIds: darkIds ?? undefined,
      collisionTargets: collision ? new Set(collision.collisions.map(c => c.fixtureId)) : undefined,
      showLuxGrid: tab === 'photo',
      showTopology: tab === 'topology',
      showBeams: true,
    });
  };

  const rerender = (): void => {
    sync3d();
    root.replaceChildren(buildSidebar(), h('div', { class: 'main' }, buildBottom()));
  };

  const buildSidebar = (): HTMLElement => {
    const p = project();
    const fx = p.fixtures.find(f => f.id === selectedFixtureId);
    const tabs: [Tab, string][] = [['layout', '灯位桁架'], ['topology', '信号网/断电'], ['photo', '照度/摄像机'], ['collision', '运动干涉']];
    return h('div', { class: 'sidebar wide' },
      h('div', { class: 'tabs' }, ...tabs.map(([id, label]) =>
        h('button', { class: tab === id ? 'active' : '', onClick: () => { tab = id; collision = null; rerender(); } }, label))),
      tab === 'layout' ? layoutTab(p, fx) :
      tab === 'topology' ? topologyTab(p) :
      tab === 'photo' ? photoTab(p) : collisionTab(p),
    );
  };

  // ---------- 灯位桁架 ----------
  const layoutTab = (p: ReturnType<typeof project>, fx: Fixture | undefined): HTMLElement =>
    h('div', {},
      section('工程与视图',
        field('活动工程', select(store.state.projects.map(x => [x.id, x.name]), p.id, id => {
          store.mutate(s => s.activeProjectId = id);
          selectedFixtureId = undefined;
          rerender();
        })),
        h('div', { class: 'btn-row' },
          button('剖切吊挂层', () => {
            clipOn = !clipOn;
            vp.setClip(clipOn, 'z', 12);
            toast(clipOn ? '剖切已开启 (Z>12m 裁掉)' : '剖切已关闭');
          }, clipOn),
          button('测距/测角', () => {
            vp.measureMode(true);
            toast('在三维中依次点两个点');
          }),
        ),
      ),
      section('布置灯具 (拾取台面放置)',
        field('型号', select(store.state.lampModels.map(m => [m.id, `${m.name} (${m.kind})`]),
          fx?.modelId ?? store.state.lampModels[0]?.id ?? '', () => {})),
        button('在视口点击台面添加灯具', () => {
          vp.onPick(key => {
            if (key.startsWith('fixture:')) {
              selectedFixtureId = key.slice(8);
              rerender();
            }
          });
          toast('点击视口中已有灯可选中; 新灯通过桁架批量生成');
        }),
        button('沿所选桁架批量加 10 台灯', () => {
          const tr = p.trusses[0];
          if (!tr) return;
          const modelId = store.state.lampModels[0]?.id;
          if (!modelId) return;
          for (let i = 0; i < 10; i++) {
            const t = i / 9;
            p.fixtures.push({
              id: uid('fx'), label: `NEW-${p.fixtures.length + 1}`, modelId,
              position: [tr.from[0] + (tr.to[0] - tr.from[0]) * t, tr.from[1], tr.from[2] - 0.5],
              rotation: [0, 0, 0], trussId: tr.id,
              universe: 0, dmxStart: 1, params: { ...defaultParams(), dimmer: 0.7 },
            });
          }
          store.mutate(() => {});
          toast('已添加 10 台灯');
          rerender();
        }),
      ),
      section('桁架',
        ...p.trusses.slice(0, 8).map(tr =>
          h('div', { class: 'list-item' },
            h('div', {}, h('strong', {}, tr.label),
              h('div', { class: 'muted mono' }, `(${tr.from.map(n => n.toFixed(1)).join(',')}) → (${tr.to.map(n => n.toFixed(1)).join(',')}) · ${tr.loadKg}kg`)),
          ),
        ),
        button('＋ 添加桁架', () => {
          const tr: Truss = {
            id: uid('truss'), label: `TR-${p.trusses.length + 1}`,
            from: [6, 12, 12], to: [54, 12, 12], section: 0.4, loadKg: 800,
          };
          p.trusses.push(tr);
          store.mutate(() => {});
          rerender();
        }),
      ),
      fx ? section(`选中: ${fx.label}`,
        field('X(m)', numInput(fx.position[0], v => { fx.position[0] = v; persist(); }, 0.1)),
        field('Y(m)', numInput(fx.position[1], v => { fx.position[1] = v; persist(); }, 0.1)),
        field('Z(m)', numInput(fx.position[2], v => { fx.position[2] = v; persist(); }, 0.1)),
        field('Pan°', numInput(fx.params.pan, v => { fx.params.pan = v; persist(); })),
        field('Tilt°', numInput(fx.params.tilt, v => { fx.params.tilt = v; persist(); })),
        field('调光', numInput(fx.params.dimmer, v => { fx.params.dimmer = v; persist(); }, 0.05)),
        field('频闪Hz', numInput(fx.params.strobeHz, v => { fx.params.strobeHz = v; persist(); })),
        h('div', { class: 'btn-row' },
          button('移出灯组(不影响其余)', () => {
            fx.excludedFromGroup = !fx.excludedFromGroup;
            persist(); rerender();
          }),
          button('删除该灯', () => {
            p.fixtures = p.fixtures.filter(f => f.id !== fx.id);
            selectedFixtureId = undefined;
            persist(); rerender();
          }),
        ),
      ) : h('div', { class: 'muted' }, '在视口单击灯具进行编辑'),
    );

  // ---------- 信号网 / 断电模拟 ----------
  const topologyTab = (p: ReturnType<typeof project>): HTMLElement => {
    const longCables = findLongCables(p.topology);
    const portIssues = validatePortMapping(p.topology);
    const disconnected = findDisconnectedNodes(p.topology);
    return h('div', {},
      section('拓扑概览',
        h('div', { class: 'row2' },
          statEl(p.topology.nodes.length, '节点/交换机'),
          statEl(p.topology.links.length, '链路'),
          statEl(longCables.length, '超100m网线'),
          statEl(disconnected.length, '离线节点'),
        ),
        longCables.length ? table(['链路', '长度(m)', '端点'], longCables.map(c =>
          [c.linkId, badge(String(c.length), 'err') as unknown as string, `${c.from} ↔ ${c.to}`])) :
          h('div', {}, badge('全部网线 ≤100m', 'ok')),
        portIssues.length ? table(['节点', '问题'], portIssues.map(i => [i.nodeLabel, i.message])) :
          h('div', {}, badge('域-网口映射无冲突', 'ok')),
      ),
      section('断电/断节点模拟 (与手工拓扑核对一致)',
        field('故障节点', select(p.topology.nodes.map(n => [n.id, `${n.label} (下挂${n.fixtureIds.length}灯)`]),
          failureNodeId || p.topology.nodes[2]?.id || p.topology.nodes[0]?.id || '',
          v => { failureNodeId = v; })),
        button('执行模拟', () => {
          const nodeId = failureNodeId || p.topology.nodes[2]?.id || p.topology.nodes[0].id;
          const r = simulateNodeFailure(p.topology, nodeId);
          darkIds = new Set(r.darkFixtures.map(d => d.fixtureId));
          const node = p.topology.nodes.find(n => n.id === nodeId);
          toast(`节点 ${node?.label} 失效: ${r.darkCount} 灯失控, ${r.aliveCount} 灯受控`);
          rerender();
          setTimeout(() => showFailureTable(nodeId), 50);
        }, true),
        button('清除失灯状态', () => { darkIds = null; rerender(); }),
        h('div', { id: 'failure-table' }),
      ),
      section('线缆清册',
        button('按桁架自动布线并统计', () => {
          p.cables = autoCableRuns(p);
          const sum = summarizeCables(p.cables);
          toast(`生成 ${p.cables.length} 根线缆, 总长 ${fmt(sum.totalLength, 1)}m`);
          rerender();
        }),
        p.cables.length ? table(['线缆', '路径', '长度(m)', '接头'],
          p.cables.slice(0, 50).map(c =>
            [c.label, `${c.path.length} 个折点`, c.length.toFixed(2), `${c.connectorA}/${c.connectorB}`])) :
          h('div', { class: 'muted' }, '尚未布线'),
      ),
    );
  };

  const showFailureTable = (nodeId: string): void => {
    const p = project();
    const r = simulateNodeFailure(p.topology, nodeId);
    const host = document.getElementById('failure-table');
    if (!host) return;
    host.replaceChildren(
      h('div', { class: 'btn-row' },
        badge(`隔离节点 ${r.isolatedNodeIds.length}`, 'warn'),
        badge(`失控灯具 ${r.darkCount}`, 'err'),
        badge(`受控灯具 ${r.aliveCount}`, 'ok'),
      ),
      table(['失控灯号', '所属节点'],
        r.darkFixtures.slice(0, 150).map(d => {
          const fx = p.fixtures.find(f => f.id === d.fixtureId);
          const node = p.topology.nodes.find(n => n.id === d.nodeId);
          return [fx?.label ?? d.fixtureId, node?.label ?? d.nodeId];
        }), { maxHeight: '240px' }),
    );
  };

  // ---------- 照度 / 摄像机 ----------
  const photoTab = (p: ReturnType<typeof project>): HTMLElement => {
    const grid = computeLuxGrid(p.fixtures, store.state.lampModels, p.luxGrid);
    const sampleLux = grid.cells[Math.floor(grid.cells.length / 2)]?.lux ?? 0;
    const exposure = cameraExposure(sampleLux, 800, p.cameraShutterSec, 2.8);
    return h('div', {},
      section('台面照度网格 (伪彩已叠加到三维台面)',
        h('div', { class: 'row2' },
          statEl(fmt(grid.average, 0), '平均 lux'),
          statEl(fmt(grid.max, 0), '最大 lux'),
          statEl(fmt(grid.min, 0), '最小 lux'),
          statEl(grid.uniformity.toFixed(3), '均匀度 min/avg'),
        ),
        h('div', {}, badge(`关键演区平均照度 ${fmt(grid.keyAreaAverage, 0)} lux`, 'info')),
        field('网格 NX', numInput(p.luxGrid.nx, v => { p.luxGrid.nx = v; persist(); rerender(); }, 4)),
        field('网格 NY', numInput(p.luxGrid.ny, v => { p.luxGrid.ny = v; persist(); rerender(); }, 4)),
      ),
      section('电视摄像机曝光模拟',
        field('快门(s)', numInput(p.cameraShutterSec, v => { p.cameraShutterSec = v; persist(); rerender(); }, 0.001)),
        field('帧率', numInput(p.cameraFrameRate, v => { p.cameraFrameRate = v; persist(); rerender(); }, 1)),
        h('div', {}, `台面中心曝光系数: `,
          badge(exposure > 1 ? `${exposure.toFixed(2)} (过曝裁切)` : exposure.toFixed(2), exposure > 1 ? 'warn' : 'ok')),
      ),
      section('PWM 滚动条纹 (调光频率 vs 快门不同步)',
        ...pwmDemo(p),
      ),
      section('色温/显色指数 → 演员肤色对比',
        ...skinDemo(),
      ),
    );
  };

  const pwmDemo = (p: ReturnType<typeof project>): HTMLElement[] => {
    const models = store.state.lampModels;
    return models.filter(m => m.pwmHz > 0).slice(0, 3).map(m => {
      const rows: number[] = [];
      for (let line = 0; line < 8; line++) {
        rows.push(pwmBandFactor(m.pwmHz, 0.7, 0, line / 8 / p.cameraFrameRate, p.cameraFrameRate, p.cameraShutterSec));
      }
      return h('div', { style: { marginBottom: '8px' } },
        h('div', { class: 'muted', style: { marginBottom: '4px' } }, `${m.name} · PWM ${m.pwmHz}Hz`),
        h('div', { style: { display: 'flex', gap: '2px', height: '26px' } },
          ...rows.map(f => h('div', {
            style: { flex: 1, background: `rgba(255,230,180,${f.toFixed(3)})`, borderRadius: '3px' },
            title: `行亮度系数 ${f.toFixed(3)}`,
          })),
        ),
      );
    });
  };

  const skinDemo = (): HTMLElement[] => {
    const baseSkin: [number, number, number] = [0.72, 0.48, 0.36];
    return store.state.lampModels.slice(0, 4).map(m => {
      const c = skinToneUnderLight(baseSkin, m.cct, m.cri);
      return h('div', {},
        h('div', {
          class: 'skin-swatch',
          style: { background: `rgb(${c.map(v => Math.round(v * 255)).join(',')})` },
        }, `${m.name}`),
        h('div', { class: 'muted', style: { fontSize: '11px' } }, `CCT ${m.cct}K · CRI ${m.cri}`),
      );
    });
  };

  // ---------- 运动干涉 ----------
  const collisionTab = (p: ReturnType<typeof project>): HTMLElement =>
    h('div', {},
      section('摇头灯整周运动包络干涉检查',
        h('div', { class: 'muted' }, '对每台灯的 pan/tilt 全范围采样, 与桁架和邻灯做胶囊体求交, 输出碰撞角度区间。硬指标: 300 台一轮 < 10s。'),
        button('开始全量干涉检查', () => {
          collision = checkEnvelopeCollisions({
            fixtures: p.fixtures, models: store.state.lampModels, trusses: p.trusses,
            panStep: 10, tiltStep: 10,
          });
          toast(`检查完成: ${collision.collisions.length} 组碰撞, 采样 ${collision.sampleCount} 姿态, 耗时 ${fmt(collision.elapsedMs, 1)}ms`);
          rerender();
        }, true),
        collision ? h('div', { class: 'btn-row' },
          badge(`${collision.movingHeadCount} 台摇头灯`, 'info'),
          badge(`${collision.collisions.length} 组碰撞`, collision.collisions.length ? 'err' : 'ok'),
          badge(`${fmt(collision.elapsedMs, 1)} ms / 预算 10000ms`, collision.elapsedMs < 10000 ? 'ok' : 'err'),
        ) : h('div'),
      ),
      collision && collision.collisions.length ? section('碰撞角度区间',
        table(['灯具', '碰撞对象', '最近距离(m)', 'Pan 区间', 'Tilt 区间'],
          collision.collisions.slice(0, 80).flatMap(c =>
            c.intervals.slice(0, 3).map(iv => [
              c.fixtureLabel, c.targetLabel, c.minDistance.toFixed(3),
              `${iv.panFrom.toFixed(0)}°~${iv.panTo.toFixed(0)}°`,
              `${iv.tiltFrom.toFixed(0)}°~${iv.tiltTo.toFixed(0)}°`,
            ])),
          { maxHeight: '320px' },
        ),
      ) : collision ? h('div', {}, badge('未检测到干涉', 'ok')) : h('div'),
    );

  const buildBottom = (): HTMLElement =>
    h('div', { class: 'bottom-panel', style: { flex: '0 0 150px' } },
      h('div', { class: 'stat-grid' },
        statEl(project().fixtures.length, '灯具总数'),
        statEl(project().trusses.length, '桁架'),
        statEl(darkIds?.size ?? 0, '模拟失灯'),
        statEl(collision?.collisions.length ?? 0, '碰撞组数'),
      ),
    );

  const persist = (): void => store.mutate(() => {});

  const statEl = (n: number | string, label: string): HTMLElement =>
    h('div', { class: 'stat' }, h('div', { class: 'num' }, String(n)), h('div', { class: 'lbl' }, label));

  vp.onPick(key => {
    if (key.startsWith('fixture:')) {
      selectedFixtureId = key.slice(8);
      rerender();
    }
  });

  rerender();
  return root;
}
