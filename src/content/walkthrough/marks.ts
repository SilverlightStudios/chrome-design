import {
  INK_HOLD_MS,
  LASER_MS,
  MARK_GAP_MS,
  MAX_MARK_STROKES,
  type WtPoint,
  type WtStroke,
  type WtTarget,
} from '../../walkthrough/model';
import { shapeOf, strokeBounds } from '../../walkthrough/shapes';
import { elementsInRect } from '../dom';
import type { Store } from '../state';
import type { Pictures } from './pictures';
import type { RecorderState } from './recorder';
import type { Tape } from './tape';
import { targetAt, targetOf } from './targets';

/**
 * The reviewer's marks while recording: red ink (⇧ + drag, or Draw), numbered pins (a click
 * while drawing) and the laser (⇧ + move). Each goes on the tape as a stroke with what it
 * touched, gets its picture, and shows on the page (the recorder's live state) until it fades.
 */

/** A pen that moves less than this is a click: a pin. */
const PIN_MOVE_PX = 6;

export class Marks {
  private tape: Tape;
  private pictures: Pictures;
  private live: Store<RecorderState>;
  private ink: { stroke: WtStroke; live: number; pointerId: number; start: WtPoint } | null = null;
  private laser: {
    stroke: WtStroke;
    dwell: { target: WtTarget; ms: number }[];
    lastSample: number;
  } | null = null;
  /** Strokes close together are one mark (one picture, retaken as the mark grows). */
  private group: { key: string; count: number; end: number } | null = null;
  private seq = 0;
  private fadeTimer = 0;
  private laserTimer = 0;

  constructor(tape: Tape, pictures: Pictures, live: Store<RecorderState>) {
    this.tape = tape;
    this.pictures = pictures;
    this.live = live;
  }

