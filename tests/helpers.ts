// 压测数据工厂 (Node 侧无 DOM, 不引用 sampleData 里的 uid)
import type { AppState, Fixture, LampModel, Venue } from '../src/core/types.ts';
import { defaultParams } from '../src/core/types.ts';

export function makeLampModels(): LampModel[] {
  return [
    {
      id: 'beam', manufacturer: 'T', name: 'Beam', kind: 'moving-head-beam',
      weightKg: 20, powerW: 480, lumen: 12000, cct: 7200, cri: 75, pwmHz: 1200,
      beamAngleDeg: 8, bodyHalfLength: 0.32, bodyHalfWidth: 0.16, panRange: 270, tiltRange: 135, dmxChannels: 16,
    },
  ];
}

export function makeVenue(id: string, cols: number, rows: number, shifted: boolean): Venue {
  const hangPoints = [];
  const sx = 60 / cols, sy = 40 / rows;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    hangPoints.push({
      id: `${id}-${i}-${j}`,
      label: `${i}-${j}`,
      position: [
        i * sx + (shifted ? ((i * 37 + j * 13) % 10) / 10 : 0),
        j * sy + (shifted ? ((i * 19 + j * 23) % 10) / 10 : 0),
        14 - (shifted && i % 9 === 0 ? 2 : 0),
      ],
      loadKg: shifted && (i + j) % 13 === 0 ? 10 : 100,
      kind: 'motor' as const,
    });
  }
  return {
    id, name: id, city: 'X', origin: [0, 0, 0], size: [60, 40, 18], height: 18,
    stageCenter: [30, 10, 0], hangPoints, obstacles: [], powerPorts: [],
    attachments: [], surveyNotes: '', revisedAt: 0, createdAt: 0,
  };
}

export function makeFixtures(n: number, venue: Venue): Fixture[] {
  const out: Fixture[] = [];
  const cols = Math.round(Math.sqrt(n * 1.5));
  for (let k = 0; k < n; k++) {
    const i = k % cols, j = Math.floor(k / cols);
    const hp = venue.hangPoints[Math.min(venue.hangPoints.length - 1, j * cols + i)];
    out.push({
      id: `fx-${k}`, label: `L${String(k + 1).padStart(4, '0')}`, modelId: 'beam',
      position: hp ? [...hp.position] as Fixture['position'] : [i, j, 14],
      rotation: [0, 0, 0], hangPointId: hp?.id,
      universe: 0, dmxStart: 1, params: { ...defaultParams() },
    });
  }
  return out;
}

export function emptyState(models: LampModel[]): AppState {
  return { venues: [], projects: [], inventory: [], lampModels: models };
}
