// Markdown documents, exposed as a tiny external store.
//
// Two kinds of source:
//   - "server": a local directory path read by the Vite middleware (vite-docs-plugin.ts).
//               Changes arrive over Vite's HMR channel as the "docs:changed" event.
//   - "fs":     a directory picked with the File System Access API (Chrome / Edge). The browser
//               reads the files itself; changes are detected by polling lastModified.
//
// The store lives in import.meta.hot.data so a re-evaluation of this module keeps the same
// store the app subscribed to, and editing docs never re-mounts the terminal.

export type DocsSource = { kind: 'server'; dir: string } | { kind: 'fs'; handle: FileSystemDirectoryHandle };

/** A pinned folder (dir only) or document (dir + doc). Stored server-side in favorites.json. */
export interface Favorite {
  dir: string;
  doc?: string;
  label?: string;
}

export interface DocsState {
  source: DocsSource | null;
  /** Human readable location: resolved directory path, or the picked folder name. */
  label: string;
  names: string[];
  contents: Record<string, string>;
  /** The document currently shown (always one of `names` when names is non-empty). */
  docName: string | null;
  loading: boolean;
  error: string | null;
  /** A previously picked folder that needs the user to click before it can be read again. */
  pendingHandle: FileSystemDirectoryHandle | null;
  /** Short explanatory message (not an error), cleared automatically. */
  notice: string | null;
  favorites: Favorite[];
  /** Where favorites are stored on disk (shown in the UI so it can be edited by hand). */
  favoritesPath: string;
}

interface Store {
  state: DocsState;
  listeners: Set<() => void>;
  fileHandles: Map<string, FileSystemFileHandle>;
  lastModified: Map<string, number>;
  inflight: Set<string>;
  pollTimer: number | null;
  initialized: boolean;
  /** Document to select once the next folder finishes loading. */
  pendingDoc: string | null;
}

const DEFAULT_DOC = 'getting-started.md';
const LS_SOURCE = 'kp2.docsSource';
const LS_RECENT = 'kp2.recentDirs';
const FS_POLL_MS = 2000;

const initialState: DocsState = {
  source: null,
  label: '',
  names: [],
  contents: {},
  docName: null,
  loading: false,
  error: null,
  pendingHandle: null,
  notice: null,
  favorites: [],
  favoritesPath: '',
};

const store: Store = import.meta.hot?.data.store ?? {
  state: initialState,
  listeners: new Set(),
  fileHandles: new Map(),
  lastModified: new Map(),
  inflight: new Set(),
  pollTimer: null,
  initialized: false,
  pendingDoc: null,
};
// A store left behind by an older version of this module may lack newer fields.
store.state = { ...initialState, ...store.state };
store.pendingDoc ??= null;
if (import.meta.hot) import.meta.hot.data.store = store;

function setState(patch: Partial<DocsState>): void {
  store.state = { ...store.state, ...patch };
  store.listeners.forEach((l) => l());
}

export function getDocsState(): DocsState {
  return store.state;
}

