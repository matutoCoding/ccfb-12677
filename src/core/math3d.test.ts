import { describe, it, expect } from 'vitest';
import { segmentSegment, pointSegment, aabbOverlap, wrapAngle, v3 } from './math3d';

describe('math3d', () => {
  it('两平行线段最近距离', () => {
    const r = segmentSegment(v3(0, 0, 0), v3(10, 0, 0), v3(0, 5, 0), v3(10, 5, 0));
    expect(r.distance).toBeCloseTo(5, 6);
  });

  it('相交线段距离为 0', () => {
    const r = segmentSegment(v3(0, 0, 0), v3(10, 0, 0), v3(5, -5, 0), v3(5, 5, 0));
    expect(r.distance).toBeCloseTo(0, 6);
  });

  it('点到线段（垂足在线段外取端点）', () => {
    expect(pointSegment(v3(-5, 0, 0), v3(0, 0, 0), v3(10, 0, 0))).toBeCloseTo(5, 6);
    expect(pointSegment(v3(5, 3, 0), v3(0, 0, 0), v3(10, 0, 0))).toBeCloseTo(3, 6);
  });

  it('AABB 重叠判定', () => {
    expect(
      aabbOverlap({ min: v3(0, 0, 0), max: v3(10, 10, 10) }, { min: v3(5, 5, 5), max: v3(15, 15, 15) }),
    ).toBe(true);
    expect(
      aabbOverlap({ min: v3(0, 0, 0), max: v3(1, 1, 1) }, { min: v3(2, 2, 2), max: v3(3, 3, 3) }),
    ).toBe(false);
  });

  it('角度归一化到 (-π,π]', () => {
    expect(wrapAngle(Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(-Math.PI * 3)).toBeCloseTo(Math.PI, 6);
    expect(wrapAngle(0)).toBe(0);
  });
});
