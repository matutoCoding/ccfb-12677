// 三维视口: 挂载 GLRenderer, 轨道控制/拾取/测距测角/剖切, 渲染循环
import { h } from './dom.ts';
import { GLRenderer } from '../engine/renderer.ts';
import { SceneBuilder, type SceneOptions } from '../engine/scene.ts';
import type { Project, Venue, LampModel, Vec3 } from '../core/types.ts';
import { dist } from '../core/math.ts';

export interface ViewportHandle {
  rerender: () => void;
  renderer: () => GLRenderer;
  setClip: (on: boolean, axis: 'x' | 'y' | 'z', dist: number) => void;
  measureMode: (on: boolean) => void;
  onPick: (cb: ((key: string) => void) | null) => void;
  sync: (project: Project | undefined, venue: Venue | undefined, models: LampModel[], opts: SceneOptions) => void;
}

export function createViewport(onReady: (handle: ViewportHandle) => void): HTMLElement {
  const canvas = h('canvas', {}) as HTMLCanvasElement;
  const tip = h('div', { class: 'overlay-tip' },
    '左键拖拽旋转 · 滚轮缩放 · 右键平移 · 单击拾取灯/挂点/评论钉');
  const measureTip = h('div', { class: 'measure-tip', hidden: true });
  const container = h('div', { class: 'viewport' }, canvas, tip, measureTip);

  let renderer: GLRenderer;
  let builder: SceneBuilder;
  let pickCb: ((key: string) => void) | null = null;
  let measuring = false;
  let measurePts: Vec3[] = [];
  let current: { project?: Project; venue?: Venue; models: LampModel[]; opts: SceneOptions } = {
    models: [], opts: {},
  };

  requestAnimationFrame(() => {
    renderer = new GLRenderer(canvas);
    builder = new SceneBuilder(renderer);
    bindControls();
    const loop = (): void => {
      builder.build(current.project, current.venue, current.models, current.opts);
      renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);

    onReady({
      renderer: () => renderer,
      rerender: () => builder.build(current.project, current.venue, current.models, current.opts),
      setClip: (on, axis, d) => {
        renderer.clipOn = on;
        renderer.clipNormal = axis === 'x' ? [1, 0, 0] : axis === 'y' ? [0, 1, 0] : [0, 0, 1];
        renderer.clipDist = d;
      },
      measureMode: on => { measuring = on; measurePts = []; measureTip.hidden = !on; },
      onPick: cb => { pickCb = cb; },
      sync: (project, venue, models, opts) => { current = { project, venue, models, opts }; },
    });
  });

  function bindControls(): void {
    let dragging = false, panning = false, lx = 0, ly = 0, moved = false;
    canvas.addEventListener('mousedown', e => {
      dragging = true; panning = e.button === 2; lx = e.clientX; ly = e.clientY; moved = false;
    });
    window.addEventListener('mouseup', e => {
      if (!dragging) return;
      dragging = false;
      if (!moved && e.target === canvas && !panning) {
        if (measuring) {
          const p = renderer.screenToPlane(e.clientX, e.clientY, current.project?.luxGrid.height ?? 0.1);
          measurePts.push(p);
          if (measurePts.length >= 2) {
            const [a, b] = measurePts;
            const d = dist(a, b);
            const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
            measureTip.textContent = `测距: ${d.toFixed(3)} m · 水平方位角: ${ang.toFixed(1)}° · 点1(${a.map(n => n.toFixed(2)).join(',')}) 点2(${b.map(n => n.toFixed(2)).join(',')})`;
            measurePts = [];
          } else {
            measureTip.textContent = '已选第一个点, 请选择第二个点…';
          }
        } else {
          const key = renderer.pick(e.clientX, e.clientY);
          if (key && pickCb) pickCb(key);
        }
      }
      panning = false;
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (panning) {
        const s = 0.02 * Math.hypot(
          renderer.camera.eye[0] - renderer.camera.target[0],
          renderer.camera.eye[1] - renderer.camera.target[1],
          renderer.camera.eye[2] - renderer.camera.target[2]);
        renderer.camera.target[0] -= dx * s * 0.05;
        renderer.camera.target[1] += dy * s * 0.05;
      } else {
        renderer.orbit(dx, dy);
      }
      lx = e.clientX; ly = e.clientY;
    });
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      renderer.zoom(e.deltaY > 0 ? 1.12 : 0.89);
    }, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  return container;
}
