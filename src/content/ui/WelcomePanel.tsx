import { useEnv } from '../context';
import { saveUiPrefs } from '../persistence';
import { Icon, type IconName } from './icons';

const STEPS: { icon: IconName; title: string; body: string; kbd: string }[] = [
  {
    icon: 'select',
    title: 'Inspect',
    body: 'Hover to measure. Click an element to see its styles; drag to select an area.',
    kbd: 'V',
  },
  {
    icon: 'comment',
    title: 'Comment',
    body: 'Click anything to leave a change request, decision or question.',
    kbd: 'C',
  },
  {
    icon: 'draw',
    title: 'Draw',
    body: 'Arrows, boxes, freehand and labels on top of the page.',
    kbd: 'D',
  },
  {
    icon: 'export',
    title: 'Hand off',
    body: 'One HTML file with the page, your notes and a prompt for an AI agent.',
    kbd: '⇧E',
  },
];

/** First-run coach card. Shown once, then reachable from Shortcuts. */
export function WelcomePanel() {
  const { store } = useEnv();
  const done = () => {
    void saveUiPrefs({ onboarded: true });
    store.set({ panel: 'none' });
  };
  return (
    <div className="panel welcome-panel">
      <div className="panel-head">
        <h2>Review this page</h2>
        <span className="muted small">Nothing leaves your browser</span>
      </div>
      <ol className="steps">
        {STEPS.map((s) => {
          const Glyph = Icon[s.icon];
          return (
            <li key={s.title}>
              <span className="step-icon">
                <Glyph />
              </span>
              <span className="step-text">
                <b>
                  {s.title} <kbd>{s.kbd}</kbd>
                </b>
                <span>{s.body}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <p className="muted small">
        <kbd>Esc</kbd> steps back and pauses the tools so the page works normally. Drag the toolbar
        by its edge to move it.
      </p>
      <button type="button" className="btn primary wide" onClick={done}>
        Start reviewing
      </button>
    </div>
  );
}
