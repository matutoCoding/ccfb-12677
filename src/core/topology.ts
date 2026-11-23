// Art-Net 信号拓扑: 断电模拟 / 超长网线 / 域-网口映射校验
// 断电模拟结果必须与拓扑手工核对完全一致 -> 纯确定性 BFS, 不依赖遍历顺序
import type { ArtNetTopology, ArtNetNode, ArtNetLink } from './types.ts';

export interface FailureResult {
  /** 断开的节点 id */
  failedNodeId: string;
  /** 与控台失去连通的节点 id (含故障节点本身) */
  isolatedNodeIds: string[];
  /** 失控灯具 id 及灯号 */
  darkFixtures: { fixtureId: string; nodeId: string }[];
  darkCount: number;
  /** 仍受控的灯具数 */
  aliveCount: number;
}

export interface LongCableWarning {
  linkId: string;
  length: number;
  from: string;
  to: string;
}

const buildAdjacency = (topo: ArtNetTopology): Map<string, string[]> => {
  const adj = new Map<string, string[]>();
  for (const n of topo.nodes) adj.set(n.id, []);
  for (const l of topo.links) {
    adj.get(l.fromNode)?.push(l.toNode);
    adj.get(l.toNode)?.push(l.fromNode);
  }
  return adj;
};

const findConsole = (topo: ArtNetTopology): ArtNetNode | undefined =>
  topo.nodes.find(n => n.kind === 'console') ?? topo.nodes[0];

/**
 * 模拟某节点失效: 从控台出发做 BFS, 不可达节点下挂的所有灯具全部失控变黑。
 * 对每个故障节点独立计算, 结果只由拓扑决定, 与节点/链路存储顺序无关。
 */
export function simulateNodeFailure(topo: ArtNetTopology, failedNodeId: string): FailureResult {
  const consoleNode = findConsole(topo);
  const adj = buildAdjacency(topo);
  const nodeById = new Map(topo.nodes.map(n => [n.id, n]));

  const reachable = new Set<string>();
  if (consoleNode && consoleNode.id !== failedNodeId) {
    const queue = [consoleNode.id];
    reachable.add(consoleNode.id);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const next of adj.get(cur) ?? []) {
        if (next === failedNodeId || reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
    }
  }

  const isolatedNodeIds: string[] = [];
  const darkFixtures: { fixtureId: string; nodeId: string }[] = [];
  let aliveCount = 0;
  for (const n of topo.nodes) {
    if (!reachable.has(n.id)) {
      isolatedNodeIds.push(n.id);
      for (const f of n.fixtureIds) darkFixtures.push({ fixtureId: f, nodeId: n.id });
    } else {
      aliveCount += n.fixtureIds.length;
    }
  }

  // 排序保证输出顺序稳定, 便于与手工清单逐行核对
  isolatedNodeIds.sort();
  darkFixtures.sort((a, b) =>
    (nodeById.get(a.nodeId)?.label ?? '').localeCompare(nodeById.get(b.nodeId)?.label ?? '') ||
    a.fixtureId.localeCompare(b.fixtureId));

  return {
    failedNodeId,
    isolatedNodeIds,
    darkFixtures,
    darkCount: darkFixtures.length,
    aliveCount,
  };
}

/** 批量模拟每个节点失效, 返回 fixtureId -> 会导致它失控的故障节点集合 */
export function allFailureMatrix(topo: ArtNetTopology): Record<string, string[]> {
  const matrix: Record<string, string[]> = {};
  for (const n of topo.nodes) {
    const r = simulateNodeFailure(topo, n.id);
    for (const d of r.darkFixtures) (matrix[d.fixtureId] ??= []).push(n.id);
  }
  for (const k of Object.keys(matrix)) matrix[k].sort();
  return matrix;
}

/** 超过 100m 的网线 (CAT5e/6 以太网极限), 逐条列出 */
export function findLongCables(topo: ArtNetTopology, limitM = 100): LongCableWarning[] {
  const labelOf = (id: string): string => topo.nodes.find(n => n.id === id)?.label ?? id;
  return topo.links
    .filter(l => l.cableLength > limitM)
    .map(l => ({ linkId: l.id, length: l.cableLength, from: labelOf(l.fromNode), to: labelOf(l.toNode) }))
    .sort((a, b) => b.length - a.length);
}

export interface PortMapIssue {
  nodeId: string;
  nodeLabel: string;
  message: string;
}

/** 域映射校验: 同一物理网口不可映射两个域; 同一域被多个节点声明时给出警告 */
export function validatePortMapping(topo: ArtNetTopology): PortMapIssue[] {
  const issues: PortMapIssue[] = [];
  const universeOwners = new Map<number, string[]>();
  for (const n of topo.nodes) {
    const seenPorts = new Set<string>();
    for (const pm of n.portMap) {
      if (seenPorts.has(pm.port)) {
        issues.push({ nodeId: n.id, nodeLabel: n.label, message: `网口 ${pm.port} 重复映射到多个域` });
      }
      seenPorts.add(pm.port);
      const owners = universeOwners.get(pm.universe) ?? [];
      owners.push(n.label);
      universeOwners.set(pm.universe, owners);
    }
  }
  for (const [u, owners] of universeOwners) {
    if (owners.length > 1) {
      issues.push({ nodeId: '', nodeLabel: owners.join(' / '), message: `Art-Net 域 ${u} 被多个节点同时声明` });
    }
  }
  return issues;
}

/** 校验拓扑连通性: 返回与控台不连通的节点 id */
export function findDisconnectedNodes(topo: ArtNetTopology): string[] {
  const consoleNode = findConsole(topo);
  if (!consoleNode) return topo.nodes.map(n => n.id).sort();
  const adj = buildAdjacency(topo);
  const seen = new Set<string>([consoleNode.id]);
  const queue = [consoleNode.id];
  while (queue.length) {
    const cur = queue.shift()!;
    for (const next of adj.get(cur) ?? []) {
      if (!seen.has(next)) { seen.add(next); queue.push(next); }
    }
  }
  return topo.nodes.filter(n => !seen.has(n.id)).map(n => n.id).sort();
}

export type { ArtNetLink };
