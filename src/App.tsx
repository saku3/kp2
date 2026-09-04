import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { defaultDocName, getDocsState, loadDoc, subscribeDocs } from './docs';
import { DocsPicker } from './DocsPicker';
import { Guide } from './Guide';
import { TerminalPane, type TerminalHandle } from './TerminalPane';

export function App() {
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);

  // ?doc=<name> selects a document; fall back to the default when it is not in the directory.
  const [requested, setRequested] = useState<string | null>(() => new URLSearchParams(location.search).get('doc'));
  const docName = requested && docs.names.includes(requested) ? requested : defaultDocName(docs.names);

  useEffect(() => {
    if (docName && !(docName in docs.contents)) void loadDoc(docName);
  }, [docName, docs.contents, docs.source]);

  const selectDoc = (name: string) => {
    setRequested(name);
    const url = new URL(location.href);
    url.searchParams.set('doc', name);
    history.replaceState(null, '', url);
  };

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

  let markdown: string;
  if (docName && docName in docs.contents) markdown = docs.contents[docName];
  else if (docs.loading || (docName && docs.source)) markdown = '_Loading…_';
  else if (docs.source) markdown = `# No markdown files\n\nNo \`.md\` files were found in \`${docs.label}\`.`;
  else markdown = '# No directory opened\n\nEnter a path above, or pick a folder.';

  return (
    <div className="app">
      <header className="app-header">
        <span className="app-title">Guide</span>
        <DocsPicker docs={docs} docName={docName} onSelectDoc={selectDoc} />
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
