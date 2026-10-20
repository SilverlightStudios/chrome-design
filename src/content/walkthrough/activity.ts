import type { WtPoint, WtTarget } from '../../walkthrough/model';
import { isExtensionNode, isTypingEvent } from '../dom';
import type { Store } from '../state';
import type { Marks } from './marks';
import type { Pictures } from './pictures';
import type { RecorderState } from './recorder';
import type { Tape } from './tape';
import { targetAt, targetOf } from './targets';

/**
 * What the reviewer does on the page while recording: the pointer (and ⇧ for the laser and
 * ink, see marks.ts), clicks, scrolling, typing (never what was typed), window resizes and the
 * recording's own keys (⌥⇧W stop, ⌥⇧F flag). The page stays theirs to use: nothing here
 * blocks it, except a drag on the drawing surface.
 */

export interface ActivityHooks {
  stop: () => void;
  flag: () => void;
  /** Leaving the page: hand the last second over too (pageSync.ts). */
  sync: () => void;
  /** How many times the page has changed so far (pageWatch.ts). */
  mutations: () => number;
  recording: () => boolean;
}

const CURSOR_EVERY_MS = 66;
const MAX_CURSOR = 30_000;
/** A pointer that moved, then 20 s without a picture: one more. */
const IDLE_MS = 20_000;

const isPageScroller = (el: Element) =>
  el === document.scrollingElement || el === document.documentElement;

const fromComposed = (e: Event, test: (el: Element) => boolean) =>
  e.composedPath().some((n) => n instanceof Element && test(n));

export class Activity {
  private tape: Tape;
  private pictures: Pictures;
  private marks: Marks;
  private live: Store<RecorderState>;
  private hooks: ActivityHooks;
  private off: (() => void)[] = [];
  private click: {
    t: number;
    point: WtPoint;
    target?: WtTarget;
    button?: 'right' | 'middle';
    mutations: number;
  } | null = null;
  private scrollRun: { el: Element; t: number; from: WtPoint; timer: number } | null = null;
  private lastType: { el: Element; t: number } | null = null;
  private lastCursorAt = -Infinity;
  private lastScrollSample = -Infinity;
  private moved = false;
  private seq = 0;
  private resizeTimer = 0;

