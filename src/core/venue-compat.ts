// ============================================================
// 换馆适配引擎
// 对同一套方案的每个灯具/挂点，在目标场馆中找最近挂点并逐项校核
// 性能：空间哈希邻域查询 + 确定性贪心分配，2000 挂点目标 < 3s
// ============================================================
import type {
  FixtureDefinition,
  FixtureInstance,
  HangPoint,
  ID,
  IncompatibleReason,
  TrussSegment,
  Vec3,
} from '../types';
import { SpatialHash } from './spatial-hash';
import { dist } from './math3d';

export interface CompatOptions {
  /** 坐标匹配容差 mm，默认 500 */
  toleranceMm?: number;
  /** 净空安全余量 mm */
  headroomMarginMm?: number;
}

export interface FixtureCompatResult {
  fixtureId: ID;
  sourcePointId?: ID;
  /** 选用的目标挂点 */
  targetPointId?: ID;
  deviationMm: number;
  ok: boolean;
  reasons: IncompatibleReason[];
  /** 替代挂点建议（已按适配度排序） */
  suggestions: { pointId: ID; distanceMm: number; violations: IncompatibleReason[] }[];
}

export interface VenueCompatReport {
  fixtureResults: FixtureCompatResult[];
  incompatible: FixtureCompatResult[];
  /** 目标场馆中未被任何灯具占用的挂点 */
  unusedTargetPointIds: ID[];
  stats: {
    total: number;
    matched: number;
    incompatibleCount: number;
    unmatchedCount: number;
    maxDeviationMm: number;
    elapsedMs: number;
  };
}

interface FixtureWeightNeed {
  fixtureId: ID;
  sourcePointId?: ID;
  anchor: Vec3;
  loadKg: number;
  needHeadroomMm: number;
  powerW: number;
  connector?: string;
}

