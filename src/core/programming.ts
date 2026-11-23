// 灯效编程域: 组联动、效果生成器、预设引用、cue 应用、盲编
import type {
  Fixture, FixtureGroup, FixtureParams, EffectGenerator, Cue, Preset,
} from './types.ts';
import { defaultParams } from './types.ts';
import { clamp } from './math.ts';

export const cloneParams = (p: FixtureParams): FixtureParams => ({
  ...p,
  rgb: [p.rgb[0], p.rgb[1], p.rgb[2]],
});

/**
 * 组联动: 编辑组内一台灯的参数, 其余灯按模式带偏移量自动跟随。
 * 被 excludedFromGroup 的灯不参与, 也不影响其余灯的序列位置 (按组内顺序号取模)。
 */
export function applyGroupParam(
  group: FixtureGroup,
  fixtures: Fixture[],
  editedFixtureId: string,
  param: keyof FixtureParams,
  value: number | [number, number, number],
): Fixture[] {
  const active = group.fixtureIds
    .map(id => fixtures.find(f => f.id === id))
    .filter((f): f is Fixture => !!f && !f.excludedFromGroup);
  const anchorIdx = active.findIndex(f => f.id === editedFixtureId);
  if (anchorIdx < 0) return fixtures;

  return fixtures.map(fx => {
    if (!group.fixtureIds.includes(fx.id) || fx.excludedFromGroup || fx.id === editedFixtureId) return fx;
    const idx = active.findIndex(f => f.id === fx.id);
    if (idx < 0 || !group.linkedParams.includes(param)) return fx;
    const n = active.length;
    let offsetIdx: number;
    switch (group.mode) {
      case 'symmetric':
        // 关于锚点镜像: 距锚点等距的灯得到相同偏移 (含越界回绕)
        offsetIdx = Math.abs(idx - anchorIdx);
        break;
      case 'wave':
        offsetIdx = group.direction * (idx - anchorIdx);
        break;
      case 'chase':
      default:
        offsetIdx = group.direction * (idx - anchorIdx);
        break;
    }
    const offset = offsetIdx * group.step;
    const next = cloneParams(fx.params);
    if (param === 'rgb' && Array.isArray(value)) {
      next.rgb = [value[0], value[1], value[2]];
      // rgb 无偏移语义, 组内同步
    } else if (typeof value === 'number') {
      const angleLike = param === 'pan' || param === 'tilt' || param === 'prismRotate';
      const raw = (value as number) + (angleLike ? offset : offset * 0.1);
      (next as unknown as Record<string, unknown>)[param] = angleLike ? raw : clamp(raw, 0, param === 'dimmer' ? 1 : 9999);
      if (param === 'dimmer') next.dimmer = clamp(raw, 0, 1);
      if (param === 'strobeHz') next.strobeHz = Math.max(0, raw);
    }
    return { ...fx, params: next };
  });
}

/** 效果生成器: 按相位/周期/方向输出圆形、螺旋、渐变的逐灯参数 */
export function evaluateEffect(
  effect: EffectGenerator,
  indexInSelection: number,
  selectionCount: number,
  timeSec: number,
): number {
  const { phase, period, direction, amplitude, offset, shape } = effect;
  const theta = (2 * Math.PI * timeSec * direction) / period
    + phase + (indexInSelection / Math.max(1, selectionCount)) * 2 * Math.PI;
  switch (shape) {
    case 'circle':
      // 圆形: 正弦往返 (pan/tilt 两个效果配对即画出圆)
      return offset + Math.sin(theta) * amplitude;
    case 'spiral':
      // 螺旋: 振幅随相位缓慢收放
      return offset + Math.sin(theta) * amplitude * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(theta * 0.25)));
    case 'gradient':
    default:
      // 渐变: 沿灯序的线性相位梯度, 不随时间回绕
      return offset + ((indexInSelection / Math.max(1, selectionCount - 1)) - 0.5) * 2 * amplitude
        + Math.sin(theta) * amplitude * 0.15;
  }
}

/** 把预设值落到一组灯上 (只覆盖预设包含的字段) */
export function applyPreset(fixtures: Fixture[], preset: Preset, targetIds: string[]): Fixture[] {
  return fixtures.map(fx => {
    if (!targetIds.includes(fx.id)) return fx;
    const next = cloneParams(fx.params);
    for (const [k, val] of Object.entries(preset.values)) {
      if (k === 'rgb' && Array.isArray(val)) next.rgb = [val[0], val[1], val[2]];
      else (next as unknown as Record<string, unknown>)[k] = val;
    }
    return { ...fx, params: next };
  });
}

