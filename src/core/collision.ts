// 摇头灯运动包络干涉检查
// 策略: 每台灯以"整周转动可达最大半径球"做空间哈希预筛, 再对 pan/tilt 采样做胶囊体精确求交
// 性能目标: 300 台摇头灯全量一轮 < 10s
import type { Fixture, LampModel, Truss, Vec3 } from './types.ts';
import { SpatialHash, deg2rad, dist, sub, cross, len, clamp } from './math.ts';

export interface AngleInterval {
  panFrom: number; panTo: number;
  tiltFrom: number; tiltTo: number;
}

export interface CollisionRecord {
  fixtureId: string;
  fixtureLabel: string;
  /** 碰撞对象: truss:<id> 或 fixture:<id> */
  target: string;
  targetLabel: string;
  minDistance: number;
  intervals: AngleInterval[];
}

export interface CollisionReport {
  movingHeadCount: number;
  sampleCount: number;
  collisions: CollisionRecord[];
  elapsedMs: number;
}

export interface CollisionOptions {
  fixtures: Fixture[];
  models: LampModel[];
  trusses: Truss[];
  /** pan 采样步长 (度) */
  panStep?: number;
  /** tilt 采样步长 (度) */
  tiltStep?: number;
  /** 额外安全间隙 米 */
  safetyGap?: number;
}

interface SegmentTarget {
  key: string;
  label: string;
  a: Vec3;
  b: Vec3;
  radius: number;
}

/** 点到线段最短距离 */
export function pointSegmentDistance(p: Vec3, a: Vec3, b: Vec3): number {
  const ab = sub(b, a);
  const ap = sub(p, a);
  const denom = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1;
  const t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denom, 0, 1);
  const closest: Vec3 = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
  return dist(p, closest);
}

/** 胶囊体 (线段 a-b + 半径 r) 与线段求最小距离, 小于半径和即碰撞 */
export function segmentSegmentDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  // 标准 Real-Time Collision Detection 第 5.1.9 节, d1=s1, d2=s2, r=p1-p2
  const d1 = sub(q1, p1), d2 = sub(q2, p2), r = sub(p1, p2);
  const a = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2];
  const e = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2];
  const f = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
  const c = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2];
  const b = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2];
  let s: number, t: number;
  const denom = a * e - b * b;
  if (denom !== 0) s = clamp((b * f - c * e) / denom, 0, 1);
  else s = 0;
  t = (b * s + f) / (e || 1);
  if (t < 0) { t = 0; s = clamp(-c / (a || 1), 0, 1); }
  else if (t > 1) { t = 1; s = clamp((b - c) / (a || 1), 0, 1); }
  const c1: Vec3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: Vec3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return dist(c1, c2);
}

/** 胶囊体与轴对齐盒 (桁架附近障碍) 距离 —— 桁架统一按线段建模, 此函数留作扩展 */
function segmentAabbDistance(a: Vec3, b: Vec3, min: Vec3, max: Vec3): number {
  // 采样 8 段近似 (盒边), 取最小; 场景内障碍已主要转为桁架/灯体胶囊
  let best = Infinity;
  const corners: Vec3[] = [
    [min[0], min[1], min[2]], [max[0], min[1], min[2]], [max[0], max[1], min[2]], [min[0], max[1], min[2]],
    [min[0], min[1], max[2]], [max[0], min[1], max[2]], [max[0], max[1], max[2]], [min[0], max[1], max[2]],
  ];
  const edges: [number, number][] = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [i, j] of edges) best = Math.min(best, segmentSegmentDistance(a, b, corners[i], corners[j]));
  return best;
}
void cross; void segmentAabbDistance;

/** 给定 pan/tilt 时灯体中轴线两端点 (绕 Z 轴 pan, 再在竖直面 tilt) */
function headSegment(fx: Fixture, model: LampModel, panDeg: number, tiltDeg: number): { a: Vec3; b: Vec3 } {
  const pan = deg2rad(panDeg);
  const tilt = deg2rad(tiltDeg);
  const L = model.bodyHalfLength;
  // 先在本地 XZ 平面按 tilt 摆, 再绕 Z 按 pan 旋
  const local: Vec3 = [Math.cos(tilt) * L * 2, 0, -Math.sin(tilt) * L * 2];
  const cosP = Math.cos(pan), sinP = Math.sin(pan);
  const dir: Vec3 = [
    local[0] * cosP - local[1] * sinP,
    local[0] * sinP + local[1] * cosP,
    local[2],
  ];
  return { a: fx.position, b: [fx.position[0] + dir[0], fx.position[1] + dir[1], fx.position[2] + dir[2]] };
}

/** 把相邻碰撞采样格合并成角度区间 */
function mergeCells(cells: Set<string>, panStep: number, tiltStep: number): AngleInterval[] {
  const grid = new Map<number, number[]>();
  for (const c of cells) {
    const [pi, ti] = c.split(',').map(Number);
    if (!grid.has(pi)) grid.set(pi, []);
    grid.get(pi)!.push(ti);
  }
  const out: AngleInterval[] = [];
  for (const [pi, tilts] of [...grid.entries()].sort((a, b) => a[0] - b[0])) {
    tilts.sort((a, b) => a - b);
    let start = tilts[0], prev = tilts[0];
    for (let i = 1; i <= tilts.length; i++) {
      const t = tilts[i];
      if (t !== prev + 1) {
        out.push({
          panFrom: pi * panStep, panTo: (pi + 1) * panStep,
          tiltFrom: start * tiltStep, tiltTo: (prev + 1) * tiltStep,
        });
        start = t;
      }
      prev = t;
    }
  }
  return out;
}

