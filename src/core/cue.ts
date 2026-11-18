// ============================================================
// Cue / 时间轴 / 预设联动 / 盲编 / 分支
// ============================================================
import type {
  Branch,
  Cue,
  CueFixtureState,
  FixtureParamValue,
  ID,
  ParamName,
  Preset,
  Project,
} from '../types';
import { clamp } from './math3d';

export const fade = (curve: Cue['curve'], t: number): number => {
  const x = clamp(t, 0, 1);
  switch (curve) {
    case 'ease-in':
      return x * x;
    case 'ease-out':
      return 1 - (1 - x) ** 2;
    case 's-curve':
      return x * x * (3 - 2 * x);
    case 'linear':
    default:
      return x;
  }
};

/** 解析预设引用：把 presetRefs 指向的预设值合并进 cue 状态（预设改了这里自动跟随） */
export function resolveCueState(
  state: CueFixtureState,
  presets: Map<ID, Preset>,
): FixtureParamValue {
  const out: FixtureParamValue = { ...state.params };
  if (!state.presetRefs) return out;
  for (const [param, presetId] of Object.entries(state.presetRefs) as [ParamName, ID][]) {
    const preset = presets.get(presetId);
    if (!preset) continue;
    Object.assign(out, pickParam(preset.value, param));
  }
  return out;
}

function pickParam(v: FixtureParamValue, param: ParamName): Partial<FixtureParamValue> {
  switch (param) {
    case 'dimmer': return v.dimmer !== undefined ? { dimmer: v.dimmer } : {};
    case 'position-pan': return v.pan !== undefined ? { pan: v.pan } : {};
    case 'position-tilt': return v.tilt !== undefined ? { tilt: v.tilt } : {};
    case 'color-rgb': return v.rgb ? { rgb: [...v.rgb] as [number, number, number] } : {};
    case 'color-cmy': return {};
    case 'gobo': return v.gobo !== undefined ? { gobo: v.gobo } : {};
    case 'prism': return v.prism !== undefined ? { prism: v.prism } : {};
    case 'strobe': return v.strobeHz !== undefined ? { strobeHz: v.strobeHz } : {};
    case 'zoom': return v.zoom !== undefined ? { zoom: v.zoom } : {};
    case 'focus': return v.focus !== undefined ? { focus: v.focus } : {};
    default: return {};
  }
}

/** 某时刻每台灯的生效参数（跨 cue 淡入淡出插值） */
export function stateAtTime(
  project: Project,
  timeMs: number,
  branchId: ID,
): Map<ID, FixtureParamValue> {
  const presetMap = new Map(project.presets.map((p) => [p.id, p]));
  const cues = project.cues
    .filter((c) => c.branchId === branchId)
    .sort((a, b) => a.timeMs - b.timeMs || a.number.localeCompare(b.number));

  const result = new Map<ID, FixtureParamValue>();
  if (!cues.length) return result;

  // 找到当前 cue 与上一 cue
  let idx = cues.findIndex((c) => c.timeMs > timeMs);
  if (idx === -1) idx = cues.length;
  const cur = cues[idx - 1];
  const next = cues[idx];

  const applyCue = (cue: Cue, factor: number) => {
    for (const st of cue.states) {
      const resolved = resolveCueState(st, presetMap);
      const prev = result.get(st.fixtureId) ?? {};
      result.set(st.fixtureId, blendParams(prev, resolved, factor, cue.curve));
    }
  };

  if (cur) applyCue(cur, 1);
  if (next) {
    const into = next.timeMs - (cur?.timeMs ?? next.timeMs - next.fadeInMs);
    const local = clamp(timeMs - next.timeMs + next.fadeInMs, 0, next.fadeInMs || 1);
    const k = next.fadeInMs > 0 ? fade(next.curve, local / next.fadeInMs) : 1;
    void into;
    // 下一 cue 尚未触发时不覆盖；触发后按淡入比例混合
    if (timeMs >= next.timeMs) applyCue(next, k);
  }
  return result;
}