export function subscribeDocs(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

export function canPickDirectory(): boolean {
  return typeof window.showDirectoryPicker === 'function';
}

function defaultDocName(names: string[]): string | null {
  return names.includes(DEFAULT_DOC) ? DEFAULT_DOC : (names[0] ?? null);
}

/** Apply a new file list, keeping (or picking) the shown document and loading it if needed. */
function setNames(names: string[]): void {
  const s = store.state;
  const wanted = store.pendingDoc ?? s.docName;
  store.pendingDoc = null;
  const docName = wanted && names.includes(wanted) ? wanted : defaultDocName(names);
  setState({ names, docName });
  syncDocUrl(docName);
  if (docName && !(docName in store.state.contents)) void loadDoc(docName);
}

/** Show a document from the current folder. */
export function selectDoc(name: string): void {
  if (!store.state.names.includes(name)) return;
  setState({ docName: name });
  syncDocUrl(name);
  if (!(name in store.state.contents)) void loadDoc(name);
}

function syncDocUrl(name: string | null): void {
  const url = new URL(location.href);
  if (name) url.searchParams.set('doc', name);
  else url.searchParams.delete('doc');
  history.replaceState(null, '', url);
}

// ---------------------------------------------------------------------------------------
// Recent directories (server kind only)

export function getRecentDirs(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(LS_RECENT) ?? '[]');
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function pushRecentDir(dir: string): void {
  try {
    const list = [dir, ...getRecentDirs().filter((d) => d !== dir)].slice(0, 8);
    localStorage.setItem(LS_RECENT, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

// ---------------------------------------------------------------------------------------
// Opening sources

function resetDocs(): void {
  store.fileHandles.clear();
  store.lastModified.clear();
  store.inflight.clear();
  if (store.pollTimer !== null) {
    clearInterval(store.pollTimer);
    store.pollTimer = null;
  }
}

/** Open a directory by path; the Vite server reads it. Optionally select a document in it. */
export async function openServerDir(dir: string, doc?: string): Promise<void> {
  resetDocs();
  store.pendingDoc = doc ?? null;
  setState({ loading: true, error: null, pendingHandle: null });
  try {
    const res = await fetch(`/api/docs?dir=${encodeURIComponent(dir)}`);
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    const source: DocsSource = { kind: 'server', dir: body.dir };
    setState({ source, label: body.dir, contents: {}, loading: false });
    setNames(body.names);
    pushRecentDir(body.dir);
    localStorage.setItem(LS_SOURCE, JSON.stringify({ kind: 'server', dir: body.dir }));
    syncUrl(body.dir);
  } catch (err) {
    setState({ loading: false, error: `Cannot open "${dir}": ${(err as Error).message}` });
  }
}

/** Open a directory with the browser's folder picker (File System Access API). */
export async function pickDirectory(): Promise<void> {
  if (!window.showDirectoryPicker) return;
  let handle: FileSystemDirectoryHandle;
  try {
    handle = await window.showDirectoryPicker({ id: 'kp2-docs', mode: 'read' });
  } catch {
    return; // user cancelled
  }
  await openHandle(handle);
}

/** Re-open the folder remembered from a previous visit (needs a user gesture for permission). */
export async function reopenPendingHandle(): Promise<void> {
  const handle = store.state.pendingHandle;
  if (!handle) return;
  if ((await handle.requestPermission({ mode: 'read' })) !== 'granted') {
    setState({ error: `Permission to read "${handle.name}" was not granted` });
    return;
  }
  await openHandle(handle);
}

async function openHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  resetDocs();
  setState({ loading: true, error: null, pendingHandle: null });
  try {
    const names = await scanHandle(handle);
    setState({ source: { kind: 'fs', handle }, label: handle.name, contents: {}, loading: false });
    setNames(names);
    await idbSet('dirHandle', handle);
    localStorage.setItem(LS_SOURCE, JSON.stringify({ kind: 'fs' }));
    syncUrl(null);
    store.pollTimer = window.setInterval(() => void pollHandle(handle), FS_POLL_MS);
  } catch (err) {
    setState({ loading: false, error: `Cannot read folder: ${(err as Error).message}` });
  }
}

async function scanHandle(dir: FileSystemDirectoryHandle, prefix = ''): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of dir.values()) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.kind === 'directory') {
      names.push(...(await scanHandle(entry as FileSystemDirectoryHandle, rel)));
    } else if (entry.name.endsWith('.md')) {
      names.push(rel);
      store.fileHandles.set(rel, entry as FileSystemFileHandle);
    }
  }
  return names.sort();
}

async function pollHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const s = store.state;
  if (s.source?.kind !== 'fs' || s.source.handle !== handle) return;
  try {
    const names = await scanHandle(handle);
    if (names.join('\n') !== s.names.join('\n')) setNames(names);
    for (const name of Object.keys(s.contents)) {
      const fh = store.fileHandles.get(name);
      if (!fh) continue;
      const file = await fh.getFile();
      if (file.lastModified !== store.lastModified.get(name)) await loadDoc(name, true);
    }
  } catch (err) {
    setState({ error: `Lost access to folder: ${(err as Error).message}` });
    resetDocs();
  }
}

// ---------------------------------------------------------------------------------------
// Loading documents

