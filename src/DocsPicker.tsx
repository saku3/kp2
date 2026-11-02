import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
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

const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/**
 * fzf-style match: every query character must appear in order. Consecutive hits and hits at the
 * start of a word score higher; shorter paths win ties. Null when the query does not match.
 */
// ponytail: tries every position for the first character, then matches the rest greedily; not
// fzf's optimal alignment, but O(n·m) is plenty for a few hundred paths.
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (q === '') return 0;
  let best: number | null = null;
  for (let start = t.indexOf(q[0]); start !== -1; start = t.indexOf(q[0], start + 1)) {
    const s = scoreFrom(q, t, start);
    if (s === null) break; // a later start cannot match either
    if (best === null || s > best) best = s;
  }
  return best === null ? null : best - t.length / 1000;
}

function scoreFrom(q: string, t: string, from: number): number | null {
  let score = 0;
  let prev = -2;
  for (const c of q) {
    const i = t.indexOf(c, from);
    if (i === -1) return null;
    score += i === prev + 1 ? 3 : 1;
    if (i === 0 || '/_-. '.includes(t[i - 1])) score += 2;
    prev = i;
    from = i + 1;
  }
  return score;
}

/** Folder or document popover: close on outside click / Escape and focus the input when opened. */
function useDismiss(open: boolean, close: () => void) {
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (!popRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return { popRef, inputRef };
}

/** Document switcher: type to filter the folder's documents fzf-style, ↑/↓ to move, Enter to open. */
function DocSwitcher({ names, current }: { names: string[]; current: string }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const close = useCallback(() => setOpen(false), []);
  const { popRef, inputRef } = useDismiss(open, close);
  const listRef = useRef<HTMLUListElement>(null);

  const matches = query.trim()
    ? names
        .map((name) => ({ name, score: fuzzyScore(query, name) }))
        .filter((m): m is { name: string; score: number } => m.score !== null)
        .sort((a, b) => b.score - a.score)
        .map((m) => m.name)
    : names;

  useEffect(() => {
    listRef.current?.children[active]?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  const toggle = () => {
    if (!open) {
      setQuery('');
      setActive(Math.max(0, names.indexOf(current)));
    }
    setOpen(!open);
  };
  const choose = (name: string | undefined) => {
    if (name === undefined) return;
    selectDoc(name);
    setOpen(false);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive((a) => (matches.length ? (a + step + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(matches[active]);
    }
  };

  return (
    <div className="crumb-wrap" ref={popRef}>
      <button className={`crumb${open ? ' is-open' : ''}`} onClick={toggle} title={current} aria-expanded={open}>
        <span className="crumb-text">{current}</span>
        <Chevron />
      </button>
      {open && (
        <div className="popover doc-switcher" role="dialog" aria-label="Choose document">
          <div className="popover-form">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
              placeholder="Filter documents"
              spellCheck={false}
              aria-label="Filter documents"
            />
          </div>
          {matches.length === 0 ? (
            <p className="popover-notice">No matching documents</p>
          ) : (
            <ul className="popover-list" ref={listRef}>
              {matches.map((name, i) => (
                <li key={name} className={`popover-row${i === active ? ' is-active' : ''}`}>
                  <button
                    type="button"
                    onClick={() => choose(name)}
                    onMouseMove={() => setActive(i)}
                    aria-current={name === current ? 'page' : undefined}
                    title={name}
                  >
                    {dirname(name) && <span className="doc-dir"><bdi>{dirname(name)}/</bdi></span>}
                    <span className="doc-file">{basename(name)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export function DocsPicker({ docs, canEdit }: Props) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const close = useCallback(() => setOpen(false), []);
  const { popRef, inputRef } = useDismiss(open, close);
  const recents = getRecentDirs().filter((d) => d !== docs.label);
  const folderFav = currentFavorite(false);
  const docFav = currentFavorite(true);

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
          <DocSwitcher names={docs.names} current={docs.docName} />
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
