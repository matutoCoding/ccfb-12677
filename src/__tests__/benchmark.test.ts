// ============================================================
// 硬指标基准（npm run bench）
// 1. 2000 挂点换馆比对 < 3s
// 2. 300 摇头灯运动包络干涉 < 10s
// 3. 断电模拟失灯清单与手工拓扑核对完全一致
// 4. MVR 往返灯位坐标零偏差
// ============================================================
import { describe, it, expect } from 'vitest';
import { makeBenchmarkState, makeProject, makeVenue } from '../store/sample-data';
import { compareVenues } from '../core/venue-compat';
import { checkMovingHeadCollisions } from '../core/collision';
import { simulateFailure, buildAdjacency } from '../core/network';
import { exportMvr, importMvr } from '../core/mvr';
import { rad } from '../core/math3d';

describe('性能与不变量硬指标', () => {
  const state = makeBenchmarkState();
  const project = Object.values(state.projects)[0]!;
  const venues = Object.values(state.venues);
  const sourceVenue = venues[0]!;
  const targetVenue = venues[1]!;

  it('指标1：2000 挂点换馆比对 3 秒内完成', () => {
    expect(sourceVenue.hangPoints.length).toBeGreaterThanOrEqual(2000);
    expect(targetVenue.hangPoints.length).toBeGreaterThanOrEqual(2000);
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const t0 = performance.now();
    const report = compareVenues(project.fixtures, defMap, project.truss, sourceVenue.hangPoints, targetVenue.hangPoints);
    const elapsed = performance.now() - t0;
    console.log(`[bench] 换馆比对: ${report.stats.total} 灯 × 2000 挂点 = ${elapsed.toFixed(0)}ms`);
    expect(elapsed).toBeLessThan(3000);
    expect(report.fixtureResults.length).toBe(project.fixtures.length);
  });

  it('指标2：300 台摇头灯运动包络干涉检查 10 秒内完成', () => {
    const mh = project.fixtures.filter((f) => f.kind === 'moving-head');
    expect(mh.length).toBeGreaterThanOrEqual(300);
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const t0 = performance.now();
    const report = checkMovingHeadCollisions(mh, defMap, project.truss, { stepRad: rad(3) });
    const elapsed = performance.now() - t0;
    const totalSamples = report.perFixture.reduce((s, r) => s + r.samplesScanned, 0);
    console.log(`[bench] 干涉检查: ${mh.length} 灯, ${totalSamples} 采样 = ${elapsed.toFixed(0)}ms, 碰撞灯 ${report.collidingFixtures}`);
    expect(elapsed).toBeLessThan(10000);
    expect(report.perFixture.length).toBe(mh.length);
  });

  it('指标3：断电模拟失灯清单与手工 BFS 拓扑核对完全一致', () => {
    const { network, fixtures } = project;
    const switches = network.nodes.filter((n) => n.type === 'switch' || n.type === 'node');
    const adj = buildAdjacency(network);
    const fixtureNode = new Map(
      network.nodes.filter((n) => n.type === 'fixture').map((n) => [n.fixtureId!, n.id]),
    );

    for (const failed of switches) {
      const result = simulateFailure(network, fixtures, failed.id);
      // 手工核对：从控台 BFS（独立实现一遍，不调用引擎的 reachableFromConsole）
      const reachable = new Set<string>();
      const consoleNode = network.nodes.find((n) => n.type === 'console')!;
      const queue = [consoleNode.id];
      reachable.add(consoleNode.id);
      while (queue.length) {
        const cur = queue.shift()!;
        for (const { link, other } of adj.get(cur)!.edges) {
          if (other === failed.id || link.fromNode === failed.id || link.toNode === failed.id) continue;
          if (!reachable.has(other)) {
            reachable.add(other);
            queue.push(other);
          }
        }
      }
      const manualDark = fixtures
        .map((f) => f.id)
        .filter((fid) => {
          const nodeId = fixtureNode.get(fid);
          return nodeId && !reachable.has(nodeId);
        })
        .sort();
      expect([...result.darkFixtureIds].sort()).toEqual(manualDark);
    }
    console.log(`[bench] 断电模拟: 核对 ${switches.length} 个节点，全部逐灯一致`);
  });

  it('指标4：MVR 导出再导入灯位坐标零偏差', () => {
    const t0 = performance.now();
    const bytes = exportMvr(project);
    const imported = importMvr(bytes, project.fixtures);
    const elapsed = performance.now() - t0;
    console.log(`[bench] MVR 往返: ${project.fixtures.length} 灯 = ${elapsed.toFixed(0)}ms, 最大偏差 ${imported.maxDeviationMm}mm`);
    expect(imported.maxDeviationMm).toBe(0);
    for (const c of imported.coordinateCheck) expect(c.deviationMm).toBe(0);
  });

  it('附加：换馆比对重复执行结果确定性一致', () => {
    const defMap = new Map(project.fixtureDefinitions.map((d) => [d.id, d]));
    const r1 = compareVenues(project.fixtures, defMap, project.truss, sourceVenue.hangPoints, targetVenue.hangPoints);
    const r2 = compareVenues(project.fixtures, defMap, project.truss, sourceVenue.hangPoints, targetVenue.hangPoints);
    // elapsedMs 是计时字段允许不同，其余结果必须逐字节一致
    const { stats: s1, ...data1 } = r1;
    const { stats: s2, ...data2 } = r2;
    expect(JSON.stringify(data1)).toBe(JSON.stringify(data2));
    expect(s1.total).toBe(s2.total);
    expect(s1.matched).toBe(s2.matched);
  });

  it('附加：小规模场景功能冒烟（示例数据可用）', () => {
    const v = makeVenue('小馆', '城', 50);
    const { project: p } = makeProject('小工程', v.id, 12, 4);
    expect(p.fixtures.length).toBe(16);
    expect(p.network.nodes.length).toBeGreaterThan(10);
  });
});
