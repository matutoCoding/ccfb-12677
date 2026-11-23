// 硬指标 1: 换馆后 2000 挂点比对 3 秒内完成
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareVenueAdaptation } from '../src/core/venueAdapt.ts';
import { makeLampModels, makeVenue, makeFixtures } from './helpers.ts';

test('2000 挂点全量换馆比对 < 3000ms 且结果确定', () => {
  const models = makeLampModels();
  // 40x50 = 2000 挂点
  const source = makeVenue('a', 40, 50, false);
  const target = makeVenue('b', 40, 50, true);
  assert.equal(source.hangPoints.length, 2000);
  const fixtures = makeFixtures(500, source);

  const r1 = compareVenueAdaptation({ fixtures, models, sourceVenue: source, targetVenue: target, toleranceM: 1.0 });
  const r2 = compareVenueAdaptation({ fixtures, models, sourceVenue: source, targetVenue: target, toleranceM: 1.0 });

  assert.ok(r1.elapsedMs < 3000, `实际耗时 ${r1.elapsedMs}ms, 预算 3000ms`);
  assert.equal(r1.fixtureCount, 500);
  // 确定性: 两次结果完全一致
  assert.deepEqual(r1.issues.map(i => i.fixtureId), r2.issues.map(i => i.fixtureId));
  assert.deepEqual(r1.mapping, r2.mapping);
  // 偏移/减载馆: 同馆比对应全部可装 (超载点有邻近挂点兜底), 但映射必须完整
  assert.equal(r1.fixtureCount, 500);
  assert.equal(Object.keys(r1.mapping).length, 500);
  for (const iss of r1.issues) {
    assert.ok(iss.suggestions.length > 0, `${iss.fixtureLabel} 缺少替代挂点建议`);
  }
  console.log(`  → 挂点 2000 / 灯具 500: ${r1.elapsedMs.toFixed(1)}ms, 匹配 ${r1.matchedCount}, 装不上 ${r1.issues.length} 台`);
});

test('低承载馆: 挂点承重普遍不足时产生超载清单和替代建议', () => {
  const models = makeLampModels();
  const source = makeVenue('a', 40, 50, false);
  const target = makeVenue('b', 40, 50, true);
  // 目标馆所有挂点承重降到 5kg (灯重 20kg), 必然超载
  target.hangPoints.forEach(hp => { hp.loadKg = 5; });
  const fixtures = makeFixtures(300, source);
  const r = compareVenueAdaptation({ fixtures, models, sourceVenue: source, targetVenue: target, toleranceM: 1.0 });
  assert.ok(r.issues.length > 200, `应大量超载, 实际 ${r.issues.length}`);
  assert.ok(r.issues.every(i => i.reason === 'overload' || i.suggestions.length > 0));
});

test('完全相同的馆应 100% 匹配且零 issue', () => {
  const models = makeLampModels();
  const venue = makeVenue('a', 20, 20, false);
  const fixtures = makeFixtures(100, venue);
  const r = compareVenueAdaptation({ fixtures, models, sourceVenue: venue, targetVenue: venue, toleranceM: 0.5 });
  assert.equal(r.issues.length, 0);
  assert.equal(r.matchedCount, 100);
});
