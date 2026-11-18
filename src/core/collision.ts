// ============================================================
// 摇头灯运动包络干涉引擎
// 对每台摇头灯在完整 pan/tilt 范围内做角度扫描，正运动学求灯臂/灯头
// 分段位置，与桁架（静态）和邻灯（动态包络）做分段-分段距离检查，
// 输出发生碰撞的角度区间。性能：空间哈希/AABB 预筛 + 区间合并
// 目标：300 台摇头灯一轮 < 10s
// ============================================================
import type { FixtureDefinition, FixtureInstance, TrussSegment, Vec3, ID } from '../types';
import { lerp, norm, segmentSegment, sub, wrapAngle } from './math3d';

export interface CollisionOptions {
  /** 角度扫描步长（rad），默认 2° */
  stepRad?: number;
  /** 安全间隙 mm，距离 <= 两物体半径之和 + 间隙 即判干涉 */
  clearanceMm?: number;
  onProgress?: (done: number, total: number) => void;
}

export interface CollisionInterval {
  panFrom: number;
  panTo: number;
  tiltFrom: number;
  tiltTo: number;
  minClearanceMm: number;
  against: { kind: 'truss' | 'fixture'; id: ID };
}

export interface FixtureCollisionReport {
  fixtureId: ID;
  hasCollision: boolean;
  intervals: CollisionInterval[];
  samplesScanned: number;
  pairChecks: number;
}

export interface CollisionReport {
  perFixture: FixtureCollisionReport[];
  collidingFixtures: number;
  elapsedMs: number;
  stepRad: number;
}

interface MovingHeadGeom {
  fx: FixtureInstance;
  def: FixtureDefinition;
  /** 底座（吊挂点） */
  base: Vec3;
  /** 灯臂长度（底座到 tilt 轴） */
  armLen: number;
  /** 灯头长度（tilt 轴到灯头前端） */
  headLen: number;
  /** 灯体等效半径 */
  bodyRadius: number;
  panRange: [number, number];
  tiltRange: [number, number];
}

/** 给定 pan/tilt 求两段（灯臂、灯头）端点 */
export function poseAt(g: MovingHeadGeom, pan: number, tilt: number): { arm: [Vec3, Vec3]; head: [Vec3, Vec3] } {
  const { pivot, tip } = poseScalar(g, pan, tilt);
  const pivotV: Vec3 = { x: pivot[0], y: pivot[1], z: pivot[2] };
  const tipV: Vec3 = { x: tip[0], y: tip[1], z: tip[2] };
  return { arm: [g.base, pivotV], head: [pivotV, tipV] };
}

/**
 * 零堆分配姿态解算：返回 pivot / tip 的标量三元组。
 * 热路径（百万级姿态）专用，避免对象分配引发的 GC 抖动。
 */
function poseScalar(g: MovingHeadGeom, pan: number, tilt: number): {
  pivot: [number, number, number];
  tip: [number, number, number];
} {
  const cp = Math.cos(pan);
  const sp = Math.sin(pan);
  // 灯臂初始朝 -Z，绕 Z 轴 pan
  const dx0 = 0, dy0 = 0, dz0 = -1;
  const downX = dx0 * cp - dy0 * sp;
  const downY = dx0 * sp + dy0 * cp;
  const downZ = dz0;
  const px = g.base.x + downX * g.armLen;
  const py = g.base.y + downY * g.armLen;
  const pz = g.base.z + downZ * g.armLen;

  // tilt 轴：pan 后的局部 X
  const axX = cp, axY = sp, axZ = 0;
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // Rodrigues 把 down 向量绕 tilt 轴转 tilt
  const crossX = axY * downZ - axZ * downY;
  const crossY = axZ * downX - axX * downZ;
  const crossZ = axX * downY - axY * downX;
  const dot = axX * downX + axY * downY + axZ * downZ;
  const hx = downX * ct + crossX * st + axX * dot * (1 - ct);
  const hy = downY * ct + crossY * st + axY * dot * (1 - ct);
  const hz = downZ * ct + crossZ * st + axZ * dot * (1 - ct);
  return {
    pivot: [px, py, pz],
    tip: [px + hx * g.headLen, py + hy * g.headLen, pz + hz * g.headLen],
  };
}

