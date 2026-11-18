// 示例/压测数据生成：场馆、项目、灯具、拓扑、库存、cue
import type {
  AppState,
  Booking,
  FixtureDefinition,
  FixtureInstance,
  HangPoint,
  InventoryItem,
  NetLink,
  NetNode,
  Project,
  TrussSegment,
  Vec3,
} from '../types';
import { rad } from '../core/math3d';

const defs: FixtureDefinition[] = [
  {
    id: 'def-mh1',
    gdtfName: 'Acme.MH380@1.0',
    manufacturer: 'Acme',
    model: 'MH380 Beam',
    weightKg: 18,
    heightMm: 520,
    footprint: { w: 320, d: 220 },
    powerW: 480,
    cctK: 7500,
    cri: 72,
    pwmHz: 1200,
    panRange: [rad(-180), rad(180)],
    tiltRange: [rad(-135), rad(135)],
    envelopeRadiusMm: 480,
    beam: { minBeamAngleRad: rad(3), maxBeamAngleRad: rad(22), lumens: 12000, colorSource: 'cmy' },
    dmxChannels: 24,
    dailyRate: 90,
  },
  {
    id: 'def-wash1',
    gdtfName: 'Glow.Wash470@1.0',
    manufacturer: 'Glow',
    model: 'Wash470',
    weightKg: 12,
    heightMm: 380,
    footprint: { w: 280, d: 280 },
    powerW: 470,
    cctK: 6500,
    cri: 88,
    pwmHz: 4000,
    beam: { minBeamAngleRad: rad(8), maxBeamAngleRad: rad(45), lumens: 9000, colorSource: 'rgbw-led' },
    dmxChannels: 14,
    dailyRate: 60,
  },
  {
    id: 'def-par1',
    gdtfName: 'Basic.PAR64@1.0',
    manufacturer: 'Basic',
    model: 'PAR64 LED',
    weightKg: 6,
    heightMm: 280,
    footprint: { w: 200, d: 200 },
    powerW: 180,
    cctK: 3200,
    cri: 95,
    pwmHz: 0,
    beam: { minBeamAngleRad: rad(15), maxBeamAngleRad: rad(35), lumens: 5000, colorSource: 'white-wheel' },
    dmxChannels: 4,
    dailyRate: 25,
  },
];

let seq = 0;
const id = (p: string): string => `${p}-${(++seq).toString(36)}`;

/** 生成带网格挂点的场馆，pointCount 可压到 2000 */
export function makeVenue(name: string, city: string, pointCount: number, vary = false) {
  const cols = Math.ceil(Math.sqrt(pointCount * 1.4));
  const rows = Math.ceil(pointCount / cols);
  const hangPoints: HangPoint[] = [];
  let n = 0;
  for (let r = 0; r < rows && n < pointCount; r++) {
    for (let c = 0; c < cols && n < pointCount; c++) {
      const jitter = vary ? (pseudo(n, 1) - 0.5) * 300 : 0;
      hangPoints.push({
        id: `hp-${name.slice(0, 2)}-${n}`,
        code: `${String.fromCharCode(65 + (r % 26))}-${c + 1}`,
        position: {
          x: 2000 + c * 3000 + jitter,
          y: 2000 + r * 3000,
          z: 11000 + (vary ? (pseudo(n, 2) - 0.5) * 600 : 0),
        },
        loadRatingKg: vary && pseudo(n, 3) > 0.9 ? 150 : 500,
        headroomMm: vary && pseudo(n, 4) > 0.85 ? 6000 : 9500,
        type: 'motor',
        power: {
          connector: pseudo(n, 5) > 0.92 ? 'CEE32' : 'CEE16',
          voltage: 230,
          phases: 1,
          maxAmps: pseudo(n, 5) > 0.92 ? 32 : 16,
        },
        tags: [],
      });
      n++;
    }
  }
  return {
    id: `venue-${name}`,
    name,
    city,
    envelope: { width: cols * 3000 + 4000, depth: rows * 3000 + 4000, height: 14000 },
    stage: { origin: { x: 4000, y: 3000, z: 0 }, width: 16000, depth: 8000, height: 9000 },
    hangPoints,
    columns: [
      { id: id('col'), code: 'K1', position: { x: 1500, y: 1500, z: 0 }, size: { w: 600, d: 600 }, heightMm: 14000 },
    ],
    attachments: [],
    revisions: [],
    notes: '',
    updatedAt: Date.now(),
  };
}

