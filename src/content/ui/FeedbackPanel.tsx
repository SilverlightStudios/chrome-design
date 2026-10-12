import { useState } from 'react';
import { type CommentThread, INTENT_LABEL, isComment } from '../../shared/model';
import { revealThread } from '../actions';
import { useEditor, useEnv } from '../context';
import { plural } from './format';

type Filter = 'all' | 'open' | 'resolved';
const FILTERS: Filter[] = ['all', 'open', 'resolved'];

function targetLabel(thread: CommentThread): string {
  const t = thread.target;
  if (t.type === 'region') return `Region ${Math.round(t.rect.width)}×${Math.round(t.rect.height)}`;
  if (t.anchor) return t.anchor.path || t.anchor.selector;
  return `Point ${Math.round(t.point.x)}, ${Math.round(t.point.y)}`;
}

export function FeedbackPanel() {
  const { store, toast } = useEnv();
  const [armed, setArmed] = useState(false);
  const annotations = useEditor((s) => s.doc.annotations);
  const openId = useEditor((s) => s.openThreadId);
  const [filter, setFilter] = useState<Filter>('all');
  const threads = annotations.filter(isComment).toSorted((a, b) => a.number - b.number);
  const shapes = annotations.length - threads.length;
  const visible = threads.filter((t) => filter === 'all' || t.status === filter);

  return (
    <div className="panel list-panel">
      <div className="panel-head">
        <h2>Feedback</h2>
        <span className="muted">
          {plural(threads.length, 'comment')} · {plural(shapes, 'drawing')}
        </span>
      </div>
      <div
        className="seg"
        role="radiogroup"
        aria-label="Filter"
        style={{ ['--n' as string]: 3, ['--i' as string]: FILTERS.indexOf(filter) }}
      >
        <span className="seg-loz" aria-hidden="true" />
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            role="radio"
            aria-checked={filter === f}
            data-active={filter === f ? '' : undefined}
            onClick={() => setFilter(f)}
          >
            {f[0]!.toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p className="empty">
          {threads.length === 0
            ? 'No comments yet. Press C and click anywhere on the page.'
            : 'Nothing here.'}
        </p>
      ) : (
        <ol className="thread-list">
          {visible.map((t) => (
            <li key={t.id}>
              <button
                type="button"
                className="thread-item"
                data-active={openId === t.id ? '' : undefined}
                data-intent={t.intent}
                data-status={t.status}
                onClick={() => revealThread(store, t)}
              >
                <span className="pin-num">{t.number}</span>
                <span className="thread-body">
                  <span className="thread-meta">
                    {INTENT_LABEL[t.intent]}
                    {t.status === 'resolved' ? ' · Resolved' : ''}
                    {t.messages.length > 1
                      ? ` · ${t.messages.length - 1} repl${t.messages.length > 2 ? 'ies' : 'y'}`
                      : ''}
                  </span>
                  <span className="thread-text">{t.messages[0]?.body}</span>
                  <span className="thread-target">{targetLabel(t)}</span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {annotations.length > 0 && (
        <div className="panel-foot">
          <button
            type="button"
            className="btn ghost danger"
            data-armed={armed ? '' : undefined}
            onClick={() => {
              if (!armed) {
                setArmed(true);
                window.setTimeout(() => setArmed(false), 3000);
                return;
              }
              setArmed(false);
              const count = annotations.length;
              store.clearAll();
              toast(`Cleared ${count} annotation${count === 1 ? '' : 's'}`, {
                label: 'Undo',
                run: store.undo,
              });
            }}
          >
            {armed ? 'Tap again to clear everything' : 'Clear page'}
          </button>
        </div>
      )}
    </div>
  );
}
