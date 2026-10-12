import { useCallback, useEffect, useState } from 'react';
import { type EditorEnv, EnvProvider, useEditor } from './context';
import { handleShortcut } from './keyboard';
import { AnnotationLayer } from './overlay/AnnotationLayer';
import { InspectOverlay } from './overlay/InspectOverlay';
import { InspectorCard } from './overlay/InspectorCard';
import { InteractionLayer } from './overlay/InteractionLayer';
import { GridOverlay, RulersAndGuides } from './overlay/Rulers';
import { Toolbar } from './ui/Toolbar';

function Toasts({ items }: { items: { id: number; text: string }[] }) {
  return (
    <div className="toasts ui" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="toast">
          {t.text}
        </div>
      ))}
    </div>
  );
}

function Root({ toasts }: { toasts: { id: number; text: string }[] }) {
  const tool = useEditor((s) => s.tool);
  return (
    <div className="root" data-tool={tool}>
      <GridOverlay />
      <InteractionLayer />
      <AnnotationLayer />
      <InspectOverlay />
      <RulersAndGuides />
      <InspectorCard />
      <Toolbar />
      <Toasts items={toasts} />
    </div>
  );
}

export function App({ env }: { env: Omit<EditorEnv, 'toast'> }) {
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([]);
  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list.slice(-2), { id, text }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 2200);
  }, []);
  const full: EditorEnv = { ...env, toast };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (handleShortcut(e, env.store, env.close)) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [env.store, env.close]);

  return (
    <EnvProvider value={full}>
      <Root toasts={toasts} />
    </EnvProvider>
  );
}
