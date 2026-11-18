import { describe, it, expect } from 'vitest';
import { compareVenues } from './venue-compat';
import { makeVenue, makeProject } from '../store/sample-data';
import type { FixtureDefinition, HangPoint, ID, Vec3 } from '../types';
import { v3 } from './math3d';

const def = (): FixtureDefinition => ({
  id: 'd1', gdtfName: 'X.Y@1', manufacturer: 'X', model: 'Y', weightKg: 20, heightMm: 500,
  footprint: { w: 300, d: 300 }, powerW: 400, cctK: 6000, cri: 85, pwmHz: 1000,
  beam: { minBeamAngleRad: 0.05, maxBeamAngleRad: 0.4, lumens: 8000, colorSource: 'cmy' },
  dmxChannels: 16, dailyRate: 80,
});

const hp = (id: ID, p: Vec3, patch: Partial<HangPoint> = {}): HangPoint => ({
  id, code: id, position: p, loadRatingKg: 500, headroomMm: 9000, type: 'motor',
  power: { connector: 'CEE16', voltage: 230, phases: 1, maxAmps: 16 }, tags: [], ...patch,
});

describe('venue-compat 换馆比对', () => {
  it('同坐标挂点匹配成功且偏差为 0', () => {
    const d = def();
    const fixtures = [
      { id: 'f1', uid: 'M1', definitionId: d.id, kind: 'moving-head' as const, position: v3(0, 0, 9000), rotation: v3(), hangPointId: 'h1' },
    ];
    const src = [hp('h1', v3(0, 0, 10000))];
    const dst = [hp('h1b', v3(0, 0, 10000))];
    const report = compareVenues(fixtures, new Map([[d.id, d]]), [], src, dst);
    expect(report.stats.matched).toBe(1);
    expect(report.fixtureResults[0].deviationMm).toBe(0);
    expect(report.fixtureResults[0].ok).toBe(true);
  });

  it('承重不足/净空不足/接口不符逐项列原因并给替代建议', () => {
    const d = def();
    const fixtures = [
      { id: 'f1', uid: 'M1', definitionId: d.id, kind: 'moving-head' as const, position: v3(0, 0, 9000), rotation: v3(), hangPointId: 'h1' },
    ];
    const src = [hp('h1', v3(0, 0, 10000))];
    const dst = [
      hp('bad', v3(0, 0, 10000), { loadRatingKg: 5, headroomMm: 100, power: { connector: 'CEE32', voltage: 230, phases: 1, maxAmps: 16 } }),
      hp('good', v3(800, 0, 10000)),
    ];
    const report = compareVenues(fixtures, new Map([[d.id, d]]), [], src, dst, { toleranceMm: 2000 });
    const r = report.fixtureResults[0];
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain('load-exceeded');
    expect(r.reasons).toContain('headroom-insufficient');
    expect(r.reasons).toContain('connector-missing');
    expect(r.suggestions.some((s) => s.pointId === 'good')).toBe(true);
  });

  it('容差内无挂点时标记 out-of-envelope', () => {
    const d = def();
    const fixtures = [
      { id: 'f1', uid: 'M1', definitionId: d.id, kind: 'moving-head' as const, position: v3(0, 0, 9000), rotation: v3(), hangPointId: 'h1' },
    ];
    const report = compareVenues(fixtures, new Map([[d.id, d]]), [], [hp('h1', v3(0, 0, 10000))], [hp('far', v3(9000, 9000, 10000))]);
    expect(report.fixtureResults[0].reasons).toEqual(['out-of-envelope']);
    expect(report.stats.unmatchedCount).toBe(1);
  });

  it('一个挂点不会被两台灯抢占', () => {
    const d = def();
    const fixtures = [1, 2].map((i) => ({
      id: `f${i}`, uid: `M${i}`, definitionId: d.id, kind: 'moving-head' as const,
      position: v3(i * 500, 0, 9000), rotation: v3(), hangPointId: `h${i}`,
    }));
    const src = [hp('h1', v3(500, 0, 10000)), hp('h2', v3(1000, 0, 10000))];
    const dst = [hp('only', v3(600, 0, 10000))];
    const report = compareVenues(fixtures, new Map([[d.id, d]]), [], src, dst, { toleranceMm: 2000 });
    const assigned = report.fixtureResults.filter((r) => r.targetPointId).length;
    expect(assigned).toBe(1);
    expect(report.unusedTargetPointIds.length).toBe(0);
  });

  it('确定性：同输入两次结果完全一致', () => {
    const a = makeVenue('A', '市', 300);
    const b = makeVenue('B', '市', 300, true);
    const { project } = makeProject('p', a.id, 80, 10);
    const defMap = new Map(project.fixtureDefinitions.map((x) => [x.id, x]));
    const r1 = compareVenues(project.fixtures, defMap, project.truss, a.hangPoints, b.hangPoints);
    const r2 = compareVenues(project.fixtures, defMap, project.truss, a.hangPoints, b.hangPoints);
    expect(JSON.stringify(r1.fixtureResults)).toBe(JSON.stringify(r2.fixtureResults));
  });
});
