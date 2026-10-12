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
import { friendlyAnchorLabel } from '../describe';
import { type DraftComment, nextCommentNumber } from '../store';
import { Icon } from '../ui/icons';

const INTENTS: CommentIntent[] = ['change', 'decision', 'question', 'note'];
const SHORT_LABEL: Record<CommentIntent, string> = {
  change: 'Change',
  decision: 'Decision',
  question: 'Question',
  note: 'Note',
};
const PLACEHOLDER: Record<CommentIntent, string> = {
  change: 'What should change?',
  decision: 'What should stay this way?',
  question: 'What would you like to ask?',
  note: 'Add a note',
};
const POPOVER_WIDTH = 300;

function popoverWidth(): number {
  return Math.min(POPOVER_WIDTH, (document.documentElement.clientWidth || window.innerWidth) - 16);
}

function placement(p: Point): { left: number; top: number; originX: number; originY: number } {
  const width = popoverWidth();
  const right = window.scrollX + (document.documentElement.clientWidth || window.innerWidth);
  const left =
    p.x + 38 + width > right - 8 ? Math.max(window.scrollX + 8, p.x - width - 12) : p.x + 38;
  const top = Math.max(window.scrollY + 8, p.y - 34);
  // Grows out of (and shrinks back into) the pin it belongs to.
  return { left, top, originX: p.x - left, originY: p.y - top - 15 };
}

function draftPoint(draft: DraftComment): Point {
  const t = draft.target;
  return t.type === 'region' ? { x: t.rect.x, y: t.rect.y } : t.point;
}

function describeTarget(target: CommentThread['target']): string {
  if (target.type === 'region') return 'This area';
  if (target.anchor) return friendlyAnchorLabel(target.anchor);
  return 'This spot';
}

/** "now", "5m", "3h", "Yesterday", "12 Oct". */
export function timeAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  if (h < 48) return 'Yesterday';
  return new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' });
}

function IntentChips({
  value,
  onChange,
}: {
  value: CommentIntent;
  onChange: (v: CommentIntent) => void;
}) {
  const index = INTENTS.indexOf(value);
  return (
    <div
      className="seg small"
      role="radiogroup"
      aria-label="Kind of comment"
      data-value={value}
      style={{ ['--n' as string]: INTENTS.length, ['--i' as string]: index }}
    >
      <span className="seg-loz" aria-hidden="true" />
      {INTENTS.map((intent) => (
        <button
          key={intent}
          type="button"
          role="radio"
          aria-checked={value === intent}
          title={INTENT_LABEL[intent]}
          data-intent={intent}
          data-active={value === intent ? '' : undefined}
          onClick={() => onChange(intent)}
        >
          {SHORT_LABEL[intent]}
        </button>
      ))}
    </div>
  );
}

export function CommentPopover({
  draft,
  thread,
  exiting = false,
}: {
  draft?: DraftComment;
  thread?: CommentThread;
  exiting?: boolean;
}) {
  const { store, toast } = useEnv();
  const [text, setText] = useState('');
  const [intent, setIntent] = useState<CommentIntent>(thread?.intent ?? 'change');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const id = requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    return () => cancelAnimationFrame(id);
  }, []);
  // Let go of the keyboard as soon as the bubble starts closing, so shortcuts work right away.
  useEffect(() => {
    if (exiting) inputRef.current?.blur();
  }, [exiting]);

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
      store.set({
        draft: null,
        openThreadId: null,
        selectedId: created.id,
        pickedEl: null,
        pickedRegion: null,
      });
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
    } else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      // Enter sends (Shift+Enter for a new line), like Figma comments and chat.
      e.preventDefault();
      submit();
    }
  };

  const point = draft ? draftPoint(draft) : thread ? livePinPoint(thread) : { x: 0, y: 0 };
  const pos = placement(point);
  const target = draft?.target ?? thread?.target;
  const current = thread?.intent ?? intent;

  return (
    <div
      className="popover ui"
      role="dialog"
      aria-label={thread ? `Comment ${thread.number}` : 'New comment'}
      data-exiting={exiting ? '' : undefined}
      inert={exiting}
      style={{
        left: pos.left,
        top: pos.top,
        width: popoverWidth(),
        ['--origin-x' as string]: `${pos.originX}px`,
        ['--origin-y' as string]: `${pos.originY}px`,
      }}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="popover-head">
        {thread ? (
          <span className="pin-num" data-intent={thread.intent} data-status={thread.status}>
            {thread.number}
          </span>
        ) : null}
        <span className="popover-target">{target ? describeTarget(target) : ''}</span>
        {thread && (
          <>
            <button
              type="button"
              className="icon-btn"
              data-on={thread.status === 'resolved' ? '' : undefined}
              aria-label={thread.status === 'open' ? 'Mark as resolved' : 'Reopen'}
              title={thread.status === 'open' ? 'Mark as resolved' : 'Reopen'}
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
              <Icon.check />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Delete comment"
              title="Delete"
              onClick={() => {
                store.removeAnnotations([thread.id]);
                toast(`Comment ${thread.number} deleted`, { label: 'Undo', run: store.undo });
              }}
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
        <div className="messages" ref={listRef}>
          {thread.messages.map((m, i) => (
            <div key={m.id} className="message">
              <div className="message-meta">
                <b>You</b>
                <span>{timeAgo(m.createdAt)}</span>
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
      ) : null}

      <div className="field">
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={thread ? 'Reply' : PLACEHOLDER[intent]}
          onChange={(e) => setText(e.target.value)}
        />
        <button
          type="button"
          className="send"
          aria-label={draft ? 'Post comment' : 'Send reply'}
          disabled={!text.trim()}
          onClick={submit}
        >
          <Icon.send />
        </button>
      </div>

      <IntentChips
        value={current}
        onChange={(v) => {
          if (thread) {
            store.updateAnnotation(thread.id, (a) =>
              isComment(a) ? { ...a, intent: v, updatedAt: nowIso() } : a,
            );
          } else {
            setIntent(v);
          }
          inputRef.current?.focus({ preventScroll: true });
        }}
      />
    </div>
  );
}
