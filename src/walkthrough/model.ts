/**
 * A walkthrough: what the reviewer pointed at, drew, clicked and scrolled while they talked,
 * on one clock. Written by the extension as `walkthrough.json`; read by the summary builder,
 * the merge CLI and any voice recorder that adds what was said.
 *
 * All times are milliseconds since `startedAtMs` (Unix epoch ms), so anything recorded on the
 * same computer lines up by subtracting. All positions are CSS pixels in page space (document
 * origin), like the handoff.
 *
 * Pure types and constants only: this folder also runs in Node (`node tools/walkthrough-merge.ts`).
 */

export const WALKTHROUGH_KIND = 'chrome-design.walkthrough';
export const WALKTHROUGH_VERSION = 1;
export const TRANSCRIPT_KIND = 'chrome-design.transcript';

export interface WtPoint {
  x: number;
  y: number;
}

export interface WtRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A page element, named the way a person would say it, plus a selector for agents. */
export interface WtTarget {
  label: string;
  selector?: string;
}

/** What was under a stroke when it was drawn (resolved live, while the page was there). */
export interface WtStrokeHits {
  center?: WtTarget;
  start?: WtTarget;
  end?: WtTarget;
  /** Elements mostly inside the stroke's box, outermost first. */
  inside?: WtTarget[];
  /** Laser only: the elements it rested on, in order. */
  path?: WtTarget[];
}

/** One pen-down to pen-up (or one laser gesture). Points are `[x, y, ms since t0]`. */
export interface WtStroke {
  t0: number;
  t1: number;
  points: [number, number, number][];
  /** A laser pointer gesture (⇧ + move): fades as it goes, never part of the page. */
  laser?: boolean;
  /** A numbered pin (⇧ + click, or a tap while drawing on a phone). */
  pin?: number;
  hits?: WtStrokeHits;
}

export type WtShape = 'circle' | 'underline' | 'line' | 'arrow' | 'pin' | 'mark' | 'laser';

/** Strokes drawn close together in time, read as one gesture. */
export interface WtMark {
  id: string;
  shape: WtShape;
  t0: number;
  t1: number;
  /** Indexes into `strokes`. */
  strokes: number[];
  box: WtRect;
  from?: WtPoint;
  to?: WtPoint;
  pin?: number;
  /** The element it's about (circled, underlined, pinned, pointed to). */
  on?: WtTarget;
  /** Arrows and lines: where they start. Laser: everything it rested on. */
  also?: WtTarget[];
  /** Plain words, e.g. `circled Heading “Pricing”`. */
  description: string;
  /** The picture it shows in (`frames/frame-03.jpg`). */
  frame?: string;
}

export type WtEvent =
  | { kind: 'click'; t: number; point: WtPoint; target: WtTarget; button?: 'right' | 'middle' }
  | { kind: 'scroll'; t: number; t1: number; from: WtPoint; to: WtPoint; target?: WtTarget }
  | { kind: 'type'; t: number; target: WtTarget }
  | { kind: 'navigate'; t: number; url: string; title: string }
  | { kind: 'resize'; t: number; width: number; height: number }
  /** A spoken cue ("here", "look") sent live by a voice recorder. */
  | { kind: 'cue'; t: number; word: string };

export type WtFrameReason =
  | 'start'
  | 'mark'
  | 'pin'
  | 'laser'
  | 'click'
  | 'result'
  | 'scroll'
  | 'navigate'
  | 'cue'
  | 'idle'
  | 'end';

/** A picture of the screen at a moment worth showing. */
export interface WtFrame {
  /** 1-based, as numbered on the contact sheet. */
  index: number;
  file: string;
  /** The moment it shows (when the mark or click began), ms since start. */
  t: number;
  /** When the picture was actually taken. */
  takenAt: number;
  reason: WtFrameReason;
  /** The mark or event it was taken for. */
  mark?: string;
  scroll: WtPoint;
  viewport: { width: number; height: number };
  url: string;
  /** Picture size in pixels; `scale` = picture pixels per CSS pixel. */
  width: number;
  height: number;
  scale: number;
}

export interface WtWord {
  t0: number;
  t1: number;
  text: string;
}

export interface WtSegment {
  t0: number;
  t1: number;
  text: string;
  words?: WtWord[];
}

/**
 * What was said, on the walkthrough's clock (already shifted by `offsetMs`). `untimed` when
 * the source had no times (plain text): it's shown whole, not split across pictures.
 */
export interface WtTranscript {
  source: string;
  segments: WtSegment[];
  /** Added to the source's own times to land on the walkthrough clock. */
  offsetMs: number;
  /**
   * `clock`: both sides knew their start times (exact). `assumed`: the audio was taken to start
   * with the walkthrough, moved by hand by `offsetMs`.
   */
  alignment: 'clock' | 'assumed';
  /** Times were worked out (spread over a span), not reported word by word. */
  estimated?: boolean;
  untimed?: boolean;
}

export interface Walkthrough {
  kind: typeof WALKTHROUGH_KIND;
  version: typeof WALKTHROUGH_VERSION;
  generator: { name: string; version: string };
  /** ISO time and Unix epoch ms of the start: the clock everything else counts from. */
  startedAt: string;
  startedAtMs: number;
  durationMs: number;
  page: { url: string; title: string };
  viewport: { width: number; height: number; devicePixelRatio: number };
  /** Set when a voice recorder started (or was told about) this walkthrough. */
  session?: { id: string; app?: string; audioStartedAtMs?: number };
  frames: WtFrame[];
  marks: WtMark[];
  events: WtEvent[];
  strokes: WtStroke[];
  /** The pointer, `[t, x, y]`, at most 15 times a second while it moved. */
  cursor: [number, number, number][];
  transcript?: WtTranscript;
}

/** Strokes this close in time (ms) are one mark (a circle and then an arrow from it). */
export const MARK_GAP_MS = 1200;
export const MAX_MARK_STROKES = 6;
/** How long the laser's tail lasts on screen. */
export const LASER_MS = 420;
/** Ink fades this long after the pen last lifted (putting it down again holds it). */
export const INK_HOLD_MS = 1500;

export function formatClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
