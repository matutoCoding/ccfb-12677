// 全局状态（zustand）：工程/场馆/库存 CRUD + 引擎动作 + 自动持久化
import { create } from 'zustand';
import type {
  AppState,
  FixtureGroup,
  FixtureInstance,
  ID,
  Project,
  ReviewComment,
  ReviewStatus,
  Venue,
} from '../types';
import { loadState, saveState } from './storage';
import { makeInitialState } from './sample-data';
import { addComment, mergeFeedback, transitionStatus } from '../core/review';
import { toggleExclude } from '../core/fx';
import { insertCueFromLive, logCueTrigger } from '../core/cue';

interface Store extends AppState {
  loaded: boolean;
  init: () => Promise<void>;
  replaceAll: (s: AppState) => void;

  // 工程
  activeProject: () => Project | undefined;
  updateProject: (id: ID, fn: (p: Project) => Project) => void;
  setActiveProject: (id: ID) => void;
  setActiveVenue: (venueId: ID) => void;
  setBlindMode: (on: boolean) => void;

  // 场馆
  upsertVenue: (v: Venue) => void;
  reviseVenue: (venueId: ID, revision: Venue['revisions'][number]) => void;
  addAttachment: (venueId: ID, att: Venue['attachments'][number]) => void;

  // 灯具/组
  updateFixture: (fixtureId: ID, patch: Partial<FixtureInstance>) => void;
  toggleGroupExclude: (groupId: ID, fixtureId: ID) => void;
  addGroup: (g: FixtureGroup) => void;

  // 评审
  addReviewComment: (input: Omit<ReviewComment, 'id' | 'status' | 'createdAt'>) => void;
  setCommentStatus: (commentId: ID, status: ReviewStatus) => void;
  importFeedback: (comments: ReviewComment[]) => void;

  // cue
  insertLiveCue: (states: Project['cues'][number]['states'], timeMs: number, name: string, note?: string) => void;
  triggerCue: (cueId: ID, operator: string) => void;
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const scheduleSave = (state: AppState) => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void saveState({
      version: state.version,
      venues: state.venues,
      projects: state.projects,
      inventory: state.inventory,
      bookings: state.bookings,
      activeProjectId: state.activeProjectId,
      blindMode: state.blindMode,
    });
  }, 300);
};

export const useStore = create<Store>((set, get) => ({
  ...makeInitialState(),
  loaded: false,

  init: async () => {
    const persisted = await loadState();
    if (persisted) set({ ...persisted, loaded: true });
    else set({ loaded: true });
  },

  replaceAll: (s) => set({ ...s, loaded: true }),

  activeProject: () => {
    const { projects, activeProjectId } = get();
    return activeProjectId ? projects[activeProjectId] : undefined;
  },

  updateProject: (id, fn) =>
    set((st) => {
      const prev = st.projects[id];
      if (!prev) return st;
      const next = { ...fn(prev), updatedAt: Date.now() };
      const projects = { ...st.projects, [id]: next };
      const newState = { ...st, projects };
      scheduleSave(newState);
      return { projects };
    }),

  setActiveProject: (id) =>
    set((st) => {
      const next = { ...st, activeProjectId: id };
      scheduleSave(next);
      return { activeProjectId: id };
    }),

  setActiveVenue: (venueId) => {
    const pid = get().activeProjectId;
    if (pid) get().updateProject(pid, (p) => ({ ...p, activeVenueId: venueId }));
  },

  setBlindMode: (on) =>
    set((st) => {
      const next = { ...st, blindMode: on };
      scheduleSave(next);
      return { blindMode: on };
    }),

  upsertVenue: (v) =>
    set((st) => {
      const venues = { ...st.venues, [v.id]: { ...v, updatedAt: Date.now() } };
      const next = { ...st, venues };
      scheduleSave(next);
      return { venues };
    }),

  reviseVenue: (venueId, revision) => {
    const st = get();
    const venue = st.venues[venueId];
    if (!venue) return;
    get().upsertVenue({ ...venue, revisions: [...venue.revisions, revision] });
  },

  addAttachment: (venueId, att) => {
    const st = get();
    const venue = st.venues[venueId];
    if (!venue) return;
    get().upsertVenue({ ...venue, attachments: [...venue.attachments, att] });
  },

  updateFixture: (fixtureId, patch) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => ({
      ...p,
      fixtures: p.fixtures.map((f) => (f.id === fixtureId ? { ...f, ...patch } : f)),
    }));
  },

  toggleGroupExclude: (groupId, fixtureId) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => ({
      ...p,
      groups: p.groups.map((g) => (g.id === groupId ? toggleExclude(g, fixtureId) : g)),
    }));
  },

  addGroup: (g) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => ({ ...p, groups: [...p.groups, g] }));
  },

  addReviewComment: (input) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => addComment(p, input));
  },

  setCommentStatus: (commentId, status) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => transitionStatus(p, commentId, status));
  },

  importFeedback: (comments) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => mergeFeedback(p, comments));
  },

  insertLiveCue: (states, timeMs, name, note) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => insertCueFromLive(p, states, timeMs, name, note));
  },

  triggerCue: (cueId, operator) => {
    const pid = get().activeProjectId;
    if (!pid) return;
    get().updateProject(pid, (p) => logCueTrigger(p, cueId, operator));
  },
}));