/** 生成项目：movingHeadCount 台摇头灯 + 桁架 + Art-Net 拓扑 + 库存 */
export function makeProject(
  name: string,
  venueId: string,
  movingHeadCount: number,
  washCount = 40,
  sourceHangPoints?: HangPoint[],
): { project: Project; inventory: InventoryItem[]; bookings: Booking[] } {
  const fixtures: FixtureInstance[] = [];
  const truss: TrussSegment[] = [];
  const trussCount = Math.ceil(movingHeadCount / 12);
  // 优先用场馆真实挂点（保证换馆比对的源坐标/承载语义正确）
  const hpPool = sourceHangPoints ?? [];

  for (let t = 0; t < trussCount; t++) {
    const anchorIdx = t * 3;
    const anchors = [0, 1, 2].map((k) => hpPool[anchorIdx + k]).filter(Boolean) as HangPoint[];
    const y = anchors[0]?.position.y ?? 3000 + t * 2600;
    const z = (anchors[0]?.position.z ?? 11000) - 1200; // 桁架在挂点下方 1.2m
    const from: Vec3 = { x: 4000, y, z };
    const to: Vec3 = { x: 4000 + 12000, y, z };
    const hangPointIds = anchors.length ? anchors.map((a) => a.id) : [`hp-fallback-${t}`];
    truss.push({
      id: `truss-${t}`,
      code: `TR-${t + 1}`,
      from,
      to,
      sectionMm: 400,
      selfWeightKg: 120,
      hangPointIds,
    });
    const perTruss = Math.ceil(movingHeadCount / trussCount);
    for (let i = 0; i < perTruss && fixtures.length < movingHeadCount; i++) {
      const x = from.x + ((i + 0.5) / perTruss) * 12000;
      fixtures.push({
        id: id('fx'),
        uid: `M-${String(fixtures.length + 1).padStart(3, '0')}`,
        definitionId: 'def-mh1',
        kind: 'moving-head',
        position: { x, y, z: z - 200 },
        rotation: { x: 0, y: 0, z: 0 },
        hangPointId: hangPointIds[0],
        serialNo: `SN-MH-${fixtures.length + 1}`,
        address: { universe: Math.floor(fixtures.length / 17), dmxStart: (fixtures.length % 17) * 24 + 1 },
      });
    }
  }
  for (let i = 0; i < washCount; i++) {
    fixtures.push({
      id: id('fx'),
      uid: `W-${String(i + 1).padStart(3, '0')}`,
      definitionId: 'def-wash1',
      kind: 'wash',
      position: { x: 4000 + (i % 10) * 1400, y: 2500 + Math.floor(i / 10) * 9000, z: 9500 },
      rotation: { x: 0, y: 0, z: 0 },
      serialNo: `SN-WS-${i + 1}`,
      address: { universe: 20 + Math.floor(i / 36), dmxStart: (i % 36) * 14 + 1 },
    });
  }

  // 网络拓扑：1 控台 → 2 交换机 → 若干 Art-Net 节点 → 灯具
  const nodes: NetNode[] = [
    { id: 'node-console', label: '控台', type: 'console', ports: [{ name: 'ETH1', speedMbps: 1000 }] },
  ];
  const links: NetLink[] = [];
  for (let s = 0; s < 2; s++) {
    const swId = `node-sw${s}`;
    nodes.push({ id: swId, label: `核心交换机${s + 1}`, type: 'switch', ports: makePorts(24) });
    links.push(linkBetween('node-console', 'ETH1', swId, 'P1', 3000 + s * 500));
  }
  const nodeCount = Math.ceil((movingHeadCount + washCount) / 40);
  for (let nI = 0; nI < nodeCount; nI++) {
    const nodeId = `node-an${nI}`;
    const sw = nI % 2;
    nodes.push({
      id: nodeId,
      label: `Art-Net 节点 ${nI + 1}`,
      type: 'node',
      ports: makePorts(8),
      universePortMap: [{ universe: nI, port: 'P1' }],
    });
    const longCable = nI === nodeCount - 1; // 最后一个节点故意超长
    links.push(linkBetween(`node-sw${sw}`, `P${2 + (nI % 20)}`, nodeId, 'P1', longCable ? 105000 : 60000));
    // 每节点挂 40 个 fixture 节点
    for (let k = 0; k < 40; k++) {
      const fxIdx = nI * 40 + k;
      if (fxIdx >= fixtures.length) break;
      const fxNodeId = `node-fx-${fxIdx}`;
      nodes.push({
        id: fxNodeId,
        label: fixtures[fxIdx].uid,
        type: 'fixture',
        ports: [{ name: 'DMX', speedMbps: 100 }],
        fixtureId: fixtures[fxIdx].id,
      });
      links.push(linkBetween(nodeId, `P${2 + (k % 6)}`, fxNodeId, 'DMX', 2000));
    }
  }

  const project: Project = {
    id: `project-${name}`,
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    activeBranchId: 'branch-main',
    branches: [{ id: 'branch-main', name: '主干', createdAt: Date.now() }],
    fixtureDefinitions: defs,
    fixtures,
    truss,
    groups: [
      {
        id: 'group-all-mh',
        name: '全部摇头灯',
        fixtureIds: fixtures.filter((f) => f.kind === 'moving-head').map((f) => f.id),
        excludedIds: [],
      },
    ],
    fx: {
      'fx-1': {
        mode: 'wave',
        param: 'pan',
        base: 0,
        amplitude: rad(45),
        phaseStep: 0.35,
        periodMs: 4000,
        direction: 1,
        shape: 'gradient',
      },
    },
    presets: [
      { id: 'preset-red', type: 'color', name: '烈焰红', value: { rgb: [1, 0.08, 0.05] } },
      { id: 'preset-center', type: 'position', name: '中心定点', value: { pan: 0, tilt: 0 } },
    ],
    cues: [
      {
        id: 'cue-1',
        number: '1.00',
        name: '开场暗场',
        timeMs: 0,
        fadeInMs: 2000,
        fadeOutMs: 1000,
        curve: 's-curve',
        branchId: 'branch-main',
        states: fixtures.slice(0, 8).map((f) => ({ fixtureId: f.id, params: { dimmer: 0.2, rgb: [1, 0.1, 0.1] }, presetRefs: { 'color-rgb': 'preset-red' } })),
        note: '观众入场',
      },
      {
        id: 'cue-2',
        number: '2.00',
        name: '主唱追光',
        timeMs: 8000,
        fadeInMs: 1500,
        fadeOutMs: 1000,
        curve: 'ease-in',
        branchId: 'branch-main',
        states: fixtures.slice(0, 16).map((f) => ({ fixtureId: f.id, params: { dimmer: 1, pan: 0, tilt: 0.2 } })),
      },
    ],
    macros: [
      { id: 'macro-1', name: '全场黑场', hotkey: 'Ctrl+B', steps: [{ action: 'dimmer.all', payload: 0 }] },
    ],
    network: { nodes, links },
    comments: [],
    cables: [],
    rigTasks: [
      { id: 'rig-1', day: '2026-12-01', startHm: '08:00', endHm: '12:00', crew: '甲班', trussId: truss[0]?.id ?? 'truss-0', description: '吊装主桁架 TR-1', done: false },
      { id: 'rig-2', day: '2026-12-01', startHm: '13:00', endHm: '18:00', crew: '乙班', trussId: truss[1]?.id ?? 'truss-1', description: '吊装 TR-2 并挂灯', done: false },
    ],
    venueIds: [venueId],
    activeVenueId: venueId,
    settings: { cameraShutterMs: 10, ambientLux: 50 },
  };

  const inventory: InventoryItem[] = fixtures.map((f) => ({
    definitionId: f.definitionId,
    serialNo: f.serialNo!,
    status: 'rented',
    currentProjectId: project.id,
  }));
  const bookings: Booking[] = fixtures.slice(0, 5).map((f, i) => ({
    id: `bk-${i}`,
    projectId: project.id,
    definitionId: f.definitionId,
    serialNo: f.serialNo!,
    fromDate: '2026-12-01',
    toDate: '2026-12-10',
  }));
  // 制造一个档期冲突
  if (fixtures[0]) {
    bookings.push({
      id: 'bk-conflict',
      projectId: 'project-other',
      definitionId: fixtures[0].definitionId,
      serialNo: fixtures[0].serialNo!,
      fromDate: '2026-12-05',
      toDate: '2026-12-12',
    });
  }
  return { project, inventory, bookings };
}

