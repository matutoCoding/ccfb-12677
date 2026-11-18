// ============================================================
// 本地持久化（无服务端、无网络）
// - IndexedDB：AppState JSON + 附件 Blob（吊杆图/用电单/照片）
// - 工程包：fflate 打包成 .tlpkg（含附件），可文件方式备份/互传
// ============================================================
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { AppState, Attachment } from '../types';

const DB_NAME = 'tourlight';
const DB_VERSION = 1;
const STORE_STATE = 'state';
const STORE_BLOBS = 'blobs';
const STATE_KEY = 'app';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_STATE)) db.createObjectStore(STORE_STATE);
      if (!db.objectStoreNames.contains(STORE_BLOBS)) db.createObjectStore(STORE_BLOBS);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function loadState(): Promise<AppState | null> {
  const db = await openDb();
  const raw = await tx(db, STORE_STATE, 'readonly', (s) => s.get(STATE_KEY) as IDBRequest<AppState | undefined>);
  db.close();
  return raw ?? null;
}

export async function saveState(state: AppState): Promise<void> {
  const db = await openDb();
  await tx(db, STORE_STATE, 'readwrite', (s) => s.put(state, STATE_KEY));
  db.close();
}

export async function putBlob(id: string, blob: Blob): Promise<void> {
  const db = await openDb();
  await tx(db, STORE_BLOBS, 'readwrite', (s) => s.put(blob, id));
  db.close();
}

export async function getBlob(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  const blob = await tx(db, STORE_BLOBS, 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
  db.close();
  return blob;
}

export async function deleteBlob(id: string): Promise<void> {
  const db = await openDb();
  await tx(db, STORE_BLOBS, 'readwrite', (s) => s.delete(id));
  db.close();
}

// ---------------- 工程包（.tlpkg） ----------------

export interface ExportBundle {
  'state.json': Uint8Array;
  blobs: Record<string, Uint8Array>;
}

export async function exportProjectBundle(state: AppState): Promise<Uint8Array> {
  const db = await openDb();
  const blobIds = new Set<string>();
  for (const venue of Object.values(state.venues)) {
    for (const att of venue.attachments) blobIds.add(att.blobId);
  }
  const files: Record<string, Uint8Array> = {
    'state.json': strToU8(JSON.stringify(state, null, 2)),
  };
  for (const id of blobIds) {
    const blob = await tx(db, STORE_BLOBS, 'readonly', (s) => s.get(id) as IDBRequest<Blob | undefined>);
    if (blob) files[`blobs/${id}`] = new Uint8Array(await blob.arrayBuffer());
  }
  db.close();
  return zipSync(files, { level: 6 });
}

export async function importProjectBundle(bytes: Uint8Array): Promise<AppState> {
  const unzipped = unzipSync(bytes);
  if (!unzipped['state.json']) throw new Error('工程包缺少 state.json');
  const state = JSON.parse(strFromU8(unzipped['state.json'])) as AppState;
  const db = await openDb();
  for (const [name, data] of Object.entries(unzipped)) {
    if (!name.startsWith('blobs/')) continue;
    const id = name.slice('blobs/'.length);
    await tx(db, STORE_BLOBS, 'readwrite', (s) => s.put(new Blob([data]), id));
  }
  db.close();
  return state;
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime = 'application/octet-stream'): void {
  const blob = new Blob([bytes], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  downloadBytes(filename, strToU8(text), mime);
}

export function readFileAsBytes(file: File): Promise<Uint8Array> {
  return file.arrayBuffer().then((b) => new Uint8Array(b));
}

export function attachmentUrl(att: Attachment, blob: Blob): string {
  void att;
  return URL.createObjectURL(blob);
}
