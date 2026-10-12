import { useEffect, useRef, useState } from 'react';
import { useEditor, useEnv } from '../context';
import { loadUiPrefs, saveUiPrefs } from '../persistence';

const HINTS: Record<string, string> = {
  select: 'Click anything to see its size — or drag to select an area',
  comment: 'Click anywhere to leave a comment',
  pen: 'Draw freely · switch to Select to move it',
  eraser: 'Drag across a drawing to erase it',
  shape: 'Drag to draw · hold ⇧ for straight lines and squares',
  text: 'Click to add a label',
  browse: 'Paused — the page works normally',
};

/** Touch screens: tap instead of click, and no keyboard modifiers. */
const TOUCH_HINTS: Record<string, string> = {
  select: 'Tap anything to see its size — or drag to select an area',
  comment: 'Tap anywhere to leave a comment',
  shape: 'Drag to draw a shape',
  text: 'Tap to add a label',
};

const isTouch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

function hintKey(tool: string, drawTool: string): string {
  if (tool !== 'draw') return tool;
  if (drawTool === 'pen' || drawTool === 'eraser' || drawTool === 'text') return drawTool;
  return 'shape';
}

/**
 * The Remote Desktop viewer's top chip: a glass pill with a one-line hint the first time each
 * tool is used, and a persistent "Paused" state with Resume.
 */
export function StatusChip() {
  const { store } = useEnv();
  const tool = useEditor((s) => s.tool);
  const drawTool = useEditor((s) => s.drawTool);
  const panel = useEditor((s) => s.panel);
  const key = hintKey(tool, drawTool);
  const [visible, setVisible] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  const first = useRef(true);

  useEffect(() => {
    void loadUiPrefs().then((p) => {
      seen.current = new Set(p.hintsSeen ?? []);
    });
  }, []);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      if (key !== 'browse') return;
    }
    if (key !== 'browse') {
      const set = seen.current;
      if (!set || set.has(key)) {
        setVisible(false);
        return;
      }
      set.add(key);
      void saveUiPrefs({ hintsSeen: [...set] });
    }
    setVisible(true);
    if (key === 'browse') return;
    const t = window.setTimeout(() => setVisible(false), 3200);
    return () => window.clearTimeout(t);
  }, [key]);

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
      <span className="status-text">{(isTouch() && TOUCH_HINTS[key]) || HINTS[key]}</span>
      {key === 'browse' ? (
        <button type="button" className="chip-btn" onClick={() => store.set({ tool: 'select' })}>
          Resume
        </button>
      ) : null}
    </div>
  );
}
