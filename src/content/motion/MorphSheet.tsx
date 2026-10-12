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
 * Mobile — a bottom sheet that is Spark's own app drawer (StackableDrawer in "scrub" mode,
 * useDrawerPull.ts): one number, the top edge's height, drives the shape, the content fade and
 * the scrim. It rises from the edge (height leads; width grows from 38% on an exponential
 * curve) on a 0.42s / 0.86 spring; a finger anywhere on it (not on a control, and a scrolling
 * list only from its top) moves that number directly, stretching up to 36px past open; letting
 * go projects the speed 0.18s ahead to decide open or closed and keeps it; closing shrinks back
 * to the card and drops away on a 1.26s critically damped spring aimed a card's depth past the
 * edge, taken off the moment it is out of sight.
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
/** A phone sheet comes up at most this share of the screen (the Remote Desktop drawer's cap). */
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
  'button, input, textarea, select, label, a, summary, [role="switch"], [role="slider"], [role="radio"], [contenteditable]';

/*
 * The phone sheet is Spark's drawer in its "scrub" mode (StackableDrawer/useDrawerPull.ts, as
 * Spark's own app uses it): one number places the sheet — how far its top edge is above the
 * bottom of the screen — and opening, a finger dragging it, and closing all play that one
 * morph. The top edge sits at that height with the full-size content uncovered beneath it;
 * the width grows from the narrow starting card (38%) on an exponential curve of how far up it
 * is; the content fades in over the first stretch and the scrim follows. A finger writes the
 * number directly; letting go, opening or closing hands it to a spring that keeps the finger's
 * velocity, so nothing changes speed at the release.
 */
/** How far a release is projected along its velocity, in seconds, before it is decided. */
const PROJECTION_S = 0.18;
/** How far past fully closed the sheet is taken off, so its shadow clears the edge too. */
const CLOSED_GAP = 24;
/** Pulled past fully open, the surface gives this much at most. */
const MAX_OVERPULL = 36;
/** The content is all there until the sheet is down to half its starting card's depth. */
const REVEAL_DEPTH = 0.5;
/** How sharply the width's growth accelerates (3: full width exactly as it's fully open). */
const WIDTH_CURVE = 3;
/** Opening is a touch underdamped; closing aims a card's depth past the edge, critically damped. */
const OPEN_SPRING = { response: 0.42, damping: 0.86 };
const CLOSE_SPRING = { response: 1.26, damping: 1 };
const PULL_FRAME_S = 0.05;
const REST_DISTANCE = 0.5;
const REST_SPEED = 8;
/** Only the last stretch of a drag counts towards the velocity it is let go with. */
const VELOCITY_WINDOW_MS = 100;
const POINTER_LOCK_PX = 6;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const resist = (d: number) => MAX_OVERPULL * (1 - 1 / (d / (MAX_OVERPULL * 2.5) + 1));

/** The phone sheet's single-number morph and its spring, kept outside React renders. */
export class PullMotion {
  surface: HTMLElement | null = null;
  root: HTMLElement | null = null;
  /** Top edge above the bottom (px); below 0 it carries on down out of sight. */
  d = 0;
  private size: Size = { w: 0, h: 0 };
  private spring: Spring | null = null;
  private closingTo: (() => void) | null = null;
  private raf = 0;
  private last = 0;
  private started = false;
  dragging = false;

  get height(): number {
    return this.size.h;
  }

  write(): void {
    const el = this.surface;
    const { w: width, h: height } = this.size;
    if (!el || !height) return;
    const d = this.d;
    const progress = clamp01(d / height);
    const growth = Math.expm1(WIDTH_CURVE * progress) / Math.expm1(WIDTH_CURVE);
    const stretch = d > height ? resist(d - height) : 0;
    const startWidth = width * START_ALONG;
    el.style.setProperty('--w', `${(startWidth + (width - startWidth) * growth).toFixed(2)}px`);
    el.style.setProperty('--h', `${(Math.max(0, Math.min(d, height)) + stretch).toFixed(2)}px`);
    el.style.setProperty('--oy', `${Math.max(0, -d).toFixed(2)}px`);
    el.style.setProperty('--rb', `${stretch.toFixed(2)}px`);
    el.style.setProperty('--reveal', clamp01(d / (height * START_DEPTH * REVEAL_DEPTH)).toFixed(4));
    this.root?.style.setProperty('--progress', progress.toFixed(4));
  }

  private stopSpring(): void {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.spring = null;
  }

