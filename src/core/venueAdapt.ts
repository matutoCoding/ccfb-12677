// 换馆适配: 方案灯具与目标场馆挂点/净空/承重自动比对
// 性能目标: 2000 挂点全量比对 < 3s (空间哈希, 实测通常 < 30ms)
import type { Fixture, LampModel, Venue, Vec3 } from './types.ts';
import { SpatialHash, add, dist, type AABB } from './math.ts';

export type IssueReason = 'no-near-point' | 'overload' | 'insufficient-clearance' | 'obstacle-collision';

export interface HangSuggestion {
  hangPointId: string;
  label: string;
  distance: number;
  spareLoadKg: number;
  clearance: number;
}

export interface AdaptationIssue {
  fixtureId: string;
  fixtureLabel: string;
  reason: IssueReason;
  detail: string;
  suggestions: HangSuggestion[];
}

export interface AdaptationResult {
  sourceVenueId: string;
  targetVenueId: string;
  fixtureCount: number;
  matchedCount: number;
  issues: AdaptationIssue[];
  /** fixtureId -> 目标挂点 id 的最优映射 */
  mapping: Record<string, string>;
  elapsedMs: number;
}

export interface AdaptationOptions {
  fixtures: Fixture[];
  models: LampModel[];
  sourceVenue: Venue;
  targetVenue: Venue;
  /** 水平匹配容差 米 */
  toleranceM?: number;
  /** 灯具下方需要的最小净空 米 */
  clearanceM?: number;
  /** 建议候选挂点数量 */
  suggestionCount?: number;
}

interface IndexedPoint {
  id: string;
  label: string;
  position: Vec3;   // 世界坐标
  loadKg: number;
  usedLoadKg: number;
}

const worldPoint = (venue: Venue, p: Vec3): Vec3 => add(venue.origin, p);

/** 灯具包围盒 (近似为以挂点为顶、向下延伸的小盒) */
const fixtureBox = (pos: Vec3, model: LampModel | undefined, clearance: number): AABB => {
  const halfW = (model?.bodyHalfWidth ?? 0.15) + 0.05;
  const drop = (model?.bodyHalfLength ?? 0.3) * 2 + clearance;
  return {
    min: [pos[0] - halfW, pos[1] - halfW, pos[2] - drop],
    max: [pos[0] + halfW, pos[1] + halfW, pos[2]],
  };
};

