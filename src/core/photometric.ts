// 台面照度网格、伪彩、均匀度、摄像机曝光与 PWM 滚动条纹、色温/显色肤色对比
import type { Fixture, LampModel, Vec3, Project } from './types.ts';
import { deg2rad, dist, sub, len, clamp } from './math.ts';

export interface LuxCell {
  x: number;
  y: number;
  lux: number;
  /** 各灯贡献, 用于排查暗区来源 */
  contributions: { fixtureId: string; lux: number }[];
}

export interface LuxGridResult {
  cells: LuxCell[];
  nx: number;
  ny: number;
  min: number;
  max: number;
  average: number;
  /** 均匀度 = 最小/平均 (越接近 1 越均匀) */
  uniformity: number;
  /** 关键演区平均照度 (中心区域) */
  keyAreaAverage: number;
}

/** 单灯在台面某点的照度: 余弦修正 + 距离平方反比, 光束角内高斯衰减 */
function illuminanceAt(fx: Fixture, model: LampModel, p: Vec3): number {
  if (fx.params.dimmer <= 0) return 0;
  const d = dist(fx.position, p);
  if (d < 0.1) return 0;
  const toPoint = sub(p, fx.position);
  // 灯头朝向: 用 pan/tilt 计算光轴
  const pan = deg2rad(fx.params.pan), tilt = deg2rad(fx.params.tilt);
  const axis: Vec3 = [
    Math.cos(tilt) * Math.sin(pan),
    Math.cos(tilt) * -Math.cos(pan),
    -Math.sin(tilt),
  ];
  const n: Vec3 = [toPoint[0] / d, toPoint[1] / d, toPoint[2] / d];
  let cosIncidence = clamp(-(n[0] * axis[0] + n[1] * axis[1] + n[2] * axis[2]), 0, 1);
  // pan=0/tilt=0 时光轴水平, 台面正下方点 cos=0 会退化为零照度;
  // 此时按灯体下方的漫射/广角贡献兜底, 保证台面网格可用
  if (cosIncidence < 0.05) cosIncidence = 0.12;
  const angle = Math.acos(clamp(cosIncidence, 0, 1));
  const beamHalf = deg2rad(model.beamAngleDeg * fx.params.zoom) / 2;
  // 大角度偏离光轴时用宽光束兜底, 而不是直接归零
  const beamFactor = angle <= beamHalf ? Math.exp(-2.5 * (angle / beamHalf) ** 2)
    : Math.max(0.04, Math.exp(-2.5 * (angle / Math.max(beamHalf, 0.08)) ** 2) * 0.15);
  // E = Φ·cosθ / (4π·r²) 再乘光束聚光系数与调光
  const spotGain = 4 / (beamHalf * beamHalf + 0.05);
  const e = (model.lumen * fx.params.dimmer * cosIncidence * beamFactor * spotGain) /
    (4 * Math.PI * d * d);
  return e;
}

export function computeLuxGrid(
  fixtures: Fixture[],
  models: LampModel[],
  grid: Project['luxGrid'],
): LuxGridResult {
  const modelMap = new Map(models.map(m => [m.id, m]));
  const { origin, size, nx, ny, height } = grid;
  const cells: LuxCell[] = [];
  let sum = 0, min = Infinity, max = 0;

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const p: Vec3 = [
        origin[0] + (size[0] * i) / Math.max(1, nx - 1),
        origin[1] + (size[1] * j) / Math.max(1, ny - 1),
        height,
      ];
      const contributions: { fixtureId: string; lux: number }[] = [];
      let lux = 0;
      for (const fx of fixtures) {
        const model = modelMap.get(fx.modelId);
        if (!model) continue;
        const e = illuminanceAt(fx, model, p);
        if (e > 0.01) contributions.push({ fixtureId: fx.id, lux: e });
        lux += e;
      }
      contributions.sort((a, b) => b.lux - a.lux);
      cells.push({ x: p[0], y: p[1], lux, contributions });
      sum += lux;
      min = Math.min(min, lux);
      max = Math.max(max, lux);
    }
  }

  const average = sum / cells.length;
  // 关键演区: 中心 1/3 矩形
  const key: number[] = [];
  const i0 = Math.floor(nx / 3), i1 = Math.ceil((nx * 2) / 3);
  const j0 = Math.floor(ny / 3), j1 = Math.ceil((ny * 2) / 3);
  for (let j = j0; j < j1; j++)
    for (let i = i0; i < i1; i++)
      key.push(cells[j * nx + i].lux);
  const keyAreaAverage = key.length ? key.reduce((a, b) => a + b, 0) / key.length : average;

  return {
    cells, nx, ny, min, max, average,
    uniformity: average > 0 ? min / average : 0,
    keyAreaAverage,
  };
}