  dispose(): void {
    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.laserTimer);
  }

  /** The pen went down on the drawing surface. */
  beginInk(e: PointerEvent, p: WtPoint): void {
    this.endLaser();
    const surface = e
      .composedPath()
      .find((n): n is Element => n instanceof Element && n.hasAttribute('data-wt-surface'));
    try {
      surface?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer
    }
    window.clearTimeout(this.fadeTimer);
    const t = this.tape.now();
    const live = ++this.seq;
    this.ink = {
      stroke: { t0: t, t1: t, points: [[p.x, p.y, 0]] },
      live,
      pointerId: e.pointerId,
      start: p,
    };
    // Pen down again before the fade: everything on screen stays.
    this.live.set({
      ink: [
        ...this.live.getState().ink.map((s) => ({ ...s, fading: false })),
        { id: live, points: [p], fading: false },
      ],
    });
  }

  /** The pen moved: false when it isn't this pointer's pen. */
  moveInk(pointerId: number, p: WtPoint, t: number): boolean {
    const ink = this.ink;
    if (!ink || pointerId !== ink.pointerId) return false;
    const last = ink.stroke.points.at(-1)!;
    if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5) return true;
    ink.stroke.points.push([p.x, p.y, t - ink.stroke.t0]);
    this.live.set({
      ink: this.live
        .getState()
        .ink.map((s) => (s.id === ink.live ? { ...s, points: [...s.points, p] } : s)),
    });
    return true;
  }

  /** The pen lifted (any pointer, or none: the window lost focus, Stop). False if no pen. */
  endInk(pointerId?: number): boolean {
    const ink = this.ink;
    if (!ink || (pointerId !== undefined && pointerId !== ink.pointerId)) return false;
    this.ink = null;
    const stroke = ink.stroke;
    stroke.t1 = this.tape.now();
    const b = strokeBounds(stroke);
    if (Math.max(b.width, b.height) < PIN_MOVE_PX) this.pin(stroke, ink.start, ink.live);
    else this.mark(stroke, b);
    this.scheduleFade();
    return true;
  }

  private pin(stroke: WtStroke, at: WtPoint, live: number): void {
    const n = ++this.tape.pinCount;
    stroke.points = [[at.x, at.y, 0]];
    stroke.pin = n;
    const center = targetAt(at.x, at.y);
    if (center) stroke.hits = { center };
    const index = this.tape.strokes.push(stroke) - 1;
    this.group = null;
    const s = this.live.getState();
    this.live.set({
      ink: s.ink.filter((x) => x.id !== live),
      pins: [...s.pins, { n, x: at.x, y: at.y }],
    });
    this.pictures.request('pin', { key: `pin-${n}`, t: stroke.t0, strokeIndex: index });
  }

  private mark(stroke: WtStroke, b: ReturnType<typeof strokeBounds>): void {
    const first = stroke.points[0]!;
    const last = stroke.points.at(-1)!;
    // An underline is about the words above it.
    const cy = shapeOf(stroke) === 'underline' ? b.y - 8 : b.y + b.height / 2;
    const center = targetAt(b.x + b.width / 2, cy);
    const start = targetAt(first[0], first[1]);
    const end = targetAt(last[0], last[1]);
    const inside = elementsInRect(b, 3)
      .map((el) => targetOf(el))
      .filter((t): t is WtTarget => !!t);
    stroke.hits = {
      ...(center ? { center } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(inside.length ? { inside } : {}),
    };
    const index = this.tape.strokes.push(stroke) - 1;
    const g = this.group;
    if (g && stroke.t0 - g.end <= MARK_GAP_MS && g.count < MAX_MARK_STROKES) {
      g.count++;
      g.end = stroke.t1;
    } else {
      this.group = { key: `mark-${index}`, count: 1, end: stroke.t1 };
    }
    this.pictures.request('mark', { key: this.group!.key, t: stroke.t0, strokeIndex: index });
  }

  private scheduleFade(): void {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.live.set({ ink: this.live.getState().ink.map((s) => ({ ...s, fading: true })) });
      this.fadeTimer = window.setTimeout(() => {
        if (!this.ink) this.live.set({ ink: [] });
      }, 320);
    }, INK_HOLD_MS);
  }

  /** ⇧ held and the pointer moved: the laser follows. */
  laserTo(p: WtPoint, t: number): void {
    const wall = Date.now();
    if (!this.laser) {
      window.clearTimeout(this.laserTimer);
      this.laser = {
        stroke: { t0: t, t1: t, points: [], laser: true },
        dwell: [],
        lastSample: -Infinity,
      };
    }
    const l = this.laser;
    l.stroke.points.push([p.x, p.y, t - l.stroke.t0]);
    l.stroke.t1 = t;
    // What it rests on: sampled every 120 ms.
    if (t - l.lastSample >= 120) {
      const target = targetAt(p.x, p.y);
      const spent = l.lastSample === -Infinity ? 0 : t - l.lastSample;
      l.lastSample = t;
      const prev = l.dwell.at(-1);
      if (prev) prev.ms += spent;
      if (target && target.label !== prev?.target.label) l.dwell.push({ target, ms: 0 });
    }
    const keep = wall - LASER_MS - 80;
    this.live.set({
      laser: [...this.live.getState().laser.filter((q) => q[2] >= keep), [p.x, p.y, wall]],
    });
  }

  endLaser(): void {
    const l = this.laser;
    if (!l) return;
    this.laser = null;
    // Let the tail fade on screen.
    window.clearTimeout(this.laserTimer);
    this.laserTimer = window.setTimeout(() => this.live.set({ laser: [] }), LASER_MS + 80);
    if (l.stroke.points.length < 3) return;
    const last = l.dwell.at(-1);
    if (last) last.ms += Math.max(0, l.stroke.t1 - l.lastSample);
    const rested = l.dwell.filter((d) => d.ms >= 250);
    const path = (rested.length ? rested : last ? [last] : []).slice(-3).map((d) => d.target);
    if (path.length) l.stroke.hits = { path };
    const index = this.tape.strokes.push(l.stroke) - 1;
    this.group = null;
    // Right away, before anything else is drawn: the live trail is left out of the picture and
    // the whole path is drawn on it instead.
    this.pictures.request('laser', { key: `laser-${index}`, t: l.stroke.t0, strokeIndex: index });
  }
}
