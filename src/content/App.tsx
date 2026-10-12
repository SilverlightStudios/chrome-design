import { useCallback, useEffect, useRef, useState } from 'react';
import { type EditorEnv, EnvProvider, type ToastAction, useEditor } from './context';
import { installIconMotion } from './iconMotion';
import { handleShortcut } from './keyboard';
import { AnnotationLayer } from './overlay/AnnotationLayer';
import { InspectOverlay } from './overlay/InspectOverlay';
import { InteractionLayer } from './overlay/InteractionLayer';
import { GridOverlay, RulersAndGuides } from './overlay/Rulers';
import { DetailsCard, SelectionBar } from './overlay/SelectionBar';
import { StatusChip } from './ui/StatusChip';
import { Toolbar } from './ui/Toolbar';

interface ToastItem {
  id: number;
  text: string;
  action?: ToastAction;
}

/** Remote Desktop-style toast: one glass pill at the top, optional action (Undo). */
function Toast({ item, onDone }: { item: ToastItem | null; onDone: () => void }) {
  return (
    <div
      className="toast glass-css ui"
      data-on={item ? '' : undefined}
      role="status"
      aria-live="polite"
    >
      {item ? (
        <>
          <span className="toast-text">{item.text}</span>
          {item.action ? (
            <button
              type="button"
              className="toast-btn"
              onClick={() => {
                item.action?.run();
                onDone();
              }}
            >
              {item.action.label}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function Root({ toast, onToastDone }: { toast: ToastItem | null; onToastDone: () => void }) {
  const tool = useEditor((s) => s.tool);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => (ref.current ? installIconMotion(ref.current) : undefined), []);
  return (
    <div ref={ref} className="root" data-tool={tool}>
      <GridOverlay />
      <InteractionLayer />
      <AnnotationLayer />
      <InspectOverlay />
      <RulersAndGuides />
      <SelectionBar />
      <DetailsCard />
      <StatusChip />
      <Toolbar />
      <Toast item={toast} onDone={onToastDone} />
    </div>
  );
}

export function App({ env }: { env: Omit<EditorEnv, 'toast'> }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const timer = useRef(0);
  const showToast = useCallback((text: string, action?: ToastAction) => {
    window.clearTimeout(timer.current);
    setToast({ id: Date.now(), text, ...(action ? { action } : {}) });
    timer.current = window.setTimeout(() => setToast(null), action ? 5000 : 2200);
  }, []);
  const clearToast = useCallback(() => {
    window.clearTimeout(timer.current);
    setToast(null);
  }, []);
  const full: EditorEnv = { ...env, toast: showToast };

  useEffect(() => {
    // Keys we handle are swallowed on keydown *and* the matching keyup/keypress, so page
    // shortcuts listening to either never see them.
    const swallowed = new Set<string>();
    const onKeyDown = (e: KeyboardEvent) => {
      const undoable = (msg: string) => showToast(msg, { label: 'Undo', run: env.store.undo });
      if (handleShortcut(e, env.store, env.close, undoable)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        swallowed.add(e.code);
      }
    };
    const onKeyUpOrPress = (e: KeyboardEvent) => {
      if (!swallowed.has(e.code)) return;
      if (e.type === 'keyup') swallowed.delete(e.code);
      e.stopImmediatePropagation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUpOrPress, true);
    window.addEventListener('keypress', onKeyUpOrPress, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUpOrPress, true);
      window.removeEventListener('keypress', onKeyUpOrPress, true);
      window.clearTimeout(timer.current);
    };
  }, [env.store, env.close, showToast]);

  return (
    <EnvProvider value={full}>
      <Root toast={toast} onToastDone={clearToast} />
    </EnvProvider>
  );
}
