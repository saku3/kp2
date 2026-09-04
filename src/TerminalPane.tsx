import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { TtydClient, type TtydStatus } from './ttyd';

export interface TerminalHandle {
  /** Write text to the PTY as if typed. */
  send(text: string): void;
  focus(): void;
}

interface Props {
  onReady: (handle: TerminalHandle | null) => void;
}

const wsProto = location.protocol === 'https:' ? 'wss' : 'ws';
const WS_URL = `${wsProto}://${location.host}/ws`;
const TOKEN_URL = `${location.origin}/token`;

export function TerminalPane({ onReady }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<TtydStatus>('connecting');
  const [title, setTitle] = useState('');
  const [reconnectKey, setReconnectKey] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, "SF Mono", Monaco, "DejaVu Sans Mono", monospace',
      scrollback: 5000,
      macOptionIsMeta: true,
      theme: { background: '#1e1e1e' },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(container);
    fit.fit();

    // Ctrl+Shift+C / Ctrl+Shift+V as copy/paste (Cmd+C / Cmd+V already work natively on macOS).
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || !e.shiftKey) return true;
      if (e.code === 'KeyC' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection());
        return false;
      }
      if (e.code === 'KeyV') {
        void navigator.clipboard.readText().then((t) => term.paste(t));
        return false;
      }
      return true;
    });

    const client = new TtydClient(term, {
      wsUrl: WS_URL,
      tokenUrl: TOKEN_URL,
      onStatus: setStatus,
      onTitle: setTitle,
    });
    void client.connect();

    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(container);

    onReady({
      send: (text) => client.sendInput(text),
      focus: () => term.focus(),
    });

    return () => {
      onReady(null);
      observer.disconnect();
      client.close();
      // xterm 5.5 schedules an unguarded setTimeout in Viewport on open(); disposing synchronously
      // (React StrictMode dev double-mount) makes it throw. Deferring dispose lets that timer run first.
      setTimeout(() => term.dispose(), 0);
    };
  }, [onReady, reconnectKey]);

  return (
    <div className="terminal-pane">
      <div className="terminal-bar">
        <span className={`status status-${status}`}>{status}</span>
        <span className="terminal-title">{title}</span>
        {status === 'closed' || status === 'error' ? (
          <button onClick={() => setReconnectKey((k) => k + 1)}>Reconnect</button>
        ) : null}
      </div>
      <div className="terminal-host" ref={containerRef} />
    </div>
  );
}
