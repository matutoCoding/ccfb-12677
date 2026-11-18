// ============================================================
// TourLight 领域模型 —— 全部模块共享的数据契约
// 单位约定：距离 mm；角度 rad（UI 层转 deg）；照度 lux；时间 ms
// ============================================================

export type Vec3 = { x: number; y: number; z: number };
export type ID = string;

// ---------------- 场馆与挂点 ----------------

export interface Attachment {
  id: ID;
  name: string;
  kind: 'rigger-drawing' | 'power-sheet' | 'photo' | 'other';
  mediaType: string;
  size: number;
  blobId: ID; // 存入 IndexedDB 的 Blob 键
  uploadedAt: number;
}

/** 复勘三维里可回写的柱位/层高/净空修订 */
export interface SiteRevision {
  id: ID;
  target: 'venue' | 'hangpoint' | 'column';
  targetId: ID;
  field: string;
  oldValue: number | string;
  newValue: number | string;
  note?: string;
  revisedAt: number;
  revisedBy: string;
}

export interface HangPoint {
  id: ID;
  code: string; // 场馆编号，如 A-12
  position: Vec3;
  /** 额定承重 kg */
  loadRatingKg: number;
  /** 该点净空（下方可利用高度 mm），复勘可改 */
  headroomMm: number;
  type: 'motor' | 'fixed-beam' | 'truss-clamp' | 'floor-base';
  /** 供电接口规格 */
  power?: { connector: string; voltage: number; phases: 1 | 3; maxAmps: number };
  tags: string[];
  /** 换馆比对时的匹配状态（运行期填充，不持久化） */
  matchState?: MatchState;
}

export type MatchState =
  | { kind: 'matched'; pointId: ID; deviationMm: number }
  | { kind: 'incompatible'; reason: IncompatibleReason; suggestions: ID[] }
  | { kind: 'unmatched' };

export type IncompatibleReason =
  | 'load-exceeded'
  | 'headroom-insufficient'
  | 'connector-missing'
  | 'power-insufficient'
  | 'out-of-envelope';

export interface VenueColumn {
  id: ID;
  code: string;
  position: Vec3;
  size: { w: number; d: number };
  heightMm: number;
}

export interface Venue {
  id: ID;
  name: string;
  city: string;
  /** 场馆基准尺寸（mm） */
  envelope: { width: number; depth: number; height: number };
  stage?: { origin: Vec3; width: number; depth: number; height: number };
  hangPoints: HangPoint[];
  columns: VenueColumn[];
  attachments: Attachment[];
  revisions: SiteRevision[];
  notes: string;
  updatedAt: number;
}

// ---------------- 灯具定义（GDTF 精简描述） ----------------

export interface FixtureDefinition {
  id: ID;
  gdtfName: string; // 厂.型号@版本
  manufacturer: string;
  model: string;
  /** 自重 kg */
  weightKg: number;
  /** 整机高度（含吊轭）mm，用于净空校核 */
  heightMm: number;
  footprint: { w: number; d: number };
  powerW: number;
  /** 光源参数 */
  cctK: number; // 相关色温
  cri: number; // 显色指数 Ra
  pwmHz: number; // 调光 PWM 频率，0 表示直流无频闪
  /** 摇头灯运动范围（rad） */
  panRange?: [number, number];
  tiltRange?: [number, number];
  /** 运动包络半径（灯头绕底座扫出的最大半径 mm） */
  envelopeRadiusMm?: number;
  /** 光学 */
  beam: {
    minBeamAngleRad: number;
    maxBeamAngleRad: number;
    /** 光通量 lm */
    lumens: number;
    colorSource: 'rgbw-led' | 'cmy' | 'white-wheel' | 'fixed-led';
  };
  dmxChannels: number;
  /** 日租金（元/天） */
  dailyRate: number;
}

export type FixtureKind = 'moving-head' | 'beam' | 'wash' | 'par' | 'fresnel' | 'profile' | 'strobe' | 'followspot';

