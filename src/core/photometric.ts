// ============================================================
// 照度与光学引擎
// - 台面照度网格（余弦定律 + 光束角衰减），lux 伪彩色带
// - 演区平均照度 / 均匀度（min:avg）
// - 电视摄像机曝光模拟（快门积分 + 曝光指数）
// - PWM 调光滚动条纹（快门与 PWM 不同步的时间混叠）
// - 色温 / 显色指数对肤色的影响对比
// 纯计算模块，渲染层只负责把数值画出来
// ============================================================
import type { FixtureDefinition, FixtureInstance, Vec3 } from '../types';
import { clamp, dist, norm, sub } from './math3d';

export interface LuxSample {
  position: Vec3;
  lux: number;
}

export interface LuxGrid {
  /** 规则网格，行优先，length = nx*ny */
  samples: LuxSample[];
  nx: number;
  ny: number;
  spacingMm: number;
  origin: Vec3;
  maxLux: number;
  minLux: number;
  avgLux: number;
}

/** 单灯在台面点上的直射照度（lm/距离² × 入射角余弦 × 光束聚光因子） */
export function illuminanceAt(
  fx: FixtureInstance,
  def: FixtureDefinition,
  point: Vec3,
  dimmer = 1,
): number {
  const toPoint = sub(point, fx.position);
  const d = dist(point, fx.position);
  if (d < 1) return 0;
  const beamDir = beamDirection(fx);
  const cosInc = clamp(-norm(toPoint).x * beamDir.x - norm(toPoint).y * beamDir.y - norm(toPoint).z * beamDir.z, 0, 1);
  if (cosInc <= 0) return 0;

  // 与光束轴夹角：超出最大光束角即截止
  const cosAngle = clamp(
    beamDir.x * norm(toPoint).x + beamDir.y * norm(toPoint).y + beamDir.z * norm(toPoint).z,
    -1,
    1,
  );
  const angle = Math.acos(cosAngle);
  const beamLimit = def.beam.maxBeamAngleRad;
  if (angle > beamLimit) return 0;
  const focus = 1 - clamp(angle / beamLimit, 0, 1); // 中心亮边缘暗
  const spotFactor = 0.15 + 0.85 * focus * focus;

  const e = (def.beam.lumens * dimmer * cosInc * spotFactor) / (d * d * 1e-6); // mm²→m²
  return e;
}

export function beamDirection(fx: FixtureInstance): Vec3 {
  const { x: pan, y: tilt } = fx.rotation;
  const cp = Math.cos(pan);
  const sp = Math.sin(pan);
  const ct = Math.cos(tilt);
  const st = Math.sin(tilt);
  // 吊挂灯默认朝下，pan 绕 z，tilt 在 pan 平面内
  const dir: Vec3 = { x: sp * ct, y: -cp * ct, z: -st };
  return norm(dir);
}

export function computeLuxGrid(
  fixtures: FixtureInstance[],
  definitions: Map<string, FixtureDefinition>,
  area: { origin: Vec3; width: number; depth: number },
  resolutionMm: number,
  dimmerByFixture?: Map<string, number>,
): LuxGrid {
  const nx = Math.max(2, Math.round(area.width / resolutionMm) + 1);
  const ny = Math.max(2, Math.round(area.depth / resolutionMm) + 1);
  const samples: LuxSample[] = new Array(nx * ny);
  let maxLux = 0;
  let minLux = Infinity;
  let sumLux = 0;

  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) {
      const position: Vec3 = {
        x: area.origin.x + ix * resolutionMm,
        y: area.origin.y + iy * resolutionMm,
        z: area.origin.z,
      };
      let lux = 0;
      for (const fx of fixtures) {
        if (fx.dark) continue;
        const def = definitions.get(fx.definitionId);
        if (!def) continue;
        lux += illuminanceAt(fx, def, position, dimmerByFixture?.get(fx.id) ?? 1);
      }
      const idx = iy * nx + ix;
      samples[idx] = { position, lux };
      maxLux = Math.max(maxLux, lux);
      minLux = Math.min(minLux, lux);
      sumLux += lux;
    }
  }
  return {
    samples,
    nx,
    ny,
    spacingMm: resolutionMm,
    origin: area.origin,
    maxLux,
    minLux: minLux === Infinity ? 0 : minLux,
    avgLux: sumLux / samples.length,
  };
}

/** 关键演区统计：平均照度与均匀度 min/avg（国标常用 min:avg） */
export function zoneUniformity(grid: LuxGrid, rect: { x0: number; y0: number; x1: number; y1: number }) {
  const vals: number[] = [];
  for (const s of grid.samples) {
    if (s.position.x >= rect.x0 && s.position.x <= rect.x1 && s.position.y >= rect.y0 && s.position.y <= rect.y1) {
      vals.push(s.lux);
    }
  }
  if (!vals.length) return { avg: 0, min: 0, uniformity: 0 };
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
  const min = Math.min(...vals);
  return { avg, min, uniformity: avg > 0 ? min / avg : 0 };
}

