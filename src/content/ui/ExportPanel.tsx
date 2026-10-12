import { useState } from 'react';
import { isComment } from '../../shared/model';
import { type ExportStatus, useEditor, useEnv } from '../context';
import { plural } from './format';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
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

  const run = () => {
    if (busy) return;
    void env.runExport({ includeScreenshot, includeSource }, setStatus);
  };

  return (
    <div className="panel export-panel" role="dialog" aria-label="Export for AI">
      <div className="panel-head">
        <h2>Export for AI agent</h2>
        <span className="muted">
          {plural(comments.length, 'comment')} · {plural(decisions, 'decision')} ·{' '}
          {plural(shapes, 'drawing')}
        </span>
      </div>
      <label className="stack">
        <span className="label">Brief for the agent (optional)</span>
        <textarea
          rows={3}
          value={brief}
          placeholder="Overall direction, e.g. “Make the hero feel calmer; keep brand colours.”"
          onChange={(e) => store.setBrief(e.target.value)}
        />
      </label>
      <div className="checks">
        <label>
          <input
            type="checkbox"
            checked={includeScreenshot}
            onChange={(e) => setIncludeScreenshot(e.target.checked)}
          />
          Include viewport screenshot
        </label>
        <label>
          <input
            type="checkbox"
            checked={includeSource}
            onChange={(e) => setIncludeSource(e.target.checked)}
          />
          Include original DOM source (reference)
        </label>
      </div>
      <p className="muted small">
        One offline HTML file: static page snapshot (scripts removed), your comments, decisions and
        drawings, a JSON payload and an explicit prompt for the agent. Nothing is uploaded.
      </p>
      <button
        type="button"
        className="btn primary wide"
        onClick={run}
        disabled={busy}
        data-testid="cd-export-download"
      >
        {busy ? status.label : 'Download handoff HTML'}
      </button>
      {status.phase === 'done' && (
        <div className="export-result" role="status">
          <strong>Saved {status.filename}</strong>
          <span className="muted">{formatBytes(status.bytes)}</span>
          {status.warnings.length > 0 ? (
            <details>
              <summary className="warn">
                ⚠ {status.warnings.length} warning{status.warnings.length === 1 ? '' : 's'} —
                details
              </summary>
              <ul className="warn-list">
                {status.warnings.slice(0, 30).map((w) => (
                  <li key={`${w.code}-${w.url ?? w.message}`}>
                    <b>{w.code}</b> {w.message} {w.url ? <code>{w.url}</code> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : (
            <span className="ok">Everything embedded.</span>
          )}
        </div>
      )}
      {status.phase === 'error' && (
        <p className="error" role="alert">
          Export failed: {status.message}
        </p>
      )}
    </div>
  );
}
