// Browser VS Code (code-server) pane: availability and "open this file" requests.
import { useEffect, useState, useSyncExternalStore } from 'react';
import { showNotice } from './docs';

export interface EditorInfo {
  available: boolean;
  url: string;
  workspace: string;
}

export function useEditor(): EditorInfo | null {
  const [info, setInfo] = useState<EditorInfo | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Keep the previous object when nothing changed, so the periodic probe does not re-render
    // the whole app every 3 seconds.
    const update = (next: EditorInfo) =>
      setInfo((prev) =>
        prev && prev.available === next.available && prev.url === next.url && prev.workspace === next.workspace ? prev : next,
      );
    const probe = async () => {
      try {
        const res = await fetch('/api/editor');
        const body = (await res.json()) as EditorInfo;
        if (!cancelled) update(body);
      } catch {
        if (!cancelled) update({ available: false, url: '', workspace: '' });
      }
    };
    void probe();
    // code-server takes a few seconds to start; keep probing until it is up.
    const timer = window.setInterval(() => {
      if (!info?.available) void probe();
    }, 3000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [info?.available]);
  return info;
}

// Whether the user wants the editor pane. Off by default; remembered in localStorage.
const LS_KEY = 'kp2.editor';
let shown = (() => {
  try {
    return localStorage.getItem(LS_KEY) === '1';
  } catch {
    return false;
  }
})();
const listeners = new Set<() => void>();

export function setEditorShown(value: boolean): void {
  shown = value;
  try {
    localStorage.setItem(LS_KEY, value ? '1' : '0');
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function useEditorShown(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => shown,
  );
}

/** Parse "vscode:src/main.rs#L120" (or "#120") into a file and optional line. */
export function parseEditorLink(href: string): { file: string; line?: number } | null {
  if (!href.startsWith('vscode:')) return null;
  const [file, hash = ''] = href.slice('vscode:'.length).split('#');
  const m = /^L?(\d+)$/.exec(hash);
  if (!file) return null;
  return m ? { file: decodeURIComponent(file), line: Number(m[1]) } : { file: decodeURIComponent(file) };
}

export async function openInEditor(file: string, line?: number): Promise<void> {
  const wasShown = shown;
  setEditorShown(true); // a guide link to a file means the reader wants to see the editor
  // A freshly shown pane needs a few seconds before code-server has a window to open the file in.
  const attempts = wasShown ? 1 : 8;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch('/api/open', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, line }),
      });
      if (res.ok) return;
      const body = await res.json().catch(() => ({}));
      const msg: string = body.error ?? res.statusText;
      const retry = i < attempts - 1 && /No opened code-server/i.test(msg);
      if (!retry) {
        showNotice(res.status === 503 ? 'Editor is not running. Install code-server (brew install code-server) and restart.' : `Cannot open ${file}: ${msg}`);
        return;
      }
    } catch (err) {
      showNotice(`Cannot open ${file}: ${(err as Error).message}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

