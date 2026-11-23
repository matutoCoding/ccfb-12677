// 向量/空间数学, 纯函数无依赖
import type { Vec3 } from './types.ts';

export const v = (x = 0, y = 0, z = 0): Vec3 => [x, y, z];
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const len = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export const dist = (a: Vec3, b: Vec3): number => len(sub(a, b));
export const lerp = (a: Vec3, b: Vec3, t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const deg2rad = (d: number): number => (d * Math.PI) / 180;
export const rad2deg = (r: number): number => (r * 180) / Math.PI;

export interface AABB { min: Vec3; max: Vec3; }

export const aabbOverlap = (a: AABB, b: AABB): boolean =>
  a.min[0] <= b.max[0] && a.max[0] >= b.min[0] &&
  a.min[1] <= b.max[1] && a.max[1] >= b.min[1] &&
  a.min[2] <= b.max[2] && a.max[2] >= b.min[2];

/** 均匀网格空间哈希: 建表 O(n), 近邻查询 O(1) 均摊 */
export class SpatialHash<T extends { position: Vec3 }> {
  private cells = new Map<string, T[]>();
  private cellSize: number;
  constructor(cellSize: number) { this.cellSize = cellSize; }

  private key(p: Vec3): string {
    const c = this.cellSize;
    return `${Math.floor(p[0] / c)},${Math.floor(p[1] / c)},${Math.floor(p[2] / c)}`;
  }

  insert(item: T): void {
    const k = this.key(item.position);
    let arr = this.cells.get(k);
    if (!arr) { arr = []; this.cells.set(k, arr); }
    arr.push(item);
  }

  /** 查询以 p 为中心半径 r 内的全部对象 (含跨格) */
  nearby(p: Vec3, r: number): T[] {
    const c = this.cellSize;
    const n = Math.max(1, Math.ceil(r / c));
    const cx = Math.floor(p[0] / c), cy = Math.floor(p[1] / c), cz = Math.floor(p[2] / c);
    const out: T[] = [];
    for (let i = cx - n; i <= cx + n; i++)
      for (let j = cy - n; j <= cy + n; j++)
        for (let k = cz - n; k <= cz + n; k++) {
          const arr = this.cells.get(`${i},${j},${k}`);
          if (arr) out.push(...arr);
        }
    return out;
  }

  get size(): number { return this.cells.size; }
}

/** 多边形折线总长度 (线缆走线长度统计) */
export const polylineLength = (path: Vec3[]): number => {
  let total = 0;
  for (let i = 1; i < path.length; i++) total += dist(path[i - 1], path[i]);
  return total;
};
