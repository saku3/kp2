import { useState, type FormEvent } from 'react';
import {
  canPickDirectory,
  getRecentDirs,
  openServerDir,
  pickDirectory,
  reopenPendingHandle,
  type DocsState,
} from './docs';

interface Props {
  docs: DocsState;
  docName: string | null;
  onSelectDoc: (name: string) => void;
}

export function DocsPicker({ docs, docName, onSelectDoc }: Props) {
  const [input, setInput] = useState('');
  const recents = getRecentDirs();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void openServerDir(input.trim());
  };

  return (
    <div className="docs-picker">
      <form className="docs-form" onSubmit={submit}>
        <input
          list="kp2-recent-dirs"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="~/path/to/docs  (empty = default)"
          spellCheck={false}
        />
        <datalist id="kp2-recent-dirs">
          {recents.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
        <button type="submit" disabled={docs.loading}>Open</button>
        {canPickDirectory() && (
          <button type="button" title="Choose a folder with the browser's picker" onClick={() => void pickDirectory()}>
            📁 Folder
          </button>
        )}
      </form>

      {docs.pendingHandle ? (
        <button className="docs-reopen" onClick={() => void reopenPendingHandle()}>
          Re-open {docs.label}
        </button>
      ) : (
        <span className="docs-label" title={docs.label}>{docs.label}</span>
      )}

      {docs.names.length > 0 && (
        <select value={docName ?? ''} onChange={(e) => onSelectDoc(e.target.value)}>
          {docs.names.map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
      )}

      {docs.error && <span className="docs-error" title={docs.error}>{docs.error}</span>}
    </div>
  );
}