export interface FixtureInstance {
  id: ID;
  uid: string; // 项目内编号，如 M-001
  definitionId: ID;
  kind: FixtureKind;
  /** 世界坐标（吊挂基准点，mm）——MVR 往返以此为准，禁止转换误差 */
  position: Vec3;
  /** 朝向（rad，pan/tilt/roll） */
  rotation: Vec3;
  hangPointId?: ID;
  /** 占用序列号（实物灯），库存核销用 */
  serialNo?: string;
  /** Art-Net 编址 */
  address?: { universe: number; dmxStart: number };
  /** 运行期：组联动时被临时剔除 */
  excludedFromGroup?: boolean;
  /** 运行期：断电模拟结果 */
  dark?: boolean;
  darkReason?: string;
}

export interface TrussSegment {
  id: ID;
  code: string;
  from: Vec3;
  to: Vec3;
  /** 截面边长 mm（正方形桁架） */
  sectionMm: number;
  selfWeightKg: number;
  hangPointIds: ID[];
}

// ---------------- 网络拓扑（Art-Net） ----------------

export type NetNodeType = 'console' | 'node' | 'switch' | 'fixture';

export interface NetNode {
  id: ID;
  label: string;
  type: NetNodeType;
  /** Art-Net 节点：域(universe) -> 物理网口名 */
  universePortMap?: { universe: number; port: string }[];
  /** 交换机/节点的物理网口 */
  ports: { name: string; speedMbps: number }[];
  fixtureId?: ID;
}

export interface NetLink {
  id: ID;
  fromNode: ID;
  fromPort: string;
  toNode: ID;
  toPort: string;
  cableKind: 'cat5e' | 'cat6' | 'fiber';
  lengthMm: number;
  /** 走线长度 >100m 时运行期标记 */
  overLength?: boolean;
}

export interface NetworkTopology {
  nodes: NetNode[];
  links: NetLink[];
}

export interface FailureSimulationResult {
  failedNodeId: ID;
  darkFixtureIds: ID[];
  /** 与手工拓扑核对用：经过的断链 id，确定性顺序 */
  cutLinkIds: ID[];
  /** 受影响 universe 列表 */
  universesLost: number[];
}

// ---------------- Cue / 预设 / 宏 ----------------

export type ParamName =
  | 'dimmer'
  | 'position-pan'
  | 'position-tilt'
  | 'color-rgb'
  | 'color-cmy'
  | 'gobo'
  | 'prism'
  | 'strobe'
  | 'zoom'
  | 'focus';

export interface FixtureParamValue {
  dimmer?: number; // 0..1
  pan?: number;
  tilt?: number;
  rgb?: [number, number, number]; // 0..1
  gobo?: number;
  prism?: number;
  strobeHz?: number;
  zoom?: number; // 0..1 在光束角范围内插值
  focus?: number;
}

export type PresetType = 'position' | 'color' | 'beam';

export interface Preset {
  id: ID;
  type: PresetType;
  name: string;
  value: FixtureParamValue;
  /** 引用计数由引擎计算，这里只存显式备注 */
  note?: string;
}

export interface CueFixtureState {
  fixtureId: ID;
  params: FixtureParamValue;
  /** 引用预设（值变更随预设联动） */
  presetRefs?: Partial<Record<ParamName, ID>>;
}

export type FadeCurve = 'linear' | 'ease-in' | 'ease-out' | 's-curve';

export interface Cue {
  id: ID;
  number: string; // 如 1.05
  name: string;
  timeMs: number; // 在时间轴上的触发时刻
  fadeInMs: number;
  fadeOutMs: number;
  curve: FadeCurve;
  states: CueFixtureState[];
  note?: string;
  branchId: ID;
  /** 演出触发留档 */
  triggerLog?: { triggeredAt: number; operator: string }[];
}