export async function loadDoc(name: string, force = false): Promise<void> {
  const s = store.state;
  if (!s.source || store.inflight.has(name)) return;
  if (!force && name in s.contents) return;
  store.inflight.add(name);
  try {
    let text: string;
    if (s.source.kind === 'server') {
      const res = await fetch(`/api/doc?dir=${encodeURIComponent(s.source.dir)}&name=${encodeURIComponent(name)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
      text = await res.text();
    } else {
      const fh = store.fileHandles.get(name);
      if (!fh) throw new Error(`No handle for ${name}`);
      const file = await fh.getFile();
      store.lastModified.set(name, file.lastModified);
      text = await file.text();
    }
    if (store.state.source === s.source) setState({ contents: { ...store.state.contents, [name]: text } });
  } catch (err) {
    setState({ error: `Cannot load ${name}: ${(err as Error).message}` });
  } finally {
    store.inflight.delete(name);
  }
}

async function refreshServerList(dir: string): Promise<void> {
  const res = await fetch(`/api/docs?dir=${encodeURIComponent(dir)}`);
  if (!res.ok) return;
  const body = await res.json();
  const s = store.state;
  if (s.source?.kind === 'server' && s.source.dir === dir) setNames(body.names);
}

// Live updates from the Vite server (dev mode only).
import.meta.hot?.on('docs:changed', (data: { dir: string; name: string; event: string }) => {
  const s = store.state;
  if (s.source?.kind !== 'server' || s.source.dir !== data.dir) return;
  void refreshServerList(data.dir);
  if (data.name in s.contents) {
    if (data.event === 'unlink') {
      const contents = { ...s.contents };
      delete contents[data.name];
      setState({ contents });
    } else {
      void loadDoc(data.name, true);
    }
  }
});

// ---------------------------------------------------------------------------------------
// Favorites (server-side favorites.json)

function sameFavorite(a: Favorite, b: Favorite): boolean {
  return a.dir === b.dir && (a.doc ?? '') === (b.doc ?? '');
}

export function isFavorite(fav: Favorite): boolean {
  return store.state.favorites.some((f) => sameFavorite(f, fav));
}

/** The current folder / document as a favorite candidate, or null when it cannot be pinned. */
export function currentFavorite(withDoc: boolean): Favorite | null {
  const s = store.state;
  if (s.source?.kind !== 'server') return null; // picked folders have no path to store
  if (!withDoc) return { dir: s.source.dir };
  return s.docName ? { dir: s.source.dir, doc: s.docName } : null;
}

export async function loadFavorites(): Promise<void> {
  try {
    const res = await fetch('/api/favorites');
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    setState({ favorites: body.favorites, favoritesPath: body.path });
  } catch (err) {
    setState({ error: `Cannot load favorites: ${(err as Error).message}` });
  }
}

async function saveFavorites(favorites: Favorite[]): Promise<void> {
  try {
    const res = await fetch('/api/favorites', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ favorites }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.error ?? res.statusText);
    setState({ favorites: body.favorites, favoritesPath: body.path });
  } catch (err) {
    setState({ error: `Cannot save favorites: ${(err as Error).message}` });
  }
}

let noticeTimer: number | null = null;
export function showNotice(message: string): void {
  setState({ notice: message });
  if (noticeTimer !== null) clearTimeout(noticeTimer);
  noticeTimer = window.setTimeout(() => setState({ notice: null }), 5000);
}

export const PICKED_FOLDER_NOTICE =
  'This folder was chosen with the browser picker, so its path is unknown. Open it by path to pin it.';

export function toggleFavorite(fav: Favorite): Promise<void> {
  const list = store.state.favorites;
  const next = isFavorite(fav) ? list.filter((f) => !sameFavorite(f, fav)) : [...list, fav];
  return saveFavorites(next);
}

export function openFavorite(fav: Favorite): Promise<void> {
  return openServerDir(fav.dir, fav.doc);
}

import.meta.hot?.on('favorites:changed', () => void loadFavorites());

// ---------------------------------------------------------------------------------------
// Startup: restore the last source (URL ?dir= wins, then localStorage, then the server default)

function syncUrl(dir: string | null): void {
  const url = new URL(location.href);
  if (dir) url.searchParams.set('dir', dir);
  else url.searchParams.delete('dir');
  history.replaceState(null, '', url);
}

async function initDocs(): Promise<void> {
  void loadFavorites();
  const params = new URLSearchParams(location.search);
  const doc = params.get('doc') ?? undefined;
  const fromUrl = params.get('dir');
  if (fromUrl) return openServerDir(fromUrl, doc);

  let saved: { kind: string; dir?: string } | null = null;
  try {
    saved = JSON.parse(localStorage.getItem(LS_SOURCE) ?? 'null');
  } catch {
    /* ignore */
  }
  if (saved?.kind === 'fs' && canPickDirectory()) {
    const handle = await idbGet<FileSystemDirectoryHandle>('dirHandle').catch(() => null);
    if (handle) {
      if ((await handle.queryPermission({ mode: 'read' })) === 'granted') {
        store.pendingDoc = doc ?? null;
        return openHandle(handle);
      }
      setState({ pendingHandle: handle, label: handle.name });
      return;
    }
  }
  return openServerDir(saved?.kind === 'server' && saved.dir ? saved.dir : '', doc);
}

if (!store.initialized) {
  store.initialized = true;
  void initDocs();
}

import.meta.hot?.accept();

// ---------------------------------------------------------------------------------------
// Tiny IndexedDB helper (directory handles can be persisted there, not in localStorage)

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kp2', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await idb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