export function checkEnvelopeCollisions(opts: CollisionOptions): CollisionReport {
  const t0 = performance.now();
  const { fixtures, models, trusses, panStep = 10, tiltStep = 10, safetyGap = 0.05 } = opts;
  const modelMap = new Map(models.map(m => [m.id, m]));
  const moving = fixtures.filter(f => (modelMap.get(f.modelId)?.kind ?? '').startsWith('moving-head'));

  // 静态目标: 桁架(线段+半径) 无条件参与精确求交; 非摇头灯按灯位小胶囊
  const trussTargets: SegmentTarget[] = [];
  const fixtureTargets: SegmentTarget[] = [];
  for (const tr of trusses) {
    trussTargets.push({
      key: `truss:${tr.id}`, label: tr.label,
      a: tr.from, b: tr.to, radius: tr.section / 2 + safetyGap,
    });
  }
  for (const f of fixtures) {
    if (moving.some(m => m.id === f.id)) continue;
    const mdl = modelMap.get(f.modelId);
    const r = (mdl?.bodyHalfWidth ?? 0.12) + safetyGap;
    const down: Vec3 = [f.position[0], f.position[1], f.position[2] - (mdl?.bodyHalfLength ?? 0.25) * 2];
    fixtureTargets.push({ key: `fixture:${f.id}`, label: f.label, a: f.position, b: down, radius: r });
  }

  // 摇头灯之间互为目标 (灯体胶囊), 用可达球做空间哈希
  const sphereHash = new SpatialHash<{ position: Vec3; fixture: Fixture; model: LampModel; r: number }>(2);
  for (const f of moving) {
    const mdl = modelMap.get(f.modelId)!;
    sphereHash.insert({ position: f.position, fixture: f, model: mdl, r: mdl.bodyHalfLength * 2 + mdl.bodyHalfWidth });
  }

  const collisions: CollisionRecord[] = [];
  let sampleCount = 0;

  for (const fx of moving) {
    const model = modelMap.get(fx.modelId)!;
    const reach = model.bodyHalfLength * 2 + model.bodyHalfWidth;
    const perTarget = new Map<string, { label: string; cells: Set<string>; minDist: number }>();

    const panSamples = Math.ceil((model.panRange * 2) / panStep) + 1;
    const tiltSamples = Math.ceil(model.tiltRange / tiltStep) + 1;
    sampleCount += panSamples * tiltSamples;

    // 候选: 桁架无条件纳入 (长桁架会跨越多个空间格, 不能按端点预筛);
    // 邻灯按空间哈希预筛; 固定灯具按点-线段距离预筛
    const neighborHeads = sphereHash.nearby(fx.position, reach * 2 + 0.5)
      .filter(o => o.fixture.id !== fx.id);
    const localTargets: SegmentTarget[] = [
      ...trussTargets,
      ...fixtureTargets.filter(tg => pointSegmentDistance(fx.position, tg.a, tg.b) <= reach + tg.radius + 0.5),
      ...neighborHeads.map(o => ({
        key: `fixture:${o.fixture.id}`,
        label: o.fixture.label,
        a: o.fixture.position,
        b: [o.fixture.position[0], o.fixture.position[1], o.fixture.position[2] - o.model.bodyHalfLength * 2] as Vec3,
        radius: o.model.bodyHalfWidth + safetyGap,
      })),
    ];
    const headR = model.bodyHalfWidth + safetyGap;
    // 枢轴点到各目标的距离与姿态无关, 循环外预计算一次 (每姿态省去一次点-线段求交)
    const pivotHits = new Set<string>();
    const targetThreshold = new Map<string, number>();
    for (const tg of localTargets) {
      const threshold = headR + tg.radius;
      targetThreshold.set(tg.key, threshold);
      if (pointSegmentDistance(fx.position, tg.a, tg.b) < threshold) pivotHits.add(tg.key);
    }

    for (let pi = 0; pi < panSamples; pi++) {
      const pan = -model.panRange + pi * panStep;
      for (let ti = 0; ti < tiltSamples; ti++) {
        const tilt = ti * tiltStep;
        const seg = headSegment(fx, model, pan, tilt);
        for (const tg of localTargets) {
          const hit = pivotHits.has(tg.key) ||
            segmentSegmentDistance(seg.a, seg.b, tg.a, tg.b) < targetThreshold.get(tg.key)!;
          if (hit) {
            let rec = perTarget.get(tg.key);
            if (!rec) {
              rec = { label: tg.label, cells: new Set(), minDist: pointSegmentDistance(fx.position, tg.a, tg.b) };
              perTarget.set(tg.key, rec);
            }
            rec.cells.add(`${pi},${ti}`);
            if (!pivotHits.has(tg.key)) {
              const d = segmentSegmentDistance(seg.a, seg.b, tg.a, tg.b);
              if (d < rec.minDist) rec.minDist = d;
            }
          }
        }
      }
    }

    for (const [target, rec] of perTarget) {
      collisions.push({
        fixtureId: fx.id,
        fixtureLabel: fx.label,
        target,
        targetLabel: rec.label,
        minDistance: Math.round(rec.minDist * 1000) / 1000,
        intervals: mergeCells(rec.cells, panStep, tiltStep),
      });
    }
  }

  collisions.sort((a, b) => a.fixtureLabel.localeCompare(b.fixtureLabel) || a.target.localeCompare(b.target));
  return {
    movingHeadCount: moving.length,
    sampleCount,
    collisions,
    elapsedMs: performance.now() - t0,
  };
}

void len;
