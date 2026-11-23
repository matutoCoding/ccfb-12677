// 其它领域逻辑: 组联动/效果/预设引用/库存冲突/照度/报价/评论合并
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyGroupParam, evaluateEffect, buildCueState, forkBranch } from '../src/core/programming.ts';
import { findBookingConflicts, checkout, checkIn } from '../src/core/inventory.ts';
import { computeLuxGrid, pwmBandFactor, skinToneUnderLight, cameraExposure } from '../src/core/photometric.ts';
import { buildQuote } from '../src/core/quote.ts';
import { mergeCommentBundle, exportCommentBundle } from '../src/core/review.ts';
import { makeLampModels, makeVenue, makeFixtures } from './helpers.ts';
import type { FixtureGroup, Project, ReviewComment } from '../src/core/types.ts';
import { defaultParams } from '../src/core/types.ts';

function group(n: number, mode: FixtureGroup['mode']): FixtureGroup {
  return {
    id: 'g', label: 'g', fixtureIds: Array.from({ length: n }, (_, i) => `fx-${i}`),
    mode, step: 5, direction: 1, linkedParams: ['pan', 'tilt', 'dimmer'],
  };
}

test('组联动: 剔除某台灯不影响其余偏移序列', () => {
  const venue = makeVenue('v', 10, 10, false);
  const fixtures = makeFixtures(6, venue);
  fixtures[2].excludedFromGroup = true;
  const g = group(6, 'chase');
  const next = applyGroupParam(g, fixtures, 'fx-0', 'pan', 100);
  // 被剔除的灯保持原值
  assert.equal(next[2].params.pan, fixtures[2].params.pan);
  // 其余灯按序列位置取偏移, 剔除灯不占位 (fx-3 在有效序列里是 idx 2)
  assert.equal(next[3].params.pan, 100 + 2 * 5);
});

test('对称模式: 关于锚点镜像的灯得到相同偏移', () => {
  const venue = makeVenue('v', 10, 10, false);
  const fixtures = makeFixtures(5, venue);
  const next = applyGroupParam(group(5, 'symmetric'), fixtures, 'fx-2', 'pan', 50);
  assert.equal(next[1].params.pan, next[3].params.pan);
  assert.equal(next[0].params.pan, next[4].params.pan);
});

test('效果生成器: 圆形/螺旋/渐变输出有界且渐变单调', () => {
  for (const shape of ['circle', 'spiral', 'gradient'] as const) {
    for (let i = 0; i < 12; i++) {
      const v = evaluateEffect({ id: 'e', label: 'e', shape, targetParam: 'pan', phase: 0, period: 4, direction: 1, amplitude: 30, offset: 0 }, i, 12, 0);
      assert.ok(Math.abs(v) <= 60);
    }
  }
  const grad = Array.from({ length: 8 }, (_, i) =>
    evaluateEffect({ id: 'e', label: 'e', shape: 'gradient', targetParam: 'dimmer', phase: 0, period: 4, direction: 1, amplitude: 0.5, offset: 0.5 }, i, 8, 0));
  for (let i = 1; i < grad.length; i++) assert.ok(grad[i] >= grad[i - 1]);
});

test('预设以引用存储: 改预设后 cue 重放自动跟随', () => {
  const venue = makeVenue('v', 8, 8, false);
  const fixtures = makeFixtures(4, venue);
  const preset = { id: 'ps', kind: 'color' as const, label: '红', values: { rgb: [1, 0, 0] as [number, number, number] } };
  const cue = {
    id: 'c', no: 1, label: 'c', overrides: {}, presetIds: ['ps'], effectIds: [],
    fadeSec: 0, holdSec: 0, remark: '', branchId: 'main', createdAt: 0,
  };
  let state = buildCueState(fixtures, cue, [preset], []);
  assert.deepEqual(state.get('fx-0')!.rgb, [1, 0, 0]);
  preset.values = { rgb: [0, 0, 1] };
  state = buildCueState(fixtures, cue, [preset], []);
  assert.deepEqual(state.get('fx-0')!.rgb, [0, 0, 1]);
});

test('分支: fork 出的 cue 与主线隔离, 改分支不动主线', () => {
  const cues = [{
    id: 'c1', no: 1, label: 'a', overrides: { x: { dimmer: 0.5 } }, presetIds: [], effectIds: [],
    fadeSec: 0, holdSec: 0, remark: '', branchId: 'main', createdAt: 0,
  }];
  const forked = forkBranch(cues, 'main', 'exp');
  assert.equal(forked[0].branchId, 'exp');
  forked[0].overrides.x.dimmer = 1;
  assert.equal(cues[0].overrides.x.dimmer, 0.5);
});

