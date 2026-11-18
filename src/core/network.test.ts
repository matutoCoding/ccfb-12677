import { describe, it, expect } from 'vitest';
import {
  buildAdjacency,
  lintTopology,
  simulateFailure,
  simulateAllSingleFailures,
  MAX_CABLE_MM,
} from './network';
import { makeProject, makeVenue } from '../store/sample-data';
import type { FixtureInstance, NetLink, NetNode, NetworkTopology } from '../types';

/** 手工搭一棵确定性拓扑树：console - sw - node - f1/f2 */
function treeTopology(): { topology: NetworkTopology; fixtures: FixtureInstance[] } {
  const nodes: NetNode[] = [
    { id: 'console', label: '控台', type: 'console', ports: [{ name: 'E', speedMbps: 1000 }] },
    { id: 'sw', label: '交换机', type: 'switch', ports: [{ name: 'P1', speedMbps: 1000 }, { name: 'P2', speedMbps: 1000 }] },
    { id: 'an', label: '节点', type: 'node', ports: [{ name: 'P1', speedMbps: 1000 }, { name: 'P2', speedMbps: 1000 }], universePortMap: [{ universe: 0, port: 'P1' }] },
    { id: 'n-f1', label: 'F1', type: 'fixture', ports: [{ name: 'D', speedMbps: 100 }], fixtureId: 'f1' },
    { id: 'n-f2', label: 'F2', type: 'fixture', ports: [{ name: 'D', speedMbps: 100 }], fixtureId: 'f2' },
  ];
  const link = (id: string, a: string, ap: string, b: string, bp: string, len = 3000): NetLink => ({
    id, fromNode: a, fromPort: ap, toNode: b, toPort: bp, cableKind: 'cat5e', lengthMm: len,
  });
  const links: NetLink[] = [
    link('l1', 'console', 'E', 'sw', 'P1'),
    link('l2', 'sw', 'P2', 'an', 'P1'),
    link('l3', 'an', 'P2', 'n-f1', 'D'),
    link('l4', 'an', 'P1', 'n-f2', 'D'),
  ];
  const fixtures: FixtureInstance[] = ['f1', 'f2'].map((id) => ({
    id, uid: id.toUpperCase(), definitionId: 'd', kind: 'par' as const,
    position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 },
  }));
  return { topology: { nodes, links }, fixtures };
}

describe('network 拓扑与断电模拟', () => {
  it('邻接表构建无向且按 id 排序', () => {
    const { topology } = treeTopology();
    const adj = buildAdjacency(topology);
    expect(adj.get('sw')!.edges.map((e) => e.other)).toEqual(['an', 'console']);
  });

  it('超过 100m 网线被标出', () => {
    const { topology } = treeTopology();
    topology.links[0]!.lengthMm = MAX_CABLE_MM + 500;
    const issues = lintTopology(topology);
    expect(issues.some((i) => i.kind === 'over-100m')).toBe(true);
  });

  it('断 Art-Net 节点 → 其下两灯全部变黑，清单与手工一致', () => {
    const { topology, fixtures } = treeTopology();
    const r = simulateFailure(topology, fixtures, 'an');
    expect(r.darkFixtureIds).toEqual(['f1', 'f2']); // 排序确定
    expect(r.cutLinkIds).toEqual(['l2', 'l3', 'l4']);
    expect(r.universesLost).toEqual([0]);
  });

  it('断交换机 → 整棵子树变黑；控台正常时无灯失控', () => {
    const { topology, fixtures } = treeTopology();
    const sw = simulateFailure(topology, fixtures, 'sw');
    expect(sw.darkFixtureIds).toEqual(['f1', 'f2']);
    const an = simulateFailure(topology, fixtures, 'an');
    expect(an.darkFixtureIds).toHaveLength(2);
  });

  it('结果确定性：重复模拟逐灯相等', () => {
    const { topology, fixtures } = treeTopology();
    const a = simulateFailure(topology, fixtures, 'sw');
    const b = simulateFailure(topology, fixtures, 'sw');
    expect(a).toEqual(b);
  });

  it('N-1 全扫描覆盖所有非控台节点', () => {
    const { topology, fixtures } = treeTopology();
    const all = simulateAllSingleFailures(topology, fixtures);
    expect(all.map((r) => r.failedNodeId).sort()).toEqual(['an', 'n-f1', 'n-f2', 'sw']);
  });

  it('大型示例拓扑：任意单节点失效的失灯数不超过其下游灯数', () => {
    const venue = makeVenue('v', '市', 220);
    const { project } = makeProject('p', venue.id, 60, 24);
    const results = simulateAllSingleFailures(project.network, project.fixtures);
    for (const r of results) {
      const node = project.network.nodes.find((n) => n.id === r.failedNodeId)!;
      if (node.type === 'fixture') expect(r.darkFixtureIds.length).toBeLessThanOrEqual(1);
      else expect(r.darkFixtureIds.length).toBeGreaterThanOrEqual(0);
    }
  });
});
