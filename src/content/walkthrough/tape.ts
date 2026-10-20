import type { WtEvent, WtStroke } from '../../walkthrough/model';

export function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** This page load (a walkthrough can span several). */
export const PAGE_ID = newId();

/** `[t, x, y]`: the pointer, or where the page was scrolled to, at `t`. */
export type Sample = [number, number, number];

export interface ContextChange {
  t: number;
  key: string;
  value: string;
}

/**
 * What a walkthrough has recorded, on one clock (ms since `startedAtMs`): this page's part
 * while it records, and every page's once Stop has put them together (pageSync.ts).
 */
export class Tape {
  readonly startedAtMs: number;
  strokes: WtStroke[] = [];
  events: WtEvent[] = [];
  cursor: Sample[] = [];
  scrolls: Sample[] = [];
  /** Page details where it started (pageContext.ts), and what changed since. */
  context: Record<string, string>;
  contextChanges: ContextChange[] = [];
  /** Pins are numbered across pages. */
  pinCount: number;

  constructor(startedAtMs: number, context: Record<string, string>, pinCount = 0) {
    this.startedAtMs = startedAtMs;
    this.context = context;
    this.pinCount = pinCount;
  }

  now(): number {
    return Date.now() - this.startedAtMs;
  }

  noteScroll(t: number): void {
    this.scrolls.push([t, Math.round(window.scrollX), Math.round(window.scrollY)]);
  }

  noteRoute(t: number): void {
    const query = location.search.length < 80 ? location.search : '';
    this.contextChanges.push({ t, key: 'route', value: `${location.pathname}${query}` });
  }

  /** The screen in front (pageContext.ts), when it's another one. */
  noteScreen(t: number, screen: string): void {
    const last =
      this.contextChanges.findLast((c) => c.key === 'screen')?.value ?? this.context.screen;
    if (screen !== last) this.contextChanges.push({ t, key: 'screen', value: screen });
  }
}
