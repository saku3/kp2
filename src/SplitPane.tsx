import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface Props {
  /** First pane: top (vertical) or left (horizontal). */
  top: ReactNode;
  /** Second pane: bottom (vertical) or right (horizontal). */
  bottom: ReactNode;
  /** Side by side instead of stacked. */
  horizontal?: boolean;
  /** Hide the top pane (and divider) with CSS; nothing is unmounted, so an iframe keeps its state. */
  topHidden?: boolean;
  storageKey: string;
  /** Initial share of the height given to the top pane, 0..1. */
  initial?: number;
}

/** Two panes with a draggable divider; the ratio is remembered per storageKey. */
export function SplitPane({ top, bottom, horizontal = false, topHidden = false, storageKey, initial = 0.6 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => {
    try {
      const v = Number(localStorage.getItem(storageKey));
      return v > 0.1 && v < 0.9 ? v : initial;
    } catch {
      return initial;
    }
  });
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(ratio));
    } catch {
      /* ignore */
    }
  }, [ratio, storageKey]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = horizontal ? (ev.clientX - rect.left) / rect.width : (ev.clientY - rect.top) / rect.height;
      setRatio(Math.min(0.9, Math.max(0.1, r)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [horizontal]);

  return (
    <div className={`split${horizontal ? ' split-h' : ''}${dragging ? ' is-dragging' : ''}`} ref={ref}>
      <div className="split-top" style={{ flexBasis: `${ratio * 100}%` }} hidden={topHidden}>{top}</div>
      <div className="split-divider" role="separator" aria-orientation={horizontal ? 'vertical' : 'horizontal'} onPointerDown={onPointerDown} hidden={topHidden} />
      <div className="split-bottom">{bottom}</div>
    </div>
  );
}