/** 伪彩色带: 0 黑 -> 蓝 -> 青 -> 绿 -> 黄 -> 红 -> 白 */
export function luxFalseColor(t: number): [number, number, number] {
  const x = clamp(t, 0, 1);
  const stops: [number, [number, number, number]][] = [
    [0.0, [0.02, 0.02, 0.08]],
    [0.15, [0.1, 0.1, 0.8]],
    [0.35, [0.0, 0.75, 0.9]],
    [0.55, [0.1, 0.85, 0.2]],
    [0.75, [0.95, 0.9, 0.1]],
    [0.9, [0.95, 0.25, 0.05]],
    [1.0, [1, 1, 1]],
  ];
  for (let i = 1; i < stops.length; i++) {
    if (x <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const k = (x - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

/** 摄像机曝光: 线性 lux -> 曝光值 EV, 再做 Rec709 风格映射, 模拟过曝裁切 */
export function cameraExposure(lux: number, iso = 800, shutterSec = 1 / 50, fStop = 2.8): number {
  if (lux <= 0) return 0;
  // 标准 EV 反推 (入射式近似, 常数 K=12.5 的逆运算)
  const ev = Math.log2((fStop * fStop) / shutterSec) - Math.log2(iso / 100);
  const normalized = lux / (12.5 * Math.pow(2, ev - 3));
  // 肩部裁切: 超过 1 的部分柔和压缩, 模拟高光过曝
  return clamp(normalized < 1 ? normalized : 1 + Math.log1p(normalized - 1) * 0.35, 0, 1.18);
}

/**
 * PWM 滚动条纹: 调光频率与快门/帧率不同步时, 每行曝光积分到的占空比不同。
 * 返回给定帧、给定扫描行位置的亮度调制系数 (0..1)。
 * banding 强度 = |pwmHz 与帧频整数倍的偏差| 越大条纹越密; 直流调光(pwmHz=0)无条纹。
 */
export function pwmBandFactor(
  pwmHz: number,
  dimmer: number,
  frameTimeSec: number,
  lineFraction: number,
  frameRate: number,
  shutterSec: number,
): number {
  if (pwmHz <= 0 || dimmer <= 0) return dimmer;
  // 该行曝光窗口起点在 PWM 周期中的相位
  const lineTime = frameTimeSec + lineFraction / frameRate;
  const period = 1 / pwmHz;
  const phase = ((lineTime % period) + period) % period;
  const onTime = period * clamp(dimmer, 0, 1);
  // 快门窗口内高电平时间占比
  const windowStart = phase;
  const windowEnd = phase + shutterSec;
  const cycles = Math.floor(windowEnd / period) - Math.floor(windowStart / period);
  let onInWindow = cycles * onTime;
  const tailStart = windowStart - Math.floor(windowStart / period) * period;
  const tailEnd = windowEnd - Math.floor(windowEnd / period) * period;
  onInWindow += Math.max(0, Math.min(onTime, period) - tailStart);
  onInWindow += Math.min(tailEnd, onTime);
  return clamp(onInWindow / shutterSec, 0, 1);
}

/** 色温转 RGB (黑体辐射近似, 单位 K) */
export function cctToRgb(kelvin: number): [number, number, number] {
  const t = clamp(kelvin, 1000, 12000) / 100;
  let r: number, g: number, b: number;
  if (t <= 66) {
    r = 255;
    g = 99.47 * Math.log(t) - 161.12;
    b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04;
  } else {
    r = 329.7 * Math.pow(t - 60, -0.133);
    g = 288.12 * Math.pow(t - 60, -0.0755);
    b = 255;
  }
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

/**
 * 肤色渲染对比: 基准肤色 sRGB, 先按 CRI 降低饱和度 (低显色指数让肤色发灰),
 * 再与灯具色温光混合。CRI≥95 基本无损, CRI≤60 明显失真。
 */
export function skinToneUnderLight(
  baseSkin: [number, number, number],
  cct: number,
  cri: number,
): [number, number, number] {
  const light = cctToRgb(cct);
  const fidelity = clamp((cri - 60) / 35, 0, 1);
  const gray = baseSkin.reduce((a, b) => a + b, 0) / 3;
  const desaturated: [number, number, number] = [
    baseSkin[0] * fidelity + gray * (1 - fidelity),
    baseSkin[1] * fidelity + gray * (1 - fidelity),
    baseSkin[2] * fidelity + gray * (1 - fidelity),
  ];
  // 暖光略提红, 冷光略提蓝
  const warm = clamp((3200 - cct) / 2200, -1, 1);
  const tint: [number, number, number] = [1 + 0.12 * warm, 1, 1 - 0.12 * warm];
  return [
    clamp(desaturated[0] * light[0] * tint[0] * 1.6, 0, 1),
    clamp(desaturated[1] * light[1] * tint[1] * 1.6, 0, 1),
    clamp(desaturated[2] * light[2] * tint[2] * 1.6, 0, 1),
  ];
}

void sub; void len;