test('库存: 同序列号双项目占用报冲突; 出库/核销闭环', () => {
  const inventory = [
    { id: 'i1', modelId: 'beam', serialNo: 'SN-1', status: 'idle' as const },
    { id: 'i2', modelId: 'beam', serialNo: 'SN-2', status: 'idle' as const },
  ];
  const conflicts0 = findBookingConflicts(inventory);
  assert.equal(conflicts0.length, 0);
  inventory[0].projectId = 'P1';
  // 第二份同序列号记录是另一项目的占用台账 (状态 out, 不进空闲池, 不影响后续出库)
  inventory.push({ id: 'i3', modelId: 'beam', serialNo: 'SN-1', status: 'out' as const, projectId: 'P2' });
  const conflicts = findBookingConflicts(inventory);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].projectIds.sort(), ['P1', 'P2']);

  const venue = makeVenue('v', 6, 6, false);
  const project = { id: 'P1', fixtures: makeFixtures(2, venue) } as Project;
  // 出库只分配空闲(idle 且无项目)的台账, SN-1 的两条记录都不可用, 用 SN-2 + 追加一台空闲
  inventory.push({ id: 'i4', modelId: 'beam', serialNo: 'SN-3', status: 'idle' as const });
  const r = checkout(project, inventory);
  assert.equal(Object.keys(r.assignments).length, 2);
  const back = checkIn(r.inventory, Object.values(r.assignments));
  // 仅核销本项目出库的灯
  const projectOut = back.inventory.filter(i => i.status === 'out' && i.projectId === 'P1');
  assert.equal(projectOut.length, 0);
  assert.ok(back.inventory.filter(i => i.status === 'idle').length >= 2);
});

test('照度网格: 有灯区域 lux > 0, 均匀度在 [0,1]', () => {
  const venue = makeVenue('v', 8, 8, false);
  const fixtures = makeFixtures(8, venue).map(f => ({ ...f, params: { ...defaultParams(), dimmer: 1, tilt: 90 } }));
  const grid = computeLuxGrid(fixtures, makeLampModels(), { origin: [0, 0, 0], size: [40, 30, 0], nx: 12, ny: 10, height: 0.1 });
  assert.ok(grid.average > 0);
  assert.ok(grid.uniformity >= 0 && grid.uniformity <= 1.0001);
  assert.ok(grid.keyAreaAverage > 0);
});

test('PWM: 直流调光(pwmHz=0)无条纹; 不同步 PWM 不同扫描行亮度不同', () => {
  assert.equal(pwmBandFactor(0, 0.7, 0, 0.1, 50, 0.01), 0.7);
  const bands = [0, 0.25, 0.5, 0.75].map(lf => pwmBandFactor(1200, 0.7, 0, lf / 50, 50, 0.01));
  assert.ok(new Set(bands).size > 1, '不同扫描行应出现亮度差(滚动条纹)');
});

test('肤色: 高 CRI 比低 CRI 更接近基准肤色', () => {
  const base: [number, number, number] = [0.72, 0.48, 0.36];
  const high = skinToneUnderLight(base, 5600, 95);
  const low = skinToneUnderLight(base, 5600, 60);
  const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  assert.ok(dist(high, base) < dist(low, base));
});

test('摄像机曝光: 照度升高出现过曝裁切', () => {
  const dark = cameraExposure(50, 800, 1 / 100, 2.8);
  const bright = cameraExposure(50000, 800, 1 / 100, 2.8);
  assert.ok(bright > dark);
  assert.ok(bright <= 1.18);
});

test('报价: 租赁按天数乘单价, 税金合计正确', () => {
  const project = {
    quoteLines: [
      { kind: 'rental' as const, name: '灯', unit: '台', qty: 10, unitPrice: 200, days: 7 },
      { kind: 'labor' as const, name: '工日', unit: '工日', qty: 5, unitPrice: 400, days: 1 },
    ],
  } as Project;
  const q = buildQuote(project, 0.09);
  assert.equal(q.subtotal, 10 * 200 * 7 + 5 * 400);
  assert.equal(q.total, q.subtotal * 1.09);
});

test('评论打包往返: 已解决意见不被外部旧副本覆盖, 新意见带批次', () => {
  const existing: ReviewComment[] = [
    { id: 'c1', position: [0, 0, 0], text: 'a', author: 'x', status: 'resolved', createdAt: 0 },
  ];
  const bundle = exportCommentBundle('P', [
    { id: 'c1', position: [0, 0, 0], text: 'a-old', author: 'x', status: 'open', createdAt: 0 },
    { id: 'c2', position: [1, 0, 0], text: 'b', author: 'client', status: 'open', createdAt: 1 },
  ]);
  const r = mergeCommentBundle(existing, bundle);
  assert.equal(r.added, 1);
  assert.equal(r.skipped, 1);
  assert.equal(r.comments.find(c => c.id === 'c1')!.status, 'resolved');
  assert.ok(r.comments.find(c => c.id === 'c2')!.importBatch);
});
