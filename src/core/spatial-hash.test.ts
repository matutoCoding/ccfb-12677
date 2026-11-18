import { describe, it, expect } from 'vitest';
import { SpatialHash } from './spatial-hash';
import { v3 } from './math3d';
import type { Vec3, ID } from '../types';

function build(n: number, spacing: number): { hash: SpatialHash; positions: Map<ID, Vec3> } {
  const positions = new Map<ID, Vec3>();
  for (let i = 0; i < n; i++) {
    positions.set(`p${i}`, v3(i * spacing, (i % 5) * 1000, 0));
  }
  return { hash: new SpatialHash(positions, spacing * 2), positions };
}

describe('SpatialHash', () => {
  it('半径查询只返回范围内点并按距离排序', () => {
    const { hash } = build(100, 1000);
    const res = hash.queryRadius(v3(5000, 0, 0), 2500);
    expect(res.length).toBeGreaterThan(0);
    expect(res.every((r) => r.distance <= 2500)).toBe(true);
    const ds = res.map((r) => r.distance);
    expect(ds).toEqual([...ds].sort((a, b) => a - b));
  });

  it('2000 点构建与查询在毫秒级完成', () => {
    const { hash } = build(2000, 2000);
    expect(hash.size).toBe(2000);
    const t0 = performance.now();
    for (let i = 0; i < 100; i++) hash.queryRadius(v3(i * 3000, 500, 0), 4000);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(500); // 100 次查询 < 500ms
  });
});
