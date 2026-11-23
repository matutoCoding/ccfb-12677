// 应用入口: 顶部导航 + 页面路由, 三维视口常驻不重建
import './ui/styles.css';
import { h, clear, toast } from './ui/dom.ts';
import { createViewport, type ViewportHandle } from './ui/viewport.ts';
import { venuesPage } from './ui/pageVenues.ts';
import { designPage } from './ui/pageDesign.ts';
import { programmingPage } from './ui/pageProgramming.ts';
import { reviewPage } from './ui/pageReview.ts';
import { outputPage } from './ui/pageOutput.ts';
import { store } from './core/store.ts';
import { buildDemoState } from './core/sampleData.ts';

type PageId = 'venues' | 'design' | 'programming' | 'review' | 'output';

const NAV: [PageId, string][] = [
  ['venues', '场馆档案'],
  ['design', '方案设计'],
  ['programming', '灯效编程'],
  ['review', '预演评审'],
  ['output', '出图报价'],
];

async function bootstrap(): Promise<void> {
  await store.load();
  // 数据版本迁移: 演示数据结构调整后, 旧版本自动重建 (正式工程数据走导入导出, 不受影响)
  const DATA_VERSION = 3;
  if (store.state.venues.length === 0 || store.state.dataVersion !== DATA_VERSION) {
    store.state = { ...buildDemoState(), dataVersion: DATA_VERSION };
  }
  const app = document.getElementById('app')!;
  let page: PageId = 'design';
  let handle: ViewportHandle | null = null;

  const topbar = h('div', { class: 'topbar' },
    h('div', { class: 'logo' }, '巡演灯光设计 · 场馆适配系统'),
    h('nav', {}, ...NAV.map(([id, label]) =>
      h('button', {
        class: id === page ? 'active' : '',
        onClick: () => { page = id; render(); },
      }, label))),
    h('div', { class: 'meta' }, '本地存储 · 离线运行 · WebGL2'),
  );

  const viewportHost = createViewport(h => { handle = h; render(); });
  const pageHost = h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } });
  const layout = h('div', { style: { flex: 1, minHeight: 0, display: 'flex' } }, pageHost, viewportHost);
  app.append(topbar, layout);

  function render(): void {
    if (!handle) return;
    clear(pageHost);
    const builders: Record<PageId, (vp: ViewportHandle) => HTMLElement> = {
      venues: venuesPage,
      design: designPage,
      programming: programmingPage,
      review: reviewPage,
      output: outputPage,
    };
    // 视口在右侧, 页面容器在左侧; 页面内部自带 .layout(侧栏+主区)
    pageHost.style.flex = '1';
    viewportHost.style.flex = '1.2';
    viewportHost.style.minWidth = '380px';
    pageHost.append(builders[page](handle));
    [...topbar.querySelectorAll('button')].forEach((b, i) =>
      b.classList.toggle('active', NAV[i][0] === page));
  }

  // 全局快捷键: 宏触发 (F2/F3...)
  window.addEventListener('keydown', e => {
    if (!e.key.startsWith('F')) return;
    const proj = store.activeProject;
    const macro = proj?.macros.find(m => m.hotkey === e.key);
    if (!macro) return;
    e.preventDefault();
    // 示例宏执行器: 支持 setParam
    for (const step of macro.steps) {
      if (step.action === 'setParam') {
        const { param, value } = step.payload as { param: string; value: number | number[] };
        store.updateProject(proj!.id, pr => {
          for (const fx of pr.fixtures) {
            if (param === 'rgb' && Array.isArray(value)) fx.params.rgb = [value[0], value[1], value[2]];
            else (fx.params as unknown as Record<string, unknown>)[param] = value;
          }
        });
      }
    }
    toast(`已执行宏: ${macro.label} (${macro.hotkey})`);
  });

  window.addEventListener('error', e => {
    toast('运行错误: ' + e.message, 'err');
  });
}

void bootstrap();
