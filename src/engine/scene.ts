// 领域数据 -> GL 渲染实例/线段 的映射
import type { GLRenderer, Instance, LineSeg } from './renderer.ts';
import type { Project, Venue, Fixture, LampModel, Vec3 } from '../core/types.ts';
import { luxFalseColor, computeLuxGrid, cctToRgb } from '../core/photometric.ts';

export interface SceneOptions {
  showLuxGrid?: boolean;
  darkFixtureIds?: Set<string>;   // 断电模拟中失控的灯 -> 黑色
  selectedId?: string;
  collisionTargets?: Set<string>; // 干涉检查命中的灯 -> 红色
  showBeams?: boolean;
  showComments?: boolean;
  showHangPoints?: boolean;
  showTrusses?: boolean;
  showTopology?: boolean;
}

export class SceneBuilder {
  private renderer: GLRenderer;
  constructor(renderer: GLRenderer) { this.renderer = renderer; }

  build(project: Project | undefined, venue: Venue | undefined, models: LampModel[], opts: SceneOptions): void {
    const instances: Instance[] = [];
    const lines: LineSeg[] = [];
    if (!project) { this.renderer.reset(instances, lines); return; }
    const modelMap = new Map(models.map(m => [m.id, m]));

    // 场地地坪与边界
    if (venue) {
      const o = venue.origin;
      const s = venue.size;
      const corners: Vec3[] = [
        [o[0], o[1], o[2] + 0.01], [o[0] + s[0], o[1], o[2] + 0.01],
        [o[0] + s[0], o[1] + s[1], o[2] + 0.01], [o[0], o[1] + s[1], o[2] + 0.01],
      ];
      for (let i = 0; i < 4; i++) {
        lines.push({ a: corners[i], b: corners[(i + 1) % 4], color: [0.35, 0.45, 0.6, 1] });
      }
      // 障碍物
      for (const ob of venue.obstacles) {
        const c: Vec3 = [(ob.min[0] + ob.max[0]) / 2, (ob.min[1] + ob.max[1]) / 2, (ob.min[2] + ob.max[2]) / 2];
        const sc: Vec3 = [ob.max[0] - ob.min[0], ob.max[1] - ob.min[1], ob.max[2] - ob.min[2]];
        instances.push({
          position: c, scale: 1,
          color: [0.45, 0.32, 0.2, 0.35],
          rotation: [0, 0, 0],
          pickId: this.renderer.registerPick(`obstacle:${ob.id}`),
        });
        // 用 scale 传不了非均匀, 障碍物改线段盒
        void sc;
        const b = [ob.min, ob.max];
        const pts: Vec3[] = [];
        for (const x of [b[0][0], b[1][0]]) for (const y of [b[0][1], b[1][1]]) for (const z of [b[0][2], b[1][2]]) pts.push([x, y, z]);
        const edges: [number, number][] = [[0, 1], [0, 2], [0, 4], [1, 3], [1, 5], [2, 3], [2, 6], [3, 7], [4, 5], [4, 6], [5, 7], [6, 7]];
        for (const [i, j] of edges) lines.push({ a: pts[i], b: pts[j], color: [0.8, 0.55, 0.3, 0.9] });
      }
      // 挂点
      if (opts.showHangPoints !== false) {
        for (const hp of venue.hangPoints) {
          const wp: Vec3 = [venue.origin[0] + hp.position[0], venue.origin[1] + hp.position[1], venue.origin[2] + hp.position[2]];
          instances.push({
            position: wp, scale: 0.22,
            color: [0.3, 0.75, 0.95, 1],
            pickId: this.renderer.registerPick(`hangpoint:${hp.id}`),
          });
        }
      }
    }

    // 桁架
    if (opts.showTrusses !== false) {
      for (const tr of project.trusses) {
        lines.push({ a: tr.from, b: tr.to, color: [0.7, 0.72, 0.78, 1] });
        const mid: Vec3 = [(tr.from[0] + tr.to[0]) / 2, (tr.from[1] + tr.to[1]) / 2, (tr.from[2] + tr.to[2]) / 2];
        const len = Math.hypot(tr.to[0] - tr.from[0], tr.to[1] - tr.from[1], tr.to[2] - tr.from[2]);
        const ang = Math.atan2(tr.to[1] - tr.from[1], tr.to[0] - tr.from[0]) * 180 / Math.PI;
        instances.push({
          position: mid, scale: 1,
          color: [0.55, 0.57, 0.62, 1],
          rotation: [0, 0, ang],
          pickId: this.renderer.registerPick(`truss:${tr.id}`),
        });
        void len;
      }
    }

    // 灯具
    for (const fx of project.fixtures) {
      const mdl = modelMap.get(fx.modelId);
      const isDark = opts.darkFixtureIds?.has(fx.id);
      const isSelected = opts.selectedId === fx.id;
      const isCollision = opts.collisionTargets?.has(fx.id);
      let color: [number, number, number, number];
      if (isDark) color = [0.08, 0.08, 0.08, 1];
      else if (isCollision) color = [1, 0.25, 0.2, 1];
      else if (isSelected) color = [1, 0.85, 0.2, 1];
      else {
        const warm = cctToRgb(mdl?.cct ?? 6000);
        const dim = 0.35 + 0.65 * fx.params.dimmer;
        color = [warm[0] * dim, warm[1] * dim, warm[2] * dim, 1];
      }
      instances.push({
        position: fx.position,
        scale: (mdl?.bodyHalfWidth ?? 0.18) * 2,
        color,
        rotation: [fx.params.tilt, 0, fx.params.pan],
        pickId: this.renderer.registerPick(`fixture:${fx.id}`),
      });
      // 光束
      if (opts.showBeams && !isDark && fx.params.dimmer > 0.05) {
        const reach = 12 * fx.params.zoom;
        const pan = fx.params.pan * Math.PI / 180, tilt = fx.params.tilt * Math.PI / 180;
        const end: Vec3 = [
          fx.position[0] + Math.cos(tilt) * Math.sin(pan) * reach,
          fx.position[1] - Math.cos(tilt) * Math.cos(pan) * reach,
          fx.position[2] - Math.sin(tilt) * reach - reach * 0.6,
        ];
        lines.push({ a: fx.position, b: end, color: [fx.params.rgb[0] * 0.5, fx.params.rgb[1] * 0.5, fx.params.rgb[2] * 0.5, 0.35] });
      }
    }

    // 拓扑链路
    if (opts.showTopology) {
      const nodePos = new Map(project.topology.nodes.map(n => [n.id, n.position]));
      for (const l of project.topology.links) {
        const a = nodePos.get(l.fromNode), b = nodePos.get(l.toNode);
        if (a && b) lines.push({ a, b, color: l.cableLength > 100 ? [1, 0.4, 0.2, 1] : [0.3, 0.9, 0.5, 0.8] });
      }
      for (const n of project.topology.nodes) {
        instances.push({
          position: n.position, scale: 0.35,
          color: n.kind === 'console' ? [0.9, 0.7, 0.2, 1] : n.kind === 'switch' ? [0.7, 0.4, 0.95, 1] : [0.3, 0.85, 0.6, 1],
          pickId: this.renderer.registerPick(`node:${n.id}`),
        });
      }
    }

    // 评审评论钉
    if (opts.showComments !== false) {
      for (const c of project.comments) {
        const col: [number, number, number, number] =
          c.status === 'resolved' ? [0.3, 0.85, 0.4, 1] :
          c.status === 'rejected' ? [0.5, 0.5, 0.5, 1] :
          c.status === 'assigned' ? [0.95, 0.65, 0.2, 1] : [1, 0.3, 0.4, 1];
        instances.push({
          position: c.position, scale: 0.28, color: col,
          pickId: this.renderer.registerPick(`comment:${c.id}`),
        });
      }
    }

    // 照度伪彩网格 (台面薄层)
    if (opts.showLuxGrid) {
      const grid = computeLuxGrid(project.fixtures, models, project.luxGrid);
      const max = Math.max(1, grid.max);
      for (const cell of grid.cells) {
        const [r, g, b] = luxFalseColor(cell.lux / max);
        instances.push({
          position: [cell.x, cell.y, project.luxGrid.height + 0.02],
          scale: Math.max(0.15, project.luxGrid.size[0] / grid.nx * 0.9),
          color: [r, g, b, 0.85],
        });
      }
    }

    this.renderer.reset(instances, lines);
  }
}

export type { Fixture };
