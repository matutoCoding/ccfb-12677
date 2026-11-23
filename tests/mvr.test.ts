// 硬指标 4: MVR 包回导灯位坐标零偏差
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exportMVR, importMVR, verifyRoundtrip } from '../src/core/mvr.ts';
import { unzipSync, zipSync, strToU8, strFromU8 } from 'fflate';
import { makeLampModels, makeVenue, makeFixtures } from './helpers.ts';
import type { Project } from '../src/core/types.ts';
import { defaultParams } from '../src/core/types.ts';

function demoProject(): Project {
  const venue = makeVenue('v', 20, 10, false);
  const fixtures = makeFixtures(120, venue);
  // 加入不规则小数坐标, 验证精度不被序列化吃掉
  fixtures.forEach((f, i) => {
    f.position = [
      f.position[0] + (i % 7) * 0.123456,
      f.position[1] + (i % 5) * 0.234567,
      f.position[2] - (i % 3) * 0.017777,
    ];
  });
  return {
    id: 'p1', name: 'roundtrip', venueId: 'v', createdAt: 0, updatedAt: 0,
    activeBranchId: 'main', branches: [{ id: 'main', label: 'main', createdAt: 0, note: '' }],
    fixtures, trusses: [{ id: 't1', label: 'TR1', from: [0, 0, 14], to: [50, 0, 14], section: 0.4, loadKg: 500 }],
    topology: { nodes: [], links: [] }, presets: [], groups: [], effects: [], cues: [], macros: [],
    comments: [], cables: [], rigTasks: [], quoteLines: [], triggerLog: [],
    cameraShutterSec: 0.01, cameraFrameRate: 50,
    luxGrid: { origin: [0, 0, 0], size: [50, 30, 0], nx: 10, ny: 10, height: 0.1 },
    blindBuffer: null,
  };
}

test('MVR 导出→回导: 灯位坐标最大偏差恒为 0', () => {
  const models = makeLampModels();
  const project = demoProject();
  const bytes = exportMVR(project, models);
  assert.ok(bytes.length > 1000);
  const imported = importMVR(bytes);
  assert.equal(imported.usedExactTable, true);
  assert.equal(imported.fixtures.length, project.fixtures.length);
  const verify = verifyRoundtrip(project.fixtures, imported);
  assert.equal(verify.maxDeviation, 0, `出现偏差: ${verify.maxDeviation}`);
  // 逐灯核对
  for (const fx of project.fixtures) assert.equal(verify.perFixture[fx.id], 0);
  console.log(`  → ${project.fixtures.length} 灯往返, 最大偏差 ${verify.maxDeviation} m, 包体 ${(bytes.length / 1024).toFixed(1)}KB`);
});

test('MVR 包内含 GDTF 描述与标准 XML', () => {
  const models = makeLampModels();
  const bytes = exportMVR(demoProject(), models);
  const arc = unzipSync(bytes);
  assert.ok(arc['GeneralSceneDescription.xml']);
  assert.ok(arc['tld_exact_xyz.json']);
  const gdtfEntries = Object.keys(arc).filter(k => k.endsWith('.gdtf'));
  assert.ok(gdtfEntries.length >= 1);
  const xml = strFromU8(arc['GeneralSceneDescription.xml']);
  assert.match(xml, /<Fixture /);
});

test('标准 XML 缺精确表时回退解析并给出警告', () => {
  const xml = `<?xml version="1.0"?><GeneralSceneDescription verMajor="1" verMinor="6"><Scene>
    <Fixture name="X1" uuid="u1"><GDTFSpec>Beam.gdtf</GDTFSpec>
    <Address type="Absolute" universe="2" address="11" />
    <Matrix>12.5 0 0 0 7.25 0 0 0 14 0 0 0 1</Matrix></Fixture></Scene></GeneralSceneDescription>`;
  const bytes = zipSync({ 'GeneralSceneDescription.xml': strToU8(xml) });
  const r = importMVR(bytes);
  assert.equal(r.usedExactTable, false);
  assert.equal(r.fixtures[0].position[0], 12.5);
  assert.equal(r.fixtures[0].universe, 2);
  assert.ok(r.warnings.length > 0);
});

void defaultParams;