export function compareVenues(
  fixtures: FixtureInstance[],
  definitions: Map<ID, FixtureDefinition>,
  truss: TrussSegment[],
  sourcePoints: HangPoint[],
  targetVenuePoints: HangPoint[],
  opts: CompatOptions = {},
): VenueCompatReport {
  const t0 = now();
  const tolerance = opts.toleranceMm ?? 500;
  const headroomMargin = opts.headroomMarginMm ?? 100;

  // 1. 计算每根桁架分配到挂点的荷载（自重 + 灯重均分）
  const trussLoad = new Map<ID, number>();
  const trussHeadroom = new Map<ID, number>();
  for (const seg of truss) trussLoad.set(seg.id, seg.selfWeightKg);
  for (const fx of fixtures) {
    const hpId = fx.hangPointId;
    if (!hpId) continue;
    const seg = truss.find((s) => s.hangPointIds.includes(hpId));
    if (!seg) continue;
    const def = definitions.get(fx.definitionId);
    trussLoad.set(seg.id, (trussLoad.get(seg.id) ?? 0) + (def?.weightKg ?? 0));
  }
  for (const seg of truss) {
    const n = Math.max(1, seg.hangPointIds.length);
    trussLoad.set(seg.id, (trussLoad.get(seg.id) ?? 0) / n);
    trussHeadroom.set(
      seg.id,
      Math.max(0, ...seg.hangPointIds.map(() => 0)) + seg.sectionMm,
    );
  }

  // 2. 汇总每个灯具在原挂点处的需求
  const sourceMap = new Map(sourcePoints.map((p) => [p.id, p]));
  const needs: FixtureWeightNeed[] = fixtures.map((fx) => {
    const def = definitions.get(fx.definitionId);
    const src = fx.hangPointId ? sourceMap.get(fx.hangPointId) : undefined;
    const seg = truss.find((s) => fx.hangPointId && s.hangPointIds.includes(fx.hangPointId));
    const loadKg =
      (seg ? trussLoad.get(seg.id) ?? 0 : def?.weightKg ?? 0);
    return {
      fixtureId: fx.id,
      sourcePointId: fx.hangPointId,
      anchor: src?.position ?? fx.position,
      loadKg,
      needHeadroomMm: (def?.heightMm ?? 0) + (seg?.sectionMm ?? 0) + headroomMargin,
      powerW: def?.powerW ?? 0,
      connector: src?.power?.connector,
    };
  });

  // 3. 目标场馆空间哈希
  const targetPositions = new Map<ID, Vec3>(targetVenuePoints.map((p) => [p.id, p.position]));
  const targetMap = new Map(targetVenuePoints.map((p) => [p.id, p]));
  const hash = new SpatialHash(targetPositions, Math.max(tolerance, 1));

  // 4. 确定性贪心：所有 (需求, 候选) 对按距离排序，依次抢占最近可用挂点
  type Pair = { needIdx: number; pointId: ID; d: number };
  const pairs: Pair[] = [];
  needs.forEach((n, i) => {
    for (const cand of hash.queryRadius(n.anchor, tolerance)) {
      pairs.push({ needIdx: i, pointId: cand.id, d: cand.distance });
    }
  });
  pairs.sort((a, b) => a.d - b.d || a.needIdx - b.needIdx || a.pointId.localeCompare(b.pointId));

  const assigned = new Map<number, ID>(); // needIdx -> pointId
  const usedPoints = new Set<ID>();
  for (const pair of pairs) {
    if (assigned.has(pair.needIdx) || usedPoints.has(pair.pointId)) continue;
    assigned.set(pair.needIdx, pair.pointId);
    usedPoints.add(pair.pointId);
  }

  // 5. 逐项校核 + 替代建议
  const checkPoint = (n: FixtureWeightNeed, hp: HangPoint): IncompatibleReason[] => {
    const reasons: IncompatibleReason[] = [];
    if (hp.loadRatingKg < n.loadKg) reasons.push('load-exceeded');
    if (hp.headroomMm < n.needHeadroomMm) reasons.push('headroom-insufficient');
    if (n.connector) {
      if (!hp.power) reasons.push('connector-missing');
      else if (hp.power.connector !== n.connector) reasons.push('connector-missing');
      else if (hp.power.maxAmps * hp.power.voltage < n.powerW) reasons.push('power-insufficient');
    } else if (n.powerW > 0 && hp.power && hp.power.maxAmps * hp.power.voltage < n.powerW) {
      reasons.push('power-insufficient');
    }
    return reasons;
  };

  const fixtureResults: FixtureCompatResult[] = needs.map((n, i) => {
    const targetId = assigned.get(i);
    if (!targetId) {
      // 完全没有容差内候选：放宽到 3 倍容差给替代建议
      const wider = hash.queryRadius(n.anchor, tolerance * 3).slice(0, 3).map((c) => ({
        pointId: c.id,
        distanceMm: c.distance,
        violations: checkPoint(n, targetMap.get(c.id)!),
      }));
      return {
        fixtureId: n.fixtureId,
        sourcePointId: n.sourcePointId,
        deviationMm: Infinity,
        ok: false,
        reasons: ['out-of-envelope'],
        suggestions: wider,
      };
    }
    const hp = targetMap.get(targetId)!;
    const deviation = dist(n.anchor, hp.position);
    const reasons = checkPoint(n, hp);
    const suggestions = hash
      .queryRadius(n.anchor, tolerance * 2)
      .filter((c) => c.id !== targetId)
      .slice(0, 3)
      .map((c) => ({
        pointId: c.id,
        distanceMm: c.distance,
        violations: checkPoint(n, targetMap.get(c.id)!),
      }))
      // 优先推荐无违规项
      .sort((a, b) => a.violations.length - b.violations.length || a.distanceMm - b.distanceMm);
    return {
      fixtureId: n.fixtureId,
      sourcePointId: n.sourcePointId,
      targetPointId: targetId,
      deviationMm: deviation,
      ok: reasons.length === 0,
      reasons,
      suggestions,
    };
  });

  const incompatible = fixtureResults.filter((r) => !r.ok);
  const finiteDev = fixtureResults.map((r) => r.deviationMm).filter((d) => Number.isFinite(d));
  const elapsedMs = now() - t0;

  return {
    fixtureResults,
    incompatible,
    unusedTargetPointIds: targetVenuePoints.map((p) => p.id).filter((id) => !usedPoints.has(id)),
    stats: {
      total: needs.length,
      matched: fixtureResults.filter((r) => r.ok).length,
      incompatibleCount: incompatible.length,
      unmatchedCount: fixtureResults.filter((r) => !r.targetPointId).length,
      maxDeviationMm: finiteDev.length ? Math.max(...finiteDev) : 0,
      elapsedMs,
    },
  };
}

// 性能计时抽象：测试环境与浏览器都可用，且确定性可测
const now: () => number =
  typeof performance !== 'undefined' && 'now' in performance
    ? () => performance.now()
    : () => Date.now();
