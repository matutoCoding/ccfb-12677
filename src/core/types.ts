// 全局数据模型 —— 纯类型定义, 无浏览器依赖, 可被 Node 测试直接 import

export type Vec3 = [number, number, number];

export interface Attachment {
  id: string;
  name: string;
  kind: 'rigger-drawing' | 'power-sheet' | 'other';
  mime: string;
  size: number;
  /** 二进制存 IndexedDB blob 库, 工程包内以 base64 携带 */
  blobKey: string;
  uploadedAt: number;
}

export interface PowerPort {
  id: string;
  label: string;
  position: Vec3;
  /** 单口额定容量 kVA */
  capacityKva: number;
  /** 接口型号, 如 32A 5芯 / 63A 3芯 */
  connector: string;
  phaseCount: 1 | 3;
}

export interface HangPoint {
  id: string;
  label: string;
  position: Vec3;
  /** 允许承重 kg */
  loadKg: number;
  /** 挂点形式 */
  kind: 'motor' | 'batten' | 'permanent-truss' | 'beam-clamp';
}

export interface VenueObstacle {
  id: string;
  label: string;
  /** 轴对齐包围盒 min/max, 用于净空与干涉 */
  min: Vec3;
  max: Vec3;
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  /** 场馆基准原点偏移, 所有挂点坐标为该馆局部坐标系 (米) */
  origin: Vec3;
  /** 场地平面尺寸 米 */
  size: Vec3;
  /** 层高 米 */
  height: number;
  /** 舞台区默认位置 */
  stageCenter: Vec3;
  hangPoints: HangPoint[];
  obstacles: VenueObstacle[];
  powerPorts: PowerPort[];
  attachments: Attachment[];
  /** 复勘修订记录 */
  surveyNotes: string;
  revisedAt: number;
  createdAt: number;
}

export type FixtureKind = 'moving-head-beam' | 'moving-head-spot' | 'moving-head-wash' | 'led-par' | 'conventional' | 'strobe' | 'follow-spot';

export interface LampModel {
  id: string;
  manufacturer: string;
  name: string;
  kind: FixtureKind;
  /** 整灯质量 kg */
  weightKg: number;
  /** 额定功耗 W */
  powerW: number;
  /** 光通量 lm */
  lumen: number;
  /** 相关色温 K */
  cct: number;
  /** 显色指数 */
  cri: number;
  /** 调光 PWM 频率 Hz (0 = 直流/线性调光) */
  pwmHz: number;
  /** 光束角(全角) 度 */
  beamAngleDeg: number;
  /** 摇臂几何: 灯体半长/半宽, 用于运动包络 (米) */
  bodyHalfLength: number;
  bodyHalfWidth: number;
  /** 灯体可旋转范围 (度) */
  panRange: number;   // 单侧, 全范围 = ±panRange
  tiltRange: number;
  /** DMX 通道数 */
  dmxChannels: number;
  /** GDTF 描述文件名 (工程包内) */
  gdtfFile?: string;
}

export interface Fixture {
  id: string;
  label: string;          // 灯号, 如 MH-001
  modelId: string;
  /** 世界坐标 (方案坐标, 米) */
  position: Vec3;
  /** 静止朝向 (度) */
  rotation: Vec3;
  /** 挂载的挂点 id (可空 = 自立/落地) */
  hangPointId?: string;
  trussId?: string;
  /** Art-Net 编址 */
  universe: number;
  dmxStart: number;
  /** 库存序列号 (出库后写入) */
  serialNo?: string;
  /** 组内被临时剔除 (不参与组效果联动) */
  excludedFromGroup?: boolean;
  groupId?: string;
  /** 灯具当前参数快照 (编程/预演用) */
  params: FixtureParams;
}

export interface FixtureParams {
  dimmer: number;         // 0..1
  pan: number;            // 度
  tilt: number;           // 度
  rgb: [number, number, number]; // 0..1
  /** 图案盘索引 */
  gobo: number;
  /** 棱镜插入 0/1 与旋转角 */
  prism: number;
  prismRotate: number;
  /** 频闪 Hz, 0 = 常亮 */
  strobeHz: number;
  /** 变焦/光束角倍率 */
  zoom: number;
}

export interface Truss {
  id: string;
  label: string;
  from: Vec3;
  to: Vec3;
  /** 截面边长 米 */
  section: number;
  /** 允许总挂重 kg */
  loadKg: number;
}

export interface ArtNetNode {
  id: string;
  label: string;
  kind: 'node' | 'switch' | 'console';
  position: Vec3;
  /** 节点下挂灯具 id */
  fixtureIds: string[];
  /** 物理网口 -> Art-Net 域(universe)映射 */
  portMap: { port: string; universe: number }[];
}

export interface ArtNetLink {
  id: string;
  fromNode: string;
  toNode: string;
  /** 走线长度 米 (布线长度, 非直线) */
  cableLength: number;
  cableType: string;
}

