// ============================================================
// 灯效引擎
// - 同型号组调一台，其余按 symmetric / wave / chase 自动带相位偏移
// - 相位步进、方向可调；临时剔除某台不影响剩余灯继续跑
// - 内置生成器：圆形 / 螺旋 / 渐变（相位、周期、方向参数化）
// 纯函数：给定时间与配置，输出每台灯的参数值
// ============================================================
import type { FixtureGroup, FixtureParamValue, FxConfig, ID } from '../types';
import { clamp, wrapAngle } from './math3d';

export interface FxOutput {
  fixtureId: ID;
  params: FixtureParamValue;
  /** 该灯当前相位（rad），调试/可视化用 */
  phase: number;
}

/** 组内有效成员（剔除临时踢出的灯），保持原始排序 */
export function activeMembers(group: FixtureGroup): ID[] {
  const excluded = new Set(group.excludedIds);
  return group.fixtureIds.filter((id) => !excluded.has(id));
}

/**
 * 计算每台灯的相位。
 * - symmetric：以组中心为轴镜像（1,2,3…3,2,1）
 * - wave：线性递增相位
 * - chase：追逐，方向决定相位递增方向并做环形首尾衔接
 */
export function memberPhases(group: FixtureGroup, cfg: FxConfig): { fixtureId: ID; phase: number }[] {
  const members = activeMembers(group);
  const n = members.length;
  return members.map((fixtureId, i) => {
    let order: number;
    switch (cfg.mode) {
      case 'symmetric': {
        // 镜像序号：0,1,2,...,ceil(n/2),...,2,1,0
        order = i < Math.ceil(n / 2) ? i : n - 1 - i;
        break;
      }
      case 'chase': {
        order = cfg.direction === 1 ? i : n - 1 - i;
        break;
      }
      case 'wave':
      default:
        order = i;
        break;
    }
    return { fixtureId, phase: normalizeZero(wrapAngle(order * cfg.phaseStep * cfg.direction)) };
  });
}

/** 内置生成器：由相位与时间产出 0..1 标量（或二维圆轨迹） */
export function generatorShape(
  cfg: FxConfig,
  phase: number,
  timeMs: number,
): { scalar: number; x: number; y: number } {
  const t = ((timeMs % cfg.periodMs) / cfg.periodMs) * Math.PI * 2 * cfg.direction + phase;
  switch (cfg.shape) {
    case 'circle':
      return { scalar: (Math.sin(t) + 1) / 2, x: Math.cos(t), y: Math.sin(t) };
    case 'spiral': {
      // 螺旋：半径随周期内推进收缩/扩张
      const r = 0.2 + 0.8 * ((timeMs % cfg.periodMs) / cfg.periodMs);
      return { scalar: (Math.sin(t) + 1) / 2, x: r * Math.cos(t), y: r * Math.sin(t) };
    }
    case 'gradient':
    default:
      return { scalar: (Math.sin(t - Math.PI / 2) + 1) / 2, x: 0, y: 0 };
  }
}

/** 应用一条 FX 配置，产出组内每台灯在 timeMs 时刻的参数 */
export function applyFx(group: FixtureGroup, cfg: FxConfig, timeMs: number): FxOutput[] {
  const phases = memberPhases(group, cfg);
  return phases.map(({ fixtureId, phase }) => {
    const g = generatorShape(cfg, phase, timeMs);
    const value = cfg.base + cfg.amplitude * (g.scalar * 2 - 1);
    const params = writeParam({}, cfg.param, value, g, cfg);
    return { fixtureId, params, phase };
  });
}

function writeParam(
  out: FixtureParamValue,
  param: keyof FixtureParamValue,
  value: number,
  g: { x: number; y: number },
  cfg: FxConfig,
): FixtureParamValue {
  switch (param) {
    case 'dimmer':
      out.dimmer = clamp(value, 0, 1);
      break;
    case 'pan':
      out.pan = value;
      break;
    case 'tilt':
      out.tilt = value;
      break;
    case 'strobeHz':
      out.strobeHz = Math.max(0, value);
      break;
    case 'zoom':
      out.zoom = clamp(value, 0, 1);
      break;
    case 'focus':
      out.focus = clamp(value, 0, 1);
      break;
    case 'rgb':
      // 圆形/螺旋生成器驱动色环
      out.rgb = hslToRgb(((Math.atan2(g.y, g.x) / (Math.PI * 2)) + 1) % 1, 0.85, 0.5);
      break;
    case 'gobo':
      out.gobo = Math.round(value);
      break;
    case 'prism':
      out.prism = Math.round(value);
      break;
    default:
      void cfg;
  }
  return out;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

/** 临时剔除/恢复某台灯（返回新组，不可变更新） */
export function toggleExclude(group: FixtureGroup, fixtureId: ID): FixtureGroup {
  const excluded = new Set(group.excludedIds);
  if (excluded.has(fixtureId)) excluded.delete(fixtureId);
  else excluded.add(fixtureId);
  return { ...group, excludedIds: [...excluded] };
}

/** 消除 -0，保证相位比较稳定 */
const normalizeZero = (x: number): number => (Object.is(x, -0) ? 0 : x);
