import { createContext, isValidElement, useContext, useEffect, useMemo, useState, type ComponentProps, type ReactNode, type SyntheticEvent } from 'react';
import Markdown, { defaultUrlTransform, type Components, type ExtraProps } from 'react-markdown';
import { openInEditor, parseEditorLink } from './editor';
import remarkGfm from 'remark-gfm';
import remarkBr from './remark-br';
import { missingVars, setVar, splitPlaceholders, substitute, useVars } from './vars';

const RUNNABLE = new Set(['bash', 'sh', 'shell']);

interface Props {
  markdown: string;
  /** Relative path of the document being shown, e.g. "k8s/setup.md". */
  docName: string | null;
  /** All documents in the current folder; relative links to one of them switch documents. */
  names: string[];
  /** Key under which `{{NAME}}` values are stored, normally the folder and the document. */
  varsScope: string;
  onNavigate: (name: string) => void;
  onInsert: (command: string) => void;
  onRun: (command: string) => void;
}

/** Resolve an href relative to the current document within the folder; null if it is not a local .md file. */
export function resolveDocLink(docName: string | null, href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('/') || href.startsWith('#')) return null;
  const path = href.split(/[?#]/)[0];
  if (!path.endsWith('.md')) return null;
  const base = docName?.includes('/') ? docName.slice(0, docName.lastIndexOf('/')).split('/') : [];
  const out = [...base];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) return path; // escapes the folder: reported as-is (never in `names`)
      out.pop();
    } else out.push(seg);
  }
  return decodeURIComponent(out.join('/'));
}

// The custom renderers reach the current document and callbacks through context rather than
// closures, so the `components` object below is created once. react-markdown identifies a
// component by function identity; a renderer created per render would make React unmount and
// recreate every code block on each Guide render, resetting its horizontal scroll, the
// "Copied" label and any text selection.
type GuideContextValue = Omit<Props, 'markdown'>;
const GuideContext = createContext<GuideContextValue>({
  docName: null,
  names: [],
  varsScope: '',
  onNavigate: () => {},
  onInsert: () => {},
  onRun: () => {},
});

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const { onInsert, onRun, varsScope } = useContext(GuideContext);
  const runnable = RUNNABLE.has(lang);
  const values = useVars(varsScope);
  const segments = useMemo(() => splitPlaceholders(code.replace(/\n$/, '')), [code]);
  // The command shown is exactly the command sent: placeholders are displayed with the same
  // values that get substituted, and nothing else is transformed.
  const command = substitute(code.replace(/\n$/, ''), values);
  const missing = missingVars(command, values);
  const blocked = missing.length > 0;
  const blockedTitle = `Fill in ${missing.join(', ')} first`;
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(t);
  }, [copied]);
  const copy = () => {
    void navigator.clipboard.writeText(command).then(() => setCopied(true));
  };
  return (
    <div className={`code-block${runnable ? ' runnable' : ''}`}>
      <div className="code-block-bar">
        <span className="code-lang">{lang || 'text'}</span>
        <span className="code-actions">
          <button className="btn-copy" title="Copy to clipboard" onClick={copy} aria-live="polite">
            {copied ? 'Copied' : 'Copy'}
          </button>
          {runnable && (
            <>
              <button
                className="btn-insert"
                title={blocked ? blockedTitle : 'Type into terminal (no Enter)'}
                disabled={blocked}
                onClick={() => onInsert(command)}
              >
                Insert
              </button>
              <button
                className="btn-run"
                title={blocked ? blockedTitle : 'Type into terminal and press Enter'}
                disabled={blocked}
                onClick={() => onRun(command)}
              >
                Run
              </button>
            </>
          )}
        </span>
      </div>
      <pre
        title={runnable ? (blocked ? blockedTitle : 'Double-click to run') : undefined}
        onDoubleClick={
          runnable && !blocked
            ? () => {
                window.getSelection()?.removeAllRanges(); // a double-click also selects a word; drop that
                onRun(command);
              }
            : undefined
        }
      >
        <code>
          {segments.map((seg, i) =>
            typeof seg === 'string' ? seg : <Placeholder key={i} name={seg.name} value={values[seg.name] ?? ''} scope={varsScope} />,
          )}
        </code>
      </pre>
    </div>
  );
}

/**
 * One `{{NAME}}` inside a code block. Shows the current value (or just the name when
 * empty) and turns into a text field on click; Enter or leaving the field saves, Escape cancels.
 */
