// 均匀空间哈希网格：O(1) 邻域查询，支撑 2000 挂点秒级比对
import type { Vec3, ID } from '../types';
import type { AABB } from './math3d';

export class SpatialHash {
  readonly cellSize: number;
  private cells = new Map<string, ID[]>();
  private positions: Map<ID, Vec3>;

  constructor(positions: Map<ID, Vec3>, cellSize: number) {
    if (!(cellSize > 0)) throw new Error('cellSize 必须为正数');
    this.cellSize = cellSize;
    this.positions = positions;
    for (const [id, p] of positions) this.insert(id, p);
  }

  private key(cx: number, cy: number, cz: number): string {
    return `${cx}|${cy}|${cz}`;
  }

  private cellOf(p: Vec3): [number, number, number] {
    return [
      Math.floor(p.x / this.cellSize),
      Math.floor(p.y / this.cellSize),
      Math.floor(p.z / this.cellSize),
    ];
  }

  private insert(id: ID, p: Vec3): void {
    const [cx, cy, cz] = this.cellOf(p);
    const k = this.key(cx, cy, cz);
    const bucket = this.cells.get(k);
    if (bucket) bucket.push(id);
    else this.cells.set(k, [id]);
  }

  /** 查询半径 radius 内的候选 id（含自身），按距离排序返回 */
  queryRadius(center: Vec3, radius: number): { id: ID; distance: number }[] {
    const [cx0, cy0, cz0] = this.cellOf({
      x: center.x - radius,
      y: center.y - radius,
      z: center.z - radius,
    });
    const [cx1, cy1, cz1] = this.cellOf({
      x: center.x + radius,
      y: center.y + radius,
      z: center.z + radius,
    });
    const out: { id: ID; distance: number }[] = [];
    const r2 = radius * radius;
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = this.cells.get(this.key(cx, cy, cz));
          if (!bucket) continue;
          for (const id of bucket) {
            const p = this.positions.get(id)!;
            const dx = p.x - center.x;
            const dy = p.y - center.y;
            const dz = p.z - center.z;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 <= r2) out.push({ id, distance: Math.sqrt(d2) });
          }
        }
      }
    }
    out.sort((a, b) => a.distance - b.distance);
    return out;
  }

  /** AABB 范围内候选（碰撞预筛用） */
  queryAABB(box: AABB): ID[] {
    const [cx0, cy0, cz0] = this.cellOf(box.min);
    const [cx1, cy1, cz1] = this.cellOf(box.max);
    const out: ID[] = [];
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cz = cz0; cz <= cz1; cz++) {
          const bucket = this.cells.get(this.key(cx, cy, cz));
          if (!bucket) continue;
          for (const id of bucket) {
            const p = this.positions.get(id)!;
            if (
              p.x >= box.min.x && p.x <= box.max.x &&
              p.y >= box.min.y && p.y <= box.max.y &&
              p.z >= box.min.z && p.z <= box.max.z
            ) {
              out.push(id);
            }
          }
        }
      }
    }
    return out;
  }

  get size(): number {
    return this.positions.size;
  }
}
