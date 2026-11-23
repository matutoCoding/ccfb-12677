// 页面三: 灯效编程 —— 组联动/预设/效果/cue 时间轴/盲编/分支/宏
import { h, section, field, numInput, textInput, button, table, badge, toast, select } from './dom.ts';
import type { ViewportHandle } from './viewport.ts';
import { store } from '../core/store.ts';
import { applyGroupParam, applyPreset, buildCueState, cueFromLiveState, forkBranch, cloneParams } from '../core/programming.ts';
import { evaluateEffect } from '../core/programming.ts';
import type { FixtureGroup, Preset, Cue, EffectGenerator, FixtureParams, Project } from '../core/types.ts';
import { uid } from '../core/util.ts';

type Tab = 'group' | 'preset' | 'cue' | 'branch' | 'macro';

export function programmingPage(vp: ViewportHandle): HTMLElement {
  let tab: Tab = 'cue';
  let blind = false;
  let playingCueNo: number | null = null;
  const root = h('div', { class: 'layout' });
  const p = (): Project => {
    const proj = store.activeProject;
    if (!proj) throw new Error('无活动工程');
    return proj;
  };

  const rerender = (): void => {
    vp.sync(store.activeProject, store.activeVenue, store.state.lampModels, { showBeams: true });
    root.replaceChildren(buildSidebar(), buildMain());
  };

  const applyLive = (cue: Cue): void => {
    const proj = p();
    const state = buildCueState(proj.fixtures, cue, proj.presets, proj.effects, 0);
    proj.fixtures = proj.fixtures.map(fx => {
      const np = state.get(fx.id);
      return np ? { ...fx, params: np } : fx;
    });
    playingCueNo = cue.no;
    store.mutate(() => {});
  };

  const buildSidebar = (): HTMLElement => {
    const tabs: [Tab, string][] = [['group', '组联动'], ['preset', '预设库'], ['cue', 'Cue时间轴'], ['branch', '方案分支'], ['macro', '宏/快捷键']];
    return h('div', { class: 'sidebar wide' },
      h('div', { class: 'tabs' }, ...tabs.map(([id, label]) =>
        h('button', { class: tab === id ? 'active' : '', onClick: () => { tab = id; rerender(); } }, label))),
      tab === 'group' ? groupTab() :
      tab === 'preset' ? presetTab() :
      tab === 'cue' ? cueTab() :
      tab === 'branch' ? branchTab() : macroTab(),
    );
  };

  // ---- 组联动 ----
  const groupTab = (): HTMLElement => {
    const proj = p();
    const group: FixtureGroup | undefined = proj.groups[0];
    if (!group) return h('div', { class: 'muted' }, '暂无灯组');
    const activeFixtures = proj.fixtures.filter(f => group.fixtureIds.includes(f.id) && !f.excludedFromGroup);
    const anchor = activeFixtures[0];
    return h('div', {},
      section('灯组',
        field('组名', textInput(group.label, v => { group.label = v; persist(); })),
        field('联动模式', select([['symmetric', '对称'], ['wave', '波浪'], ['chase', '追逐']], group.mode,
          v => { group.mode = v as FixtureGroup['mode']; persist(); rerender(); })),
        field('偏移步进', numInput(group.step, v => { group.step = v; persist(); }, 0.5)),
        field('方向', select([['1', '正向'], ['-1', '反向']], String(group.direction),
          v => { group.direction = Number(v) as 1 | -1; persist(); rerender(); })),
        badge(`组内 ${activeFixtures.length} 台参与 / ${group.fixtureIds.length - activeFixtures.length} 台被临时剔除`, 'info'),
      ),
      section(`调一台, 其余自动跟随 (锚点 ${anchor?.label ?? '—'})`,
        field('Pan°', numInput(anchor?.params.pan ?? 0, v => {
          if (anchor) {
            anchor.params.pan = v;
            proj.fixtures = applyGroupParam(group, proj.fixtures, anchor.id, 'pan', v);
            persist(); rerender();
          }
        })),
        field('Tilt°', numInput(anchor?.params.tilt ?? 0, v => {
          if (anchor) {
            anchor.params.tilt = v;
            proj.fixtures = applyGroupParam(group, proj.fixtures, anchor.id, 'tilt', v);
            persist(); rerender();
          }
        })),
        field('调光', numInput(anchor?.params.dimmer ?? 0, v => {
          if (anchor) {
            anchor.params.dimmer = v;
            proj.fixtures = applyGroupParam(group, proj.fixtures, anchor.id, 'dimmer', v);
            persist(); rerender();
          }
        }, 0.05)),
        field('频闪Hz', numInput(anchor?.params.strobeHz ?? 0, v => {
          if (anchor) {
            anchor.params.strobeHz = v;
            proj.fixtures = applyGroupParam(group, proj.fixtures, anchor.id, 'strobeHz', v);
            persist(); rerender();
          }
        })),
      ),
      section('临时剔灯 (不打断其余效果)',
        table(['灯号', '状态', '操作'],
          proj.fixtures.filter(f => group.fixtureIds.includes(f.id)).slice(0, 40).map(f => [
            f.label,
            f.excludedFromGroup ? badge('已剔除', 'warn') as unknown as string : badge('参与中', 'ok') as unknown as string,
            h('button', {
              class: 'btn',
              onClick: () => { f.excludedFromGroup = !f.excludedFromGroup; persist(); rerender(); },
            }, f.excludedFromGroup ? '恢复' : '剔除') as unknown as string,
          ]),
          { maxHeight: '240px' },
        ),
      ),
    );
  };

  // ---- 预设 ----
  const presetTab = (): HTMLElement => {
    const proj = p();
    const kindLabel: Record<Preset['kind'], string> = { position: '位置', color: '颜色', beam: '光束' };
    return h('div', {},
      section('预设集中维护 (改预设, 引用它的 cue 自动跟随)',
        ...proj.presets.map(ps => h('div', { class: 'list-item' },
          h('div', {},
            h('div', {}, h('strong', {}, ps.label), ' ', badge(kindLabel[ps.kind], 'info')),
            h('div', { class: 'muted mono', style: { fontSize: '11px' } }, JSON.stringify(ps.values)),
          ),
          h('div', { class: 'btn-row' },
            h('button', {
              class: 'btn', onClick: () => {
                const ids = proj.groups[0]?.fixtureIds ?? proj.fixtures.slice(0, 10).map(f => f.id);
                proj.fixtures = applyPreset(proj.fixtures, ps, ids);
                persist(); rerender();
                toast(`预设 ${ps.label} 已应用到 ${ids.length} 台灯`);
              },
            }, '应用到灯组'),
          ),
        )),
        button('＋ 新建颜色预设', () => {
          proj.presets.push({ id: uid('ps'), kind: 'color', label: `颜色预设${proj.presets.length + 1}`, values: { rgb: [0.9, 0.5, 0.1] } });
          persist(); rerender();
        }),
      ),
      section('内置效果生成器 (相位/周期/方向)',
        ...proj.effects.map(eff => effectCard(eff)),
      ),
    );
  };

  const effectCard = (eff: EffectGenerator): HTMLElement =>
    h('div', { class: 'panel' },
      h('h3', {}, eff.label,
        select([['circle', '圆形'], ['spiral', '螺旋'], ['gradient', '渐变']], eff.shape,
          v => { eff.shape = v as EffectGenerator['shape']; persist(); rerender(); })),
      h('div', { class: 'panel-body' },
        field('目标参数', select(['pan', 'tilt', 'dimmer', 'strobeHz'].map(x => [x, x]), eff.targetParam,
          v => { eff.targetParam = v as EffectGenerator['targetParam']; persist(); })),
        field('周期(s)', numInput(eff.period, v => { eff.period = v; persist(); }, 0.5)),
        field('相位', numInput(eff.phase, v => { eff.phase = v; persist(); }, 0.1)),
        field('振幅', numInput(eff.amplitude, v => { eff.amplitude = v; persist(); }, 0.5)),
        field('方向', select([['1', '正向'], ['-1', '反向']], String(eff.direction),
          v => { eff.direction = Number(v) as 1 | -1; persist(); })),
        h('div', { class: 'muted' }, '8 灯预览输出: ' +
          Array.from({ length: 8 }, (_, i) => evaluateEffect(eff, i, 8, 0).toFixed(1)).join(' / ')),
      ),
    );

  // ---- Cue 时间轴 ----
  const cueTab = (): HTMLElement => {
    const proj = p();
    const cues = proj.cues.filter(c => c.branchId === proj.activeBranchId).sort((a, b) => a.no - b.no);
    return h('div', {},
      section('播放与盲编',
        h('div', { class: 'btn-row' },
          button(blind ? '退出盲编' : '进入盲编 (不碰预演画面)', () => {
            blind = !blind;
            if (!blind) proj.blindBuffer = null;
            else proj.blindBuffer = {};
            persist(); rerender();
            toast(blind ? '盲编已开启: 调 cue 不影响正在播的画面' : '盲编已退出');
          }, blind),
          button('导演喊停: 当前状态存为新 cue 插回时间轴', () => {
            const live = new Map(proj.fixtures.map(f => [f.id, cloneParams(f.params)]));
            const no = Math.max(0, ...proj.cues.map(c => c.no)) + 1;
            const cue = cueFromLiveState(no, `现场插入 Cue ${no}`, live, proj.activeBranchId, '排练现场导演要求');
            proj.cues.push(cue);
            persist(); rerender();
            toast(`已插入 Cue ${no}`);
          }),
        ),
        blind ? badge('盲编中: 下方编辑只进盲缓冲, 预演画面保持不变', 'warn') : badge('实时模式', 'ok'),
      ),
      section('Cue 时间轴 (手动逐条触发, 记录留档)',
        h('div', { class: 'cue-track' }, ...cues.map(cue =>
          h('div', {
            class: `cue-card ${playingCueNo === cue.no ? 'active' : ''}`,
            onClick: () => {
              if (blind) {
                proj.blindBuffer = Object.fromEntries(Object.entries(cue.overrides));
                toast(`Cue ${cue.no} 已载入盲缓冲, 预演画面未变`);
              } else {
                applyLive(cue);
                rerender();
              }
            },
          },
            h('strong', {}, `Cue ${cue.no}`),
            h('div', { style: { fontSize: '11px' } }, cue.label),
            h('div', { class: 'muted', style: { fontSize: '11px' } }, `淡入 ${cue.fadeSec}s`),
            h('div', { class: 'muted', style: { fontSize: '11px' } }, cue.remark || '无备注'),
          ),
        )),
        button('＋ 新建 Cue', () => {
          const no = cues.length + 1;
          proj.cues.push({
            id: uid('cue'), no, label: `Cue ${no}`, overrides: {}, presetIds: [], effectIds: [],
            fadeSec: 2, holdSec: 0, remark: '', branchId: proj.activeBranchId, createdAt: Date.now(),
          });
          persist(); rerender();
        }),
      ),
      section('Cue 明细 / 备注 / 触发记录',
        table(['No', '名称', '预设引用', '效果', '备注', '操作'],
          cues.map(c => [
            String(c.no), c.label,
            c.presetIds.map(id => proj.presets.find(x => x.id === id)?.label ?? id).join(', ') || '—',
            c.effectIds.length ? badge(`${c.effectIds.length} 个效果`, 'info') as unknown as string : '—',
            h('input', { value: c.remark, onInput: (e: Event) => { c.remark = (e.target as HTMLInputElement).value; persist(); } }) as unknown as string,
            h('button', {
              class: 'btn btn-primary',
              onClick: () => {
                applyLive(c);
                const updated = { ...p(), triggerLog: [...p().triggerLog, { cueNo: c.no, cueLabel: c.label, triggeredAt: Date.now(), operator: '当前操作员' }] };
                Object.assign(p(), updated);
                persist(); rerender();
                toast(`Cue ${c.no} 触发已留档`);
              },
            }, '触发并留档') as unknown as string,
          ]),
        ),
        proj.triggerLog.length ? h('div', { class: 'muted', style: { marginTop: '6px' } },
          `已留档 ${proj.triggerLog.length} 条触发记录, 最近: Cue ${proj.triggerLog.at(-1)?.cueNo} @ ${new Date(proj.triggerLog.at(-1)!.triggeredAt).toLocaleTimeString('zh-CN')}`) : h('div'),
      ),
    );
  };

  // ---- 分支 ----
  const branchTab = (): HTMLElement => {
    const proj = p();
    return h('div', {},
      section('方案分支 (试效果不行就切回)',
        ...proj.branches.map(b => h('div', { class: `list-item ${b.id === proj.activeBranchId ? 'active' : ''}` },
          h('div', {}, h('strong', {}, b.label), h('div', { class: 'muted' }, `${proj.cues.filter(c => c.branchId === b.id).length} 个 cue · ${b.note || '无备注'}`)),
          h('div', { class: 'btn-row' },
            h('button', {
              class: 'btn', onClick: () => { proj.activeBranchId = b.id; persist(); rerender(); },
            }, '切换'),
          ),
        )),
        button('＋ 从当前主线开试验分支', () => {
          const newId = uid('br');
          proj.branches.push({ id: newId, label: `试验分支${proj.branches.length}`, parentId: proj.activeBranchId, createdAt: Date.now(), note: '试效果' });
          const forked = forkBranch(proj.cues, proj.activeBranchId, newId);
          proj.cues.push(...forked);
          proj.activeBranchId = newId;
          persist(); rerender();
          toast('分支已创建, 主线 cue 不受影响');
        }),
      ),
    );
  };

  // ---- 宏 ----
  const macroTab = (): HTMLElement => {
    const proj = p();
    return h('div', {},
      section('操作宏与快捷键',
        h('div', { class: 'muted' }, '把多步操作录成宏绑快捷键, 演出时一键执行'),
        ...proj.macros.map(m => h('div', { class: 'list-item' },
          h('div', {}, h('strong', {}, m.label), ' ', badge(m.hotkey, 'info')),
          h('div', { class: 'muted' }, `${m.steps.length} 步`),
        )),
        button('● 录制宏 (示例: 全灯调光 80% → 红色)', () => {
          proj.macros.push({
            id: uid('macro'), label: `宏${proj.macros.length + 1}`, hotkey: `F${proj.macros.length + 2}`,
            steps: [
              { action: 'setParam', payload: { param: 'dimmer', value: 0.8 } },
              { action: 'setParam', payload: { param: 'rgb', value: [1, 0.1, 0.1] } },
            ],
          });
          persist(); rerender();
          toast('宏已录制并绑定快捷键');
        }),
      ),
    );
  };

  const buildMain = (): HTMLElement =>
    h('div', { class: 'main' },
      h('div', { class: 'bottom-panel' },
        h('div', { class: 'stat-grid' },
          stat(p().cues.filter(c => c.branchId === p().activeBranchId).length, '当前分支 Cue'),
          stat(p().presets.length, '预设'),
          stat(p().effects.length, '效果器'),
          stat(p().triggerLog.length, '触发留档'),
        ),
      ),
    );

  const persist = (): void => store.mutate(() => {});
  rerender();
  return root;
}

const stat = (n: number, label: string): HTMLElement =>
  h('div', { class: 'stat' }, h('div', { class: 'num' }, String(n)), h('div', { class: 'lbl' }, label));

export type { FixtureParams };