function Placeholder({ name, value, scope }: { name: string; value: string; scope: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  const stop = (e: SyntheticEvent) => e.stopPropagation(); // keep double-click-to-run out of it
  if (draft === null) {
    return (
      <span
        className={`var${value ? ' var-set' : ' var-empty'}`}
        role="button"
        tabIndex={0}
        title={`${name}: click to edit`}
        onClick={() => setDraft(value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setDraft(value);
          }
        }}
        onDoubleClick={stop}
      >
        {value || name}
      </span>
    );
  }
  const commit = () => {
    setVar(scope, name, draft.trim());
    setDraft(null);
  };
  return (
    <input
      className="var-input"
      autoFocus
      value={draft}
      size={Math.max(draft.length, name.length + 4, 6)}
      placeholder={name}
      aria-label={name}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        else if (e.key === 'Escape') setDraft(null);
      }}
      onDoubleClick={stop}
      onClick={stop}
    />
  );
}

/** Extract { lang, code } from the <code> element react-markdown puts inside <pre>. */
function parsePreChild(children: ReactNode): { lang: string; code: string } | null {
  if (!isValidElement<{ className?: string; children?: ReactNode }>(children)) return null;
  const className = children.props.className ?? '';
  const lang = /language-([\w-]+)/.exec(className)?.[1]?.toLowerCase() ?? '';
  const raw = children.props.children;
  const code = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.join('') : '';
  return { lang, code };
}

function GuidePre({ children }: ComponentProps<'pre'> & ExtraProps) {
  const parsed = parsePreChild(children);
  if (!parsed) return <pre>{children}</pre>;
  return <CodeBlock {...parsed} />;
}

function GuideLink({ href = '', children, node: _node, ...rest }: ComponentProps<'a'> & ExtraProps) {
  const { docName, names, onNavigate } = useContext(GuideContext);
  const editorLink = parseEditorLink(href);
  if (editorLink) {
    // "vscode:path#L12": opens the file in the editor pane (path relative to the workspace).
    return (
      <a
        {...rest}
        href={href}
        className="link-editor"
        title={`Open in editor: ${editorLink.file}${editorLink.line ? `:${editorLink.line}` : ''}`}
        onClick={(e) => {
          e.preventDefault();
          void openInEditor(editorLink.file, editorLink.line);
        }}
      >
        {children}
      </a>
    );
  }
  const target = resolveDocLink(docName, href);
  if (target !== null && !names.includes(target)) {
    // A .md link that cannot be followed: either it leaves the folder (resolveDocLink reports
    // the raw path, still containing "..") or the file is not in the folder. Keep the link text
    // readable; the reason appears as a tooltip on hover (see .link-tip in styles.css).
    const outside = target.split('/').includes('..');
    const reason = outside ? 'outside folder' : 'not found';
    return (
      <span className="link-missing-wrap">
        <a {...rest} href={href} className="link-missing" onClick={(e) => e.preventDefault()}>
          {children}
        </a>
        <span className="link-tip" role="tooltip">
          {reason}: {target}
        </span>
      </span>
    );
  }
  if (target !== null) {
    return (
      <a
        {...rest}
        href={`?doc=${encodeURIComponent(target)}`}
        onClick={(e) => {
          e.preventDefault();
          onNavigate(target);
        }}
      >
        {children}
      </a>
    );
  }
  const external = /^https?:/i.test(href);
  return (
    <a {...rest} href={href} target={external ? '_blank' : undefined} rel={external ? 'noopener noreferrer' : undefined}>
      {children}
    </a>
  );
}

const components: Components = { a: GuideLink, pre: GuidePre };

// Keep our own "vscode:" links; everything else gets react-markdown's default sanitizing.
const urlTransform = (url: string) => (url.startsWith('vscode:') ? url : defaultUrlTransform(url));

const remarkPlugins = [remarkGfm, remarkBr];

export function Guide({ markdown, docName, names, varsScope, onNavigate, onInsert, onRun }: Props) {
  return (
    <GuideContext.Provider value={{ docName, names, varsScope, onNavigate, onInsert, onRun }}>
      <article className="guide">
        <Markdown remarkPlugins={remarkPlugins} urlTransform={urlTransform} components={components}>
          {markdown}
        </Markdown>
      </article>
    </GuideContext.Provider>
  );
}
