// 演示/压测数据: 两个场馆、2000+ 挂点、300 摇头灯、Art-Net 拓扑、桁架
import type { AppState, Project, Venue, LampModel, Fixture, Truss, ArtNetTopology, HangPoint, ArtNetNode } from './types.ts';
import { defaultParams } from './types.ts';
import { uid } from './util.ts';

const lampModels: LampModel[] = [
  {
    id: 'mdl-beam380', manufacturer: 'DemoLight', name: 'Beam 380', kind: 'moving-head-beam',
    weightKg: 18, powerW: 480, lumen: 12000, cct: 7200, cri: 75, pwmHz: 1200,
    beamAngleDeg: 8, bodyHalfLength: 0.32, bodyHalfWidth: 0.16, panRange: 270, tiltRange: 135, dmxChannels: 16,
  },
  {
    id: 'mdl-spot470', manufacturer: 'DemoLight', name: 'Spot 470', kind: 'moving-head-spot',
    weightKg: 24, powerW: 550, lumen: 20000, cct: 6800, cri: 82, pwmHz: 2000,
    beamAngleDeg: 22, bodyHalfLength: 0.4, bodyHalfWidth: 0.2, panRange: 270, tiltRange: 135, dmxChannels: 24,
  },
  {
    id: 'mdl-wash19', manufacturer: 'DemoLight', name: 'Wash 19x25', kind: 'moving-head-wash',
    weightKg: 14, powerW: 500, lumen: 9000, cct: 6500, cri: 90, pwmHz: 0,
    beamAngleDeg: 35, bodyHalfLength: 0.28, bodyHalfWidth: 0.18, panRange: 270, tiltRange: 135, dmxChannels: 14,
  },
  {
    id: 'mdl-par', manufacturer: 'DemoLight', name: 'LED PAR 300', kind: 'led-par',
    weightKg: 6, powerW: 300, lumen: 8000, cct: 3200, cri: 95, pwmHz: 4000,
    beamAngleDeg: 40, bodyHalfLength: 0.18, bodyHalfWidth: 0.14, panRange: 90, tiltRange: 90, dmxChannels: 8,
  },
];

function makeVenue(id: string, name: string, city: string, nx: number, ny: number, height: number, shift = 0): Venue {
  const hangPoints: HangPoint[] = [];
  const sx = 60 / nx, sy = 40 / ny;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      // 第二馆做部分偏移和减载, 模拟真实复勘差异 (水平 0~0.8m, 局部层高降低)
      const jitterX = shift ? (Math.sin(i * 12.9898 + j * 78.233) * 0.35 + 0.35) : 0;
      const jitterY = shift ? (Math.cos(i * 4.12 + j * 9.7) * 0.35 + 0.35) : 0;
      hangPoints.push({
        id: `${id}-hp-${i}-${j}`,
        label: `${String.fromCharCode(65 + (j % 26))}${i + 1}`,
        // 层高与源馆一致, 仅局部点降低 0.8m 制造净空问题
        position: [i * sx + jitterX, j * sy + jitterY, height - 1.2 - (i % 3) * 0.15 - (shift && i % 9 === 0 ? 0.8 : 0)],
        loadKg: shift && (i + j) % 11 === 0 ? 15 : 100,
        kind: (i + j) % 4 === 0 ? 'batten' : 'motor',
      });
    }
  }
  return {
    id, name, city, origin: [0, 0, 0], size: [60, 40, height], height,
    stageCenter: [30, 10, 0],
    hangPoints,
    obstacles: shift ? [
      { id: `${id}-ob1`, label: '中央马道', min: [26, 16, height - 4], max: [34, 20, height - 1] },
    ] : [],
    powerPorts: [
      { id: `${id}-pw1`, label: '舞台左 63A', position: [4, 2, 1.2], capacityKva: 125, connector: '63A 5芯', phaseCount: 3 },
      { id: `${id}-pw2`, label: '舞台右 32A', position: [56, 2, 1.2], capacityKva: 63, connector: '32A 5芯', phaseCount: 3 },
    ],
    attachments: [], surveyNotes: '', revisedAt: Date.now(), createdAt: Date.now(),
  };
}