/**
 * 应用 cue: 基础参数 <- 预设(按引用, 预设改动后重放自动跟随) <- cue 覆盖值 <- 运行效果
 * 预设以引用 id 存储而非快照, 保证"改一个预设, 所有 cue 跟着变"。
 */
export function buildCueState(
  fixtures: Fixture[],
  cue: Cue,
  presets: Preset[],
  effects: EffectGenerator[],
  timeSec = 0,
): Map<string, FixtureParams> {
  const state = new Map<string, FixtureParams>();
  const usedPresets = cue.presetIds
    .map(id => presets.find(p => p.id === id))
    .filter((p): p is Preset => !!p);

  for (const fx of fixtures) {
    let p = cloneParams(fx.params);
    for (const preset of usedPresets) {
      for (const [k, val] of Object.entries(preset.values)) {
        if (k === 'rgb' && Array.isArray(val)) p.rgb = [val[0], val[1], val[2]];
        else (p as unknown as Record<string, unknown>)[k] = val;
      }
    }
    const ov = cue.overrides[fx.id];
    if (ov) {
      for (const [k, val] of Object.entries(ov)) {
        if (k === 'rgb' && Array.isArray(val)) p.rgb = [val[0], val[1], val[2]];
        else (p as unknown as Record<string, unknown>)[k] = val;
      }
    }
    state.set(fx.id, p);
  }

  // 效果实时叠加
  const ids = fixtures.map(f => f.id);
  for (const eff of cue.effectIds.map(id => effects.find(e => e.id === id)).filter(Boolean) as EffectGenerator[]) {
    ids.forEach((id, i) => {
      const p = state.get(id)!;
      (p as unknown as Record<string, unknown>)[eff.targetParam] = evaluateEffect(eff, i, ids.length, timeSec);
    });
  }
  return state;
}

/** 两帧 cue 状态按淡入时间插值 */
export function fadeStates(
  from: Map<string, FixtureParams>,
  to: Map<string, FixtureParams>,
  t: number,
): Map<string, FixtureParams> {
  const k = clamp(t, 0, 1);
  const out = new Map<string, FixtureParams>();
  for (const [id, target] of to) {
    const a = from.get(id) ?? defaultParams();
    out.set(id, {
      ...target,
      dimmer: a.dimmer + (target.dimmer - a.dimmer) * k,
      pan: a.pan + (target.pan - a.pan) * k,
      tilt: a.tilt + (target.tilt - a.tilt) * k,
      rgb: [
        a.rgb[0] + (target.rgb[0] - a.rgb[0]) * k,
        a.rgb[1] + (target.rgb[1] - a.rgb[1]) * k,
        a.rgb[2] + (target.rgb[2] - a.rgb[2]) * k,
      ],
      strobeHz: a.strobeHz + (target.strobeHz - a.strobeHz) * k,
      zoom: a.zoom + (target.zoom - a.zoom) * k,
    });
  }
  return out;
}

/** 导演喊停: 从当前实时状态直接生成新 cue, 插回时间轴指定位置 */
export function cueFromLiveState(
  no: number,
  label: string,
  liveParams: Map<string, FixtureParams>,
  branchId: string,
  remark = '',
): Cue {
  const overrides: Cue['overrides'] = {};
  for (const [id, p] of liveParams) overrides[id] = cloneParams(p);
  return {
    id: `cue-${no}-${Math.round(performance.now())}`,
    no, label, overrides, presetIds: [], effectIds: [],
    fadeSec: 2, holdSec: 0, remark, branchId, createdAt: Date.now(),
  };
}

/** 方案分支: 从当前 cue 集合复制出试验分支, 不行可切回 (分支隔离 cue 数据) */
export function forkBranch(branches: Cue[], parentBranchId: string, newBranchId: string): Cue[] {
  return branches
    .filter(c => c.branchId === parentBranchId)
    .map(c => ({ ...c, id: `${newBranchId}-${c.no}`, branchId: newBranchId, overrides: structuredClone(c.overrides) }));
}
