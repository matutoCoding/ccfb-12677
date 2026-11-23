// 报价、线缆清册、吊装工序
import type { Project, QuoteLine, CableRun, RigTask, Fixture, LampModel, Vec3 } from './types.ts';
import { polylineLength, dist } from './math.ts';

export interface QuoteTotal {
  lines: (QuoteLine & { amount: number })[];
  subtotal: number;
  taxRate: number;
  tax: number;
  total: number;
}

/** 租赁费用按用灯天数×单价, 人工工日与运输车次一起汇总 */
export function buildQuote(project: Project, taxRate = 0.09): QuoteTotal {
  const lines = project.quoteLines.map(l => ({ ...l, amount: l.qty * l.unitPrice * (l.kind === 'rental' ? l.days : 1) }));
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const tax = subtotal * taxRate;
  return { lines, subtotal, taxRate, tax, total: subtotal + tax };
}

/** 自动生成租赁行: 按型号汇总灯具数量, 天数取项目报价参数 */
export function autoRentalLines(project: Project, models: LampModel[], dayRate: Record<string, number>, days: number): QuoteLine[] {
  const count = new Map<string, number>();
  for (const fx of project.fixtures) count.set(fx.modelId, (count.get(fx.modelId) ?? 0) + 1);
  return [...count.entries()].map(([modelId, qty]) => {
    const m = models.find(x => x.id === modelId);
    return {
      kind: 'rental' as const,
      name: m ? `${m.manufacturer} ${m.name}` : modelId,
      unit: '台',
      qty,
      unitPrice: dayRate[modelId] ?? 200,
      days,
    };
  });
}

/** 线缆长度: 沿走线路径逐段求和; 接头型号取两端灯具/节点声明 */
export function summarizeCables(cables: CableRun[]): {
  byType: Record<string, { count: number; totalLength: number; connectors: Set<string> }>;
  totalLength: number;
} {
  const byType: Record<string, { count: number; totalLength: number; connectors: Set<string> }> = {};
  let totalLength = 0;
  for (const c of cables) {
    const length = c.path.length > 1 ? polylineLength(c.path) : c.length;
    c.length = Math.round(length * 100) / 100;
    totalLength += c.length;
    if (!byType[c.cableType]) byType[c.cableType] = { count: 0, totalLength: 0, connectors: new Set() };
    byType[c.cableType].count++;
    byType[c.cableType].totalLength += c.length;
    byType[c.cableType].connectors.add(`${c.connectorA} / ${c.connectorB}`);
  }
  return { byType, totalLength };
}

/** 根据灯具在桁架上的分布自动布线: 每根桁架上的灯手拉手, 末端回到节点 */
export function autoCableRuns(project: Project): CableRun[] {
  const runs: CableRun[] = [];
  const byTruss = new Map<string, Fixture[]>();
  for (const fx of project.fixtures) {
    if (!fx.trussId) continue;
    const arr = byTruss.get(fx.trussId) ?? [];
    arr.push(fx);
    byTruss.set(fx.trussId, arr);
  }
  let seq = 1;
  for (const [trussId, fixtures] of byTruss) {
    fixtures.sort((a, b) => a.position[0] - b.position[0] || a.position[1] - b.position[1]);
    for (let i = 1; i < fixtures.length; i++) {
      const a = fixtures[i - 1], b = fixtures[i];
      // 走线: 灯位 -> 上沿桁架 -> 下一灯位 (预留 0.3m 接头余量)
      const path: Vec3[] = [a.position, [a.position[0], a.position[1], a.position[2] + 0.3],
        [b.position[0], b.position[1], b.position[2] + 0.3], b.position];
      runs.push({
        id: `cable-${seq++}`,
        label: `${a.label}→${b.label}`,
        fromFixture: a.id, toFixture: b.id,
        path,
        length: polylineLength(path) + 0.3,
        connectorA: 'powerCon True1', connectorB: 'powerCon True1',
        cableType: '信号/电源复合缆',
      });
    }
  }
  return runs;
}

/** 吊装工序: 每根桁架一条班组任务, 按日排程, 每日按工时 8h 切分 */
export function scheduleRigging(project: Project, crewPerTrussHours = 2.5): RigTask[] {
  const tasks: RigTask[] = [];
  const day0 = new Date();
  let dayIdx = 0, hourCursor = 8;
  for (const tr of project.trusses) {
    if (hourCursor + crewPerTrussHours > 17) { dayIdx++; hourCursor = 8; }
    const day = new Date(day0.getTime() + dayIdx * 86400000).toISOString().slice(0, 10);
    tasks.push({
      id: `rig-${tr.id}`,
      day,
      startHour: hourCursor,
      durationHours: crewPerTrussHours,
      crew: dayIdx % 2 === 0 ? '甲班(吊挂A组)' : '乙班(吊挂B组)',
      trussId: tr.id,
      description: `吊装 ${tr.label} 并挂接灯具`,
    });
    hourCursor += crewPerTrussHours;
  }
  return tasks;
}

/** 触发记录留档: 演出当天手动逐条触发 */
export function logTrigger(project: Project, cueNo: number, operator: string): Project {
  const cue = project.cues.find(c => c.no === cueNo);
  if (!cue) return project;
  return {
    ...project,
    triggerLog: [...project.triggerLog, {
      cueNo, cueLabel: cue.label, triggeredAt: Date.now(), operator,
    }],
  };
}

export function nearestFixtureDistance(fixtures: Fixture[]): number {
  let best = Infinity;
  for (let i = 0; i < fixtures.length; i++)
    for (let j = i + 1; j < fixtures.length; j++)
      best = Math.min(best, dist(fixtures[i].position, fixtures[j].position));
  return best;
}
