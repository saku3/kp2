import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { getDocsState, selectDoc, subscribeDocs } from './docs';
import { DocsPicker } from './DocsPicker';
import { useEditor } from './editor';
import { SplitPane } from './SplitPane';
import { Guide } from './Guide';
import { TerminalPane, type TerminalHandle } from './TerminalPane';

export function App() {
  const docs = useSyncExternalStore(subscribeDocs, getDocsState);
  const docName = docs.docName;
  const editor = useEditor();

  // Start each document at the top (switching via a link or the dropdown).
  const guideRef = useRef<HTMLElement>(null);
  useEffect(() => {
    guideRef.current?.scrollTo({ top: 0 });
  }, [docName]);

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
        <DocsPicker docs={docs} />
      </header>
      <main className="panes">
        <section className="pane pane-guide" ref={guideRef}>
          <Guide markdown={markdown} docName={docName} names={docs.names} onNavigate={selectDoc} onInsert={insert} onRun={run} />
        </section>
        <section className="pane pane-right">
          {editor?.available ? (
            <SplitPane
              storageKey="kp2.editorSplit"
              top={<iframe className="editor-frame" src={editor.url} title="Editor" allow="clipboard-read; clipboard-write" />}
              bottom={<TerminalPane onReady={onReady} />}
            />
          ) : (
            <TerminalPane onReady={onReady} />
          )}
        </section>
      </main>
    </div>
  );
}
