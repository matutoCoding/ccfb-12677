import { describe, it, expect } from 'vitest';
import { fade, forkBranch, insertCueFromLive, logCueTrigger, nextCue, resolveCueState, stateAtTime } from './cue';
import { makeProject } from '../store/sample-data';
import type { CueFixtureState, Preset } from '../types';

describe('cue 时间轴与分支', () => {
  it('淡变曲线端点正确', () => {
    expect(fade('linear', 0)).toBe(0);
    expect(fade('linear', 1)).toBe(1);
    expect(fade('ease-in', 0.5)).toBeCloseTo(0.25, 6);
    expect(fade('ease-out', 0.5)).toBeCloseTo(0.75, 6);
  });

  it('预设引用解析：预设值变化后 cue 自动跟随', () => {
    const state: CueFixtureState = { fixtureId: 'f', params: { dimmer: 0.5 }, presetRefs: { 'color-rgb': 'p1' } };
    const preset: Preset = { id: 'p1', type: 'color', name: '红', value: { rgb: [1, 0, 0] } };
    const r1 = resolveCueState(state, new Map([['p1', preset]]));
    expect(r1.rgb).toEqual([1, 0, 0]);
    const r2 = resolveCueState(state, new Map([['p1', { ...preset, value: { rgb: [0, 1, 0] } }]]));
    expect(r2.rgb).toEqual([0, 1, 0]);
  });

  it('stateAtTime 在 cue 触发后返回灯参数', () => {
    const { project } = makeProject('p', 'v1', 10, 0);
    const before = stateAtTime(project, 100, 'branch-main');
    const after = stateAtTime(project, 9000, 'branch-main');
    expect(after.size).toBeGreaterThanOrEqual(before.size);
  });

  it('开分支复制 cue 且不影响主干', () => {
    const { project } = makeProject('p', 'v1', 10, 0);
    const mainCount = project.cues.filter((c) => c.branchId === 'branch-main').length;
    const forked = forkBranch(project, '试验分支');
    expect(forked.branches).toHaveLength(2);
    expect(forked.activeBranchId).not.toBe('branch-main');
    expect(project.cues.filter((c) => c.branchId === 'branch-main')).toHaveLength(mainCount);
    expect(forked.cues.filter((c) => c.branchId === forked.activeBranchId).length).toBe(mainCount);
  });

  it('导演喊停插 cue：编号递增并落在指定时刻', () => {
    const { project } = makeProject('p', 'v1', 10, 0);
    const updated = insertCueFromLive(project, [{ fixtureId: 'f', params: { dimmer: 1 } }], 12000, '现场加灯');
    const inserted = updated.cues.find((c) => c.name === '现场加灯')!;
    expect(inserted.timeMs).toBe(12000);
    expect(parseFloat(inserted.number)).toBeGreaterThan(parseFloat(project.cues[project.cues.length - 1]!.number));
  });

  it('触发留档与 nextCue 顺序', () => {
    const { project } = makeProject('p', 'v1', 10, 0);
    const logged = logCueTrigger(project, 'cue-1', '操作员甲');
    expect(logged.cues.find((c) => c.id === 'cue-1')!.triggerLog).toHaveLength(1);
    expect(nextCue(project)?.id).toBe('cue-1');
    expect(nextCue(project, 'cue-1')?.id).toBe('cue-2');
  });
});