export function compareVenueAdaptation(opts: AdaptationOptions): AdaptationResult {
  const t0 = performance.now();
  const {
    fixtures, models, sourceVenue, targetVenue,
    toleranceM = 0.75, clearanceM = 0.3, suggestionCount = 3,
  } = opts;

  const modelMap = new Map(models.map(m => [m.id, m]));
  const srcPointById = new Map(sourceVenue.hangPoints.map(hp => [hp.id, worldPoint(sourceVenue, hp.position)]));
  const points: IndexedPoint[] = targetVenue.hangPoints.map(hp => ({
    id: hp.id, label: hp.label,
    position: worldPoint(targetVenue, hp.position),
    loadKg: hp.loadKg, usedLoadKg: 0,
  }));

  // 目标馆障碍物 (世界坐标)
  const boxes: AABB[] = targetVenue.obstacles.map(o => ({
    min: worldPoint(targetVenue, o.min),
    max: worldPoint(targetVenue, o.max),
  }));

  // 哈希单元取 2m, 容差查询只查相邻 1 圈格, 避免小格子跨格爆炸 (2000 点性能关键)
  const hash = new SpatialHash<IndexedPoint>(2);
  points.forEach(p => hash.insert(p));
  const pointById = new Map(points.map(p => [p.id, p]));

  const hitsObstacle = (box: AABB): boolean =>
    boxes.some(b =>
      box.min[0] <= b.max[0] && box.max[0] >= b.min[0] &&
      box.min[1] <= b.max[1] && box.max[1] >= b.min[1] &&
      box.min[2] <= b.max[2] && box.max[2] >= b.min[2]);

  /** 评估某挂点能否装下某灯, 返回 null=可行, 否则原因 */
  const evaluate = (fx: Fixture, pt: IndexedPoint): IssueReason | null => {
    const model = modelMap.get(fx.modelId);
    const weight = model?.weightKg ?? 0;
    if (pt.usedLoadKg + weight > pt.loadKg) return 'overload';
    // 净空: 灯体最低点距地坪必须保留人工作业/通行余量 (默认 2.5m)
    const lampBottomZ = pt.position[2] - (model?.bodyHalfLength ?? 0.3) * 2;
    const minFloorClearance = 2.5;
    if (lampBottomZ < targetVenue.origin[2] + minFloorClearance) return 'insufficient-clearance';
    // 障碍物干涉: 挂点下方灯体包围盒
    const box = fixtureBox(pt.position, model, clearanceM);
    if (hitsObstacle(box)) return 'obstacle-collision';
    return null;
  };

  /** 每台灯的比对锚点: 优先源馆挂点坐标 (灯吊在挂点下方, 灯位本身与屋面挂点有数米高差) */
  const anchorOf = (fx: Fixture): Vec3 =>
    (fx.hangPointId && srcPointById.get(fx.hangPointId)) || fx.position;

  const buildSuggestions = (fx: Fixture, exclude?: string): HangSuggestion[] => {
    const model = modelMap.get(fx.modelId);
    const weight = model?.weightKg ?? 0;
    const anchor = anchorOf(fx);
    // 扩大半径找候选, 按距离排序
    const candidates = hash.nearby(anchor, 6)
      .filter(p => p.id !== exclude)
      .map(p => ({ p, d: dist(anchor, p.position) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, suggestionCount * 3);
    return candidates.slice(0, suggestionCount).map(({ p, d }) => ({
      hangPointId: p.id,
      label: p.label,
      distance: round3(d),
      spareLoadKg: round3(p.loadKg - p.usedLoadKg - weight),
      clearance: round3(p.position[2] - targetVenue.origin[2]),
    }));
  };

  const issues: AdaptationIssue[] = [];
  const mapping: Record<string, string> = {};
  let matched = 0;

  // 按锚点稳定排序, 保证承重分配可复现
  const ordered = fixtures.map(fx => ({ fx, anchor: anchorOf(fx) }))
    .sort((a, b) => a.anchor[0] - b.anchor[0] || a.anchor[1] - b.anchor[1]);

  for (const { fx, anchor } of ordered) {
    const nearby = hash.nearby(anchor, toleranceM)
      .map(p => ({ p, d: dist(anchor, p.position) }))
      .sort((a, b) => a.d - b.d);

    if (nearby.length === 0) {
      issues.push({
        fixtureId: fx.id, fixtureLabel: fx.label, reason: 'no-near-point',
        detail: `容差 ${toleranceM}m 内无挂点 (源挂点 ${fmtVec(anchor)})`,
        suggestions: buildSuggestions(fx),
      });
      continue;
    }

    let chosen: IndexedPoint | null = null;
    let firstReason: IssueReason | null = null;
    for (const { p } of nearby) {
      const reason = evaluate(fx, p);
      if (reason === null) { chosen = p; break; }
      firstReason ??= reason;
    }

    if (chosen) {
      const model = modelMap.get(fx.modelId);
      chosen.usedLoadKg += model?.weightKg ?? 0;
      mapping[fx.id] = chosen.id;
      matched++;
    } else {
      const reason = firstReason ?? 'no-near-point';
      const reasonText: Record<IssueReason, string> = {
        'no-near-point': '容差内无挂点',
        overload: '候选挂点承重不足',
        'insufficient-clearance': '净空不足 (灯体下垂超下限)',
        'obstacle-collision': '与梁/马道/障碍物干涉',
      };
      issues.push({
        fixtureId: fx.id, fixtureLabel: fx.label, reason,
        detail: `${reasonText[reason]}; 最近候选 ${nearby[0].p.label} 相距 ${round3(nearby[0].d)}m`,
        suggestions: buildSuggestions(fx, nearby[0].p.id),
      });
      // 即使失败也记录最近候选, 供人工兜底
      mapping[fx.id] = nearby[0].p.id;
    }
  }

  return {
    sourceVenueId: sourceVenue.id,
    targetVenueId: targetVenue.id,
    fixtureCount: fixtures.length,
    matchedCount: matched,
    issues,
    mapping,
    elapsedMs: performance.now() - t0,
  };
}

const round3 = (n: number): number => Math.round(n * 1000) / 1000;
const fmtVec = (p: Vec3): string => `(${round3(p[0])}, ${round3(p[1])}, ${round3(p[2])})`;