  /** Hand the number to a spring toward open (or toward gone), keeping `velocity` (px/s, up +). */
  private settle(open: boolean, velocity: number): void {
    this.stopSpring();
    const height = this.size.h;
    const { response, damping } = open ? OPEN_SPRING : CLOSE_SPRING;
    const spring = createSpring(this.d, stiffnessFor(response), damping);
    spring.target = open ? height : -height * START_DEPTH;
    spring.velocity = velocity;
    this.spring = spring;
    const finish = () => {
      this.stopSpring();
      if (!open) {
        const done = this.closingTo;
        this.closingTo = null;
        done?.();
      }
    };
    if (prefersReducedMotion()) {
      this.d = open ? spring.target : -CLOSED_GAP;
      this.write();
      finish();
      return;
    }
    this.last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(PULL_FRAME_S, (now - this.last) / 1000);
      this.last = now;
      advance(spring, dt);
      const resting = open
        ? Math.abs(spring.value - spring.target) < REST_DISTANCE &&
          Math.abs(spring.velocity) < REST_SPEED
        : spring.value <= -CLOSED_GAP;
      this.d = resting && open ? spring.target : spring.value;
      this.write();
      if (resting) finish();
      else this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** The sheet's final box: the first one rises it from the edge; later ones re-settle. */
  measured(next: Size): void {
    const previous = this.size;
    this.size = next;
    if (!this.started) {
      this.started = true;
      this.d = 0;
      this.write();
      this.settle(true, 0);
      return;
    }
    if (this.closingTo || this.dragging) {
      this.write();
      return;
    }
    // Another panel or its content changed: the top edge springs to the new height. Also picks
    // the rise back up if something stopped it short (React's dev double-mount cancels frames).
    if (this.spring) {
      if (previous.h !== next.h) this.settle(true, this.spring.velocity);
      else this.write();
    } else if (Math.abs(this.d - next.h) > REST_DISTANCE) this.settle(true, 0);
    else this.write();
  }

  /** A finger is `dy` px from where it started (down +): the top edge follows it. */
  drag(dy: number): void {
    this.stopSpring();
    this.d = this.size.h - dy;
    this.write();
  }

  /** Let go with `velocity` (px/s, up +). True if it opens again, false if it should close. */
  release(velocity: number): boolean {
    const open = this.d + velocity * PROJECTION_S > this.size.h / 2;
    if (open) this.settle(true, velocity);
    return open;
  }

  /** Shrink back to the starting card and drop away; `done` once out of sight. */
  close(done: () => void, velocity = 0): void {
    this.closingTo = done;
    this.settle(false, Math.min(0, velocity));
  }

  /** Reopened while closing: rise back from wherever it is. */
  reopen(): void {
    if (!this.closingTo) return;
    this.closingTo = null;
    this.settle(true, this.spring?.velocity ?? 0);
  }

  stop(): void {
    this.stopSpring();
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
  const bodyRef = useRef<HTMLDivElement>(null);
  const motionRef = useRef<PullMotion | null>(null);
  motionRef.current ??= new PullMotion();
  const [box, setBox] = useState<Size | null>(null);
  const [dragging, setDragging] = useState(false);
  const [scrolls, setScrolls] = useState(false);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    locked: boolean;
    samples: { y: number; t: number }[];
  } | null>(null);
  const { leaving, swappedIn } = useSwap(contentKey, SWAP_FADE_MS);
  const kb = useKeyboardInset(rootRef);
  /** Speed at release (px/s, up +), handed to the closing spring. */
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
    motion.root = rootRef.current;
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
      setScrolls(natural > max + 1);
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
    // Closing: shrink to the card and drop away, then unmount (with a fallback if frames
    // stop, e.g. a hidden tab).
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      closedRef.current();
    };
    motion.close(finish, releaseVelocity.current);
    releaseVelocity.current = 0;
    const t = window.setTimeout(finish, prefersReducedMotion() ? 0 : 1500);
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

  // Spark's drawer gesture: grab the sheet anywhere that isn't a control. A list that scrolls
  // only hands over once it's at its top and the finger is pulling down.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (phase !== 'open' || e.button > 0 || drag.current) return;
    const target = e.target as Element;
    const fromChrome = !!target.closest('.bsheet-grab, .panel-head');
    if (!fromChrome && target.closest(INTERACTIVE)) return;
    drag.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      locked: false,
      samples: [{ y: e.clientY, t: performance.now() }],
    };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dy = e.clientY - d.y;
    if (!d.locked) {
      if (Math.abs(dy) < POINTER_LOCK_PX) return;
      const body = bodyRef.current;
      const inList =
        !!body && body.contains(e.target as Node) && !(e.target as Element).closest('.panel-head');
      const listBusy =
        inList && body!.scrollHeight > body!.clientHeight + 1 && (dy < 0 || body!.scrollTop > 1);
      if (Math.abs(dy) <= Math.abs(e.clientX - d.x) || listBusy) {
        drag.current = null;
        return;
      }
      d.locked = true;
      motionRef.current!.dragging = true;
      setDragging(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // synthetic or already-released pointer
      }
    }
    const now = performance.now();
    d.samples.push({ y: e.clientY, t: now });
    while (d.samples.length > 2 && now - d.samples[0]!.t > VELOCITY_WINDOW_MS) d.samples.shift();
    motionRef.current!.drag(dy);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (!d.locked) return;
    const motion = motionRef.current!;
    motion.dragging = false;
    setDragging(false);
    const first = d.samples[0]!;
    const last = d.samples[d.samples.length - 1]!;
    const now = performance.now();
    // Up is positive. A finger that stopped before it lifted gives none.
    const velocity =
      last.t > first.t && now - last.t < VELOCITY_WINDOW_MS
        ? -((last.y - first.y) / (last.t - first.t)) * 1000
        : 0;
    if (motion.release(velocity)) return;
    releaseVelocity.current = velocity;
    onDismiss();
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
            <div ref={bodyRef} className="bsheet-body" data-scrolls={scrolls ? '' : undefined}>
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
