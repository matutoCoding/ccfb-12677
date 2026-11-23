// 硬指标 2: 断电模拟失灯清单与手工拓扑核对完全一致
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { simulateNodeFailure, allFailureMatrix, findLongCables, findDisconnectedNodes } from '../src/core/topology.ts';
import type { ArtNetTopology } from '../src/core/types.ts';

/**
 * 手工拓扑:
 * console -- swA -- n1 -- n2 (链式, n2 下挂 3 灯)
 *                \- n3 (2 灯)
 *         \- swB -- n4 (4 灯), 链路 115m 故意超长
 * 断 swA: 隔离 swA,n1,n2,n3; 失灯 = 3+2 = 5; swB/n4 仍受控
 */
function topo(): ArtNetTopology {
  return {
    nodes: [
      { id: 'console', label: '控台', kind: 'console', position: [0, 0, 0], fixtureIds: [], portMap: [] },
      { id: 'swA', label: '交换A', kind: 'switch', position: [1, 0, 0], fixtureIds: [], portMap: [] },
      { id: 'swB', label: '交换B', kind: 'switch', position: [-1, 0, 0], fixtureIds: [], portMap: [] },
      { id: 'n1', label: '节点1', kind: 'node', position: [2, 0, 0], fixtureIds: ['f1', 'f2'], portMap: [{ port: 'e1', universe: 0 }] },
      { id: 'n2', label: '节点2', kind: 'node', position: [3, 0, 0], fixtureIds: ['f3', 'f4', 'f5'], portMap: [{ port: 'e1', universe: 1 }] },
      { id: 'n3', label: '节点3', kind: 'node', position: [2, 1, 0], fixtureIds: ['f6', 'f7'], portMap: [{ port: 'e1', universe: 2 }] },
      { id: 'n4', label: '节点4', kind: 'node', position: [-2, 0, 0], fixtureIds: ['f8', 'f9', 'f10', 'f11'], portMap: [{ port: 'e1', universe: 3 }] },
    ],
    links: [
      { id: 'l0', fromNode: 'console', toNode: 'swA', cableLength: 10, cableType: 'Cat6' },
      { id: 'l1', fromNode: 'console', toNode: 'swB', cableLength: 115, cableType: 'Cat6' },
      { id: 'l2', fromNode: 'swA', toNode: 'n1', cableLength: 30, cableType: 'Cat5e' },
      { id: 'l3', fromNode: 'n1', toNode: 'n2', cableLength: 40, cableType: 'Cat5e' },
      { id: 'l4', fromNode: 'swA', toNode: 'n3', cableLength: 50, cableType: 'Cat5e' },
      { id: 'l5', fromNode: 'swB', toNode: 'n4', cableLength: 60, cableType: 'Cat5e' },
    ],
  };
}

test('断 swA 的失灯清单与手工核对一致', () => {
  const r = simulateNodeFailure(topo(), 'swA');
  assert.deepEqual(r.isolatedNodeIds, ['n1', 'n2', 'n3', 'swA']);
  assert.deepEqual(r.darkFixtures.map(d => d.fixtureId), ['f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7']);
  assert.equal(r.darkCount, 5 + 2);
  assert.equal(r.aliveCount, 4);
});

test('断链路中间节点 n1: 下游 n2 同时失控', () => {
  const r = simulateNodeFailure(topo(), 'n1');
  assert.deepEqual(r.isolatedNodeIds.sort(), ['n1', 'n2']);
  assert.equal(r.darkCount, 2 + 3);
});

test('断控台: 所有灯具全部失控', () => {
  const r = simulateNodeFailure(topo(), 'console');
  assert.equal(r.darkCount, 11);
  assert.equal(r.aliveCount, 0);
});

test('断末端节点 n4: 只影响自身 4 灯', () => {
  const r = simulateNodeFailure(topo(), 'n4');
  assert.deepEqual(r.isolatedNodeIds, ['n4']);
  assert.equal(r.darkCount, 4);
});

test('结果与节点/链路存储顺序无关 (打乱后重算一致)', () => {
  const shuffled = topo();
  shuffled.nodes = [...shuffled.nodes].reverse();
  shuffled.links = [...shuffled.links].reverse();
  const a = simulateNodeFailure(topo(), 'swA');
  const b = simulateNodeFailure(shuffled, 'swA');
  assert.deepEqual(a.darkFixtures.map(d => d.fixtureId), b.darkFixtures.map(d => d.fixtureId));
});

test('超 100m 网线被标出', () => {
  const long = findLongCables(topo());
  assert.equal(long.length, 1);
  assert.equal(long[0].length, 115);
});

test('全故障矩阵: f5 的所有单点故障来源', () => {
  const matrix = allFailureMatrix(topo());
  // f5 在 n2 下, 能让它失控的节点故障: console/swA/n1/n2
  assert.deepEqual(matrix['f5'].sort(), ['console', 'n1', 'n2', 'swA']);
});

test('离线节点检测: 断开 n3 链路后 n3 不可达', () => {
  const t = topo();
  t.links = t.links.filter(l => l.id !== 'l4');
  assert.deepEqual(findDisconnectedNodes(t), ['n3']);
});
