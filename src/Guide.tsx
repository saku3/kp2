import { isValidElement, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

const RUNNABLE = new Set(['bash', 'sh', 'shell']);

interface Props {
  markdown: string;
  onInsert: (command: string) => void;
  onRun: (command: string) => void;
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
  return (
    <div className={`code-block${runnable ? ' runnable' : ''}`}>
      <div className="code-block-bar">
        <span className="code-lang">{lang || 'text'}</span>
        {runnable && (
          <span className="code-actions">
            <button className="btn-insert" title="Type into terminal (no Enter)" onClick={() => onInsert(command)}>
              Insert
            </button>
            <button className="btn-run" title="Type into terminal and press Enter" onClick={() => onRun(command)}>
              Run
            </button>
          </span>
        )}
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

export function Guide({ markdown, onInsert, onRun }: Props) {
  return (
    <article className="guide">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
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
