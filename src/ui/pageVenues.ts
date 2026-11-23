// 页面一: 场馆档案 —— 档案/附件/复勘三维回写/换馆适配比对
import { h, section, field, numInput, textInput, button, table, badge, toast, select } from './dom.ts';
import type { ViewportHandle } from './viewport.ts';
import { store } from '../core/store.ts';
import { compareVenueAdaptation, type AdaptationResult } from '../core/venueAdapt.ts';
import { pickFile, fmt, fmtTime, uid } from '../core/util.ts';
import type { Venue, HangPoint } from '../core/types.ts';

export function venuesPage(vp: ViewportHandle): HTMLElement {
  let selectedVenueId = store.state.activeVenueId ?? store.state.venues[0]?.id;
  let adaptation: AdaptationResult | null = null;
  const project0 = store.activeProject;
  let targetVenueId = store.state.venues.find(v => v.id !== project0?.venueId)?.id ?? '';
  let toleranceM = 1.5;
  const root = h('div', { class: 'layout' });

  const rerender = (): void => {
    const venue = store.state.venues.find(v => v.id === selectedVenueId);
    store.state.activeVenueId = selectedVenueId;
    if (venue) vp.sync(store.activeProject, venue, store.state.lampModels, { showHangPoints: true });
    root.replaceChildren(buildSidebar(venue), buildMain(venue));
  };

  const buildSidebar = (venue: Venue | undefined): HTMLElement =>
    h('div', { class: 'sidebar' },
      section('场馆列表',
        ...store.state.venues.map(v =>
          h('div', {
            class: `list-item ${v.id === selectedVenueId ? 'active' : ''}`,
            onClick: () => { selectedVenueId = v.id; rerender(); },
          },
            h('div', {}, h('strong', {}, v.name), h('div', { class: 'muted' }, `${v.city} · ${v.hangPoints.length} 挂点`)),
            badge(v.revisedAt ? '已复勘' : '初版', v.revisedAt ? 'ok' : 'info'),
          ),
        ),
        button('＋ 新建场馆档案', () => {
          const v: Venue = {
            id: uid('venue'), name: '新场馆', city: '', origin: [0, 0, 0], size: [40, 30, 18], height: 18,
            stageCenter: [20, 8, 0], hangPoints: [], obstacles: [], powerPorts: [],
            attachments: [], surveyNotes: '', revisedAt: 0, createdAt: Date.now(),
          };
          store.mutate(s => s.venues.push(v));
          selectedVenueId = v.id;
          rerender();
        }),
      ),
      venue ? section('档案信息',
        field('名称', textInput(venue.name, val => { venue.name = val; persist(); })),
        field('城市', textInput(venue.city, val => { venue.city = val; persist(); })),
        field('层高(m)', numInput(venue.height, v => { venue.height = v; persist(); })),
        field('场地长(m)', numInput(venue.size[0], v => { venue.size[0] = v; persist(); })),
        field('场地宽(m)', numInput(venue.size[1], v => { venue.size[1] = v; persist(); })),
        field('复勘备注', h('textarea', {
          onInput: (e: Event) => { venue.surveyNotes = (e.target as HTMLTextAreaElement).value; persist(); },
        }, venue.surveyNotes)),
      ) : h('div'),
      venue ? section('吊杆图 / 用电条件单',
        button('导入附件 (PDF/图片/表格)', async () => {
          const file = await pickFile('.pdf,.png,.jpg,.jpeg,.xlsx,.xls,.dwg,.dxf');
          const kind = file.name.includes('电') ? 'power-sheet' : 'rigger-drawing';
          await store.putAttachment(venue.id, file, kind);
          toast('附件已挂接到档案');
          rerender();
        }),
        ...venue.attachments.map(a =>
          h('div', { class: 'attachment-card' },
            h('div', {}, h('div', {}, a.name), h('div', { class: 'muted' }, `${fmt(a.size / 1024, 1)} KB · ${fmtTime(a.uploadedAt)}`)),
            h('div', { class: 'btn-row' },
              h('button', {
                class: 'btn', onClick: async () => {
                  const blob = await store.getAttachment(a.blobKey);
                  if (blob) window.open(URL.createObjectURL(blob), '_blank');
                },
              }, '查看'),
              h('button', {
                class: 'btn btn-danger', onClick: () => {
                  void store.removeAttachment(venue.id, a.id).then(rerender);
                },
              }, '删除'),
            ),
          ),
        ),
      ) : h('div'),
    );

  const buildMain = (venue: Venue | undefined): HTMLElement => {
    if (!venue) return h('div', { class: 'main' }, h('div', { class: 'overlay-tip' }, '请先选择或新建场馆'));
    const project = store.activeProject;
    return h('div', { class: 'main' },
      h('div', { class: 'bottom-panel', style: { flex: '0 0 auto', maxHeight: '46vh', overflow: 'auto' } },
        h('div', { class: 'tabs' },
          h('button', { class: 'active' }, '挂点与复勘回写'),
          h('button', { onClick: () => rerender() }, '用电接口'),
        ),
        h('div', { class: 'stat-grid', style: { marginBottom: '10px' } },
          stat(venue.hangPoints.length, '挂点总数'),
          stat(venue.obstacles.length, '障碍物/马道'),
          stat(venue.powerPorts.length, '供电接口'),
          stat(venue.attachments.length, '附件'),
        ),
        table(
          ['挂点', 'X(m)', 'Y(m)', 'Z层高(m)', '承重(kg)', '形式', '复勘操作'],
          venue.hangPoints.slice(0, 300).map(hp => [
            hp.label,
            ...(['position.0', 'position.1', 'position.2'] as const).map((k, i) =>
              numInput(hp.position[i], v => {
                hp.position[i] = v;
                store.updateVenue(venue.id, () => {});
                rerender();
              }, 0.1) as unknown as string),
            String(hp.loadKg),
            hp.kind,
            h('button', {
              class: 'btn',
              onClick: () => {
                // 三维里拾取挂点后可直接改 Z 净空; 此处提供快速下调 0.5m 的复勘动作
                hp.position[2] = Math.round((hp.position[2] - 0.5) * 100) / 100;
                store.updateVenue(venue.id, () => {});
                toast(`挂点 ${hp.label} 净空回写: Z=${hp.position[2]}m`);
                rerender();
              },
            }, '净空 -0.5m') as unknown as string,
          ]),
          { maxHeight: '260px' },
        ),
        h('div', { class: 'muted', style: { marginTop: '6px' } },
          `表中只展示前 300 行, 全量 ${venue.hangPoints.length} 挂点参与比对; 三维视口中点击蓝色挂点可在下方定位。`),
      ),
      h('div', { class: 'bottom-panel' },
        h('div', { style: { display: 'flex', gap: '10px', alignItems: 'center', marginBottom: '8px' } },
          h('strong', {}, '换馆适配比对'),
          h('span', { class: 'muted' }, `当前工程: ${project?.name ?? '未选择'} (${project?.fixtures.length ?? 0} 灯)`),
          select(
            store.state.venues.filter(v => v.id !== (project?.venueId ?? '')).map(v => [v.id, v.name]),
            targetVenueId,
            v => { targetVenueId = v; },
          ),
          field('匹配容差(m)', numInput(toleranceM, v => { toleranceM = v; }, 0.25)),
          button('开始全量比对', () => {
            if (!project) return toast('请先在方案设计页打开工程', 'err');
            const target = store.state.venues.find(v => v.id === targetVenueId);
            const source = store.state.venues.find(v => v.id === project.venueId);
            if (!target || !source) return toast('请选择目标场馆', 'err');
            adaptation = compareVenueAdaptation({
              fixtures: project.fixtures, models: store.state.lampModels,
              sourceVenue: source, targetVenue: target, toleranceM,
            });
            toast(`比对完成: ${adaptation.matchedCount}/${adaptation.fixtureCount} 可装, 耗时 ${fmt(adaptation.elapsedMs, 1)}ms`);
            rerender();
          }, true),
        ),
        adaptation ? adaptationPanel(adaptation, venue) : h('div', { class: 'muted' }, '选择目标馆后开始比对。硬指标: 2000 挂点全量 < 3 秒。'),
      ),
    );
  };

  const adaptationPanel = (r: AdaptationResult, target: Venue): HTMLElement => {
    const tone = r.issues.length === 0 ? 'ok' : r.issues.length > 20 ? 'err' : 'warn';
    return h('div', {},
      h('div', { class: 'btn-row', style: { marginBottom: '8px' } },
        badge(`可装 ${r.matchedCount}/${r.fixtureCount}`, 'ok'),
        badge(`装不上 ${r.issues.length}`, tone),
        badge(`耗时 ${fmt(r.elapsedMs, 1)} ms / 预算 3000ms`, r.elapsedMs < 3000 ? 'ok' : 'err'),
        badge(`目标馆: ${target.name}`, 'info'),
      ),
      table(
        ['灯号', '原因', '明细', '替代挂点建议(Top3)'],
        r.issues.slice(0, 200).map(iss => [
          iss.fixtureLabel,
          badge(reasonText(iss.reason), iss.reason === 'overload' ? 'warn' : 'err') as unknown as string,
          iss.detail,
          h('div', { class: 'btn-row' }, ...iss.suggestions.map(s =>
            h('button', {
              class: 'btn',
              title: `剩余承重 ${s.spareLoadKg}kg · 净空 ${s.clearance}m`,
              onClick: () => toast(`已选替代挂点 ${s.label}: 偏移 ${s.distance}m`),
            }, `${s.label} (${s.distance}m)`),
          )) as unknown as string,
        ]),
        { maxHeight: '200px' },
      ),
    );
  };

  const persist = (): void => store.mutate(() => {});

  // 三维拾取挂点 -> 高亮并定位编辑
  vp.onPick(key => {
    if (!key.startsWith('hangpoint:')) return;
    const id = key.slice(10);
    const venue = store.state.venues.find(v => v.id === selectedVenueId);
    const hp = venue?.hangPoints.find((x: HangPoint) => x.id === id);
    if (hp) toast(`挂点 ${hp.label} @ (${hp.position.map(n => n.toFixed(2)).join(', ')}) 承重 ${hp.loadKg}kg`);
  });

  rerender();
  return root;
}

const reasonText = (r: string): string => ({
  'no-near-point': '附近无挂点', overload: '承重不足',
  'insufficient-clearance': '净空不足', 'obstacle-collision': '障碍干涉',
} as Record<string, string>)[r] ?? r;

const stat = (num: number | string, label: string): HTMLElement =>
  h('div', { class: 'stat' }, h('div', { class: 'num' }, String(num)), h('div', { class: 'lbl' }, label));
