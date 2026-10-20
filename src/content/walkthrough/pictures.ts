import type { WtPicture } from '../../shared/messages';
import type { WtEvent, WtFrameReason, WtPoint } from '../../walkthrough/model';
import {
  type Look,
  lookFromWire,
  regionDiff,
  SCENE_CHANGE,
  sceneDiff,
} from '../../walkthrough/scene';
import { askBackground, withPictureTurn } from '../ext';
import { screenName } from './pageContext';
import { PAGE_ID, type Tape } from './tape';

/**
 * Pictures of the screen while a walkthrough records: asked for at the moments that matter
 * (a click, a mark, a page change…), taken one at a time as Chrome allows (two a second), and
 * on Stop the most telling ones are kept (`pickFrames`). The service worker takes and keeps
 * them (background/walkthroughFiles.ts); the page keeps what each one shows and a small "look"
 * for telling whether the screen changed.
 */

/** A picture taken while recording (before the best ones are picked). */
export type Candidate = WtPicture & {
  /** For "is this new?" (scene.ts). */
  look?: Look;
};

export type Region = [number, number, number, number];

export interface PictureRequest {
  /** Asking again with the same key retakes that picture (a mark that grew). */
  key?: string;
  t?: number;
  delay?: number;
  strokeIndex?: number;
  /** A page change: where it happened (normalized), and its event, dropped with the picture
   *  when the screen shows nothing new. */
  region?: Region;
  event?: WtEvent;
}

interface Pending extends PictureRequest {
  key: string;
  reason: WtFrameReason;
  t: number;
  due: number;
}

const MAX_CANDIDATES = 60;
export const MAX_FRAMES = 20;

const PRIORITY: Record<WtFrameReason, number> = {
  // A flag is a deliberate "picture this": never dropped.
  flag: 10,
  start: 9,
  mark: 8,
  pin: 8,
  laser: 8,
  click: 7,
  navigate: 6,
  result: 5,
  cue: 5,
  change: 5,
  scroll: 4,
  end: 4,
  idle: 1,
};

/** Keep the most telling pictures (≤ MAX_FRAMES), in time order. */
export function pickFrames<T extends { reason: WtFrameReason; t: number }>(
  candidates: readonly T[],
  max = MAX_FRAMES,
): T[] {
  const list = [...candidates].toSorted((a, b) => a.t - b.t);
  while (list.length > max) {
    let drop = -1;
    let worst = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      // Lower priority goes first; among equals, the one crowded closest by a neighbour.
      const gap = Math.min(
        i > 0 ? c.t - list[i - 1]!.t : Infinity,
        i < list.length - 1 ? list[i + 1]!.t - c.t : Infinity,
      );
      const score = PRIORITY[c.reason] * 1e7 + Math.min(gap, 9e6);
      if (score < worst) {
        worst = score;
        drop = i;
      }
    }
    list.splice(drop, 1);
  }
  return list;
}

export class Pictures {
  candidates: Candidate[] = [];
  /** Where the page was scrolled in the last picture. */
  lastScroll: WtPoint = { x: window.scrollX, y: window.scrollY };
  private tape: Tape;
  private host: HTMLElement;
  /** The walkthrough they're kept under; null where there are no pictures (the demo page). */
  private session: string | null;
  private pending = new Map<string, Pending>();
  private busy = false;
  private timer = 0;
  private seq = 0;
  private waiters: (() => void)[] = [];

  constructor(tape: Tape, host: HTMLElement, session: string | null) {
    this.tape = tape;
    this.host = host;
    this.session = session;
  }

  /** When the last picture was taken (ms on the tape), -Infinity before the first. */
  get lastTaken(): number {
    return this.candidates.reduce((n, c) => Math.max(n, c.takenAt), -Infinity);
  }

  get waiting(): boolean {
    return this.pending.size > 0;
  }

