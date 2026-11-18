// 运动包络干涉 Worker
import { checkMovingHeadCollisions, type CollisionOptions, type CollisionReport } from '../core/collision';
import type { FixtureDefinition, FixtureInstance, TrussSegment } from '../types';

export interface CollisionRequest {
  fixtures: FixtureInstance[];
  definitions: FixtureDefinition[];
  truss: TrussSegment[];
  options: CollisionOptions;
}

self.onmessage = (ev: MessageEvent<CollisionRequest>) => {
  const defMap = new Map(ev.data.definitions.map((d) => [d.id, d]));
  const report: CollisionReport = checkMovingHeadCollisions(
    ev.data.fixtures,
    defMap,
    ev.data.truss,
    ev.data.options,
  );
  (self as unknown as Worker).postMessage(report);
};
