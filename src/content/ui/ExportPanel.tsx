import { useEffect, useState } from 'react';
import { isComment } from '../../shared/model';
import { type ExportStatus, useEditor, useEnv } from '../context';
import { plural } from './format';
import { Icon } from './icons';

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
  if (/screenshot/i.test(label)) return 'Taking a picture…';
  if (/build/i.test(label)) return 'Putting it together…';
  return label;
}

/** Send to AI: one note, one button. Everything else is optional and tucked away. */
export function ExportPanel() {
  const env = useEnv();
  const { store } = env;
  const brief = useEditor((s) => s.doc.brief);
  const annotations = useEditor((s) => s.doc.annotations);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeSource, setIncludeSource] = useState(true);
  const [status, setStatus] = useState<ExportStatus>({ phase: 'idle' });
  const comments = annotations.filter(isComment);
  const drawings = annotations.length - comments.length;
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

  const run = () => {
    if (busy) return;
    setStatus({ phase: 'working', label: 'Getting ready…' });
    void env.runExport({ includeScreenshot, includeSource }, setStatus);
  };

  const summary =
    comments.length || drawings
      ? [
          comments.length ? plural(comments.length, 'comment') : '',
          drawings ? plural(drawings, 'drawing') : '',
        ]
          .filter(Boolean)
          .join(' and ')
      : 'No comments yet — the AI will get just the page';

  return (
    <div className="panel export-panel">
      <div className="panel-head stacked">
        <h2>Send to AI</h2>
        <p className="muted">
          One file with this page and your notes. Give it to any AI assistant.
        </p>
      </div>
      <div className="summary-row">
        <Icon.comment />
        <span>{summary}</span>
      </div>
      <label className="stack">
        <span className="label">Anything else to tell the AI?</span>
        <textarea
          rows={2}
          value={brief}
          placeholder="Optional — e.g. “Make it feel calmer, keep our colours.”"
          onChange={(e) => store.setBrief(e.target.value)}
        />
      </label>
      <button
        type="button"
        className="morph-pill"
        data-phase={status.phase}
        onClick={run}
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
        <span className="layer error">Something went wrong — try again</span>
      </button>
      {status.phase === 'done' && (
        <div className="export-result" role="status">
          {missing.length > 0 ? (
            <>
              <span className="warn">
                {plural(missing.length, 'image or style')} couldn’t be included
              </span>
              <span className="muted small">They come from another website. </span>
              <button
                type="button"
                className="inline-link"
                onClick={() => env.store.set({ panel: 'settings', panelBack: 'export' })}
              >
                Allow other websites
              </button>
            </>
          ) : (
            <span className="ok">Everything was included.</span>
          )}
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
      <details className="options">
        <summary>Options</summary>
        <div className="checks">
          <Switch
            label="Include a picture of what you see"
            on={includeScreenshot}
            onChange={setIncludeScreenshot}
          />
          <Switch
            label="Include the page’s original code"
            on={includeSource}
            onChange={setIncludeSource}
          />
        </div>
      </details>
    </div>
  );
}
