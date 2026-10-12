import type { ReactNode } from 'react';
import { useEditor, useEnv } from '../context';
import type { PanelId } from '../store';
import { Icon } from './icons';

const BACK_LABEL: Partial<Record<PanelId, string>> = {
  more: 'all options',
  export: 'Send to AI',
};

/** Returns to the panel this one was opened from (More, or Send to AI for Settings). */
export function BackButton() {
  const { store } = useEnv();
  const back = useEditor((s) => s.panelBack);
  if (!back) return null;
  return (
    <button
      type="button"
      className="back-btn"
      aria-label={`Back to ${BACK_LABEL[back] ?? 'previous panel'}`}
      onClick={() => store.set({ panel: back })}
    >
      <Icon.chevron />
    </button>
  );
}

/** Panel title row: back button when there's somewhere to go back to, title, optional extras. */
export function PanelHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="panel-head">
      <BackButton />
      <h2>{title}</h2>
      {children}
    </div>
  );
}
