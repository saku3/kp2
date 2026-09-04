// Markdown documents under docs/, exposed as a tiny external store.
//
// This module is its own HMR boundary: editing a .md file re-evaluates only this file,
// so App / TerminalPane are never re-rendered by Fast Refresh and the terminal keeps its
// connection. The store object lives in import.meta.hot.data so every re-evaluated instance
// of this module shares (and updates) the same store the app subscribed to.
export type Docs = Record<string, string>; // "getting-started.md" -> markdown

interface Store {
  docs: Docs;
  listeners: Set<() => void>;
}

const modules = import.meta.glob('../docs/**/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

function toDocs(mods: Record<string, string>): Docs {
  const out: Docs = {};
  for (const [path, md] of Object.entries(mods)) out[path.replace(/^\.\.\/docs\//, '')] = md;
  return out;
}

const store: Store = import.meta.hot?.data.store ?? { docs: {}, listeners: new Set() };
if (import.meta.hot) import.meta.hot.data.store = store;

store.docs = toDocs(modules);
store.listeners.forEach((l) => l());

export function getDocs(): Docs {
  return store.docs;
}

export function subscribeDocs(listener: () => void): () => void {
  store.listeners.add(listener);
  return () => store.listeners.delete(listener);
}

import.meta.hot?.accept();
