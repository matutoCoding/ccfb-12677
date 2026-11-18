import { describe, it, expect } from 'vitest';
import {
  cameraExposure,
  computeLuxGrid,
  luxFalseColor,
  pwmRollingBands,
  renderSkinUnder,
  zoneUniformity,
} from './photometric';
import { makeProject } from '../store/sample-data';
import { v3 } from './math3d';

describe('photometric 照度与光学', () => {
  it('照度网格输出 nx*ny 且统计量自洽', () => {
    const { project } = makeProject('p', 'v1', 20, 8);
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const grid = computeLuxGrid(
      project.fixtures,
      defMap,
      { origin: v3(2000, 2000, 0), width: 8000, depth: 6000 },
      1000,
    );
    expect(grid.samples.length).toBe(grid.nx * grid.ny);
    expect(grid.maxLux).toBeGreaterThanOrEqual(grid.avgLux);
    expect(grid.avgLux).toBeGreaterThanOrEqual(grid.minLux);
  });

  it('演区均匀度在 0..1 之间', () => {
    const { project } = makeProject('p', 'v1', 20, 8);
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const grid = computeLuxGrid(project.fixtures, defMap, { origin: v3(0, 0, 0), width: 10000, depth: 8000 }, 1000);
    const z = zoneUniformity(grid, { x0: 2000, y0: 2000, x1: 8000, y1: 6000 });
    expect(z.uniformity).toBeGreaterThanOrEqual(0);
    expect(z.uniformity).toBeLessThanOrEqual(1);
  });

  it('伪彩色返回 RGB 三元组且高 lux 偏红', () => {
    const low = luxFalseColor(10, 10000);
    const high = luxFalseColor(10000, 10000);
    expect(low.every((c) => c >= 0 && c <= 1)).toBe(true);
    expect(high[0]).toBeGreaterThan(low[0]);
  });

  it('摄像机曝光：过曝削顶到 1.25，黑场接近 0', () => {
    const cam = { shutterMs: 10, fps: 50, targetLux: 800 };
    expect(cameraExposure(0, cam)).toBe(0);
    expect(cameraExposure(100000, cam)).toBe(1.25);
    expect(cameraExposure(800, cam)).toBeCloseTo(0.5, 1);
  });

  it('PWM 不同步产生可见滚动条纹，同步时条纹消失', () => {
    // 低频 PWM + 短快门：每行窗口捕获到不同 PWM 相位
    const cam = { shutterMs: 2, fps: 50, targetLux: 800 };
    // 123Hz 与 50fps 非整数倍 → 逐行相位漂移 → 可见条纹
    const unsynced = pwmRollingBands(123, 0.5, cam, 200, 15);
    expect(unsynced.bandingStrength).toBeGreaterThan(0);
    // 100/50=2 整数倍同步 → 每行相位一致 → 条纹消失
    const synced = pwmRollingBands(100, 0.5, cam, 200, 15);
    expect(synced.bandingStrength).toBe(0);
  });

  it('无 PWM 直流灯具无条纹', () => {
    const r = pwmRollingBands(0, 1, { shutterMs: 10, fps: 50, targetLux: 800 }, 100);
    expect(r.bandingStrength).toBe(0);
    expect(r.rowGain.every((g) => g === 1)).toBe(true);
  });

  it('色温/CRI 影响肤色：低色温暖、高 CRI 保真度高', () => {
    const warm = renderSkinUnder(3000, 95);
    const cool = renderSkinUnder(7500, 70);
    expect(warm.tone).toContain('暖');
    expect(cool.tone).toContain('冷');
    expect(warm.fidelity).toBeGreaterThan(cool.fidelity);
    expect(warm.rgb[0]).toBeGreaterThanOrEqual(cool.rgb[0]); // 暖光红通道更高
  });
});