  request(reason: WtFrameReason, options: PictureRequest = {}): void {
    if (!this.session) return;
    // Unique across the pages of a walkthrough: it's what the picture is kept under.
    const key = `${PAGE_ID}:${options.key ?? `${reason}-${++this.seq}`}`;
    const existing = this.pending.get(key);
    const taken = this.candidates.find((c) => c.key === key);
    if (!existing && !taken && this.candidates.length >= MAX_CANDIDATES) return;
    this.pending.set(key, {
      ...options,
      key,
      reason,
      t: existing?.t ?? taken?.t ?? options.t ?? this.tape.now(),
      due: Math.max(existing?.due ?? 0, Date.now() + (options.delay ?? 0)),
    });
    this.schedule();
  }

  /** Take what's still waiting (now), then resolve. */
  drain(): Promise<void> {
    if (this.pending.size === 0 && !this.busy) return Promise.resolve();
    for (const p of this.pending.values()) p.due = Math.min(p.due, Date.now());
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 8000);
      this.waiters.push(() => {
        window.clearTimeout(timeout);
        resolve();
      });
      this.schedule();
    });
  }

  dispose(): void {
    window.clearTimeout(this.timer);
    this.pending.clear();
    for (const w of this.waiters.splice(0)) w();
  }

  private schedule(): void {
    window.clearTimeout(this.timer);
    if (this.busy) return;
    if (this.pending.size === 0) {
      for (const w of this.waiters.splice(0)) w();
      return;
    }
    const next = Math.min(...[...this.pending.values()].map((p) => p.due));
    const wait = Math.max(0, next - Date.now());
    this.timer = window.setTimeout(() => void this.run(), wait);
  }

  private async run(): Promise<void> {
    const due = [...this.pending.values()]
      .filter((p) => p.due <= Date.now() + 5)
      .toSorted((a, b) => a.due - b.due)[0];
    if (!due) {
      this.schedule();
      return;
    }
    this.pending.delete(due.key);
    this.busy = true;
    try {
      const shot = await this.capture(due.key);
      if (shot && this.isNew(due, shot)) this.keep(due, shot);
      else if (shot && due.event)
        this.tape.events = this.tape.events.filter((e) => e !== due.event);
    } finally {
      this.busy = false;
      this.schedule();
    }
  }

  /**
   * A page change is kept only if it shows something new (Scrawl's measures): the screen moved
   * by more than 8 %, or a quarter of where it happened changed.
   */
  private isNew(due: Pending, shot: { look?: Look }): boolean {
    if (due.reason !== 'change' || !shot.look) return true;
    const before = this.candidates.reduce<Candidate | null>(
      (best, c) => (!best || c.takenAt > best.takenAt ? c : best),
      null,
    );
    if (!before?.look) return true;
    return (
      sceneDiff(before.look, shot.look) > SCENE_CHANGE ||
      (!!due.region && regionDiff(before.look, shot.look, due.region) > 0.25)
    );
  }

  private keep(due: Pending, shot: Omit<Candidate, 'key' | 'reason' | 't' | 'takenAt'>): void {
    const takenAt = this.tape.now();
    const screen = screenName();
    if (screen) this.tape.noteScreen(takenAt, screen);
    const candidate: Candidate = {
      key: due.key,
      reason: due.reason,
      t: due.t,
      takenAt,
      ...(due.strokeIndex !== undefined ? { strokeIndex: due.strokeIndex } : {}),
      ...shot,
      ...(screen ? { screen } : {}),
    };
    const at = this.candidates.findIndex((c) => c.key === due.key);
    if (at >= 0) this.candidates[at] = candidate;
    else this.candidates.push(candidate);
    this.lastScroll = shot.scroll;
  }

  private async capture(
    key: string,
  ): Promise<Omit<Candidate, 'key' | 'reason' | 't' | 'takenAt'> | null> {
    const scroll = { x: window.scrollX, y: window.scrollY };
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
    };
    const url = location.href;
    const session = this.session!;
    const taken = await withPictureTurn(this.host, () =>
      askBackground('cd:wt-picture', { session, key }),
    );
    if (!taken) return null;
    return {
      scroll,
      viewport,
      url,
      width: taken.width,
      height: taken.height,
      scale: taken.width / (window.innerWidth || viewport.width),
      look: lookFromWire(taken.look),
    };
  }
}
