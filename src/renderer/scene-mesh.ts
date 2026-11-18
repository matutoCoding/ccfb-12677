// 把领域对象（场馆、挂点、桁架、灯具）构建成渲染器可吃的 MeshData
import type { Project, Vec3, Venue } from '../types';
import { lineMesh, pointMesh, type MeshData } from './webgl-renderer';

export interface SceneBuildOptions {
  clipPlane?: { normal: Vec3; distance: number } | null;
  highlightFixtureIds?: Set<string>;
  darkFixtureIds?: Set<string>;
}

export function buildSceneMeshes(
  project: Project,
  venue: Venue | undefined,
  opts: SceneBuildOptions = {},
): MeshData[] {
  const meshes: MeshData[] = [];
  const clip = opts.clipPlane;
  const keep = (p: Vec3): boolean =>
    !clip || p.x * clip.normal.x + p.y * clip.normal.y + p.z * clip.normal.z <= clip.distance;

  // 场馆外框与柱网
  if (venue) {
    const env = venue.envelope;
    const c: [number, number, number] = [0.45, 0.55, 0.7];
    const corners: Vec3[] = [
      { x: 0, y: 0, z: 0 },
      { x: env.width, y: 0, z: 0 },
      { x: env.width, y: env.depth, z: 0 },
      { x: 0, y: env.depth, z: 0 },
      { x: 0, y: 0, z: env.height },
      { x: env.width, y: 0, z: env.height },
      { x: env.width, y: env.depth, z: env.height },
      { x: 0, y: env.depth, z: env.height },
    ];
    const edges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7],
    ];
    meshes.push(
      lineMesh(edges.filter(([a, b]) => keep(corners[a]) && keep(corners[b])).map(([a, b]) => ({ a: corners[a], b: corners[b], color: c }))),
    );
    // 柱子
    const colLines = venue.columns
      .filter((col) => keep(col.position))
      .map((col) => ({
        a: col.position,
        b: { ...col.position, z: col.heightMm },
        color: [0.55, 0.5, 0.45] as [number, number, number],
      }));
    if (colLines.length) meshes.push(lineMesh(colLines));
  }

  // 挂点（蓝色小球点）
  const hangPoints =
    venue?.hangPoints.filter((hp) => keep(hp.position)).map((hp, i) => ({
      p: hp.position,
      color: hp.matchState?.kind === 'incompatible'
        ? ([1, 0.3, 0.2] as [number, number, number])
        : hp.matchState?.kind === 'matched'
          ? ([0.3, 0.9, 0.5] as [number, number, number])
          : ([0.45, 0.65, 1] as [number, number, number]),
      id: i + 1,
    })) ?? [];
  if (hangPoints.length) meshes.push(pointMesh(hangPoints));

  // 桁架（橙色线 + 截面示意）
  const trussLines = project.truss
    .filter((t) => keep(t.from) && keep(t.to))
    .flatMap((t) => {
      const color: [number, number, number] = [1, 0.72, 0.42];
      const s = t.sectionMm / 2;
      const off: Vec3[] = [
        { x: s, y: s, z: 0 }, { x: -s, y: s, z: 0 }, { x: -s, y: -s, z: 0 }, { x: s, y: -s, z: 0 },
      ];
      const pa = off.map((o) => ({ x: t.from.x + o.x, y: t.from.y + o.y, z: t.from.z + o.z }));
      const pb = off.map((o) => ({ x: t.to.x + o.x, y: t.to.y + o.y, z: t.to.z + o.z }));
      const lines = [0, 1, 2, 3].map((i) => ({ a: pa[i], b: pb[i], color }));
      lines.push({ a: pa[0], b: pa[2], color }, { a: pb[0], b: pb[2], color });
      return lines;
    });
  if (trussLines.length) meshes.push(lineMesh(trussLines));

  // 灯具（红=摇头，绿=常规，灰=断电失控，黄=高亮选中）
  const fxPoints = project.fixtures
    .filter((fx) => keep(fx.position))
    .map((fx, i) => {
      let color: [number, number, number] =
        fx.kind === 'moving-head' ? [1, 0.36, 0.45] : [0.36, 1, 0.69];
      if (opts.darkFixtureIds?.has(fx.id)) color = [0.4, 0.4, 0.42];
      if (opts.highlightFixtureIds?.has(fx.id)) color = [1, 0.9, 0.25];
      return { p: fx.position, color, id: i + 1 };
    });
  if (fxPoints.length) meshes.push(pointMesh(fxPoints));

  return meshes;
}
