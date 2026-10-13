import { useState } from 'react';
import { type Annotation, BREAKPOINTS, type CommentThread, isComment } from '../../shared/model';
import { findShape, shapeLabel } from '../../shared/targets';
import { revealThread } from '../actions';
import { useEditor, useEnv } from '../context';
import { friendlyAnchorLabel } from '../describe';
import { timeAgo } from '../overlay/CommentPopover';
import { messagePreview } from './format';
import { PanelHead } from './PanelHead';

type Filter = 'all' | 'open' | 'resolved';
const FILTERS: Filter[] = ['all', 'open', 'resolved'];

function targetLabel(thread: CommentThread, annotations: readonly Annotation[]): string {
  const t = thread.target;
  if (t.type === 'region') return 'An area';
  if (t.type === 'shape') {
    const shape = findShape(annotations, t.shapeId);
    return shape ? shapeLabel(shape) : 'A spot on the page';
  }
  if (t.anchor) return friendlyAnchorLabel(t.anchor);
  return 'A spot on the page';
}

export function FeedbackPanel() {
  const { store } = useEnv();
  const annotations = useEditor((s) => s.doc.annotations);
  const openId = useEditor((s) => s.openThreadId);
  const [filter, setFilter] = useState<Filter>('all');
  const threads = annotations.filter(isComment).toSorted((a, b) => a.number - b.number);
  const visible = threads.filter((t) => filter === 'all' || t.status === filter);

  return (
    <div className="panel list-panel">
      <PanelHead title="Comments">
        {threads.length ? <span className="muted small">{threads.length}</span> : null}
      </PanelHead>
      {threads.length > 0 && (
        <div
          className="seg"
          role="radiogroup"
          aria-label="Show"
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
      )}
      {visible.length === 0 ? (
        <p className="empty">
          {threads.length === 0 ? 'No comments yet' : `No ${filter} comments`}
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
                  <span className="thread-text">{messagePreview(t.messages[0])}</span>
                  <span className="thread-meta">
                    {targetLabel(t, annotations)}
                    {t.scope ? ` · ${BREAKPOINTS[t.scope].label}` : ''} · {timeAgo(t.updatedAt)}
                    {t.messages.length > 1
                      ? ` · ${t.messages.length - 1} repl${t.messages.length > 2 ? 'ies' : 'y'}`
                      : ''}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
