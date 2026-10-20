import { buildAnchor } from '../../capture/anchor';
import { createId, nowIso } from '../../shared/ids';
import { type CommentThread, isComment } from '../../shared/model';
import { formatClock, type Walkthrough } from '../../walkthrough/model';
import { timeline } from '../../walkthrough/summary';
import { pickElement } from '../dom';
import { type EditorStore, nextCommentNumber } from '../store';
import type { Pictures } from './pictures';
import type { Tape } from './tape';
import { targetOf } from './targets';

/**
 * Flags (⌥⇧F, or ⚑ on the recording bar): "look here". A picture that's never dropped, and a
 * Note comment pinned where the pointer is, so the moment is in the feedback too. Once there's
 * a transcript the comment also says what was said then.
 */

/** A flag comment's own words (kept at the end when what was said is added). */
const flagBody = (t: number) => `⚑ Walkthrough ${formatClock(t)}`;

export function flag(tape: Tape, pictures: Pictures, store: EditorStore | null): void {
  const t = tape.now();
  const last = tape.cursor.at(-1);
  const point = last
    ? { x: last[1], y: last[2] }
    : { x: window.scrollX + window.innerWidth / 2, y: window.scrollY + window.innerHeight / 2 };
  const el = pickElement(point.x - window.scrollX, point.y - window.scrollY);
  const target = el ? targetOf(el) : undefined;
  let number: number | undefined;
  if (store) {
    number = nextCommentNumber(store.getState().doc.annotations);
    const at = nowIso();
    const anchor =
      el && el !== document.body && el !== document.documentElement ? buildAnchor(el) : null;
    const thread: CommentThread = {
      id: createId('c'),
      type: 'comment',
      number,
      intent: 'note',
      status: 'open',
      target: anchor ? { type: 'element', point, anchor } : { type: 'point', point },
      messages: [{ id: createId('m'), body: flagBody(t), createdAt: at }],
      createdAt: at,
      updatedAt: at,
      viewport: {
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      },
    };
    store.addAnnotation(thread);
  }
  tape.events.push({
    kind: 'flag',
    t,
    point: { x: Math.round(point.x), y: Math.round(point.y) },
    ...(target ? { target } : {}),
    ...(number !== undefined ? { comment: number } : {}),
  });
  pictures.request('flag', { key: `flag-${t}`, t });
}

/** Flag comments say what was said then, once there's a transcript (their text untouched). */
export function syncFlags(store: EditorStore, wt: Walkthrough): void {
  if (!wt.transcript) return;
  const entries = timeline(wt);
  for (const e of wt.events) {
    if (e.kind !== 'flag' || e.comment === undefined) continue;
    const entry =
      entries.find((x) => Math.abs(x.t - e.t) < 50) ?? entries.findLast((x) => x.t <= e.t);
    const said = entry?.said;
    if (!said) continue;
    const thread = store
      .getState()
      .doc.annotations.find((a): a is CommentThread => isComment(a) && a.number === e.comment);
    const first = thread?.messages[0];
    if (!thread || !first?.body.startsWith(flagBody(e.t))) continue;
    const body = `“${said}”\n\n${flagBody(e.t)}`;
    if (first.body === body) continue;
    store.updateAnnotation(thread.id, (a) =>
      isComment(a)
        ? { ...a, messages: [{ ...first, body }, ...a.messages.slice(1)], updatedAt: nowIso() }
        : a,
    );
  }
}
