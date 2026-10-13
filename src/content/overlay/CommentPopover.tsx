import {
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createId, nowIso } from '../../shared/ids';
import {
  type Annotation,
  type CommentIntent,
  type CommentMessage,
  type CommentThread,
  type ImageAttachment,
  INTENT_LABEL,
  isComment,
  type Point,
} from '../../shared/model';
import { findShape, shapeLabel, storedTargetPoint } from '../../shared/targets';
import { livePinPoint } from '../actions';
import { useEnv } from '../context';
import { friendlyAnchorLabel } from '../describe';
import {
  dragHasImage,
  imageFiles,
  imageUrls,
  type LoadedImage,
  loadImageFiles,
  loadImageUrls,
  pickImageFiles,
  toAttachment,
} from '../images';
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
const MAX_ATTACHMENTS = 6;

function popoverWidth(): number {
  return Math.min(POPOVER_WIDTH, (document.documentElement.clientWidth || window.innerWidth) - 16);
}

function placement(p: Point): { left: number; top: number; originX: number; originY: number } {
  const width = popoverWidth();
  const right = window.scrollX + (document.documentElement.clientWidth || window.innerWidth);
  const fitsRight = p.x + 38 + width <= right - 8;
  const fitsLeft = p.x - width - 12 >= window.scrollX + 8;
  const left = fitsRight ? p.x + 38 : Math.max(window.scrollX + 8, p.x - width - 12);
  // On a phone neither side has room: hang below the pin rather than over it.
  const top =
    fitsRight || fitsLeft
      ? Math.max(window.scrollY + 8, p.y - 34)
      : Math.max(window.scrollY + 8, p.y + 12);
  // Grows out of (and shrinks back into) the pin it belongs to.
  return { left, top, originX: p.x - left, originY: p.y - top - 15 };
}

function describeTarget(
  target: CommentThread['target'],
  annotations: readonly Annotation[],
): string {
  if (target.type === 'region') return 'This area';
  if (target.type === 'shape') {
    const shape = findShape(annotations, target.shapeId);
    return shape ? `This ${shapeLabel(shape).toLowerCase()}` : 'This spot';
  }
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
  const [attachments, setAttachments] = useState<ImageAttachment[]>([]);
  const [dropping, setDropping] = useState(false);
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

  const attach = (files: File[]) => {
    if (files.length) attachLoaded(loadImageFiles(files));
  };
  const attachLoaded = (loading: Promise<LoadedImage[]>) => {
    void loading.then((images) => {
      if (images.length === 0) {
        toast('That image couldn’t be opened');
        return;
      }
      setAttachments((list) => [...list, ...images.map(toAttachment)].slice(0, MAX_ATTACHMENTS));
      inputRef.current?.focus({ preventScroll: true });
    });
  };
  const onDragOver = (e: ReactDragEvent) => {
    if (!dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
    if (!dropping) setDropping(true);
  };
  const onDragLeave = (e: ReactDragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
  };
  const onDrop = (e: ReactDragEvent) => {
    if (!dragHasImage(e.dataTransfer)) return;
    e.preventDefault();
    e.stopPropagation();
    setDropping(false);
    const files = imageFiles(e.dataTransfer);
    if (files.length) attach(files);
    else {
      const urls = imageUrls(e.dataTransfer);
      if (urls.length) attachLoaded(loadImageUrls(urls));
    }
  };

  const submit = () => {
    const body = text.trim();
    if (!body && attachments.length === 0) return;
    const at = nowIso();
    const message: CommentMessage = {
      id: createId('m'),
      body,
      createdAt: at,
      ...(attachments.length ? { attachments } : {}),
    };
    if (draft) {
      const s = store.getState();
      const created: CommentThread = {
        id: createId('c'),
        type: 'comment',
        number: nextCommentNumber(s.doc.annotations),
        intent,
        status: 'open',
        target: draft.target,
        messages: [message],
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
              messages: [...a.messages, message],
              updatedAt: at,
            }
          : a,
      );
    }
    setText('');
    setAttachments([]);
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

  const annotations = store.getState().doc.annotations;
  const point = draft
    ? storedTargetPoint(draft.target, annotations)
    : thread
      ? livePinPoint(thread, annotations)
      : { x: 0, y: 0 };
  const pos = placement(point);
  const target = draft?.target ?? thread?.target;
  const current = thread?.intent ?? intent;

  return (
    <div
      className="popover ui"
      role="dialog"
      aria-label={thread ? `Comment ${thread.number}` : 'New comment'}
      data-exiting={exiting ? '' : undefined}
      data-drop-attach=""
      data-dropping={dropping ? '' : undefined}
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
      onDragEnter={onDragOver}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <div className="popover-head">
        {thread ? (
          <span className="pin-num" data-intent={thread.intent} data-status={thread.status}>
            {thread.number}
          </span>
        ) : null}
        <span className="popover-target">{target ? describeTarget(target, annotations) : ''}</span>
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
              {m.body ? <p>{m.body}</p> : null}
              {m.attachments?.length ? (
                <div className="message-images">
                  {m.attachments.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      className="image-thumb"
                      aria-label={`Open ${img.name}`}
                      onClick={() => store.set({ viewImage: img })}
                    >
                      <img
                        src={img.src}
                        alt=""
                        width={img.width}
                        height={img.height}
                        draggable={false}
                      />
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <div className="field" data-has-images={attachments.length ? '' : undefined}>
        {attachments.length ? (
          <div className="attach-strip">
            {attachments.map((img) => (
              <span key={img.id} className="attach-item">
                <img
                  src={img.src}
                  alt={img.name}
                  width={img.width}
                  height={img.height}
                  draggable={false}
                />
                <button
                  type="button"
                  className="attach-remove"
                  aria-label={`Remove ${img.name}`}
                  onClick={() => setAttachments((list) => list.filter((x) => x.id !== img.id))}
                >
                  <Icon.close />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={inputRef}
          rows={1}
          value={text}
          placeholder={thread ? 'Reply' : PLACEHOLDER[intent]}
          onChange={(e) => setText(e.target.value)}
          onPaste={(e) => {
            const files = imageFiles(e.clipboardData);
            if (files.length === 0) return;
            e.preventDefault();
            attach(files);
          }}
        />
        <button
          type="button"
          className="attach-btn"
          aria-label="Attach image"
          title="Attach image"
          disabled={attachments.length >= MAX_ATTACHMENTS}
          onClick={() => void pickImageFiles().then(attach)}
        >
          <Icon.image />
        </button>
        <button
          type="button"
          className="send"
          aria-label={draft ? 'Post comment' : 'Send reply'}
          disabled={!text.trim() && attachments.length === 0}
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
