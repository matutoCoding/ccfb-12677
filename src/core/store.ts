// IndexedDB 持久化 + 全局状态 store (发布订阅, 自动防抖保存, 全本地)
import type { AppState, Project, Venue, InventoryItem, LampModel, Attachment } from './types.ts';
import { uid } from './util.ts';

const DB_NAME = 'tld-light-design';
const DB_VERSION = 1;
const STORE = 'kv';
const BLOB_STORE = 'blobs';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      if (!db.objectStoreNames.contains(BLOB_STORE)) db.createObjectStore(BLOB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const r = tx.objectStore(store).get(key);
    r.onsuccess = () => resolve(r.result as T | undefined);
    r.onerror = () => reject(r.error);
  });
}

async function idbPut(store: string, key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function idbDel(store: string, key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

type Listener = () => void;

class Store {
  state: AppState = { venues: [], projects: [], inventory: [], lampModels: [] };
  private listeners = new Set<Listener>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  loaded = false;

  async load(): Promise<void> {
    const saved = await idbGet<AppState>(STORE, 'appstate');
    if (saved) this.state = saved;
    this.loaded = true;
    this.emit();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.state.projects.forEach(p => (p.updatedAt = Date.now()));
      void idbPut(STORE, 'appstate', this.state);
    }, 400);
  }

  /** 通用变更入口 */
  mutate(fn: (s: AppState) => void): void {
    fn(this.state);
    this.emit();
  }

  get activeProject(): Project | undefined {
    return this.state.projects.find(p => p.id === this.state.activeProjectId);
  }

  get activeVenue(): Venue | undefined {
    return this.state.venues.find(v => v.id === this.state.activeVenueId);
  }

  updateProject(id: string, fn: (p: Project) => void): void {
    this.mutate(s => {
      const p = s.projects.find(x => x.id === id);
      if (p) fn(p);
    });
  }

  updateVenue(id: string, fn: (v: Venue) => void): void {
    this.mutate(s => {
      const v = s.venues.find(x => x.id === id);
      if (v) { fn(v); v.revisedAt = Date.now(); }
    });
  }

  // ---- 附件 blob ----
  async putAttachment(venueId: string, file: File, kind: Attachment['kind']): Promise<void> {
    const key = uid('blob');
    await idbPut(BLOB_STORE, key, file);
    const att: Attachment = {
      id: uid('att'), name: file.name, kind, mime: file.type,
      size: file.size, blobKey: key, uploadedAt: Date.now(),
    };
    this.updateVenue(venueId, v => v.attachments.push(att));
  }

  async getAttachment(blobKey: string): Promise<Blob | undefined> {
    return idbGet<Blob>(BLOB_STORE, blobKey);
  }

  async removeAttachment(venueId: string, attId: string): Promise<void> {
    const venue = this.state.venues.find(v => v.id === venueId);
    const att = venue?.attachments.find(a => a.id === attId);
    if (att) await idbDel(BLOB_STORE, att.blobKey);
    this.updateVenue(venueId, v => { v.attachments = v.attachments.filter(a => a.id !== attId); });
  }

  // ---- 整工程导入导出 ----
  async exportProject(projectId: string): Promise<string> {
    const p = this.state.projects.find(x => x.id === projectId);
    if (!p) throw new Error('工程不存在');
    const blobs: Record<string, { base64: string; name: string; mime: string }> = {};
    const venue = this.state.venues.find(v => v.id === p.venueId);
    if (venue) {
      for (const att of venue.attachments) {
        const blob = await this.getAttachment(att.blobKey);
        if (blob) blobs[att.blobKey] = { base64: await blobToBase64(blob), name: att.name, mime: att.mime };
      }
    }
    return JSON.stringify({ format: 'tld-project/1', state: this.state, project: p, venue, blobs }, null, 2);
  }

  async importProject(json: string): Promise<void> {
    const data = JSON.parse(json);
    if (data.format !== 'tld-project/1') throw new Error('工程包格式不识别');
    const s = this.state;
    const project = data.project as Project;
    project.id = uid('proj');
    if (!s.projects.some(p => p.id === project.id)) s.projects.push(project);
    if (data.venue) {
      const venue = data.venue as Venue;
      if (!s.venues.some(v => v.id === venue.id)) s.venues.push(venue);
      for (const [key, b] of Object.entries(data.blobs ?? {}) as [string, { base64: string; name: string; mime: string }][]) {
        await idbPut(BLOB_STORE, key, await base64ToBlob(b.base64, b.mime));
      }
    }
    s.activeProjectId = project.id;
    s.activeVenueId = project.venueId;
    this.emit();
  }
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function base64ToBlob(base64: string, mime: string): Promise<Blob> {
  const bin = atob(base64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export const store = new Store();
export type { InventoryItem, LampModel };