function makeProject(venueId: string): Project {
  const id = 'proj-demo';
  const fixtures: Fixture[] = [];
  const trusses: Truss[] = [];
  // 6 根桁架, 每根 50 台灯 (300 台)
  const trussCount = 6, perTruss = 50;
  for (let t = 0; t < trussCount; t++) {
    const z = 14 - t * 1.8;
    const y = 6 + t * 5;
    const trussId = `truss-${t}`;
    trusses.push({
      id: trussId, label: `TR-${t + 1}`,
      from: [4, y, z], to: [56, y, z], section: 0.4, loadKg: 800,
    });
    for (let k = 0; k < perTruss; k++) {
      const x = 4 + (k / (perTruss - 1)) * 52;
      const modelId = t % 3 === 0 ? 'mdl-beam380' : t % 3 === 1 ? 'mdl-spot470' : 'mdl-wash19';
      const universe = Math.floor((t * perTruss + k) / 60);
      fixtures.push({
        id: `fx-${t}-${k}`,
        label: `${t % 3 === 0 ? 'BM' : t % 3 === 1 ? 'SP' : 'WH'}-${String(t * perTruss + k + 1).padStart(3, '0')}`,
        modelId,
        position: [x, y, z - 0.5],
        rotation: [0, 0, 0],
        trussId,
        hangPointId: `${venueId}-hp-${Math.min(39, Math.round((k / perTruss) * 39))}-${Math.min(19, t * 3 + (k % 3))}`,
        universe,
        dmxStart: ((t * perTruss + k) % 60) * 16 + 1,
        params: { ...defaultParams(), dimmer: 0.7, pan: 0, tilt: 45 },
      });
    }
  }

  // 拓扑: 控台 -> 2 交换机 -> 10 节点, 每节点 30 灯, 其中一条链路故意超 100m
  const nodes: ArtNetNode[] = [
    { id: 'node-console', label: '控台', kind: 'console', position: [30, 34, 1.2], fixtureIds: [], portMap: [{ port: 'eth0', universe: 0 }] },
    { id: 'sw-a', label: '交换机A', kind: 'switch', position: [15, 30, 6], fixtureIds: [], portMap: [] },
    { id: 'sw-b', label: '交换机B', kind: 'switch', position: [45, 30, 6], fixtureIds: [], portMap: [] },
  ];
  for (let n = 0; n < 10; n++) {
    const nodeId = `node-${n}`;
    nodes.push({
      id: nodeId, label: `Art-Net 节点${n + 1}`, kind: 'node',
      position: [6 + n * 5.3, 8 + (n % 2) * 12, 10],
      fixtureIds: fixtures.slice(n * 30, n * 30 + 30).map(f => f.id),
      portMap: [{ port: 'eth1', universe: Math.floor(n / 2) }, { port: 'eth2', universe: Math.floor(n / 2) + 1 }],
    });
  }
  const links = [
    { id: 'lk-0', fromNode: 'node-console', toNode: 'sw-a', cableLength: 20, cableType: 'Cat6 室内' },
    { id: 'lk-1', fromNode: 'node-console', toNode: 'sw-b', cableLength: 115, cableType: 'Cat6 室内' },
    ...Array.from({ length: 10 }, (_, n) => ({
      id: `lk-${n + 2}`,
      fromNode: n < 5 ? 'sw-a' : 'sw-b',
      toNode: `node-${n}`,
      cableLength: 30 + (n % 4) * 25,
      cableType: 'Cat5e 吊点',
    })),
  ];
  const topology: ArtNetTopology = { nodes, links };

  return {
    id, name: '2026 巡演 Demo 工程', venueId,
    createdAt: Date.now(), updatedAt: Date.now(),
    activeBranchId: 'br-main',
    branches: [{ id: 'br-main', label: '主线', createdAt: Date.now(), note: '' }],
    fixtures, trusses, topology,
    presets: [
      { id: 'ps-red', kind: 'color', label: '中国红', values: { rgb: [1, 0.05, 0.05] } },
      { id: 'ps-blue', kind: 'color', label: '深海蓝', values: { rgb: [0.05, 0.2, 1] } },
      { id: 'ps-wide', kind: 'beam', label: '广角柔光', values: { zoom: 1.6, prism: 1 } },
      { id: 'ps-front', kind: 'position', label: '正面光位', values: { pan: 0, tilt: 55 } },
    ],
    groups: [{
      id: 'grp-1', label: '一号桁架全组',
      fixtureIds: fixtures.slice(0, 50).map(f => f.id),
      mode: 'wave', step: 5, direction: 1,
      linkedParams: ['pan', 'tilt', 'dimmer', 'strobeHz'],
    }],
    effects: [
      { id: 'ef-circle', label: '画圆', shape: 'circle', targetParam: 'pan', phase: 0, period: 6, direction: 1, amplitude: 30, offset: 0 },
      { id: 'ef-spiral', label: '螺旋收束', shape: 'spiral', targetParam: 'tilt', phase: 0.5, period: 10, direction: -1, amplitude: 25, offset: 45 },
    ],
    cues: [
      {
        id: 'cue-1', no: 1, label: '开场暖场', overrides: {}, presetIds: ['ps-red'], effectIds: [],
        fadeSec: 3, holdSec: 0, remark: '观众入场', branchId: 'br-main', createdAt: Date.now(),
      },
      {
        id: 'cue-2', no: 2, label: '主角登场', overrides: {}, presetIds: ['ps-blue', 'ps-front', 'ps-wide'], effectIds: ['ef-circle'],
        fadeSec: 2, holdSec: 0, remark: '追光到台中', branchId: 'br-main', createdAt: Date.now(),
      },
    ],
    macros: [],
    comments: [],
    cables: [],
    rigTasks: [],
    quoteLines: [],
    triggerLog: [],
    cameraShutterSec: 1 / 100,
    cameraFrameRate: 50,
    luxGrid: { origin: [0, 0, 0], size: [50, 28, 0], nx: 40, ny: 24, height: 0.1 },
    blindBuffer: null,
  };
}

export function buildDemoState(): AppState {
  const venueA = makeVenue('venue-a', '北京国家体育馆(档案)', '北京', 40, 20, 20, 0);
  const venueB = makeVenue('venue-b', '上海梅奔馆(复勘)', '上海', 40, 20, 20, 1);
  const project = makeProject('venue-a');
  return {
    venues: [venueA, venueB],
    projects: [project],
    inventory: lampModels.flatMap(m =>
      Array.from({ length: 120 }, (_, i): import('./types.ts').InventoryItem => ({
        id: uid('inv'), modelId: m.id, serialNo: `${m.name.slice(-3).toUpperCase()}-SN-${String(i + 1).padStart(4, '0')}`,
        status: 'idle',
      }))),
    lampModels,
    activeProjectId: project.id,
    activeVenueId: venueA.id,
  };
}
