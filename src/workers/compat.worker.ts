// 换馆比对 Worker：主线程 postMessage 传快照，避免冻结 UI
import { compareVenues, type CompatOptions, type VenueCompatReport } from '../core/venue-compat';
import type { FixtureDefinition, FixtureInstance, HangPoint, TrussSegment } from '../types';

export interface CompatRequest {
  fixtures: FixtureInstance[];
  definitions: FixtureDefinition[];
  truss: TrussSegment[];
  sourcePoints: HangPoint[];
  targetPoints: HangPoint[];
  options: CompatOptions;
}

self.onmessage = (ev: MessageEvent<CompatRequest>) => {
  const defMap = new Map(ev.data.definitions.map((d) => [d.id, d]));
  const report: VenueCompatReport = compareVenues(
    ev.data.fixtures,
    defMap,
    ev.data.truss,
    ev.data.sourcePoints,
    ev.data.targetPoints,
    ev.data.options,
  );
  (self as unknown as Worker).postMessage(report);
};