/** 标量版线段-线段最近距离（零分配） */
function segDistScalar(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number, dx: number, dy: number, dz: number,
): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = dx - cx, vy = dy - cy, vz = dz - cz;
  const wx = ax - cx, wy = ay - cy, wz = az - cz;
  const a = ux * ux + uy * uy + uz * uz;
  const e = vx * vx + vy * vy + vz * vz;
  const f = vx * wx + vy * wy + vz * wz;
  let s = 0;
  let t = 0;
  const EPS = 1e-9;
  if (a <= EPS) {
    t = Math.max(0, Math.min(1, f / e));
  } else {
    const bb = ux * vx + uy * vy + uz * vz;
    const c = ux * wx + uy * wy + uz * wz;
    if (e <= EPS) {
      s = Math.max(0, Math.min(1, -c / a));
    } else {
      const denom = a * e - bb * bb;
      s = denom > EPS ? Math.max(0, Math.min(1, (bb * f - c * e) / denom)) : 0;
      t = (bb * s + f) / e;
      if (t < 0) { t = 0; s = Math.max(0, Math.min(1, -c / a)); }
      else if (t > 1) { t = 1; s = Math.max(0, Math.min(1, (bb - c) / a)); }
    }
  }
  const p1x = ax + ux * s, p1y = ay + uy * s, p1z = az + uz * s;
  const p2x = cx + vx * t, p2y = cy + vy * t, p2z = cz + vz * t;
  return Math.hypot(p1x - p2x, p1y - p2y, p1z - p2z);
}

/** 标量版点-线段距离（零分配） */
function pointSegDistScalar(
  px: number, py: number, pz: number,
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
): number {
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const l2 = ux * ux + uy * uy + uz * uz;
  if (l2 < 1e-12) return Math.hypot(px - ax, py - ay, pz - az);
  let t = ((px - ax) * ux + (py - ay) * uy + (pz - az) * uz) / l2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + ux * t, cy = ay + uy * t, cz = az + uz * t;
  return Math.hypot(px - cx, py - cy, pz - cz);
}

const dot3 = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** 合并连续碰撞采样为角度区间 */
function mergeCells(
  cells: { pan: number; tilt: number; minClearance: number; against: CollisionInterval['against'] }[],
  step: number,
): CollisionInterval[] {
  if (!cells.length) return [];
  const key = (pan: number, tilt: number) => `${pan.toFixed(5)}|${tilt.toFixed(5)}`;
  const cellMap = new Map(cells.map((c) => [key(c.pan, c.tilt), c]));
  const visited = new Set<string>();
  const out: CollisionInterval[] = [];

  for (const start of cells) {
    const sk = key(start.pan, start.tilt);
    if (visited.has(sk)) continue;
    // BFS 连通块（4 邻域，同一对碰撞物）
    const queue = [start];
    visited.add(sk);
    let minPan = start.pan;
    let maxPan = start.pan;
    let minTilt = start.tilt;
    let maxTilt = start.tilt;
    let minClearance = start.minClearance;
    while (queue.length) {
      const cur = queue.shift()!;
      for (const [dp, dt] of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
        const nk = key(cur.pan + dp, cur.tilt + dt);
        const nb = cellMap.get(nk);
        if (!nb || visited.has(nk)) continue;
        if (nb.against.kind !== cur.against.kind || nb.against.id !== cur.against.id) continue;
        visited.add(nk);
        queue.push(nb);
        minPan = Math.min(minPan, nb.pan);
        maxPan = Math.max(maxPan, nb.pan);
        minTilt = Math.min(minTilt, nb.tilt);
        maxTilt = Math.max(maxTilt, nb.tilt);
        minClearance = Math.min(minClearance, nb.minClearance);
      }
    }
    out.push({
      panFrom: minPan,
      panTo: maxPan + step,
      tiltFrom: minTilt,
      tiltTo: maxTilt + step,
      minClearanceMm: minClearance,
      against: start.against,
    });
  }
  // 确定性排序，方便与手工核对
  return out.sort(
    (a, b) =>
      a.against.id.localeCompare(b.against.id) ||
      a.panFrom - b.panFrom ||
      a.tiltFrom - b.tiltFrom,
  );
}

