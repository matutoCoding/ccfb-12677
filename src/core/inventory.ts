// 库存台账: 项目占灯、档期冲突检测、序列号核销
import type { InventoryItem, Project, LampModel } from './types.ts';

export interface BookingConflict {
  serialNo: string;
  modelId: string;
  projectIds: string[];
}

/**
 * 同一序列号被多个项目占用即冲突。
 * 项目本身只声明需要的型号与数量, 占用关系落在 InventoryItem.projectId 上;
 * 该函数扫描全库找出被重复占用的序列号。
 */
export function findBookingConflicts(inventory: InventoryItem[]): BookingConflict[] {
  const bySerial = new Map<string, InventoryItem[]>();
  for (const it of inventory) {
    if (!it.projectId) continue;
    const arr = bySerial.get(it.serialNo) ?? [];
    arr.push(it);
    bySerial.set(it.serialNo, arr);
  }
  const conflicts: BookingConflict[] = [];
  for (const [serialNo, items] of bySerial) {
    const projects = [...new Set(items.map(i => i.projectId!))];
    if (projects.length > 1) {
      conflicts.push({ serialNo, modelId: items[0].modelId, projectIds: projects });
    }
  }
  return conflicts;
}

/** 按型号统计: 项目需求 vs 库存可用, 返回缺口 */
export function stockGap(
  project: Project,
  inventory: InventoryItem[],
  models: LampModel[],
): { modelId: string; modelName: string; required: number; available: number; gap: number }[] {
  const need = new Map<string, number>();
  for (const fx of project.fixtures) need.set(fx.modelId, (need.get(fx.modelId) ?? 0) + 1);
  const out: { modelId: string; modelName: string; required: number; available: number; gap: number }[] = [];
  for (const [modelId, required] of need) {
    const available = inventory.filter(i =>
      i.modelId === modelId && (i.status === 'idle') && !i.projectId).length;
    const mdl = models.find(m => m.id === modelId);
    out.push({
      modelId,
      modelName: mdl ? `${mdl.manufacturer} ${mdl.name}` : modelId,
      required,
      available,
      gap: Math.max(0, required - available),
    });
  }
  return out.sort((a, b) => b.gap - a.gap);
}

/** 出库: 为项目按型号分配空闲序列号, 写到灯具上 */
export function checkout(
  project: Project,
  inventory: InventoryItem[],
): { inventory: InventoryItem[]; assignments: Record<string, string>; shortage: string[] } {
  const next = inventory.map(i => ({ ...i }));
  const assignments: Record<string, string> = {};
  const shortage: string[] = [];
  for (const fx of project.fixtures) {
    const cand = next.find(i => i.modelId === fx.modelId && i.status === 'idle' && !i.projectId);
    if (!cand) { shortage.push(fx.label); continue; }
    cand.status = 'out';
    cand.projectId = project.id;
    assignments[fx.id] = cand.serialNo;
  }
  return { inventory: next, assignments, shortage };
}

/** 撤场核销: 按序列号逐台归还, 返回未归还清单 */
export function checkIn(
  inventory: InventoryItem[],
  returnedSerials: string[],
): { inventory: InventoryItem[]; missing: string[] } {
  const set = new Set(returnedSerials);
  const next = inventory.map(i => {
    if (i.status === 'out' && set.has(i.serialNo)) {
      return { ...i, status: 'idle' as const, projectId: undefined, returnedAt: Date.now() };
    }
    return i;
  });
  const known = new Set(inventory.map(i => i.serialNo));
  const missing = [...set].filter(s => !known.has(s));
  const stillOut = next.filter(i => i.status === 'out').map(i => i.serialNo);
  return { inventory: next, missing: [...missing, ...stillOut] };
}

export type { LampModel };
