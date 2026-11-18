// ============================================================
// Art-Net 信号网引擎
// - 走线路径 >100m 标记
// - 域(universe) -> 物理网口映射校验
// - 节点失效模拟：移除节点后从控台 BFS，不可达灯具确定性列清单
// 不变量：同一拓扑、同一失效节点，结果永远一致（与手工核对对齐）
// ============================================================
import type {
  FailureSimulationResult,
  FixtureInstance,
  ID,
  NetLink,
  NetNode,
  NetworkTopology,
} from '../types';

export const MAX_CABLE_MM = 100_000; // 100m

export interface TopologyIssue {
  kind: 'over-100m' | 'duplicate-universe-port' | 'orphan-node' | 'missing-console' | 'port-mismatch';
  nodeId?: ID;
  linkId?: ID;
  message: string;
}

/** 邻接表（无向图，边按 id 排序保证遍历确定性） */
export function buildAdjacency(topology: NetworkTopology): Map<ID, { node: NetNode; edges: { link: NetLink; other: ID }[] }> {
  const map = new Map<ID, { node: NetNode; edges: { link: NetLink; other: ID }[] }>();
  for (const n of topology.nodes) map.set(n.id, { node: n, edges: [] });
  for (const link of [...topology.links].sort((a, b) => a.id.localeCompare(b.id))) {
    const a = map.get(link.fromNode);
    const b = map.get(link.toNode);
    if (!a || !b) continue;
    a.edges.push({ link, other: link.toNode });
    b.edges.push({ link, other: link.fromNode });
  }
  for (const entry of map.values()) entry.edges.sort((x, y) => x.other.localeCompare(y.other));
  return map;
}

export function lintTopology(topology: NetworkTopology): TopologyIssue[] {
  const issues: TopologyIssue[] = [];
  const adj = buildAdjacency(topology);

  if (!topology.nodes.some((n) => n.type === 'console')) {
    issues.push({ kind: 'missing-console', message: '拓扑中没有控台节点' });
  }
  for (const link of topology.links) {
    if (link.lengthMm > MAX_CABLE_MM) {
      issues.push({
        kind: 'over-100m',
        linkId: link.id,
        message: `网线 ${link.fromNode}:${link.fromPort} → ${link.toNode}:${link.toPort} 长度 ${(link.lengthMm / 1000).toFixed(1)}m，超过 100m`,
      });
    }
    // 网口存在性
    const fn = topology.nodes.find((n) => n.id === link.fromNode);
    const tn = topology.nodes.find((n) => n.id === link.toNode);
    if (fn && !fn.ports.some((p) => p.name === link.fromPort)) {
      issues.push({ kind: 'port-mismatch', nodeId: fn.id, linkId: link.id, message: `${fn.label} 不存在网口 ${link.fromPort}` });
    }
    if (tn && !tn.ports.some((p) => p.name === link.toPort)) {
      issues.push({ kind: 'port-mismatch', nodeId: tn.id, linkId: link.id, message: `${tn.label} 不存在网口 ${link.toPort}` });
    }
  }

  // 域映射：同一 universe 映射到两个不同物理网口即冲突
  const seen = new Map<string, ID>();
  for (const n of topology.nodes) {
    for (const m of n.universePortMap ?? []) {
      const k = `u${m.universe}`;
      const prev = seen.get(k);
      if (prev && prev !== n.id) {
        issues.push({
          kind: 'duplicate-universe-port',
          nodeId: n.id,
          message: `Universe ${m.universe} 同时映射到多个节点网口`,
        });
      }
      seen.set(k, n.id);
    }
  }

  // 孤立节点（控台除外）
  for (const [id, entry] of adj) {
    if (entry.node.type !== 'console' && entry.edges.length === 0) {
      issues.push({ kind: 'orphan-node', nodeId: id, message: `节点 ${entry.node.label} 没有任何连线` });
    }
  }
  return issues;
}

/** 从控台出发的可达节点集合（BFS，确定性顺序） */
export function reachableFromConsole(
  topology: NetworkTopology,
  removedNodeIds: Set<ID> = new Set(),
  removedLinkIds: Set<ID> = new Set(),
): Set<ID> {
  const console_ = topology.nodes.find((n) => n.type === 'console' && !removedNodeIds.has(n.id));
  const reachable = new Set<ID>();
  if (!console_) return reachable;
  const adj = buildAdjacency(topology);
  const queue: ID[] = [console_.id];
  reachable.add(console_.id);
  while (queue.length) {
    const cur = queue.shift()!;
    const entry = adj.get(cur);
    if (!entry) continue;
    for (const { link, other } of entry.edges) {
      if (removedNodeIds.has(other) || removedLinkIds.has(link.id)) continue;
      if (!reachable.has(other)) {
        reachable.add(other);
        queue.push(other);
      }
    }
  }
  return reachable;
}

/**
 * 断电/断节点模拟
 * @param failedNodeId 失效节点（交换机或 Art-Net 节点）
 * @returns 失控变黑灯具清单（按 fixtureId 排序），及断开的链路、丢失域
 */
export function simulateFailure(
  topology: NetworkTopology,
  fixtures: FixtureInstance[],
  failedNodeId: ID,
): FailureSimulationResult {
  const failed = topology.nodes.find((n) => n.id === failedNodeId);
  if (!failed) throw new Error(`节点不存在: ${failedNodeId}`);

  const removedNodes = new Set<ID>([failedNodeId]);
  const cutLinks = topology.links
    .filter((l) => l.fromNode === failedNodeId || l.toNode === failedNodeId)
    .sort((a, b) => a.id.localeCompare(b.id));
  const removedLinks = new Set(cutLinks.map((l) => l.id));

  const reachable = reachableFromConsole(topology, removedNodes, removedLinks);

  // 灯具 -> 所属节点（fixture 类型节点或经 node 挂接）
  const fixtureNode = new Map<ID, ID>();
  for (const n of topology.nodes) {
    if (n.type === 'fixture' && n.fixtureId) fixtureNode.set(n.fixtureId, n.id);
  }

  const darkFixtureIds = fixtures
    .map((f) => f.id)
    .filter((fid) => {
      const nodeId = fixtureNode.get(fid);
      if (!nodeId) return false;
      return !reachable.has(nodeId);
    })
    .sort((a, b) => a.localeCompare(b));

  // 丢失的 universe：不可达节点上声明过的域
  const universesLost = [
    ...new Set(
      topology.nodes
        .filter((n) => !reachable.has(n.id))
        .flatMap((n) => (n.universePortMap ?? []).map((m) => m.universe)),
    ),
  ].sort((a, b) => a - b);

  return {
    failedNodeId,
    darkFixtureIds,
    cutLinkIds: cutLinks.map((l) => l.id),
    universesLost,
  };
}

/** 全量 N-1 扫描：每个节点失效各模拟一次（评审/容灾报告用） */
export function simulateAllSingleFailures(
  topology: NetworkTopology,
  fixtures: FixtureInstance[],
): FailureSimulationResult[] {
  return topology.nodes
    .filter((n) => n.type !== 'console')
    .map((n) => simulateFailure(topology, fixtures, n.id));
}
