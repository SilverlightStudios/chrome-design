import { useEnv } from '../context';
import { Icon, type IconName } from './icons';
import { BackButton } from './PanelHead';

const STEPS: { icon: IconName; title: string }[] = [
  { icon: 'comment', title: 'Comment on anything' },
  { icon: 'draw', title: 'Sketch with pencil, shapes and text' },
  { icon: 'export', title: 'Send it all to AI as one file' },
];

/** First-run card: three steps, one button. Reopen it from More → Quick tour. */
export function WelcomePanel() {
  const { store } = useEnv();
  return (
    <div className="panel welcome-panel">
      <BackButton />
      <div className="welcome-head">
        <h2>Give feedback on any page</h2>
      </div>
      <ol className="steps">
        {STEPS.map((s) => {
          const Glyph = Icon[s.icon];
          return (
            <li key={s.title}>
              <span className="step-icon">
                <Glyph />
              </span>
              <span className="step-text">{s.title}</span>
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
