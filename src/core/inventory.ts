// ============================================================
// 库存台账 / 档期冲突 / 序列号核销 / 报价 / 线缆清册 / 吊装工序
// ============================================================
import type {
  Booking,
  CableRun,
  FixtureDefinition,
  FixtureInstance,
  ID,
  InventoryItem,
  Quote,
  QuoteLine,
  RigTask,
} from '../types';
import { dist } from './math3d';

/** 同一序列号被两个项目档期重叠 → 冲突清单 */
export function findBookingConflicts(bookings: Booking[]): { serialNo: string; bookings: Booking[] }[] {
  const bySerial = new Map<string, Booking[]>();
  for (const b of bookings) {
    const list = bySerial.get(b.serialNo) ?? [];
    list.push(b);
    bySerial.set(b.serialNo, list);
  }
  const conflicts: { serialNo: string; bookings: Booking[] }[] = [];
  for (const [serialNo, list] of bySerial) {
    const sorted = [...list].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i].fromDate <= sorted[i - 1].toDate) {
        conflicts.push({ serialNo, bookings: [sorted[i - 1], sorted[i]] });
        break;
      }
    }
  }
  return conflicts;
}

/** 项目占灯与台账核对：缺失/占用/可用 */
export function reconcileProjectInventory(
  fixtures: FixtureInstance[],
  inventory: InventoryItem[],
  projectId: ID,
): {
  satisfied: FixtureInstance[];
  missing: FixtureInstance[];
  serials: { fixtureId: ID; serialNo?: string; ok: boolean; reason?: string }[];
} {
  const itemBySerial = new Map(inventory.map((i) => [i.serialNo, i]));
  const satisfied: FixtureInstance[] = [];
  const missing: FixtureInstance[] = [];
  const serials: { fixtureId: ID; serialNo?: string; ok: boolean; reason?: string }[] = [];

  for (const fx of fixtures) {
    if (!fx.serialNo) {
      missing.push(fx);
      serials.push({ fixtureId: fx.id, ok: false, reason: '未分配序列号' });
      continue;
    }
    const item = itemBySerial.get(fx.serialNo);
    if (!item) {
      missing.push(fx);
      serials.push({ fixtureId: fx.id, serialNo: fx.serialNo, ok: false, reason: '台账无此序列号' });
      continue;
    }
    if (item.status === 'maintenance') {
      missing.push(fx);
      serials.push({ fixtureId: fx.id, serialNo: fx.serialNo, ok: false, reason: '维修中' });
      continue;
    }
    if (item.currentProjectId && item.currentProjectId !== projectId) {
      missing.push(fx);
      serials.push({ fixtureId: fx.id, serialNo: fx.serialNo, ok: false, reason: `已被项目 ${item.currentProjectId} 占用` });
      continue;
    }
    satisfied.push(fx);
    serials.push({ fixtureId: fx.id, serialNo: fx.serialNo, ok: true });
  }
  return { satisfied, missing, serials };
}

/** 撤场按序列号核销归还 */
export function checkinSerial(inventory: InventoryItem[], serialNo: string): InventoryItem[] {
  return inventory.map((i) =>
    i.serialNo === serialNo ? { ...i, status: 'idle', currentProjectId: undefined } : i,
  );
}

// ---------------- 报价 ----------------

export function buildQuote(params: {
  title: string;
  venueId?: ID;
  fixtures: FixtureInstance[];
  definitions: Map<ID, FixtureDefinition>;
  showDays: number;
  installDays: number;
  strikeDays: number;
  laborDayRate: number;
  laborPersonDays: number;
  truckTripRate: number;
  truckTrips: number;
  extraLines?: QuoteLine[];
}): Quote {
  const countByDef = new Map<ID, number>();
  for (const fx of params.fixtures) {
    countByDef.set(fx.definitionId, (countByDef.get(fx.definitionId) ?? 0) + 1);
  }
  const lines: QuoteLine[] = [];
  for (const [defId, qty] of countByDef) {
    const def = params.definitions.get(defId);
    if (!def) continue;
    const days = params.showDays + params.installDays + params.strikeDays;
    lines.push({
      label: `${def.manufacturer} ${def.model}`,
      qty,
      unit: '台',
      unitPrice: def.dailyRate,
      days,
      subtotal: qty * def.dailyRate * days,
    });
  }
  lines.push({
    label: '人工工日',
    qty: params.laborPersonDays,
    unit: '工日',
    unitPrice: params.laborDayRate,
    subtotal: params.laborPersonDays * params.laborDayRate,
  });
  lines.push({
    label: '运输车次',
    qty: params.truckTrips,
    unit: '车次',
    unitPrice: params.truckTripRate,
    subtotal: params.truckTrips * params.truckTripRate,
  });
  for (const ex of params.extraLines ?? []) lines.push(ex);
  const total = lines.reduce((s, l) => s + l.subtotal, 0);
  return {
    id: `quote-${Math.random().toString(36).slice(2, 8)}`,
    title: params.title,
    venueId: params.venueId,
    showDays: params.showDays,
    installDays: params.installDays,
    strikeDays: params.strikeDays,
    laborDayRate: params.laborDayRate,
    truckTripRate: params.truckTripRate,
    laborPersonDays: params.laborPersonDays,
    truckTrips: params.truckTrips,
    lines,
    total,
    createdAt: Date.now(),
  };
}

// ---------------- 线缆清册 ----------------

/** 按走线路径折线求每根长度，并汇总接头型号 */
export function cableLedger(cables: CableRun[]): {
  runs: (CableRun & { lengthM: number })[];
  connectorSummary: Record<string, number>;
  totalLengthM: number;
} {
  const connectorSummary: Record<string, number> = {};
  let totalLengthM = 0;
  const runs = cables.map((c) => {
    let lengthMm = 0;
    for (let i = 1; i < c.path.length; i++) lengthMm += dist(c.path[i - 1], c.path[i]);
    const lengthM = lengthMm / 1000;
    totalLengthM += lengthM;
    connectorSummary[c.connectorFrom] = (connectorSummary[c.connectorFrom] ?? 0) + 1;
    connectorSummary[c.connectorTo] = (connectorSummary[c.connectorTo] ?? 0) + 1;
    return { ...c, lengthMm, lengthM };
  });
  return { runs, connectorSummary, totalLengthM };
}

/** 吊装工序排班组任务（按日期+开始时间排序的日历视图数据） */
export function sortRigTasks(tasks: RigTask[]): RigTask[] {
  return [...tasks].sort((a, b) =>
    a.day.localeCompare(b.day) || a.startHm.localeCompare(b.startHm) || a.crew.localeCompare(b.crew),
  );
}

export function rigProgress(tasks: RigTask[]): { done: number; total: number; percent: number } {
  const done = tasks.filter((t) => t.done).length;
  return { done, total: tasks.length, percent: tasks.length ? done / tasks.length : 0 };
}
