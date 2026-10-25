// Placeholders in code blocks: `{{NAME}}` is replaced by a value the reader types in the browser,
// so a shared runbook stays untouched while each reader runs it against their own environment.
//
// Only an upper-case identifier counts (`{{CLUSTER}}`, `{{AWS_REGION}}`), so Go/Helm template
// code such as `{{ .Values.x }}` or `{{end}}` shown in a runbook is left alone.
//
// Values are kept per document in localStorage, so filling in a runbook never changes what
// another runbook in the folder runs, and they must not leak to other people when kp2 runs
// behind a proxy.
import { useSyncExternalStore } from 'react';

export const PLACEHOLDER = /\{\{([A-Z][A-Z0-9_]*)\}\}/g;

export type Segment = string | { name: string };

/** Split text into literal runs and placeholder references, in order. */
export function splitPlaceholders(text: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push({ name: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export type VarValues = Readonly<Record<string, string>>;

/** Replace every placeholder that has a non-empty value; the others are left as written. */
export function substitute(text: string, values: VarValues): string {
  return text.replace(PLACEHOLDER, (whole, name: string) => values[name] || whole);
}

/** Placeholder names in `text` that have no value yet (deduplicated, in order of appearance). */
export function missingVars(text: string, values: VarValues): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(PLACEHOLDER)) {
    if (!values[m[1]] && !out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

// --- store -------------------------------------------------------------------------------------

const LS_PREFIX = 'kp2.vars:';
const cache = new Map<string, VarValues>();
const listeners = new Set<() => void>();
const EMPTY: VarValues = {};

function load(scope: string): VarValues {
  const hit = cache.get(scope);
  if (hit) return hit;
  let values: VarValues = EMPTY;
  try {
    const raw = localStorage.getItem(LS_PREFIX + scope);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        values = Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as VarValues;
      }
    }
  } catch {
    // Unreadable storage or a broken entry: start empty, the next edit overwrites it.
  }
  cache.set(scope, values);
  return values;
}

export function setVar(scope: string, name: string, value: string): void {
  const next = { ...load(scope) };
  if (value) next[name] = value;
  else delete next[name];
  cache.set(scope, next);
  try {
    if (Object.keys(next).length) localStorage.setItem(LS_PREFIX + scope, JSON.stringify(next));
    else localStorage.removeItem(LS_PREFIX + scope);
  } catch {
    // Storage unavailable (private window, quota): values still work for this page load.
  }
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Values for one folder; re-renders when any of them changes. */
export function useVars(scope: string): VarValues {
  return useSyncExternalStore(subscribe, () => load(scope));
}
