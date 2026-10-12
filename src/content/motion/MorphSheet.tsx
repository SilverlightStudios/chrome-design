import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import {
  advance,
  createSpring,
  dampingFor,
  isAtRest,
  prefersReducedMotion,
  type Spring,
  stiffnessFor,
} from './spring';

/*
 * Sheets that never lose their content mid-animation.
 *
 * Desktop — a floating sheet above the toolbar whose surface is spring-sized while its content
 * stays at final size (Spark's StackableDrawer / useDrawerMorph):
 *   open:  from 38% along the edge × 58% deep, 16px toward the toolbar, 384ms, ~10px overshoot,
 *          cross axis 24ms later; content fades in early (by 60%) so it grows with the surface.
 *   swap:  the surface springs to the next panel's size while the old content fades out on top
 *          of the new one fading in — never a blank sheet.
 *   close: the whole sheet, content included, sinks back toward the toolbar and fades (the
 *          Remote Desktop drawer's "content rides down with the surface").
 *
 * Mobile — a bottom sheet on the same physics as the owner's Remote Desktop drawer (desk.js, a
 * port of Spark's StackableDrawer): the surface springs up from 38% × 58% of its box with a
 * 10px overshoot in 384ms while the full-size content fades in late (hidden until 36%); panel
 * changes re-spring its height (0.3s, ~6px overshoot); it drops away in 0.18s × 1.3 with its
 * content riding down. Drag the handle: down follows the finger, up stretches with a rubber
 * band (max 64px); let go past 84px or with a flick (> 0.6 px/ms) to close, else it springs back.
 */

const OPEN_S = 0.384;
const OVERSHOOT_PX = 10;
const CROSS_AXIS_DELAY_MS = 24;
const START_ALONG = 0.38;
const START_DEPTH = 0.58;
const MAX_FRAME_S = 0.1;
const CLOSE_MS = 180;
const SWAP_FADE_MS = 180;
// Remote Desktop drawer (desk.js) on phones.
const DRAWER_CLOSE_S = 0.18 * 1.3;
const DRAWER_RESIZE_S = 0.3;
const DRAWER_RESIZE_OVERSHOOT_PX = 6;
const DRAWER_DISMISS_PX = 84;
const DRAWER_FLICK = 0.6;
const DRAWER_BAND_PX = 64;
const DRAWER_MAX_SHARE = 0.72;

export type SheetPhase = 'open' | 'closing';

interface Size {
  w: number;
  h: number;
}

function configure(list: Spring[], seconds: number, overshoot: number, distance: number): void {
  const damping = dampingFor(distance, overshoot);
  for (const s of list) {
    s.stiffness = stiffnessFor(seconds);
    s.damping = damping;
  }
}

/** The spring loop for the floating sheet's surface, kept outside React renders. */
class SurfaceMotion {
  readonly w = createSpring(0);
  readonly h = createSpring(0);
  readonly y = createSpring(0);
  shell: HTMLElement | null = null;
  dir = 1;
  private raf = 0;
  private last = 0;
  private opened = false;
  private timer: number | undefined;

  private get all(): Spring[] {
    return [this.w, this.h, this.y];
  }

  private write(): void {
    const shell = this.shell;
    if (!shell) return;
    shell.style.setProperty('--shell-w', `${Math.max(0, this.w.value).toFixed(2)}px`);
    shell.style.setProperty('--shell-h', `${Math.max(0, this.h.value).toFixed(2)}px`);
    shell.style.setProperty('--shell-y', `${this.y.value.toFixed(2)}px`);
  }