export interface ArtNetTopology {
  nodes: ArtNetNode[];
  links: ArtNetLink[];
}

export type PresetKind = 'position' | 'color' | 'beam';

export interface Preset {
  id: string;
  kind: PresetKind;
  label: string;
  /** 仅保存对应类别字段 */
  values: Partial<FixtureParams>;
}

export type GroupMode = 'symmetric' | 'wave' | 'chase';

export interface FixtureGroup {
  id: string;
  label: string;
  fixtureIds: string[];
  mode: GroupMode;
  /** 相邻灯之间的偏移步进 */
  step: number;
  /** 方向 1 / -1 */
  direction: 1 | -1;
  /** 组联动作用的参数类别 */
  linkedParams: (keyof FixtureParams)[];
}

export type EffectShape = 'circle' | 'spiral' | 'gradient';

export interface EffectGenerator {
  id: string;
  label: string;
  shape: EffectShape;
  targetParam: keyof FixtureParams;
  phase: number;
  period: number;     // 秒
  direction: 1 | -1;
  amplitude: number;
  offset: number;
}

export interface Cue {
  id: string;
  no: number;
  label: string;
  /** 每台灯的参数 (仅记录与默认不同的覆盖值) */
  overrides: Record<string, Partial<FixtureParams>>;
  presetIds: string[];
  effectIds: string[];
  /** 渐变时间 秒 */
  fadeSec: number;
  /** 保持时间 秒 (0 = 手动触发下一 cue) */
  holdSec: number;
  remark: string;
  branchId: string;
  createdAt: number;
}

export interface Macro {
  id: string;
  label: string;
  /** 快捷键, 如 F2 / Ctrl+G */
  hotkey: string;
  /** 录制下来的操作序列 (store action 名 + 参数) */
  steps: { action: string; payload: unknown }[];
}

export type CommentStatus = 'open' | 'assigned' | 'resolved' | 'rejected';

export interface ReviewComment {
  id: string;
  position: Vec3;
  text: string;
  author: string;
  assignee?: string;
  status: CommentStatus;
  cueNo?: number;
  fixtureLabel?: string;
  createdAt: number;
  /** 外部打包导入的评论批次号 */
  importBatch?: string;
}

export interface InventoryItem {
  id: string;
  modelId: string;
  serialNo: string;
  /** 占用该序列号的项目 id */
  projectId?: string;
  status: 'idle' | 'out' | 'repair' | 'retired';
  /** 归还核销 */
  returnedAt?: number;
}

export interface QuoteLine {
  kind: 'rental' | 'labor' | 'transport' | 'cable' | 'other';
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  days: number;
}

export interface CableRun {
  id: string;
  label: string;
  fromFixture: string;
  toFixture: string;
  path: Vec3[];
  length: number;
  connectorA: string;
  connectorB: string;
  cableType: string;
}

export interface RigTask {
  id: string;
  day: string;
  startHour: number;
  durationHours: number;
  crew: string;
  trussId: string;
  description: string;
}

export interface ProjectBranch {
  id: string;
  label: string;
  parentId?: string;
  createdAt: number;
  note: string;
}

export interface TriggerRecord {
  cueNo: number;
  cueLabel: string;
  triggeredAt: number;
  operator: string;
}

export interface Project {
  id: string;
  name: string;
  venueId: string;
  createdAt: number;
  updatedAt: number;
  activeBranchId: string;
  branches: ProjectBranch[];
  fixtures: Fixture[];
  trusses: Truss[];
  topology: ArtNetTopology;
  presets: Preset[];
  groups: FixtureGroup[];
  effects: EffectGenerator[];
  cues: Cue[];
  macros: Macro[];
  comments: ReviewComment[];
  cables: CableRun[];
  rigTasks: RigTask[];
  quoteLines: QuoteLine[];
  triggerLog: TriggerRecord[];
  /** 演出参数: 摄像机快门/帧率, 用于滚动条纹模拟 */
  cameraShutterSec: number;
  cameraFrameRate: number;
  /** 照度网格设置 */
  luxGrid: { origin: Vec3; size: Vec3; nx: number; ny: number; height: number };
  /** 盲编模式下的暂存 cue 覆盖, 不影响正在播的预演 */
  blindBuffer: Record<string, Partial<FixtureParams>> | null;
}

export interface AppState {
  venues: Venue[];
  projects: Project[];
  inventory: InventoryItem[];
  lampModels: LampModel[];
  activeProjectId?: string;
  activeVenueId?: string;
  /** 演示数据结构版本, 不匹配时自动重建种子数据 */
  dataVersion?: number;
}

export const defaultParams = (): FixtureParams => ({
  dimmer: 0, pan: 0, tilt: 0, rgb: [1, 1, 1],
  gobo: 0, prism: 0, prismRotate: 0, strobeHz: 0, zoom: 1,
});