function blendParams(a: FixtureParamValue, b: FixtureParamValue, t: number, curve: Cue['curve']): FixtureParamValue {
  const k = fade(curve, t);
  const out: FixtureParamValue = { ...a };
  for (const key of Object.keys(b) as (keyof FixtureParamValue)[]) {
    const bv = b[key];
    const av = a[key];
    if (bv === undefined) continue;
    if (typeof bv === 'number') {
      (out as Record<string, number>)[key] = av === undefined ? bv : lerpNum1(av as number, bv, k);
    } else if (Array.isArray(bv)) {
      const avArr = Array.isArray(av) ? (av as number[]) : [0, 0, 0];
      (out as Record<string, unknown>)[key] = bv.map((n, i) => lerpNum1(avArr[i] ?? 0, n as number, k));
    }
  }
  return out;
}

const lerpNum1 = (a: number, b: number, t: number): number => a + (b - a) * t;

// ---------------- 分支 ----------------

/** 开分支：从指定 cue 复制当前分支全部 cue，之后试效果不行可切回 */
export function forkBranch(project: Project, name: string, fromCueId?: ID): Project {
  const sourceBranchId = project.activeBranchId;
  const newBranch: Branch = {
    id: `branch-${project.branches.length + 1}-${randSuffix()}`,
    name,
    parentId: sourceBranchId,
    forkedFromCueId: fromCueId,
    createdAt: Date.now(),
  };
  const cutoff = fromCueId ? project.cues.find((c) => c.id === fromCueId)?.timeMs ?? Infinity : Infinity;
  const copiedCues: Cue[] = project.cues
    .filter((c) => c.branchId === sourceBranchId && c.timeMs <= cutoff)
    .map((c) => ({ ...c, id: `${c.id}-b${project.branches.length + 1}`, branchId: newBranch.id, triggerLog: [] }));
  return {
    ...project,
    branches: [...project.branches, newBranch],
    cues: [...project.cues, ...copiedCues],
    activeBranchId: newBranch.id,
  };
}

/** 导演喊停：在当前状态上改灯并存成新 cue 插回时间轴 */
export function insertCueFromLive(
  project: Project,
  states: CueFixtureState[],
  timeMs: number,
  name: string,
  note?: string,
): Project {
  const branchId = project.activeBranchId;
  const branchCues = project.cues
    .filter((c) => c.branchId === branchId)
    .sort((a, b) => a.number.localeCompare(b.number));
  const lastNo = branchCues.length ? parseFloat(branchCues[branchCues.length - 1].number) || 0 : 0;
  const cue: Cue = {
    id: `cue-${randSuffix()}`,
    number: (lastNo + 1).toFixed(2),
    name,
    timeMs,
    fadeInMs: 1000,
    fadeOutMs: 1000,
    curve: 's-curve',
    states,
    note,
    branchId,
  };
  return { ...project, cues: [...project.cues, cue] };
}

/** 演出触发留档（手动逐条） */
export function logCueTrigger(project: Project, cueId: ID, operator: string): Project {
  return {
    ...project,
    cues: project.cues.map((c) =>
      c.id === cueId
        ? { ...c, triggerLog: [...(c.triggerLog ?? []), { triggeredAt: Date.now(), operator }] }
        : c,
    ),
  };
}

/** 盲编：返回一份隔离的工程草稿，提交前不影响正在播放的预演 */
export function enterBlind(project: Project): Project {
  return structuredClone(project);
}

export function nextCue(project: Project, currentCueId?: ID): Cue | undefined {
  const cues = project.cues
    .filter((c) => c.branchId === project.activeBranchId)
    .sort((a, b) => a.timeMs - b.timeMs);
  if (!currentCueId) return cues[0];
  const i = cues.findIndex((c) => c.id === currentCueId);
  return cues[i + 1];
}

function randSuffix(): string {
  return Math.random().toString(36).slice(2, 8);
}