  private wake(): void {
    if (this.raf) return;
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(MAX_FRAME_S, (now - this.last) / 1000);
      this.last = now;
      const calm = prefersReducedMotion();
      for (const s of this.all) {
        if (calm) {
          s.value = s.target;
          s.velocity = 0;
        } else advance(s, dt);
      }
      this.write();
      if (this.all.every(isAtRest)) {
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  measured(next: Size): void {
    if (!this.opened) {
      this.opened = true;
      this.w.value = next.w * START_ALONG;
      this.h.value = next.h * START_DEPTH;
      this.y.value = 16 * this.dir;
      this.w.target = this.w.value;
      this.h.target = next.h;
      this.y.target = 0;
      configure(
        [this.w, this.h],
        OPEN_S,
        OVERSHOOT_PX,
        Math.hypot(next.w - this.w.value, next.h - this.h.value),
      );
      configure([this.y], OPEN_S * 1.3, 0, 16);
      this.write();
      this.wake();
      this.timer = window.setTimeout(() => {
        this.w.target = next.w;
        this.wake();
      }, CROSS_AXIS_DELAY_MS);
      return;
    }
    configure(
      [this.w, this.h],
      OPEN_S,
      OVERSHOOT_PX * 0.6,
      Math.hypot(next.w - this.w.value, next.h - this.h.value),
    );
    this.w.target = next.w;
    this.h.target = next.h;
    this.wake();
  }

  stop(): void {
    // Reset so a remount (React StrictMode runs effects twice) can wake the loop again.
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }
}

function motionFor(ref: RefObject<SurfaceMotion | null>): SurfaceMotion {
  ref.current ??= new SurfaceMotion();
  return ref.current;
}

/**
 * Panel swaps: remembers the previous content key for a short crossfade, and which panel
 * arrived by a swap. That panel keeps its swap-in animation for as long as it is shown;
 * dropping back to the opening reveal would restart the reveal from blank mid-way.
 */
function useSwap(contentKey: string, ms: number): { leaving: string | null; swappedIn: boolean } {
  const [prev, setPrev] = useState(contentKey);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [swapped, setSwapped] = useState<string | null>(null);
  if (contentKey !== prev) {
    setLeaving(prev);
    setPrev(contentKey);
    setSwapped(contentKey);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(null), ms);
    return () => window.clearTimeout(t);
  }, [leaving, ms]);
  return { leaving, swappedIn: swapped === contentKey };
}

/** Calls `onDone` once, `ms` after `active` turns true. */
function useAfter(active: boolean, ms: number, onDone: () => void): void {
  const done = useRef(onDone);
  useLayoutEffect(() => {
    done.current = onDone;
  });
  useEffect(() => {
    if (!active) return;
    const t = window.setTimeout(() => done.current(), prefersReducedMotion() ? 0 : ms);
    return () => window.clearTimeout(t);
  }, [active, ms]);
}

interface SheetProps {
  phase: SheetPhase;
  contentKey: string;
  render: (key: string) => ReactNode;
  label: string;
  className?: string;
  onClosed: () => void;
}