export function makeInitialState(): AppState {
  const venueA = makeVenue('上海梅奔', '上海', 220, false);
  const venueB = makeVenue('北京凯迪拉克', '北京', 220, true);
  const { project, inventory, bookings } = makeProject('2027 巡演·光年', venueA.id, 60, 24, venueA.hangPoints);
  project.venueIds = [venueA.id, venueB.id];
  return {
    version: 1,
    venues: { [venueA.id]: venueA, [venueB.id]: venueB },
    projects: { [project.id]: project },
    inventory,
    bookings,
    activeProjectId: project.id,
    blindMode: false,
  };
}

/** 性能压测专用：2000 挂点 + 300 摇头灯 */
export function makeBenchmarkState(): AppState {
  const venueA = makeVenue('压测A馆', '测试市', 2000, false);
  const venueB = makeVenue('压测B馆', '测试市', 2000, true);
  const { project, inventory, bookings } = makeProject('压测工程', venueA.id, 300, 0, venueA.hangPoints);
  project.venueIds = [venueA.id, venueB.id];
  return {
    version: 1,
    venues: { [venueA.id]: venueA, [venueB.id]: venueB },
    projects: { [project.id]: project },
    inventory,
    bookings,
    activeProjectId: project.id,
    blindMode: false,
  };
}

function makePorts(n: number): { name: string; speedMbps: number }[] {
  return Array.from({ length: n }, (_, i) => ({ name: `P${i + 1}`, speedMbps: 1000 }));
}

function linkBetween(fromNode: string, fromPort: string, toNode: string, toPort: string, lengthMm: number): NetLink {
  return {
    id: id('link'),
    fromNode,
    fromPort,
    toNode,
    toPort,
    cableKind: lengthMm > 100000 ? 'cat6' : 'cat5e',
    lengthMm,
  };
}

/** 确定性伪随机（压测数据必须可复现） */
function pseudo(seed: number, salt: number): number {
  const x = Math.sin(seed * 127.1 + salt * 311.7) * 43758.5453;
  return x - Math.floor(x);
}
