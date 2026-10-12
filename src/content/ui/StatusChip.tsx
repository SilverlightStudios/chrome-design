import { useEffect, useRef, useState } from 'react';
import { useEditor, useEnv } from '../context';

const HINTS: Record<string, string> = {
  select: 'Inspect — hover to measure · click to select · drag an area',
  comment: 'Comment — click an element or drag an area',
  draw: 'Draw — P pen · A arrow · R box · T text · E eraser',
  browse: 'Paused — the page works normally',
};

/**
 * The Remote Desktop viewer's top chip: a glass pill that names the current mode for a
 * moment after it changes, and stays while the tools are paused.
 */
export function StatusChip() {
  const { store } = useEnv();
  const tool = useEditor((s) => s.tool);
  const panel = useEditor((s) => s.panel);
  const [visible, setVisible] = useState(false);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (tool !== 'browse') return;
    }
    setVisible(true);
    if (tool === 'browse') return;
    const t = window.setTimeout(() => setVisible(false), 2600);
    return () => window.clearTimeout(t);
  }, [tool]);

  const hidden = !visible || panel === 'welcome';
  return (
    <div
      className="status-chip glass-css ui"
      data-hidden={hidden ? '' : undefined}
      data-tool={tool}
      role="status"
      aria-live="polite"
    >
      <span className="status-dot" aria-hidden="true" />
      <span className="status-text">{HINTS[tool]}</span>
      {tool === 'browse' ? (
        <button type="button" className="chip-btn" onClick={() => store.set({ tool: 'select' })}>
          Resume
        </button>
      ) : null}
    </div>
  );
}
