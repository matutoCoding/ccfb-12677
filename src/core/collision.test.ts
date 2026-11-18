import { describe, it, expect } from 'vitest';
import { checkMovingHeadCollisions, measureAngle, measureDistance } from './collision';
import { makeProject, makeVenue } from '../store/sample-data';
import type { FixtureDefinition, FixtureInstance, TrussSegment } from '../types';
import { rad, v3 } from './math3d';

const mhDef = (): FixtureDefinition => ({
  id: 'mh', gdtfName: 'X.MH@1', manufacturer: 'X', model: 'MH', weightKg: 20, heightMm: 500,
  footprint: { w: 300, d: 300 }, powerW: 450, cctK: 7000, cri: 75, pwmHz: 1200,
  panRange: [rad(-180), rad(180)], tiltRange: [rad(-90), rad(90)], envelopeRadiusMm: 500,
  beam: { minBeamAngleRad: 0.05, maxBeamAngleRad: 0.4, lumens: 10000, colorSource: 'cmy' },
  dmxChannels: 20, dailyRate: 80,
});

const mh = (id: string, pos: FixtureInstance['position']): FixtureInstance => ({
  id, uid: id, definitionId: 'mh', kind: 'moving-head', position: pos, rotation: v3(),
});

describe('collision 运动包络干涉', () => {
  it('灯头扫掠路径上有桁架时报告碰撞角度区间', () => {
    const def = mhDef();
    const fixtures = [mh('f1', v3(0, 0, 10000))];
    // 灯臂 225mm、灯头 500mm，在灯下方 600mm 放桁架（扫掠包络内）
    const truss: TrussSegment[] = [{
      id: 't1', code: 'T1', from: v3(-1000, 0, 9400), to: v3(1000, 0, 9400),
      sectionMm: 400, selfWeightKg: 100, hangPointIds: [],
    }];
    const report = checkMovingHeadCollisions(fixtures, new Map([['mh', def]]), truss, { stepRad: rad(4) });
    const r = report.perFixture[0]!;
    expect(r.hasCollision).toBe(true);
    expect(r.intervals.length).toBeGreaterThan(0);
    expect(r.intervals[0].against).toEqual({ kind: 'truss', id: 't1' });
    // 区间角度合法
    for (const iv of r.intervals) {
      expect(iv.panTo).toBeGreaterThanOrEqual(iv.panFrom);
      expect(iv.tiltTo).toBeGreaterThanOrEqual(iv.tiltFrom);
    }
  });

  it('足够远的桁架不产生碰撞', () => {
    const def = mhDef();
    const fixtures = [mh('f1', v3(0, 0, 10000))];
    const truss: TrussSegment[] = [{
      id: 't1', code: 'T1', from: v3(-1000, 0, 5000), to: v3(1000, 0, 5000),
      sectionMm: 400, selfWeightKg: 100, hangPointIds: [],
    }];
    const report = checkMovingHeadCollisions(fixtures, new Map([['mh', def]]), truss, { stepRad: rad(5) });
    expect(report.perFixture[0]!.hasCollision).toBe(false);
  });

  it('两台过近的摇头灯互检为 fixture 干涉', () => {
    const def = mhDef();
    const fixtures = [mh('f1', v3(0, 0, 10000)), mh('f2', v3(400, 0, 10000))];
    const report = checkMovingHeadCollisions(fixtures, new Map([['mh', def]]), [], { stepRad: rad(8) });
    const allAgainst = report.perFixture.flatMap((r) => r.intervals.map((i) => i.against.kind));
    expect(allAgainst).toContain('fixture');
  });

  it('确定性：同输入碰撞区间逐字段一致', () => {
    const venue = makeVenue('v1', '市', 100);
    const { project } = makeProject('p', venue.id, 40, 0);
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const r1 = checkMovingHeadCollisions(project.fixtures, defMap, project.truss, { stepRad: rad(6) });
    const r2 = checkMovingHeadCollisions(project.fixtures, defMap, project.truss, { stepRad: rad(6) });
    expect(JSON.stringify(r1.perFixture)).toBe(JSON.stringify(r2.perFixture));
  });

  it('量距/量角工具', () => {
    expect(measureDistance(v3(0, 0, 0), v3(3000, 4000, 0))).toBeCloseTo(5000, 6);
    expect(measureAngle(v3(0, 0, 0), v3(1, 0, 0), v3(0, 1, 0))).toBeCloseTo(Math.PI / 2, 6);
  });
});
