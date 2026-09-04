import { useEffect, useRef, useState, type FormEvent } from 'react';
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

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.2l1.6 1.5h6.2a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Short display name of the current source: last path segment, or the picked folder's name. */
function shortLabel(docs: DocsState): string {
  if (!docs.source && !docs.pendingHandle) return 'No folder';
  if (docs.source?.kind === 'fs') return docs.source.handle.name;
  if (docs.pendingHandle) return docs.pendingHandle.name;
  return docs.label.split('/').filter(Boolean).pop() ?? docs.label;
}

export function DocsPicker({ docs, docName, onSelectDoc }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recents = getRecentDirs().filter((d) => d !== docs.label);

  // Close on outside click / Escape; focus the input when opened.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Close once a new folder has loaded successfully.
  useEffect(() => {
    if (!docs.loading && !docs.error && docs.source) setOpen(false);
  }, [docs.label, docs.loading, docs.error, docs.source]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void openServerDir(input.trim());
  };

  return (
    <nav className="crumbs" aria-label="Document location">
      <div className="crumb-wrap" ref={popRef}>
        <button
          className={`crumb${open ? ' is-open' : ''}`}
          onClick={() => setOpen((o) => !o)}
          title={docs.label || 'Choose a folder'}
          aria-expanded={open}
        >
          <FolderIcon />
          <span className="crumb-text">{shortLabel(docs)}</span>
          <Chevron />
        </button>

        {open && (
          <div className="popover" role="dialog" aria-label="Choose folder">
            {docs.label && (
              <div className="popover-current" title={docs.label}>{docs.label}</div>
            )}

            <form className="popover-form" onSubmit={submit}>
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Path to a folder, e.g. ~/notes"
                spellCheck={false}
              />
              <button type="submit" disabled={docs.loading}>Open</button>
            </form>
            {docs.error && <p className="popover-error">{docs.error}</p>}

            {recents.length > 0 && (
              <ul className="popover-list">
                {recents.map((d) => (
                  <li key={d}>
                    <button type="button" onClick={() => void openServerDir(d)} title={d}>
                      <span className="popover-list-name">{d.split('/').filter(Boolean).pop()}</span>
                      <span className="popover-list-path">{d}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {docs.pendingHandle && (
              <button type="button" className="popover-action" onClick={() => void reopenPendingHandle()}>
                Re-open “{docs.pendingHandle.name}”
              </button>
            )}
            {canPickDirectory() && (
              <button type="button" className="popover-action" onClick={() => void pickDirectory()}>
                Choose folder…
              </button>
            )}
          </div>
        )}
      </div>

      {docs.names.length > 0 && docName && (
        <>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <label className="crumb crumb-select">
            <span className="crumb-text">{docName}</span>
            <Chevron />
            <select value={docName} onChange={(e) => onSelectDoc(e.target.value)} aria-label="Document">
              {docs.names.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </>
      )}
    </nav>
  );
}
