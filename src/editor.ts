// Browser VS Code (code-server) pane: availability and "open this file" requests.
import { useEffect, useState } from 'react';
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
    const probe = async () => {
      try {
        const res = await fetch('/api/editor');
        const body = (await res.json()) as EditorInfo;
        if (!cancelled) setInfo(body);
      } catch {
        if (!cancelled) setInfo({ available: false, url: '', workspace: '' });
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

/** Parse "vscode:src/main.rs#L120" (or "#120") into a file and optional line. */
export function parseEditorLink(href: string): { file: string; line?: number } | null {
  if (!href.startsWith('vscode:')) return null;
  const [file, hash = ''] = href.slice('vscode:'.length).split('#');
  const m = /^L?(\d+)$/.exec(hash);
  if (!file) return null;
  return m ? { file: decodeURIComponent(file), line: Number(m[1]) } : { file: decodeURIComponent(file) };
}

export async function openInEditor(file: string, line?: number): Promise<void> {
  try {
    const res = await fetch('/api/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, line }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const msg: string = body.error ?? res.statusText;
      showNotice(res.status === 503 ? 'Editor is not running. Install code-server (brew install code-server) and restart.' : `Cannot open ${file}: ${msg}`);
    }
  } catch (err) {
    showNotice(`Cannot open ${file}: ${(err as Error).message}`);
  }
}
