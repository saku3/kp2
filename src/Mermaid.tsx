import { useEffect, useId, useState } from 'react';

// mermaid is large, so it is loaded on first use and kept in its own chunk; documents without a
// diagram never download it.
let loader: Promise<typeof import('mermaid').default> | null = null;
function loadMermaid() {
  loader ??= import('mermaid').then(({ default: mermaid }) => {
    // securityLevel "strict" (the default, stated here on purpose) sanitizes labels and disables
    // click handlers, so a runbook cannot run scripts through a diagram.
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
    return mermaid;
  });
  return loader;
}

// mermaid.render uses a shared scratch element, so renders run one at a time.
let queue: Promise<unknown> = Promise.resolve();
function renderQueued(id: string, code: string): Promise<string> {
  const job = queue.then(async () => {
    const mermaid = await loadMermaid();
    await mermaid.parse(code); // throws a readable error instead of rendering an error diagram
    return (await mermaid.render(id, code)).svg;
  });
  queue = job.catch(() => {});
  return job;
}

type State = { svg: string } | { error: string } | null;

/** A ```mermaid code block, drawn as a diagram. On a syntax error the source is shown with the message. */
export function MermaidBlock({ code }: { code: string }) {
  const id = `mermaid-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const [state, setState] = useState<State>(null);
  useEffect(() => {
    let cancelled = false;
    renderQueued(id, code).then(
      (svg) => !cancelled && setState({ svg }),
      (err: unknown) => !cancelled && setState({ error: err instanceof Error ? err.message : String(err) }),
    );
    return () => {
      cancelled = true;
    };
  }, [id, code]);

  if (state && 'svg' in state) {
    return <div className="mermaid-block" dangerouslySetInnerHTML={{ __html: state.svg }} />;
  }
  return (
    <div className="code-block mermaid-source">
      <div className="code-block-bar">
        <span className="code-lang">mermaid</span>
        {state && 'error' in state && <span className="mermaid-error" title={state.error}>{state.error}</span>}
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  );
}
