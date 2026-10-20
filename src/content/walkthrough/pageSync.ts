import type { WtPageData, WtSessionInfo, WtSyncedPicture } from '../../shared/messages';
import { askBackground } from '../ext';
import type { Candidate, Pictures } from './pictures';
import type { Tape } from './tape';

/**
 * Walkthroughs that follow a link: the page's script goes away with the page, so while it
 * records it hands what it has to the service worker about once a second (and as the page
 * goes); the next page picks the walkthrough up on the same clock (recorder.resume), and on
 * Stop the earlier pages are put in front of this one's (background/walkthroughs.ts keeps them).
 */

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** This page load (a walkthrough can span several). */
export const PAGE_ID = newId();

export class PageSync {
  private tape: Tape;
  private pictures: Pictures;
  private cursorSent = 0;
  private picturesSent = new Map<string, number>();
  private timer: number;

  constructor(tape: Tape, pictures: Pictures) {
    this.tape = tape;
    this.pictures = pictures;
    this.timer = window.setInterval(() => this.send(), 1000);
  }

  dispose(): void {
    window.clearInterval(this.timer);
  }

  /** Hand over what's new (pictures and pointer only once; the rest whole). */
  send(): void {
    const pictures: WtSyncedPicture[] = [];
    for (const c of this.pictures.candidates) {
      if (this.picturesSent.get(c.key) === c.takenAt) continue;
      const { look: _look, ...picture } = c;
      pictures.push(picture);
      this.picturesSent.set(c.key, c.takenAt);
    }
    const tape = this.tape;
    const cursorFrom = this.cursorSent;
    this.cursorSent = tape.cursor.length;
    void askBackground('cd:wt-sync', {
      pinCount: tape.pinCount,
      page: {
        pageId: PAGE_ID,
        strokes: tape.strokes,
        events: tape.events,
        scrolls: tape.scrolls,
        contextChanges: tape.contextChanges,
        cursorFrom,
        cursor: tape.cursor.slice(cursorFrom),
        pictures,
      },
    });
  }
}

/** Put the earlier pages (from the service worker) in front of this one's. */
export async function withEarlierPages(tape: Tape, pictures: Pictures): Promise<void> {
  const pages = (await askBackground('cd:wt-collect', { pageId: PAGE_ID }))?.pages ?? [];
  if (pages.length === 0) return;
  const { strokes: own, events, cursor, scrolls, contextChanges } = tape;
  const all: Omit<WtPageData, 'pageId'>[] = [
    ...pages,
    { strokes: own, events, cursor, scrolls, contextChanges, pictures: pictures.candidates },
  ];
  const strokes: Tape['strokes'] = [];
  const candidates: Candidate[] = [];
  for (const page of all) {
    // Stroke indexes are each page's own: shift them past the pages before.
    const offset = strokes.length;
    strokes.push(...page.strokes);
    for (const c of page.pictures as Candidate[])
      candidates.push(
        c.strokeIndex === undefined ? c : { ...c, strokeIndex: c.strokeIndex + offset },
      );
  }
  tape.strokes = strokes;
  tape.events = all.flatMap((p) => p.events).toSorted((a, b) => a.t - b.t);
  tape.cursor = all.flatMap((p) => p.cursor).toSorted((a, b) => a[0] - b[0]);
  tape.scrolls = all.flatMap((p) => p.scrolls).toSorted((a, b) => a[0] - b[0]);
  tape.contextChanges = all.flatMap((p) => p.contextChanges).toSorted((a, b) => a.t - b.t);
  pictures.candidates = candidates;
}

export function sessionInfo(
  tape: Tape,
  session: WtSessionInfo['session'],
  startPage: WtSessionInfo['startPage'],
): WtSessionInfo {
  return {
    session: {
      id: session.id,
      origin: session.origin,
      ...(session.app ? { app: session.app } : {}),
      ...(session.audioStartedAtMs !== undefined
        ? { audioStartedAtMs: session.audioStartedAtMs }
        : {}),
    },
    startedAtMs: tape.startedAtMs,
    pinCount: tape.pinCount,
    context: tape.context,
    startPage,
  };
}
