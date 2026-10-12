import { useState } from 'react';
import { type CommentThread, INTENT_LABEL, isComment } from '../../shared/model';
import { revealThread } from '../actions';
import { useEditor, useEnv } from '../context';
import { friendlyAnchorLabel } from '../describe';
import { timeAgo } from '../overlay/CommentPopover';
import { PanelHead } from './PanelHead';

type Filter = 'all' | 'open' | 'resolved';
const FILTERS: Filter[] = ['all', 'open', 'resolved'];

function targetLabel(thread: CommentThread): string {
  const t = thread.target;
  if (t.type === 'region') return 'An area';
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
        <span className="muted small">{threads.length}</span>
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
          {threads.length === 0
            ? 'No comments yet. Choose Comment and click anywhere on the page.'
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
                  <span className="thread-text">{t.messages[0]?.body}</span>
                  <span className="thread-meta">
                    {INTENT_LABEL[t.intent]} · {targetLabel(t)} · {timeAgo(t.updatedAt)}
                    {t.status === 'resolved' ? ' · Resolved' : ''}
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