export function checkMovingHeadCollisions(
  fixtures: FixtureInstance[],
  definitions: Map<ID, FixtureDefinition>,
  truss: TrussSegment[],
  opts: CollisionOptions = {},
): CollisionReport {
  const t0 = performance.now();
  const step = opts.stepRad ?? (2 * Math.PI) / 180;
  const clearance = opts.clearanceMm ?? 25;

  // 全角度 sin/cos 查找表（覆盖 -π~π 共 360 格，含偏移余量），热循环零超越函数调用
  const TAB_SIZE = 545;
  const sinTab = new Float64Array(TAB_SIZE);
  const cosTab = new Float64Array(TAB_SIZE);
  for (let i = 0; i < TAB_SIZE; i++) {
    const angle = -Math.PI + i * step;
    sinTab[i] = Math.sin(angle);
    cosTab[i] = Math.cos(angle);
  }

  const heads: MovingHeadGeom[] = [];
  for (const fx of fixtures) {
    const def = definitions.get(fx.definitionId);
    if (!def || fx.kind !== 'moving-head' || !def.panRange || !def.tiltRange) continue;
    const armLen = def.heightMm * 0.45;
    const headLen = def.envelopeRadiusMm ?? def.heightMm * 0.6;
    heads.push({
      fx,
      def,
      base: fx.position,
      armLen,
      headLen,
      bodyRadius: Math.max(def.footprint.w, def.footprint.d) / 2,
      panRange: def.panRange,
      tiltRange: def.tiltRange,
    });
  }

  const perFixture: FixtureCollisionReport[] = [];
  let pairChecks = 0;

  heads.forEach((g, idx) => {
    // 预筛半径须覆盖灯臂前伸 + 灯头整周扫掠 + 安全间隙
    const reach = g.armLen + (g.def.envelopeRadiusMm ?? g.headLen) + g.bodyRadius + clearance;
    const collisionCells: Parameters<typeof mergeCells>[0] = [];
    let samples = 0;

    // 桁架候选：灯底座到桁架线段的距离 <= 灯整周扫掠半径。
    // 用点-段距离而非包围球——长桁架的包围球半径过大，会把相邻行的桁架全部误纳为候选。
    const candidateTruss: { id: ID; from: Vec3; to: Vec3; limit: number }[] = [];
    for (const seg of truss) {
      const baseToTruss = pointSegDistScalar(
        g.base.x, g.base.y, g.base.z,
        seg.from.x, seg.from.y, seg.from.z, seg.to.x, seg.to.y, seg.to.z,
      );
      if (baseToTruss > reach) continue;
      candidateTruss.push({
        id: seg.id,
        from: seg.from,
        to: seg.to,
        limit: g.bodyRadius + seg.sectionMm / 2 + clearance,
      });
    }
    // 预筛邻灯：底座静态，底座间距超过两灯最大扫掠直径之和则在任何姿态下都不可能碰。
    // 同时解析指向该邻灯的 pan/tilt 角度窗口，窗口外姿态直接跳过段距离精算。
    const mySweep = g.armLen + (g.def.envelopeRadiusMm ?? g.headLen) + g.bodyRadius;
    const myPivotX = g.base.x, myPivotY = g.base.y, myPivotZ = g.base.z - g.armLen;
    const neighborHeads = heads
      .filter((h) => h.fx.id !== g.fx.id)
      .map((nb) => {
        const nbSweep = nb.armLen + (nb.def.envelopeRadiusMm ?? nb.headLen) + nb.bodyRadius;
        const baseDist = Math.hypot(nb.base.x - g.base.x, nb.base.y - g.base.y, nb.base.z - g.base.z);
        return { nb, nbSweep, baseDist };
      })
      .filter((x) => x.baseDist <= mySweep + x.nbSweep + clearance)
      .map(({ nb, nbSweep }) => {
        const nbPose = poseScalar(nb, 0, 0);
        const dx = nb.base.x - myPivotX;
        const dy = nb.base.y - myPivotY;
        const horiz = Math.max(1, Math.hypot(dx, dy));
        const panCenter = Math.atan2(-dy, -dx);
        const tiltCenter = Math.atan2(myPivotZ - nb.base.z, horiz);
        const half = Math.atan2(nbSweep + g.bodyRadius + clearance, horiz);
        return {
          id: nb.fx.id,
          limit: g.bodyRadius + nb.bodyRadius + clearance,
          reachSq: (nbSweep + g.bodyRadius + clearance) ** 2,
          panCenter,
          panHalf: half,
          tiltCenter,
          tiltHalf: half,
          // 灯头段（pivot→tip）标量
          hx0: nbPose.pivot[0], hy0: nbPose.pivot[1], hz0: nbPose.pivot[2],
          hx1: nbPose.tip[0], hy1: nbPose.tip[1], hz1: nbPose.tip[2],
          // 邻灯底座（快速球判用）
          bx: nb.base.x, by: nb.base.y, bz: nb.base.z,
        };
      });

    // 桁架候选预提取为标量平坦数组（零属性查找），并解析 pan/tilt 可达窗口
    const pivotZ = g.base.z - g.armLen;
    const trussFlat = candidateTruss.map((ct) => {
      // 候选段两端相对 pivot 的水平方位角，碰撞只可能发生在该方位角 ±半张角内
      const pvX = g.base.x, pvY = g.base.y;
      // pan 参考系：pan=0 灯头朝 -Y，故目标方位角 = atan2(-Δy, -Δx)
      const ang0 = Math.atan2(-(ct.from.y - pvY), -(ct.from.x - pvX));
      const ang1 = Math.atan2(-(ct.to.y - pvY), -(ct.to.x - pvX));
      const d0 = Math.hypot(ct.from.x - pvX, ct.from.y - pvY);
      const d1 = Math.hypot(ct.to.x - pvX, ct.to.y - pvY);
      const halfSpan = Math.max(
        Math.atan2((g.headLen + g.bodyRadius + clearance), Math.max(1, d0)),
        Math.atan2((g.headLen + g.bodyRadius + clearance), Math.max(1, d1)),
      );
      // tilt 窗口：灯头在垂直面内指向候选所需的俯仰角（水平灯头 tilt=0，向下为正）
      const tiltAt = (p: { z: number }, d: number): number => Math.atan2(pivotZ - p.z, Math.max(1, d));
      const t0 = tiltAt(ct.from, d0);
      const t1 = tiltAt(ct.to, d1);
      return {
        id: ct.id,
        limit: ct.limit,
        fx0: ct.from.x, fy0: ct.from.y, fz0: ct.from.z,
        fx1: ct.to.x, fy1: ct.to.y, fz1: ct.to.z,
        panCenter: (ang0 + ang1) / 2,
        panHalf: Math.abs(wrapAngle(ang1 - ang0)) / 2 + halfSpan,
        tiltCenter: (t0 + t1) / 2,
        tiltHalf: Math.abs(t1 - t0) / 2 + halfSpan,
      };
    });

    // 单级扫描 + 角度域裁剪：桁架只在其 pan 可达窗口内才需要精算，
    // 窗口外的姿态只做邻灯检查（邻灯通常在同一方位，数量已被底座距离预筛压到 1~2）。
    const panSteps = Math.ceil((g.panRange[1] - g.panRange[0]) / step) + 1;
    const tiltSteps = Math.ceil((g.tiltRange[1] - g.tiltRange[0]) / step) + 1;
    // 灯头末端相对 pivot 的最大长度，用于廉价球面包络预判
    const headReachSq = (g.headLen + g.bodyRadius + clearance) ** 2;
    const armLenL = g.armLen;
    const headLenL = g.headLen;
    const baseXL = g.base.x, baseYL = g.base.y, baseZL = g.base.z;

    const checkPoseAt = (pi: number, ti: number, pan: number, tilt: number): boolean => {
      samples++;
      // 查表替代 Math.sin/cos（pi、ti 即角度网格索引）
      const cp = cosTab[pi] ?? Math.cos(pan);
      const sp = sinTab[pi] ?? Math.sin(pan);
      // 灯臂朝 -Z，绕 Z 轴 pan 不改变 -Z 方向，pivot 恒在底座正下方
      const pvX = baseXL;
      const pvY = baseYL;
      const pvZ = baseZL - armLenL;
      const axX = cp, axY = sp; // tilt 轴 = pan 后的局部 X
      const ct = cosTab[ti] ?? Math.cos(tilt);
      const st = sinTab[ti] ?? Math.sin(tilt);
      // down=(0,0,-1)；cross(axis,down)=(-axY,axX,0)；axis·down=0
      const hx = -axY * st;
      const hy = axX * st;
      const hz = -ct;
      const tX = pvX + hx * headLenL;
      const tY = pvY + hy * headLenL;
      const tZ = pvZ + hz * headLenL;

      for (let k = 0; k < trussFlat.length; k++) {
        const ct2 = trussFlat[k]!;
        // 角度域裁剪：pan/tilt 任一不在该桁架可达窗口内，本姿态必不碰它
        if (Math.abs(wrapAngle(pan - ct2.panCenter)) > ct2.panHalf) continue;
        if (Math.abs(tilt - ct2.tiltCenter) > ct2.tiltHalf) continue;
        const approx = pointSegDistScalar(pvX, pvY, pvZ, ct2.fx0, ct2.fy0, ct2.fz0, ct2.fx1, ct2.fy1, ct2.fz1);
        if (approx * approx > headReachSq) continue;
        pairChecks++;
        const d = segDistScalar(pvX, pvY, pvZ, tX, tY, tZ, ct2.fx0, ct2.fy0, ct2.fz0, ct2.fx1, ct2.fy1, ct2.fz1);
        if (d <= ct2.limit) {
          collisionCells.push({ pan, tilt, minClearance: d, against: { kind: 'truss', id: ct2.id } });
          return true;
        }
      }
      for (let k = 0; k < neighborHeads.length; k++) {
        const nb = neighborHeads[k]!;
        // 角度域裁剪：pan/tilt 不在指向该邻灯的窗口内则必不碰
        if (Math.abs(wrapAngle(pan - nb.panCenter)) > nb.panHalf) continue;
        if (Math.abs(tilt - nb.tiltCenter) > nb.tiltHalf) continue;
        const dx = tX - nb.bx, dy = tY - nb.by, dz = tZ - nb.bz;
        if (dx * dx + dy * dy + dz * dz > nb.reachSq) continue;
        pairChecks++;
        const d = segDistScalar(pvX, pvY, pvZ, tX, tY, tZ, nb.hx0, nb.hy0, nb.hz0, nb.hx1, nb.hy1, nb.hz1);
        if (d <= nb.limit) {
          collisionCells.push({ pan, tilt, minClearance: d, against: { kind: 'fixture', id: nb.id } });
          return true;
        }
      }
      return false;
    };

    // 角度网格相对 -π 的索引偏移，使 pi/ti 与全局 sin/cos 查找表对齐
    const panOffset = Math.round((g.panRange[0] + Math.PI) / step);
    const tiltOffset = Math.round((g.tiltRange[0] + Math.PI) / step);
    for (let pi = 0; pi < panSteps; pi++) {
      const pan = wrapAngle(g.panRange[0] + pi * step);
      const tabPi = pi + panOffset;
      for (let ti = 0; ti < tiltSteps; ti++) {
        const tilt = g.tiltRange[0] + ti * step;
        checkPoseAt(tabPi, ti + tiltOffset, pan, tilt);
      }
    }

    const intervals = mergeCells(collisionCells, step);
    perFixture.push({
      fixtureId: g.fx.id,
      hasCollision: intervals.length > 0,
      intervals,
      samplesScanned: samples,
      pairChecks,
    });
    opts.onProgress?.(idx + 1, heads.length);
  });

  return {
    perFixture,
    collidingFixtures: perFixture.filter((r) => r.hasCollision).length,
    elapsedMs: performance.now() - t0,
    stepRad: step,
  };
}

/** 三维量距工具：场景里直接量两挂点/两灯距离 */
export function measureDistance(a: Vec3, b: Vec3): number {
  return segmentSegment(a, a, b, b).distance;
}

export function measureAngle(vertex: Vec3, a: Vec3, b: Vec3): number {
  const va = norm(sub(a, vertex));
  const vb = norm(sub(b, vertex));
  const c = Math.max(-1, Math.min(1, dot3(va, vb)));
  return Math.acos(c);
}

export { lerp };
