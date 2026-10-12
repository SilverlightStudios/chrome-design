import { useEnv } from '../context';
import { Icon, type IconName } from './icons';

const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

const STEPS: { icon: IconName; title: string; body: string }[] = [
  {
    icon: 'comment',
    title: 'Comment',
    body: `${touch() ? 'Tap' : 'Click'} anything on the page to leave feedback.`,
  },
  { icon: 'draw', title: 'Draw', body: 'Point things out with the pencil, shapes and text.' },
  {
    icon: 'export',
    title: 'Send to AI',
    body: 'Download one file with the page and your notes for an AI assistant.',
  },
];

/** First-run card: three steps, one button. Reopen it from More → Quick tour. */
export function WelcomePanel() {
  const { store } = useEnv();
  return (
    <div className="panel welcome-panel">
      <div className="welcome-head">
        <h2>Give feedback on any page</h2>
        <p className="muted">Everything stays in your browser.</p>
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
                <b>{s.title}</b>
                <span>{s.body}</span>
              </span>
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="btn primary wide"
        onClick={() => store.set({ panel: 'none', tool: 'comment' })}
      >
        Start commenting
      </button>
    </div>
  );
}
