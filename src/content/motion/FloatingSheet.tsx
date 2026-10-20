import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  type SheetProps,
  type Size,
  START_ALONG,
  START_DEPTH,
  SWAP_FADE_MS,
  useSwap,
} from './sheets';
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
 * Desktop: a floating sheet above the toolbar whose surface is spring-sized while its content
 * stays at final size (Spark's StackableDrawer / useDrawerMorph):
 *   open:  from 38% along the edge × 58% deep, 16px toward the toolbar, 384ms, ~10px overshoot,
 *          cross axis 24ms later; content fades in early (by 60%) so it grows with the surface.
 *   swap:  the surface springs to the next panel's size while the old content fades out on top
 *          of the new one fading in — never a blank sheet.
 *   close: the whole sheet, content included, sinks back toward the toolbar and fades (the
 *          Remote Desktop drawer's "content rides down with the surface").
 */

const OPEN_S = 0.384;
const OVERSHOOT_PX = 10;
const CROSS_AXIS_DELAY_MS = 24;
const MAX_FRAME_S = 0.1;
const CLOSE_MS = 180;

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
