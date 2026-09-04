import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { getDocs, subscribeDocs } from './docs';
import { Guide } from './Guide';
import { TerminalPane, type TerminalHandle } from './TerminalPane';

const DEFAULT_DOC = 'getting-started.md';

export function App() {
  // Every markdown file under docs/ is bundled (and hot-updated); pick one with ?doc=<name>.md
  const docs = useSyncExternalStore(subscribeDocs, getDocs);
  const docNames = useMemo(() => Object.keys(docs).sort(), [docs]);

  const [docName, setDocName] = useState(() => {
    const q = new URLSearchParams(location.search).get('doc');
    if (q && q in docs) return q;
    return DEFAULT_DOC in docs ? DEFAULT_DOC : docNames[0];
  });
  const markdown = docs[docName] ?? '# No docs found\n\nAdd a markdown file under `docs/`.';

  const terminalRef = useRef<TerminalHandle | null>(null);
  const onReady = useCallback((h: TerminalHandle | null) => {
    terminalRef.current = h;
  }, []);

  const insert = useCallback((cmd: string) => {
    const t = terminalRef.current;
    if (!t) return;
    // Bracketed paste keeps a multi-line snippet editable as a single input in zsh/bash.
    t.send(`\x1b[200~${cmd}\x1b[201~`);
    t.focus();
  }, []);

  const run = useCallback((cmd: string) => {
    const t = terminalRef.current;
    if (!t) return;
    t.send(`${cmd}\n`);
    t.focus();
  }, []);

  const selectDoc = (name: string) => {
    setDocName(name);
    const url = new URL(location.href);
    url.searchParams.set('doc', name);
    history.replaceState(null, '', url);
  };

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Guide</span>
        {docNames.length > 1 && (
          <select value={docName} onChange={(e) => selectDoc(e.target.value)}>
            {docNames.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        )}
      </header>
      <main className="panes">
        <section className="pane pane-guide">
          <Guide markdown={markdown} onInsert={insert} onRun={run} />
        </section>
        <section className="pane pane-terminal">
          <TerminalPane onReady={onReady} />
        </section>
      </main>
    </div>
  );
}