export interface Branch {
  id: ID;
  name: string;
  parentId?: ID;
  forkedFromCueId?: ID;
  createdAt: number;
}

export interface MacroStep {
  action: string; // 动作标识，如 cue.insert / preset.apply
  payload: unknown;
}

export interface Macro {
  id: ID;
  name: string;
  hotkey: string;
  steps: MacroStep[];
}

// ---------------- 组与效果引擎 ----------------

export type FxMode = 'symmetric' | 'wave' | 'chase';

export interface FixtureGroup {
  id: ID;
  name: string;
  fixtureIds: ID[];
  /** 临时剔除的灯 */
  excludedIds: ID[];
}

export interface FxConfig {
  mode: FxMode;
  param: keyof FixtureParamValue;
  /** 基值与幅度（按参数语义） */
  base: number;
  amplitude: number;
  /** 相位步进 rad、周期 ms、方向 +1/-1 */
  phaseStep: number;
  periodMs: number;
  direction: 1 | -1;
  /** 内置生成器形状 */
  shape?: 'circle' | 'spiral' | 'gradient';
}

// ---------------- 评审 ----------------

export type ReviewStatus = 'open' | 'assigned' | 'resolved' | 'rejected';

export interface ReviewComment {
  id: ID;
  position: Vec3;
  author: string;
  assignee?: string;
  status: ReviewStatus;
  text: string;
  cueRef?: string;
  fixtureRef?: string;
  createdAt: number;
  resolvedAt?: number;
}

// ---------------- 库存 / 档期 / 报价 / 线缆 / 吊装 ----------------

export interface InventoryItem {
  definitionId: ID;
  serialNo: string;
  status: 'idle' | 'rented' | 'maintenance';
  currentProjectId?: ID;
}

export interface Booking {
  id: ID;
  projectId: ID;
  definitionId: ID;
  serialNo: string;
  fromDate: string; // ISO yyyy-mm-dd
  toDate: string;
}

export interface QuoteLine {
  label: string;
  qty: number;
  unit: string;
  unitPrice: number;
  days?: number;
  subtotal: number;
}

export interface Quote {
  id: ID;
  title: string;
  venueId?: ID;
  showDays: number;
  installDays: number;
  strikeDays: number;
  laborDayRate: number;
  truckTripRate: number;
  laborPersonDays: number;
  truckTrips: number;
  lines: QuoteLine[];
  total: number;
  createdAt: number;
}

export interface CableRun {
  id: ID;
  signal: 'dmx' | 'artnet' | 'power';
  fromNode: ID;
  toNode: ID;
  /** 走线路径折线（mm），长度按段求和 */
  path: Vec3[];
  lengthMm: number;
  connectorFrom: string;
  connectorTo: string;
}

export interface RigTask {
  id: ID;
  day: string;
  startHm: string;
  endHm: string;
  crew: string;
  trussId: ID;
  description: string;
  done: boolean;
}

// ---------------- 工程根 ----------------

export interface Project {
  id: ID;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** 当前激活分支 */
  activeBranchId: ID;
  branches: Branch[];
  fixtureDefinitions: FixtureDefinition[];
  fixtures: FixtureInstance[];
  truss: TrussSegment[];
  groups: FixtureGroup[];
  fx: Record<ID, FxConfig>;
  presets: Preset[];
  cues: Cue[];
  macros: Macro[];
  network: NetworkTopology;
  comments: ReviewComment[];
  cables: CableRun[];
  rigTasks: RigTask[];
  quote?: Quote;
  /** 适配的场馆 id（可多馆巡演） */
  venueIds: ID[];
  activeVenueId?: ID;
  /** 工程级设置 */
  settings: {
    cameraShutterMs: number;
    ambientLux: number;
  };
}

export interface AppState {
  version: number;
  venues: Record<ID, Venue>;
  projects: Record<ID, Project>;
  inventory: InventoryItem[];
  bookings: Booking[];
  activeProjectId?: ID;
  blindMode: boolean;
}
