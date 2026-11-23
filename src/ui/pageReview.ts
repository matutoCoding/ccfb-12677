// 页面四: 预演评审 —— 三维钉评论/指派/状态/关联 cue 灯号/意见打包往返/预演
import { h, section, field, textInput, button, table, badge, toast, select } from './dom.ts';
import type { ViewportHandle } from './viewport.ts';
import { store } from '../core/store.ts';
import { makeComment, exportCommentBundle, mergeCommentBundle } from '../core/review.ts';
import { buildCueState } from '../core/programming.ts';
import { downloadText, pickFile, fmtTime, uid } from '../core/util.ts';
import type { ReviewComment, Project } from '../core/types.ts';

export function reviewPage(vp: ViewportHandle): HTMLElement {
  const root = h('div', { class: 'layout' });
  let pinMode = false;
  let filter: ReviewComment['status'] | 'all' = 'all';

  const p = (): Project => {
    const proj = store.activeProject;
    if (!proj) throw new Error('无活动工程');
    return proj;
  };

  const rerender = (): void => {
    vp.sync(store.activeProject, store.activeVenue, store.state.lampModels, { showBeams: true, showComments: true });
    root.replaceChildren(buildSidebar(), buildMain());
  };

  const buildSidebar = (): HTMLElement => {
    const proj = p();
    const comments = proj.comments.filter(c => filter === 'all' || c.status === filter);
    return h('div', { class: 'sidebar wide' },
      section('评审操作',
        button(pinMode ? '取消钉评论' : '在场景中钉评论 (点击三维位置)', () => {
          pinMode = !pinMode;
          if (pinMode) toast('点击三维视口中的位置放置评论钉');
          rerender();
        }, pinMode),
        h('div', { class: 'btn-row' },
          button('打包客户意见 (导出 JSON)', () => {
            downloadText(`${proj.name}-评论包.json`, exportCommentBundle(proj.name, proj.comments), 'application/json');
            toast('评论包已导出, 可发给客户');
          }),
          button('导回客户意见并合并', async () => {
            const file = await pickFile('.json');
            const text = await file.text();
            const r = mergeCommentBundle(proj.comments, text);
            proj.comments = r.comments;
            store.mutate(() => {});
            rerender();
            toast(`合并完成: 新增 ${r.added} 条, 跳过已解决 ${r.skipped} 条`);
          }),
        ),
      ),
      section('状态筛选',
        select([['all', '全部'], ['open', '待处理'], ['assigned', '已指派'], ['resolved', '已解决'], ['rejected', '已驳回']],
          filter, v => { filter = v as ReviewComment['status'] | 'all'; rerender(); }),
      ),
      section(`评论清单 (${comments.length})`,
        table(['位置', '意见', '指派/状态', '关联', '操作'],
          comments.map(c => [
            `(${c.position.map(n => n.toFixed(1)).join(',')})`,
            h('div', {}, h('div', {}, c.text), h('div', { class: 'muted', style: { fontSize: '11px' } }, `${c.author} · ${fmtTime(c.createdAt)}`)) as unknown as string,
            h('div', {},
              badge(statusText(c.status), c.status === 'resolved' ? 'ok' : c.status === 'open' ? 'err' : 'warn'),
              h('div', { class: 'muted', style: { fontSize: '11px' } }, c.assignee ? `→ ${c.assignee}` : '未指派'),
            ) as unknown as string,
            h('div', { class: 'mono', style: { fontSize: '11px' } },
              [c.cueNo ? `Cue${c.cueNo}` : '', c.fixtureLabel ?? ''].filter(Boolean).join(' / ') || '—') as unknown as string,
            h('div', { class: 'btn-row' },
              h('button', { class: 'btn', onClick: () => { c.assignee = c.assignee ?? '灯光组'; c.status = 'assigned'; persist(); rerender(); } }, '指派'),
              h('button', { class: 'btn', onClick: () => { c.status = 'resolved'; persist(); rerender(); } }, '解决'),
              h('button', { class: 'btn btn-danger', onClick: () => { proj.comments = proj.comments.filter(x => x.id !== c.id); persist(); rerender(); } }, '删'),
            ) as unknown as string,
          ]),
          { maxHeight: '420px' },
        ),
      ),
    );
  };

  const buildMain = (): HTMLElement =>
    h('div', { class: 'main' },
      h('div', { class: 'bottom-panel' },
        section('预演播放 (按 cue 顺序, 盲编与现场隔离)',
          h('div', { class: 'cue-track' },
            ...p().cues.filter(c => c.branchId === p().activeBranchId).sort((a, b) => a.no - b.no).map(c =>
              h('div', {
                class: 'cue-card',
                onClick: () => {
                  const state = buildCueState(p().fixtures, c, p().presets, p().effects, 0);
                  store.updateProject(p().id, proj => {
                    proj.fixtures = proj.fixtures.map(fx => ({ ...fx, params: state.get(fx.id) ?? fx.params }));
                  });
                  toast(`预演 Cue ${c.no}: ${c.label}`);
                  rerender();
                },
              }, h('strong', {}, `Cue ${c.no}`), h('div', { style: { fontSize: '11px' } }, c.label)),
            ),
          ),
          h('div', { class: 'muted' }, '提示: 点击三维中的红色评论钉可直接回复/解决; 绿色为已解决, 橙色为已指派。'),
        ),
      ),
    );

  vp.onPick(key => {
    if (!key.startsWith('comment:')) {
      if (pinMode && key.startsWith('fixture:')) {
        const fx = store.activeProject?.fixtures.find(f => f.id === key.slice(8));
        if (fx) openCommentDialog(fx.position, fx.label);
      }
      return;
    }
    const id = key.slice(8);
    const c = p().comments.find(x => x.id === id);
    if (c) toast(`${statusText(c.status)}: ${c.text}${c.assignee ? ` (${c.assignee})` : ''}`);
  });

  const openCommentDialog = (position: number[], fixtureLabel?: string, cueNo?: number): void => {
    const text = window.prompt('输入评审意见:', '此处光束遮挡演员');
    if (!text) return;
    const assignee = window.prompt('指派给 (留空不指派):', '灯光编程');
    const comment = makeComment(position as [number, number, number], text, '评审人', {
      fixtureLabel, cueNo, assignee: assignee || undefined,
    });
    p().comments.push(comment);
    pinMode = false;
    persist();
    rerender();
    toast('评论已钉到场景');
  };

  // 暴露给视口空白处点击: 通过自定义事件
  window.addEventListener('tld:pin-comment', ((e: CustomEvent) => {
    openCommentDialog(e.detail.position, e.detail.fixtureLabel, e.detail.cueNo);
  }) as EventListener);

  const persist = (): void => store.mutate(() => {});
  void uid;
  rerender();
  return root;
}

const statusText = (s: ReviewComment['status']): string =>
  ({ open: '待处理', assigned: '已指派', resolved: '已解决', rejected: '已驳回' })[s];
