import { useEffect, useRef, useState, type FormEvent } from 'react';
import { openInEditor } from './editor';
import {
  canPickDirectory,
  currentFavorite,
  getRecentDirs,
  isFavorite,
  openFavorite,
  openServerDir,
  pickDirectory,
  PICKED_FOLDER_NOTICE,
  reopenPendingHandle,
  selectDoc,
  showNotice,
  toggleFavorite,
  type DocsState,
  type Favorite,
} from './docs';

interface Props {
  docs: DocsState;
  /** True when the current document can be opened in the VS Code pane. */
  canEdit: boolean;
}

const FolderIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M1.5 3.5A1 1 0 0 1 2.5 2.5h3.2l1.6 1.5h6.2a1 1 0 0 1 1 1v7.5a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z" stroke="currentColor" strokeWidth="1.2" />
  </svg>
);
const DocIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 1.5h5l3.5 3.5v9.5h-8.5z M9 1.5v3.5h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
const PencilIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M11.3 2.2 13.8 4.7 5.5 13H3v-2.5z M9.8 3.7l2.5 2.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
  </svg>
);
const Chevron = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
    <path d="M2 3.5 5 6.5 8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
const Star = ({ filled }: { filled: boolean }) => (
  <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
    <path
      d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinejoin="round"
    />
  </svg>
);

/** Star button that pins/unpins a folder or document. Explains itself when there is no path to pin. */
function StarButton({ fav, what }: { fav: Favorite | null; what: string }) {
  const on = fav ? isFavorite(fav) : false;
  return (
    <button
      type="button"
      className={`star${on ? ' is-on' : ''}${fav ? '' : ' is-unavailable'}`}
      onClick={() => (fav ? void toggleFavorite(fav) : showNotice(PICKED_FOLDER_NOTICE))}
      title={!fav ? PICKED_FOLDER_NOTICE : on ? `Unpin ${what}` : `Pin ${what}`}
      aria-pressed={on}
    >
      <Star filled={on} />
    </button>
  );
}

/** Short display name of the current source: last path segment, or the picked folder's name. */
function shortLabel(docs: DocsState): string {
  if (!docs.source && !docs.pendingHandle) return 'No folder';
  if (docs.source?.kind === 'fs') return docs.source.handle.name;
  if (docs.pendingHandle) return docs.pendingHandle.name;
  return docs.label.split('/').filter(Boolean).pop() ?? docs.label;
}

const basename = (p: string) => p.split('/').filter(Boolean).pop() ?? p;

/** Group "a/b/c.md" style names by their folder for <optgroup>; top-level files come first. */
function groupByFolder(names: string[]): { folder: string; items: { name: string; file: string }[] }[] {
  const groups = new Map<string, { name: string; file: string }[]>();
  for (const name of names) {
    const i = name.lastIndexOf('/');
    const folder = i === -1 ? '' : name.slice(0, i);
    const file = i === -1 ? name : name.slice(i + 1);
    (groups.get(folder) ?? groups.set(folder, []).get(folder)!).push({ name, file });
  }
  return [...groups].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b))).map(([folder, items]) => ({ folder, items }));
}

export function DocsPicker({ docs, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const recents = getRecentDirs().filter((d) => d !== docs.label);
  const folderFav = currentFavorite(false);
  const docFav = currentFavorite(true);

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
              <div className="popover-current">
                <span className="popover-current-path" title={docs.label}>{docs.label}</span>
                <StarButton fav={folderFav} what="this folder" />
              </div>
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
            {docs.notice && <p className="popover-notice">{docs.notice}</p>}

            {docs.favorites.length > 0 && (
              <section className="popover-section">
                <h3 title={docs.favoritesPath}>Pinned</h3>
                <ul className="popover-list">
                  {docs.favorites.map((f) => (
                    <li key={`${f.dir}\0${f.doc ?? ''}`} className="popover-row">
                      <button type="button" onClick={() => void openFavorite(f)} title={f.doc ? `${f.dir}/${f.doc}` : f.dir}>
                        {f.doc ? <DocIcon /> : <FolderIcon />}
                        <span className="popover-list-text">
                          <span className="popover-list-name">{f.label ?? (f.doc ?? basename(f.dir))}</span>
                          <span className="popover-list-path">{f.doc ? `${basename(f.dir)} · ${f.dir}` : f.dir}</span>
                        </span>
                      </button>
                      <StarButton fav={f} what={f.doc ? 'this document' : 'this folder'} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {recents.length > 0 && (
              <section className="popover-section">
                <h3>Recent</h3>
                <ul className="popover-list">
                  {recents.map((d) => (
                    <li key={d} className="popover-row">
                      <button type="button" onClick={() => void openServerDir(d)} title={d}>
                        <FolderIcon />
                        <span className="popover-list-text">
                          <span className="popover-list-name">{basename(d)}</span>
                          <span className="popover-list-path">{d}</span>
                        </span>
                      </button>
                      <StarButton fav={{ dir: d }} what="this folder" />
                    </li>
                  ))}
                </ul>
              </section>
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

      {docs.names.length > 0 && docs.docName && (
        <>
          <span className="crumb-sep" aria-hidden="true">/</span>
          <label className="crumb crumb-select">
            <span className="crumb-text">{docs.docName}</span>
            <Chevron />
            <select value={docs.docName} onChange={(e) => selectDoc(e.target.value)} aria-label="Document">
              {groupByFolder(docs.names).map(({ folder, items }) =>
                folder === '' ? (
                  items.map(({ name, file }) => <option key={name} value={name}>{file}</option>)
                ) : (
                  <optgroup key={folder} label={folder + '/'}>
                    {items.map(({ name, file }) => <option key={name} value={name}>{file}</option>)}
                  </optgroup>
                ),
              )}
            </select>
          </label>
          <StarButton fav={docFav} what="this document" />
          {canEdit && docs.source?.kind === 'server' && (
            <button
              type="button"
              className="icon-button"
              title="Edit this document in VS Code"
              onClick={() => void openInEditor(`${docs.label}/${docs.docName}`)}
            >
              <PencilIcon />
            </button>
          )}
          {docs.notice && !open && <span className="crumb-notice">{docs.notice}</span>}
        </>
      )}
    </nav>
  );
}