  constructor(
    tape: Tape,
    pictures: Pictures,
    marks: Marks,
    live: Store<RecorderState>,
    hooks: ActivityHooks,
  ) {
    this.tape = tape;
    this.pictures = pictures;
    this.marks = marks;
    this.live = live;
    this.hooks = hooks;
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      options: AddEventListenerOptions = { capture: true },
    ) => {
      window.addEventListener(type, fn as EventListener, options);
      this.off.push(() => window.removeEventListener(type, fn as EventListener, options));
    };
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e), { capture: true, passive: true });
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', (e) => this.onPointerUp(e));
    on('keydown', (e) => this.onKey(e, true));
    on('keyup', (e) => this.onKey(e, false));
    on('pagehide', () => hooks.sync());
    on('blur', () => {
      this.setShift(false);
      marks.endInk();
    });
    on('scroll', (e) => this.onScroll(e), { capture: true, passive: true });
    on('input', (e) => this.onInput(e));
    on('resize', () => this.onResize());
    const idle = window.setInterval(() => this.checkIdle(), 2000);
    this.off.push(() => window.clearInterval(idle));
  }

  /** Stop listening (the scroll in progress, if any, is noted first). */
  dispose(): void {
    this.flushScroll();
    for (const off of this.off.splice(0)) off();
    window.clearTimeout(this.resizeTimer);
  }

  private page(e: PointerEvent): WtPoint {
    return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down && e.altKey && e.shiftKey && (e.code === 'KeyW' || e.code === 'KeyF')) {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.code === 'KeyW') this.hooks.stop();
      else this.hooks.flag();
      return;
    }
    if (e.key !== 'Shift') return;
    if (down && (e.repeat || isTypingEvent(e))) return;
    this.setShift(down);
  }

  private setShift(on: boolean): void {
    if (this.live.getState().shift === on) return;
    this.live.set({ shift: on });
    if (!on) this.marks.endLaser();
  }

  private onPointerDown(e: PointerEvent): void {
    const p = this.page(e);
    if (fromComposed(e, (el) => el.hasAttribute('data-wt-surface'))) {
      if (e.button !== 0) return;
      e.preventDefault();
      this.marks.beginInk(e, p);
      return;
    }
    if (fromComposed(e, isExtensionNode)) return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : undefined;
    const el = e.composedPath()[0];
    const target = el instanceof Element ? targetOf(el) : targetAt(p.x, p.y);
    const t = this.tape.now();
    this.click = {
      t,
      point: p,
      ...(target ? { target } : {}),
      ...(button ? { button } : {}),
      mutations: this.hooks.mutations(),
    };
    // Before the page reacts: what was clicked, as it was.
    this.pictures.request('click', { key: `click-${t}`, t });
    const id = ++this.seq;
    this.live.set({ ripples: [...this.live.getState().ripples, { id, x: p.x, y: p.y }] });
    window.setTimeout(
      () => this.live.set({ ripples: this.live.getState().ripples.filter((r) => r.id !== id) }),
      600,
    );
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.page(e);
    const t = this.tape.now();
    if (t - this.lastCursorAt >= CURSOR_EVERY_MS && this.tape.cursor.length < MAX_CURSOR) {
      this.tape.cursor.push([t, Math.round(p.x), Math.round(p.y)]);
      this.lastCursorAt = t;
      this.moved = true;
    }
    if (this.marks.moveInk(e.pointerId, p, t)) return;
    if (this.live.getState().shift && e.pointerType !== 'touch' && e.buttons === 0)
      this.marks.laserTo(p, t);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.marks.endInk(e.pointerId)) return;
    const c = this.click;
    this.click = null;
    if (!c || e.type === 'pointercancel') return;
    const p = this.page(e);
    if (Math.hypot(p.x - c.point.x, p.y - c.point.y) > 10 || !c.target) return;
    this.tape.events.push({
      kind: 'click',
      t: c.t,
      point: { x: Math.round(c.point.x), y: Math.round(c.point.y) },
      target: c.target,
      ...(c.button ? { button: c.button } : {}),
    });
    // And after, if the page changed (or went somewhere): what the click did.
    const href = location.href;
    window.setTimeout(() => {
      if (!this.hooks.recording()) return;
      if (this.hooks.mutations() > c.mutations || location.href !== href)
        this.pictures.request('result', { key: `result-${c.t}` });
    }, 900);
  }

  private scrollPos(el: Element): WtPoint {
    return isPageScroller(el)
      ? { x: window.scrollX, y: window.scrollY }
      : { x: el.scrollLeft, y: el.scrollTop };
  }

  private onScroll(e: Event): void {
    const target = e.target;
    const el =
      target === document || target === window
        ? (document.scrollingElement ?? document.documentElement)
        : target instanceof Element
          ? target
          : null;
    if (!el || isExtensionNode(el)) return;
    const t = this.tape.now();
    if (isPageScroller(el) && t - this.lastScrollSample >= 100) {
      this.tape.noteScroll(t);
      this.lastScrollSample = t;
    }
    if (this.scrollRun && this.scrollRun.el !== el) this.flushScroll();
    if (!this.scrollRun) this.scrollRun = { el, t, from: this.scrollPos(el), timer: 0 };
    window.clearTimeout(this.scrollRun.timer);
    this.scrollRun.timer = window.setTimeout(() => this.flushScroll(), 400);
  }

  /** A scroll that has settled: an event, and a picture when it went far. */
  private flushScroll(): void {
    const run = this.scrollRun;
    if (!run) return;
    this.scrollRun = null;
    window.clearTimeout(run.timer);
    const to = this.scrollPos(run.el);
    if (Math.hypot(to.x - run.from.x, to.y - run.from.y) < 40) return;
    const page = isPageScroller(run.el);
    const t1 = this.tape.now();
    if (page) this.tape.scrolls.push([t1, Math.round(to.x), Math.round(to.y)]);
    const target = page ? undefined : targetOf(run.el);
    this.tape.events.push({
      kind: 'scroll',
      t: run.t,
      t1,
      from: run.from,
      to,
      ...(target ? { target } : {}),
    });
    if (!this.hooks.recording()) return;
    const seen = this.pictures.lastScroll;
    const far = page
      ? Math.abs(window.scrollY - seen.y) > window.innerHeight * 0.4 ||
        Math.abs(window.scrollX - seen.x) > window.innerWidth * 0.4
      : Math.abs(to.y - run.from.y) > run.el.clientHeight * 0.4;
    if (far) this.pictures.request('scroll');
  }

  private onInput(e: Event): void {
    const el = e.composedPath()[0];
    if (!(el instanceof HTMLElement) || isExtensionNode(el)) return;
    const editable =
      el.isContentEditable || el.localName === 'textarea' || el.localName === 'input';
    if (!editable) return;
    const t = this.tape.now();
    // Typing on in the same field is the same event.
    if (this.lastType?.el === el && t - this.lastType.t < 4000) {
      this.lastType.t = t;
      return;
    }
    this.lastType = { el, t };
    const target = targetOf(el);
    if (target) this.tape.events.push({ kind: 'type', t, target });
  }

  private onResize(): void {
    window.clearTimeout(this.resizeTimer);
    this.resizeTimer = window.setTimeout(() => {
      this.tape.events.push({
        kind: 'resize',
        t: this.tape.now(),
        width: document.documentElement.clientWidth || window.innerWidth,
        height: window.innerHeight,
      });
    }, 400);
  }

  private checkIdle(): void {
    const last = Math.max(0, this.pictures.lastTaken);
    if (this.moved && this.tape.now() - last > IDLE_MS && !this.pictures.waiting) {
      this.moved = false;
      this.pictures.request('idle');
    }
  }
}
