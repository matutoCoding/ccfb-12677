import { describe, it, expect } from 'vitest';
import { activeMembers, applyFx, memberPhases, toggleExclude } from './fx';
import type { FixtureGroup, FxConfig } from '../types';

const group = (n: number, excluded: string[] = []): FixtureGroup => ({
  id: 'g',
  name: 'g',
  fixtureIds: Array.from({ length: n }, (_, i) => `f${i}`),
  excludedIds: excluded,
});

const cfg = (patch: Partial<FxConfig> = {}): FxConfig => ({
  mode: 'wave',
  param: 'dimmer',
  base: 0.5,
  amplitude: 0.5,
  phaseStep: 0.5,
  periodMs: 2000,
  direction: 1,
  shape: 'gradient',
  ...patch,
});

describe('fx 灯效引擎', () => {
  it('对称模式相位以中心镜像', () => {
    const phases = memberPhases(group(5), cfg({ mode: 'symmetric' }));
    expect(phases[0]!.phase).toBe(phases[4]!.phase);
    expect(phases[1]!.phase).toBe(phases[3]!.phase);
  });

  it('波浪模式相位线性递增', () => {
    const phases = memberPhases(group(4), cfg({ mode: 'wave', phaseStep: 0.3 }));
    expect(phases[1]!.phase - phases[0]!.phase).toBeCloseTo(0.3, 6);
  });

  it('追逐模式反向时相位顺序翻转', () => {
    const fwd = memberPhases(group(4), cfg({ mode: 'chase', direction: 1 }));
    const rev = memberPhases(group(4), cfg({ mode: 'chase', direction: -1 }));
    expect(fwd[0]!.phase).toBe(rev[3]!.phase);
  });

  it('临时剔除某台灯不影响剩余灯相位序列', () => {
    const g = toggleExclude(group(5), 'f2');
    expect(activeMembers(g)).toEqual(['f0', 'f1', 'f3', 'f4']);
    const phases = memberPhases(g, cfg({ mode: 'wave' }));
    expect(phases.find((p) => p.fixtureId === 'f2')).toBeUndefined();
    expect(phases).toHaveLength(4);
  });

  it('输出参数在合法范围且随时间周期变化', () => {
    const out0 = applyFx(group(6), cfg(), 0);
    const out1 = applyFx(group(6), cfg(), 1000);
    expect(out0).toHaveLength(6);
    for (const o of out0) expect(o.params.dimmer!).toBeGreaterThanOrEqual(0);
    const changed = out0.some((o, i) => Math.abs((o.params.dimmer ?? 0) - (out1[i]!.params.dimmer ?? 0)) > 1e-6);
    expect(changed).toBe(true);
  });

  it('圆形生成器输出二维轨迹', () => {
    const out = applyFx(group(3), cfg({ shape: 'circle', param: 'rgb' }), 500);
    expect(out[0]!.params.rgb).toBeDefined();
    expect(out[0]!.params.rgb).toHaveLength(3);
  });
});
