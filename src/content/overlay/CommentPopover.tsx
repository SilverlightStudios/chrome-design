import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react';
import { createId, nowIso } from '../../shared/ids';
import {
  type CommentIntent,
  type CommentThread,
  INTENT_LABEL,
  isComment,
  type Point,
} from '../../shared/model';
import { livePinPoint } from '../actions';
import { useEnv } from '../context';
import { type DraftComment, nextCommentNumber } from '../store';
import { Icon } from '../ui/icons';

const INTENTS: CommentIntent[] = ['change', 'decision', 'question', 'note'];
const POPOVER_WIDTH = 320;

function placement(p: Point): { left: number; top: number } {
  const right = window.scrollX + (document.documentElement.clientWidth || window.innerWidth);
  const left =
    p.x + 34 + POPOVER_WIDTH > right - 8
      ? Math.max(window.scrollX + 8, p.x - POPOVER_WIDTH - 12)
      : p.x + 34;
  const top = Math.max(window.scrollY + 8, p.y - 36);
  return { left, top };
}

function draftPoint(draft: DraftComment): Point {
  const t = draft.target;
  return t.type === 'region' ? { x: t.rect.x + t.rect.width, y: t.rect.y } : t.point;
}

function describeTarget(target: CommentThread['target']): string {
  if (target.type === 'region') {
    const n = target.anchors.length;
    return `Region ${Math.round(target.rect.width)}×${Math.round(target.rect.height)}${n ? ` · ${n} element${n > 1 ? 's' : ''}` : ''}`;
  }
  if (target.anchor) return target.anchor.path || target.anchor.selector;
  return `Point ${Math.round(target.point.x)}, ${Math.round(target.point.y)}`;
}

function IntentPicker({
  value,
  onChange,
}: {
  value: CommentIntent;
  onChange: (v: CommentIntent) => void;
}) {
  return (
    <div className="intent-picker" role="radiogroup" aria-label="Comment type">
      {INTENTS.map((intent) => (
        <button
          key={intent}
          type="button"
          role="radio"
          aria-checked={value === intent}
          data-intent={intent}
          data-active={value === intent ? '' : undefined}
          onClick={() => onChange(intent)}
        >
          {INTENT_LABEL[intent]}
        </button>
      ))}
    </div>
  );
}

export function CommentPopover({
  draft,
  thread,
}: {
  draft?: DraftComment;
  thread?: CommentThread;
}) {
  const { store } = useEnv();
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<CommentIntent>(thread?.intent ?? 'change');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);

  const messageCount = thread?.messages.length ?? 0;
  const seenCount = useRef(messageCount);
  useEffect(() => {
    if (messageCount > seenCount.current)
      listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    seenCount.current = messageCount;
  });

  const close = () => store.set({ draft: null, openThreadId: null });

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    const at = nowIso();
    if (draft) {
      const s = store.getState();
      const created: CommentThread = {
        id: createId('c'),
        type: 'comment',
        number: nextCommentNumber(s.doc.annotations),
        intent,
        status: 'open',
        target: draft.target,
        messages: [{ id: createId('m'), body, createdAt: at }],
        createdAt: at,
        updatedAt: at,
      };
      store.addAnnotation(created);
      store.set({ draft: null, openThreadId: null, selectedId: created.id });
    } else if (thread) {
      store.updateAnnotation(thread.id, (a) =>
        isComment(a)
          ? {
              ...a,
              messages: [...a.messages, { id: createId('m'), body, createdAt: at }],
              updatedAt: at,
            }
          : a,
      );
    }
    setText('');
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      submit();
    }
  };

  const point = draft ? draftPoint(draft) : thread ? livePinPoint(thread) : { x: 0, y: 0 };
  const pos = placement(point);
  const target = draft?.target ?? thread?.target;

  return (
    <div
      className="popover ui"
      role="dialog"
      aria-label={thread ? `Comment ${thread.number}` : 'New comment'}
      style={{ left: pos.left, top: pos.top, width: POPOVER_WIDTH }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="popover-head">
        {thread ? (
          <span className="pin-num" data-intent={thread.intent}>
            {thread.number}
          </span>
        ) : (
          <span className="new-dot" />
        )}
        <span className="popover-target" title={target ? describeTarget(target) : ''}>
          {target ? describeTarget(target) : ''}
        </span>
        {thread && (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label={thread.status === 'open' ? 'Resolve' : 'Reopen'}
              data-tip={thread.status === 'open' ? 'Resolve' : 'Reopen'}
              onClick={() =>
                store.updateAnnotation(thread.id, (a) =>
                  isComment(a)
                    ? {
                        ...a,
                        status: a.status === 'open' ? 'resolved' : 'open',
                        updatedAt: nowIso(),
                      }
                    : a,
                )
              }
            >
              {thread.status === 'open' ? <Icon.check /> : <Icon.reopen />}
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Delete thread"
              data-tip="Delete"
              onClick={() => store.removeAnnotations([thread.id])}
            >
              <Icon.trash />
            </button>
          </>
        )}
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          <Icon.close />
        </button>
      </div>

      {thread ? (
        <>
          <IntentPicker
            value={thread.intent}
            onChange={(v) =>
              store.updateAnnotation(thread.id, (a) =>
                isComment(a) ? { ...a, intent: v, updatedAt: nowIso() } : a,
              )
            }
          />
          <div className="messages" ref={listRef}>
            {thread.messages.map((m, i) => (
              <div key={m.id} className="message">
                <div className="message-meta">
                  {i === 0 ? 'You' : 'Reply'} ·{' '}
                  {new Date(m.createdAt).toLocaleString([], {
                    dateStyle: 'short',
                    timeStyle: 'short',
                  })}
                  {i > 0 && (
                    <button
                      type="button"
                      className="link-btn"
                      onClick={() =>
                        store.updateAnnotation(thread.id, (a) =>
                          isComment(a)
                            ? { ...a, messages: a.messages.filter((x) => x.id !== m.id) }
                            : a,
                        )
                      }
                    >
                      Delete
                    </button>
                  )}
                </div>
                <p>{m.body}</p>
              </div>
            ))}
          </div>
        </>
      ) : (
        <IntentPicker value={intent} onChange={setIntent} />
      )}

      <div className="composer">
        <textarea
          ref={inputRef}
          rows={draft ? 3 : 2}
          value={text}
          placeholder={
            draft
              ? intent === 'decision'
                ? 'Record a decision the agent must respect…'
                : intent === 'question'
                  ? 'Ask a question…'
                  : 'Describe the change…'
              : 'Reply or add detail…'
          }
          onChange={(e) => setText(e.target.value)}
        />
        <div className="composer-actions">
          <span className="muted small">⌘↵ to {draft ? 'post' : 'reply'}</span>
          <button type="button" className="btn primary" disabled={!text.trim()} onClick={submit}>
            {draft ? 'Post' : 'Reply'}
          </button>
        </div>
      </div>
    </div>
  );
}
