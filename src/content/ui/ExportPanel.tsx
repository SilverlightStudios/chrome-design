import { useEffect, useState } from 'react';
import { isComment } from '../../shared/model';
import { type ExportStatus, useEditor, useEnv } from '../context';
import { useRecorder } from '../walkthrough/recorder';
import { plural } from './format';
import { Icon } from './icons';
import { PanelHead } from './PanelHead';
import { WalkthroughCard } from './WalkthroughCard';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function Spinner() {
  return (
    <svg
      className="spin"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M10 2.5a7.5 7.5 0 1 1-7.5 7.5" strokeLinecap="round" />
    </svg>
  );
}

function Switch({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className="check-row"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
    >
      {label}
      <span className="switch" data-on={on ? '' : undefined} />
    </button>
  );
}

/** Plain progress words for each capture stage. */
function friendlyStage(label: string): string {
  if (/stylesheet/i.test(label)) return 'Reading the page…';
  if (/asset/i.test(label))
    return `Saving images${label.match(/\d+\/\d+/) ? ` ${label.match(/\d+\/\d+/)![0]}` : ''}…`;
  if (/serializ/i.test(label)) return 'Copying the page…';
  if (/screenshot/i.test(label))
    return `Taking pictures${label.match(/\d+\/\d+/) ? ` ${label.match(/\d+\/\d+/)![0]}` : ''}…`;
  if (/build/i.test(label)) return 'Putting it together…';
  return label;
}

/** Exactly what the AI gets, as text (built only while it's shown). */
function Preview() {
  const env = useEnv();
  const [open, setOpen] = useState(false);
  // Made again whenever the feedback changes.
  useEditor((s) => s.doc);
  const summary = useRecorder((s) => s.result?.summary) ?? env.sentWalkthrough?.summary;
  return (
    <details className="options" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>What the AI gets</summary>
      {open ? (
        <pre className="ai-preview" data-testid="cd-ai-preview">
          {env.chatText(summary)}
        </pre>
      ) : null}
    </details>
  );
}

/**
 * Send to AI: everything that goes, one note, one button. The page's feedback and the
 * walkthrough (when there is one) go together, in every format.
 */
export function ExportPanel() {
  const env = useEnv();
  const { store } = env;
  const brief = useEditor((s) => s.doc.brief);
  const annotations = useEditor((s) => s.doc.annotations);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeSource, setIncludeSource] = useState(true);
  const [status, setStatus] = useState<ExportStatus>({ phase: 'idle' });
  const [copied, setCopied] = useState(false);
  const comments = annotations.filter(isComment);
  const drawings = annotations.length - comments.length;
  const walkthrough = useRecorder((s) => !!s.result) || !!env.sentWalkthrough;
  const busy = status.phase === 'working';
  const missing =
    status.phase === 'done'
      ? status.warnings.filter(
          (w) =>
            w.code === 'asset-not-embedded' ||
            w.code === 'stylesheet-unreadable' ||
            w.code === 'asset-too-large',
        )
      : [];

  useEffect(() => {
    if (status.phase !== 'error') return;
    const t = window.setTimeout(() => setStatus({ phase: 'idle' }), 2600);
    return () => window.clearTimeout(t);
  }, [status.phase]);

  const run = (format: 'html' | 'zip') => {
    if (busy) return;
    setStatus({ phase: 'working', label: 'Getting ready…' });
    void env.runExport({ includeScreenshot, includeSource, format }, setStatus);
  };

  const summary =
    comments.length || drawings
      ? [
          comments.length ? plural(comments.length, 'comment') : '',
          drawings ? plural(drawings, 'drawing') : '',
        ]
          .filter(Boolean)
          .join(' and ')
      : walkthrough
        ? 'No comments'
        : 'No comments yet';

  return (
    <div className="panel export-panel">
      <PanelHead title="Send to AI" />
      <div className="summary-row">
        <Icon.comment />
        <span>{summary}</span>
      </div>
      <WalkthroughCard />
      <label className="stack">
        <textarea
          rows={2}
          value={brief}
          aria-label="Note for the AI"
          placeholder="Note for the AI (optional)"
          onChange={(e) => store.setBrief(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="morph-pill"
        data-phase={status.phase}
        onClick={() => run('html')}
        disabled={busy}
        data-testid="cd-export-download"
        aria-live="polite"
      >
        <span className="layer idle">
          <Icon.export /> Download file
        </span>
        <span className="layer working">
          <Spinner />
          <span className="label-text">
            {status.phase === 'working' ? friendlyStage(status.label) : ''}
          </span>
        </span>
        <span className="layer done">
          <Icon.check />
          <span className="label-text">
            {status.phase === 'done' ? `Saved to Downloads · ${formatBytes(status.bytes)}` : ''}
          </span>
        </span>
        <span className="layer error">Couldn’t save — try again</span>
      </button>
      <div className="ghost-row">
        <button
          type="button"
          className="ghost-action"
          disabled={busy}
          data-testid="cd-export-zip"
          onClick={() => run('zip')}
        >
          <Icon.image /> .zip with images
        </button>
        <button
          type="button"
          className="ghost-action"
          data-testid="cd-copy-for-ai"
          data-done={copied ? '' : undefined}
          onClick={() => {
            void env.copyForAi().then((ok) => {
              if (!ok) {
                env.toast('Couldn’t copy');
                return;
              }
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            });
          }}
        >
          {copied ? <Icon.check /> : <Icon.copy />} Copy for AI
        </button>
      </div>
      {status.phase === 'done' && missing.length > 0 && !env.handoff && (
        <div className="export-result" role="status">
          <span className="warn">
            {plural(missing.length, 'image or style')} couldn’t be included
          </span>
          <button
            type="button"
            className="inline-link"
            onClick={() => env.store.set({ panel: 'settings', panelBack: 'export' })}
          >
            Allow other websites
          </button>
          {status.warnings.length > 0 ? (
            <details>
              <summary className="muted small">Details</summary>
              <ul className="warn-list">
                {status.warnings.slice(0, 30).map((w) => (
                  <li key={`${w.code}-${w.url ?? w.message}`}>
                    {w.message} {w.url ? <code>{w.url}</code> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      )}
      {status.phase === 'error' && (
        <p className="error" role="alert">
          {status.message}
        </p>
      )}
      <Preview />
      {env.handoff ? null : (
        <details className="options">
          <summary>Options</summary>
          <div className="checks">
            <Switch
              label="Include a screenshot"
              on={includeScreenshot}
              onChange={setIncludeScreenshot}
            />
            <Switch label="Include the page code" on={includeSource} onChange={setIncludeSource} />
          </div>
        </details>
      )}
    </div>
  );
}