/** lux → 伪彩色（蓝-青-绿-黄-红对数刻度） */
export function luxFalseColor(lux: number, maxLux: number): [number, number, number] {
  if (maxLux <= 0 || lux <= 0) return [0.08, 0.08, 0.12];
  const t = clamp(Math.log10(1 + lux) / Math.log10(1 + maxLux), 0, 1);
  const stops: [number, [number, number, number]][] = [
    [0.0, [0.1, 0.15, 0.55]],
    [0.25, [0.1, 0.6, 0.8]],
    [0.5, [0.2, 0.8, 0.3]],
    [0.75, [0.95, 0.85, 0.2]],
    [1.0, [0.9, 0.15, 0.1]],
  ];
  for (let i = 0; i < stops.length - 1; i++) {
    const [t0, c0] = stops[i];
    const [t1, c1] = stops[i + 1];
    if (t >= t0 && t <= t1) {
      const k = (t - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return stops[stops.length - 1][1];
}

// ---------------- 摄像机与 PWM ----------------

export interface CameraModel {
  /** 快门速度 ms */
  shutterMs: number;
  /** 帧率 fps */
  fps: number;
  /** 目标曝光 lux（入射式测光基准） */
  targetLux: number;
}

/** 曝光效果：把场景 lux 映射为 0..1 亮度，含削顶（过曝）与抬黑 */
export function cameraExposure(lux: number, cam: CameraModel): number {
  // 快门越长进光越多，按与 20ms(1/50) 基准比例
  const shutterGain = cam.shutterMs / 20;
  const ev = (lux * shutterGain) / cam.targetLux;
  return clamp(ev, 0, 1.25); // >1 为过曝削顶区
}

export interface PwmFrame {
  /** 每条扫描行的亮度系数（行 0=画面顶部），用于渲染滚动条纹 */
  rowGain: number[];
  /** 条纹可见度 0..1 */
  bandingStrength: number;
}

/**
 * PWM 滚动条纹：摄像机逐行曝光（卷帘快门），每行积分时间窗内 PWM 占空比。
 * 当 PWM 频率与快门/帧率不同步时，每行积分起点相位不同 → 明暗相间滚动条。
 */
export function pwmRollingBands(
  pwmHz: number,
  dimmer: number,
  cam: CameraModel,
  frameRows = 1080,
  readoutMs = 15,
): PwmFrame {
  if (pwmHz <= 0 || dimmer <= 0) {
    return { rowGain: new Array(frameRows).fill(1), bandingStrength: 0 };
  }
  const pwmPeriodMs = 1000 / pwmHz;
  const rowGain = new Array<number>(frameRows);
  // 每行曝光起点在整帧 readout 内依次延后
  for (let row = 0; row < frameRows; row++) {
    const rowStartMs = (row / frameRows) * readoutMs;
    rowGain[row] = integratePwm(rowStartMs, cam.shutterMs, pwmPeriodMs, dimmer);
  }
  // 同步（整数倍关系）时每行起始相位一致，条纹消失
  const ratio = pwmHz / cam.fps;
  const synchronized = Math.abs(ratio - Math.round(ratio)) < 0.02;
  const variance = varianceOf(rowGain);
  const bandingStrength = synchronized ? 0 : clamp(Math.sqrt(variance) * 2, 0, 1);
  return { rowGain, bandingStrength };
}

/** 数值积分一个快门窗口内 PWM 平均亮度（过采样，保证逐行相位差异可被捕获） */
function integratePwm(startMs: number, windowMs: number, periodMs: number, duty: number): number {
  // 每个 PWM 周期至少 8 个采样，且整窗不少于 64 个
  const steps = Math.max(64, Math.ceil((windowMs / periodMs) * 8));
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const t = startMs + (i / steps) * windowMs;
    const phase = (t % periodMs) / periodMs;
    sum += phase < duty ? 1 : 0;
  }
  return sum / steps;
}

function varianceOf(xs: number[]): number {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length;
}

// ---------------- 色温 / 显色 / 肤色 ----------------

export interface SkinRender {
  /** 肤色在该光源下的 RGB（sRGB 近似，0..1） */
  rgb: [number, number, number];
  /** 色彩还原评分 0..100，受 CRI 影响 */
  fidelity: number;
  /** 冷暖描述 */
  tone: string;
}

/**
 * 不同灯具 CCT/CRI 打到演员肤色上的对比。
 * 基准肤色（D65 下 sRGB 约 0.74,0.55,0.44），按黑体轨迹近似光源色度加权，
 * CRI 越低去饱和越明显。
 */
export function renderSkinUnder(cctK: number, cri: number): SkinRender {
  const base: [number, number, number] = [0.74, 0.55, 0.44];
  // 黑体辐射色度的粗近似：低色温偏暖(R 高 B 低)，高色温偏冷
  const warm = clamp((6500 - cctK) / 5000, -0.3, 0.5);
  const tint: [number, number, number] = [1 + warm * 0.35, 1 - warm * 0.05, 1 - warm * 0.55];
  const fidelity = clamp(cri, 0, 100);
  const desat = 1 - fidelity / 100; // 低 CRI 拉向灰
  const rgb = base.map((c, i) => {
    const tinted = c * tint[i];
    const gray = 0.5;
    return clamp(tinted * (1 - desat * 0.6) + gray * desat * 0.6, 0, 1);
  }) as [number, number, number];
  const tone = cctK < 3200 ? '暖钨丝感' : cctK < 4500 ? '中性偏暖' : cctK < 6000 ? '日光中性' : '冷日光感';
  return { rgb, fidelity, tone };
}
