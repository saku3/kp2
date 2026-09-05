import { isValidElement, useEffect, useState, type ReactNode } from 'react';
import Markdown, { defaultUrlTransform } from 'react-markdown';
import { openInEditor, parseEditorLink } from './editor';
import remarkGfm from 'remark-gfm';

const RUNNABLE = new Set(['bash', 'sh', 'shell']);

interface Props {
  markdown: string;
  /** Relative path of the document being shown, e.g. "k8s/setup.md". */
  docName: string | null;
  /** All documents in the current folder; relative links to one of them switch documents. */
  names: string[];
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

function CodeBlock({
  lang,
  code,
  onInsert,
  onRun,
}: { lang: string; code: string; onInsert: Props['onInsert']; onRun: Props['onRun'] }) {
  const runnable = RUNNABLE.has(lang);
  // The command shown is exactly the command sent: no hidden text, no transformation.
  const command = code.replace(/\n$/, '');
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
              <button className="btn-insert" title="Type into terminal (no Enter)" onClick={() => onInsert(command)}>
                Insert
              </button>
              <button className="btn-run" title="Type into terminal and press Enter" onClick={() => onRun(command)}>
                Run
              </button>
            </>
          )}
        </span>
      </div>
      <pre>
        <code>{command}</code>
      </pre>
    </div>
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

export function Guide({ markdown, docName, names, onNavigate, onInsert, onRun }: Props) {
  return (
    <article className="guide">
      <Markdown
        remarkPlugins={[remarkGfm]}
        // Keep our own "vscode:" links; everything else gets react-markdown's default sanitizing.
        urlTransform={(url) => (url.startsWith('vscode:') ? url : defaultUrlTransform(url))}
        components={{
          a: ({ href = '', children, node: _node, ...rest }) => {
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
              // A .md link inside the folder that does not exist: do not leave the app.
              return (
                <a {...rest} href={href} className="link-missing" title={`Not found in this folder: ${target}`} onClick={(e) => e.preventDefault()}>
                  {children}
                </a>
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
          },
          pre: ({ children }) => {
            const parsed = parsePreChild(children);
            if (!parsed) return <pre>{children}</pre>;
            return <CodeBlock {...parsed} onInsert={onInsert} onRun={onRun} />;
          },
        }}
      >
        {markdown}
      </Markdown>
    </article>
  );
}