/** Desktop: floating, spring-sized sheet anchored to the toolbar. */
export function FloatingSheet({
  phase,
  contentKey,
  render,
  anchor,
  label,
  className,
  onClosed,
}: SheetProps & { anchor: 'bottom' | 'top' }) {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const motionRef = useRef<SurfaceMotion | null>(null);
  const { leaving, swappedIn } = useSwap(contentKey, SWAP_FADE_MS);
  useAfter(phase === 'closing', CLOSE_MS, onClosed);

  useLayoutEffect(() => {
    const motion = motionFor(motionRef);
    motion.shell = shellRef.current;
    motion.dir = anchor === 'bottom' ? 1 : -1;
  }, [anchor]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    // Re-runs per content: each panel gets its own frame element to measure.
    if (!frame || !contentKey) return;
    const motion = motionFor(motionRef);
    const measure = () => {
      const r = frame.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const next = { w: r.width, h: r.height };
      setSize((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
      motion.measured(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    return () => ro.disconnect();
  }, [contentKey]);

  useEffect(() => () => motionRef.current?.stop(), []);

  return (
    <div
      className="sheet-slot"
      data-anchor={anchor}
      data-phase={phase}
      style={size ? { width: size.w, height: size.h } : undefined}
    >
      <div
        ref={shellRef}
        className={`sheet-shell ${className ?? ''}`}
        role="dialog"
        aria-label={label}
      >
        {leaving && leaving !== contentKey ? (
          <div className="sheet-frame leaving" key={`leaving-${leaving}`} aria-hidden="true" inert>
            {render(leaving)}
          </div>
        ) : null}
        <div
          ref={frameRef}
          className="sheet-frame"
          data-swapped={swappedIn ? '' : undefined}
          key={contentKey}
        >
          {render(contentKey)}
        </div>
      </div>
    </div>
  );
}

const INTERACTIVE =
  'button, input, textarea, select, label, a, summary, [role="switch"], .scrub-label';

/** Rubber band for pulling the sheet up (Remote Desktop / Spark: approaches 64px). */
const band = (d: number) => DRAWER_BAND_PX * (1 - 1 / (d * 0.018 + 1));

/** The phone sheet's spring loop (size, lift, rubber band), kept outside React renders. */
class DrawerMotion {
  readonly w = createSpring(0);
  readonly h = createSpring(0);
  readonly y = createSpring(0);
  readonly rb = createSpring(0);
  surface: HTMLElement | null = null;
  /** Finger offset while dragging down (follows 1:1, not a spring). */
  gy = 0;
  closing = false;
  private opened = false;
  private raf = 0;
  private last = 0;
  private timer: number | undefined;
  private onRest: (() => void) | null = null;

  private get all(): Spring[] {
    return [this.w, this.h, this.y, this.rb];
  }

  write(): void {
    const el = this.surface;
    if (!el) return;
    el.style.setProperty('--w', `${Math.max(0, this.w.value).toFixed(2)}px`);
    el.style.setProperty('--h', `${Math.max(0, this.h.value).toFixed(2)}px`);
    el.style.setProperty('--oy', `${this.y.value.toFixed(2)}px`);
    el.style.setProperty('--gy', `${this.gy.toFixed(2)}px`);
    el.style.setProperty('--rb', `${Math.max(0, this.rb.value).toFixed(2)}px`);
  }

  private wake(): void {
    if (this.raf) return;
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(MAX_FRAME_S, (now - this.last) / 1000);
      this.last = now;
      const calm = prefersReducedMotion();
      for (const s of this.all) {
        if (calm) {
          s.value = s.target;
          s.velocity = 0;
        } else advance(s, dt);
      }
      // Closing is done once the sheet is out of view; no need to wait for the spring to rest.
      if (this.closing && this.y.value >= this.y.target - 1) {
        this.y.value = this.y.target;
        this.y.velocity = 0;
        this.rb.value = this.rb.target;
        this.rb.velocity = 0;
      }
      this.write();
      if (this.all.every(isAtRest)) {
        this.raf = 0;
        const done = this.onRest;
        this.onRest = null;
        done?.();
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  measured(next: Size): void {
    if (this.closing) return;
    if (!this.opened) {
      this.opened = true;
      // Spark: narrow along the edge, a little over half as deep, 16px low; height leads.
      this.w.value = next.w * START_ALONG;
      this.h.value = next.h * START_DEPTH;
      this.y.value = 16;
      this.w.target = this.w.value;
      this.h.target = next.h;
      this.y.target = 0;
      configure(
        [this.w, this.h],
        OPEN_S,
        OVERSHOOT_PX,
        Math.hypot(next.w - this.w.value, next.h - this.h.value),
      );
      configure([this.y], OPEN_S * 1.3, 0, 16);
      this.write();
      this.wake();
      this.timer = window.setTimeout(() => {
        this.w.target = next.w;
        this.wake();
      }, CROSS_AXIS_DELAY_MS);
      return;
    }
    // Another panel or its content changed: re-spring to the new box.
    configure([this.w], DRAWER_RESIZE_S, 0, 0);
    configure(
      [this.h],
      DRAWER_RESIZE_S,
      DRAWER_RESIZE_OVERSHOOT_PX,
      Math.abs(next.h - this.h.value),
    );
    this.w.target = next.w;
    this.h.target = next.h;
    this.wake();
  }

  /** Finger moved `dy` from where the drag started (positive = down). */
  drag(dy: number): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.gy = Math.max(0, dy);
    this.rb.value = dy < 0 ? band(-dy) : 0;
    this.rb.velocity = 0;
    this.rb.target = this.rb.value;
    this.write();
  }

  /** Let go: spring back into place (the close itself is `close`). */
  settle(): void {
    this.y.value += this.gy;
    this.gy = 0;
    configure([this.y, this.rb], DRAWER_RESIZE_S, 0, 0);
    this.y.target = 0;
    this.rb.target = 0;
    this.wake();
  }

  /** Drop away below the edge, content riding down; `velocity` in px/s carries a flick. */
  close(done: () => void, velocity = 0): void {
    this.closing = true;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    this.y.value += this.gy;
    this.gy = 0;
    this.y.velocity = Math.max(this.y.velocity, velocity);
    configure([this.y], DRAWER_CLOSE_S, 0, 0);
    this.y.target = this.h.value + this.rb.value + 24;
    this.w.target = this.w.value;
    this.h.target = this.h.value;
    this.w.velocity = 0;
    this.h.velocity = 0;
    configure([this.rb], DRAWER_CLOSE_S, 0, 0);
    this.rb.target = 0;
    this.onRest = done;
    this.wake();
  }

  /** Reopened while closing: rise back from wherever it is. */
  reopen(): void {
    if (!this.closing) return;
    this.closing = false;
    this.onRest = null;
    configure([this.y], OPEN_S * 1.3, 0, 0);
    this.y.target = 0;
    this.wake();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }
}

/**
 * Height of the on-screen keyboard (iOS/Android) while a field inside the sheet has focus, so
 * the sheet rides above it instead of behind it. Ignored while the page is pinch-zoomed.
 */
function useKeyboardInset(rootRef: RefObject<HTMLElement | null>): number {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    const vv = window.visualViewport;
    const root = rootRef.current;
    if (!vv || !root) return;
    const sync = () => {
      const focused = (root.getRootNode() as ShadowRoot).activeElement;
      const typing =
        !!focused &&
        root.contains(focused) &&
        focused.matches('textarea, input, [contenteditable]');
      const kb = typing && vv.scale < 1.01 ? window.innerHeight - vv.height - vv.offsetTop : 0;
      setInset(Math.max(0, Math.round(kb)));
    };
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    root.addEventListener('focusin', sync);
    root.addEventListener('focusout', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
      root.removeEventListener('focusin', sync);
      root.removeEventListener('focusout', sync);
    };
  }, [rootRef]);
  return inset;
}

/** Mobile: bottom sheet with handle, scrim and drag-to-dismiss (see the header comment). */
export function BottomSheet({
  phase,
  contentKey,
  render,
  label,
  className,
  onClosed,
  onDismiss,
}: SheetProps & { onDismiss: () => void }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const planeRef = useRef<HTMLDivElement>(null);
  const grabRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<DrawerMotion | null>(null);
  motionRef.current ??= new DrawerMotion();
  const [box, setBox] = useState<Size | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{
    startY: number;
    samples: { y: number; t: number }[];
    moved: boolean;
    dy: number;
  } | null>(null);
  const { leaving, swappedIn } = useSwap(contentKey, SWAP_FADE_MS);
  const kb = useKeyboardInset(rootRef);
  /** Flick speed at release (px/s), handed to the closing spring. */
  const releaseVelocity = useRef(0);
  const closedRef = useRef(onClosed);
  useLayoutEffect(() => {
    closedRef.current = onClosed;
  });

  // Measure the final box: full dock width × (handle + content), capped like the reference.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    if (!frame || !contentKey) return;
    const motion = motionRef.current!;
    motion.surface = surfaceRef.current;
    const measure = () => {
      const dock = dockRef.current;
      const plane = planeRef.current;
      if (!dock || !plane) return;
      const pad = Number.parseFloat(getComputedStyle(plane).paddingBottom) || 0;
      const natural = (grabRef.current?.offsetHeight ?? 22) + frame.scrollHeight + pad;
      const room = window.innerHeight - kb - 24;
      const max = Math.max(160, kb ? room : Math.min(room, window.innerHeight * DRAWER_MAX_SHARE));
      const next = { w: dock.clientWidth, h: Math.round(Math.min(natural, max)) };
      if (next.w === 0 || next.h === 0) return;
      setBox((prev) => (prev && prev.w === next.w && prev.h === next.h ? prev : next));
      motion.measured(next);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(frame);
    if (dockRef.current) ro.observe(dockRef.current);
    return () => ro.disconnect();
  }, [contentKey, kb]);

  useEffect(() => {
    const motion = motionRef.current!;
    if (phase === 'open') {
      motion.reopen();
      return;
    }
    // Closing: drop away, then unmount (with a fallback if frames stop, e.g. a hidden tab).
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closedRef.current();
    };
    motion.close(finish, releaseVelocity.current);
    releaseVelocity.current = 0;
    const t = window.setTimeout(finish, prefersReducedMotion() ? 0 : 700);
    return () => window.clearTimeout(t);
  }, [phase]);

  useEffect(() => () => motionRef.current?.stop(), []);

  // The page underneath never scrolls while the sheet is up: a swipe on the scrim or the
  // sheet's chrome does nothing, and only a list that actually overflows scrolls (CSS
  // overscroll-behavior keeps it from chaining to the page at its ends). touch-action alone
  // isn't enough on iOS, so touchmove is cancelled too.
  useEffect(() => {
    const root = rootRef.current;
    if (!root || phase !== 'open') return;
    const onTouchMove = (e: TouchEvent) => {
      const body = (e.target as Element).closest?.('.bsheet-body');
      if (!body || body.scrollHeight <= body.clientHeight + 1) e.preventDefault();
    };
    root.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => root.removeEventListener('touchmove', onTouchMove);
  }, [phase]);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'open' || e.button !== 0) return;
    const target = e.target as Element;
    // Drag from the handle or the panel's title row; the body scrolls natively.
    if (!target.closest('.bsheet-grab, .panel-head') || target.closest(INTERACTIVE)) return;
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointer
    }
    drag.current = {
      startY: e.clientY,
      samples: [{ y: e.clientY, t: performance.now() }],
      moved: false,
      dy: 0,
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const now = performance.now();
    d.samples.push({ y: e.clientY, t: now });
    // Keep the last ~120ms of movement for the release velocity.
    while (d.samples.length > 2 && now - d.samples[0]!.t > 120) d.samples.shift();
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < 6) return;
    if (!d.moved) setDragging(true);
    d.moved = true;
    d.dy = dy;
    motionRef.current!.drag(dy);
  };
  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    setDragging(false);
    const first = d.samples[0]!;
    const last = d.samples[d.samples.length - 1]!;
    const span = last.t - first.t;
    // px/ms over the recent window; a window shorter than 30ms can't be trusted as a flick.
    const velocity = span >= 30 ? (last.y - first.y) / span : 0;
    if (d.dy > DRAWER_DISMISS_PX || (velocity > DRAWER_FLICK && d.dy > 24)) {
      releaseVelocity.current = Math.max(0, velocity * 1000);
      onDismiss();
    } else motionRef.current!.settle();
  };

  return (
    <div
      ref={rootRef}
      className="bsheet-root ui"
      data-phase={phase}
      style={kb ? { ['--kb' as string]: `${kb}px` } : undefined}
    >
      <button
        type="button"
        className="bsheet-scrim"
        aria-label="Close"
        tabIndex={-1}
        onClick={() => phase === 'open' && onDismiss()}
      />
      <div ref={dockRef} className="bsheet-dock">
        <div
          ref={surfaceRef}
          className={`bsheet ${className ?? ''}`}
          role="dialog"
          aria-label={label}
          data-dragging={dragging ? '' : undefined}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div
            ref={planeRef}
            className="bsheet-plane"
            style={
              box
                ? { ['--fw' as string]: `${box.w}px`, ['--fh' as string]: `${box.h}px` }
                : undefined
            }
          >
            <div ref={grabRef} className="bsheet-grab" aria-hidden="true">
              <span />
            </div>
            <div className="bsheet-body">
              {leaving && leaving !== contentKey ? (
                <div
                  className="bsheet-frame leaving"
                  key={`leaving-${leaving}`}
                  aria-hidden="true"
                  inert
                >
                  {render(leaving)}
                </div>
              ) : null}
              <div
                ref={frameRef}
                className="bsheet-frame"
                data-swapped={swappedIn ? '' : undefined}
                key={contentKey}
              >
                {render(contentKey)}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Keeps a closing sheet mounted until its exit animation reports done. */
export function useSheetPresence<T>(value: T | null): {
  shown: T | null;
  phase: SheetPhase;
  onClosed: () => void;
} {
  const [shown, setShown] = useState<T | null>(value);
  const [phase, setPhase] = useState<SheetPhase>('open');
  const [prev, setPrev] = useState<T | null>(value);
  if (value !== prev) {
    setPrev(value);
    if (value !== null) {
      setShown(value);
      setPhase('open');
    } else if (shown !== null) {
      setPhase('closing');
    }
  }
  const onClosed = useCallback(() => {
    setShown(null);
    setPhase('open');
  }, []);
  return { shown, phase, onClosed };
}

/** Small screens / touch: panels become bottom sheets. */
export function useCompact(): boolean {
  const query = '(max-width: 640px), (pointer: coarse) and (max-width: 900px)';
  const [compact, setCompact] = useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = matchMedia(query);
    const sync = () => setCompact(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return compact;
}
