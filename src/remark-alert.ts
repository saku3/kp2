/**
 * remark plugin: GitHub-style alerts.
 *
 *   > [!NOTE]
 *   > Useful information.
 *
 * A blockquote whose first line is exactly one of `[!NOTE]`, `[!TIP]`, `[!IMPORTANT]`,
 * `[!WARNING]` or `[!CAUTION]` (case-insensitive) is rendered as
 * `<div class="markdown-alert markdown-alert-note">` with a title paragraph, matching the
 * markup GitHub produces so the same document looks alike in both places. Any other
 * blockquote is left alone.
 */

interface Node {
  type: string;
  value?: string;
  children?: Node[];
  data?: { hName?: string; hProperties?: Record<string, unknown> };
}

const TITLES: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
};

const MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

function convert(quote: Node): void {
  const para = quote.children?.[0];
  if (para?.type !== 'paragraph' || !para.children?.length) return;
  const first = para.children[0];
  if (first.type !== 'text' || first.value === undefined) return;
  const m = MARKER.exec(first.value);
  if (!m) return;
  // "[!NOTE]" ends at a line end or at the end of the text node; in the latter case the
  // next node must be a line break (or nothing), otherwise the marker shares its line.
  const rest = first.value.slice(m[0].length);
  if (!m[0].endsWith('\n') && para.children.length > 1 && para.children[1].type !== 'break') return;

  const kind = m[1].toLowerCase();
  if (rest) first.value = rest;
  else {
    para.children.shift();
    if (para.children[0]?.type === 'break') para.children.shift();
  }
  if (para.children.length === 0) quote.children!.shift();

  quote.data = { ...quote.data, hName: 'div', hProperties: { className: ['markdown-alert', `markdown-alert-${kind}`] } };
  quote.children!.unshift({
    type: 'paragraph',
    data: { hProperties: { className: ['markdown-alert-title'] } },
    children: [{ type: 'text', value: TITLES[kind] }],
  });
}

export default function remarkAlert() {
  return (tree: Node) => {
    const walk = (node: Node) => {
      for (const child of node.children ?? []) {
        if (child.type === 'blockquote') convert(child);
        walk(child);
      }
    };
    walk(tree);
  };
}
