import { setEditorShown, useEditorShown, type EditorInfo } from './editor';

const CodeIcon = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M5.5 4 2 8l3.5 4M10.5 4 14 8l-3.5 4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** Header switch that shows or hides the VS Code pane. Hidden entirely when code-server is not running. */
export function EditorToggle({ editor }: { editor: EditorInfo | null }) {
  const shown = useEditorShown();
  if (!editor?.available) return null;
  return (
    <button
      type="button"
      className={`editor-toggle${shown ? ' is-on' : ''}`}
      onClick={() => setEditorShown(!shown)}
      aria-pressed={shown}
      title={shown ? 'Hide the editor' : 'Show the editor'}
    >
      <CodeIcon />
      <span>Editor</span>
    </button>
  );
}
