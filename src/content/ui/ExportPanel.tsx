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

export function ExportPanel() {
  const env = useEnv();
  const { store } = env;
  const brief = useEditor((s) => s.doc.brief);
  const annotations = useEditor((s) => s.doc.annotations);
  const [includeScreenshot, setIncludeScreenshot] = useState(true);
  const [includeSource, setIncludeSource] = useState(true);
  const [status, setStatus] = useState<ExportStatus>({ phase: 'idle' });
  const comments = annotations.filter(isComment);
  const decisions = comments.filter((c) => c.intent === 'decision').length;
  const shapes = annotations.length - comments.length;
  const busy = status.phase === 'working';
  const assetWarnings =
    status.phase === 'done'
      ? status.warnings.filter(
          (w) => w.code === 'asset-not-embedded' || w.code === 'stylesheet-unreadable',
        )
      : [];

  // An error relaxes back to idle so the pill is ready to retry.
  useEffect(() => {
    if (status.phase !== 'error') return;
    const t = window.setTimeout(() => setStatus({ phase: 'idle' }), 2600);
    return () => window.clearTimeout(t);
  }, [status.phase]);

  const run = () => {
    if (busy) return;
    setStatus({ phase: 'working', label: 'Preparing…' });
    void env.runExport({ includeScreenshot, includeSource }, setStatus);
  };

  return (
    <div className="panel export-panel">
      <div className="panel-head">
        <h2>Hand off to an AI agent</h2>
        <span className="muted small">
          {plural(comments.length, 'comment')} · {plural(decisions, 'decision')} ·{' '}
          {plural(shapes, 'drawing')}
        </span>
      </div>
      <label className="stack">
        <span className="label">Brief (optional)</span>
        <textarea
          rows={2}
          value={brief}
          placeholder="Overall direction, e.g. “Make the hero calmer; keep brand colours.”"
          onChange={(e) => store.setBrief(e.target.value)}
        />
      </label>
      <div className="checks">
        <Switch
          label="Viewport screenshot"
          on={includeScreenshot}
          onChange={setIncludeScreenshot}
        />
        <Switch
          label="Original DOM source (reference)"
          on={includeSource}
          onChange={setIncludeSource}
        />
      </div>
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
          <Icon.export /> {status.phase === 'done' ? 'Download again' : 'Download handoff HTML'}
        </span>
        <span className="layer working">
          <Spinner />
          <span className="label-text">{status.phase === 'working' ? status.label : ''}</span>
        </span>
        <span className="layer done">
          <Icon.check />
          <span className="label-text">
            {status.phase === 'done' ? `Saved · ${formatBytes(status.bytes)}` : ''}
          </span>
        </span>
        <span className="layer error">Export failed — try again</span>
      </button>
      {status.phase === 'done' && (
        <div className="export-result" role="status">
          <span className="muted">{status.filename}</span>
          {status.warnings.length > 0 ? (
            <details>
              <summary className="warn">
                {plural(status.warnings.length, 'warning')} — some parts may be missing offline
              </summary>
              <ul className="warn-list">
                {status.warnings.slice(0, 30).map((w) => (
                  <li key={`${w.code}-${w.url ?? w.message}`}>
                    <b>{w.code}</b> {w.message} {w.url ? <code>{w.url}</code> : null}
                  </li>
                ))}
              </ul>
              {assetWarnings.length > 0 ? (
                <p className="muted small">
                  Assets from other sites need permission.{' '}
                  <button type="button" className="inline-link" onClick={env.openSettings}>
                    Allow in settings
                  </button>
                </p>
              ) : null}
            </details>
          ) : (
            <span className="ok">Everything embedded.</span>
          )}
        </div>
      )}
      {status.phase === 'error' && (
        <p className="error" role="alert">
          {status.message}
        </p>
      )}
      <p className="muted small">
        One offline file: a static snapshot of this page (scripts removed), every comment, decision
        and drawing, a JSON payload and a prompt telling the agent what to change. Nothing is
        uploaded.
      </p>
    </div>
  );
}
