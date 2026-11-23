// 硬指标 3: 300 台摇头灯运动包络干涉检查一轮 < 10s
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkEnvelopeCollisions } from '../src/core/collision.ts';
import { makeLampModels, makeFixtures } from './helpers.ts';
import type { Project, Truss } from '../src/core/types.ts';
import { defaultParams } from '../src/core/types.ts';
import { makeVenue } from './helpers.ts';

test('300 台摇头灯全量干涉检查 < 10000ms 且能发现已知碰撞', () => {
  const models = makeLampModels();
  const venue = makeVenue('v', 30, 10, false);
  const fixtures = makeFixtures(300, venue);
  // 每台灯都给整周转动能力 (model 默认 panRange 270)
  const trusses: Truss[] = [
    // 故意在第一排灯头扫掠区域放一根低空桁架, 制造必然碰撞
    { id: 'tr-low', label: '低空桁架', from: [0, 0.5, 13.2], to: [60, 0.5, 13.2], section: 0.4, loadKg: 500 },
    { id: 'tr-top', label: '主桁架', from: [0, 0, 14], to: [60, 0, 14], section: 0.4, loadKg: 800 },
  ];

  const report = checkEnvelopeCollisions({ fixtures, models, trusses, panStep: 10, tiltStep: 10 });
  assert.equal(report.movingHeadCount, 300);
  assert.ok(report.elapsedMs < 10000, `实际耗时 ${report.elapsedMs}ms, 预算 10000ms`);
  assert.ok(report.collisions.length > 0, '应检测到低空桁架碰撞');
  // 每条碰撞必须给出角度区间
  for (const c of report.collisions) {
    assert.ok(c.intervals.length > 0);
    for (const iv of c.intervals) {
      assert.ok(iv.panFrom <= iv.panTo && iv.tiltFrom <= iv.tiltTo);
    }
  }
  const trussHits = report.collisions.filter(c => c.target.startsWith('truss:tr-low'));
  assert.ok(trussHits.length > 0, '低空桁架必须产生碰撞记录');
  console.log(`  → 300 摇头灯: ${report.elapsedMs.toFixed(1)}ms, 采样 ${report.sampleCount} 姿态, ${report.collisions.length} 组碰撞`);
});

test('无障碍物场景: 灯距足够大时碰撞数为 0', () => {
  const models = makeLampModels();
  const venue = makeVenue('v', 10, 10, false);
  const sparse = makeFixtures(20, venue).map((f, i) => ({ ...f, position: [i * 4, 20, 14] as [number, number, number], params: { ...defaultParams() } }));
  const report = checkEnvelopeCollisions({ fixtures: sparse, models, trusses: [] });
  assert.equal(report.collisions.length, 0);
});

void (null as unknown as Project);
