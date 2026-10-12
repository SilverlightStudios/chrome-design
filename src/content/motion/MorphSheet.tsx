import {
  type ReactNode,
  type RefObject,
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
 * A floating sheet whose surface is physically spring-sized while its content stays at final
 * size behind an overflow clip — Spark's StackableDrawer technique (useDrawerMorph.ts):
 *   open:  from 38% along the edge × 58% deep, 16px toward the anchor, 384ms, ~10px overshoot,
 *          the cross axis following 24ms later; content fades in over the last ~64%.
 *   swap:  the same surface springs to the next panel's size (spatial continuity, no remount).
 *   close: back to the start shape in 180ms (translation ×1.3), content gone in the first 28%.
 * The anchor is the toolbar edge the sheet grows out of.
 */

const OPEN_S = 0.384;
const CLOSE_S = 0.18;
const OVERSHOOT_PX = 10;
const CROSS_AXIS_DELAY_MS = 24;
const START_ALONG = 0.38;
const START_DEPTH = 0.58;
const MAX_FRAME_S = 0.1;

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

/** The spring loop, kept outside React so renders never touch it. */
class SheetMotion {
  readonly w = createSpring(0);
  readonly h = createSpring(0);
  readonly y = createSpring(0);
  readonly o = createSpring(1);
  shell: HTMLElement | null = null;
  phase: SheetPhase = 'open';
  dir = 1;
  size: Size | null = null;
  onClosed: () => void = () => {};
  private raf = 0;
  private last = 0;
  private opened = false;
  private timer: number | undefined;

  private get all(): Spring[] {
    return [this.w, this.h, this.y, this.o];
  }

  private write(): void {
    const shell = this.shell;
    if (!shell) return;
    shell.style.setProperty('--shell-w', `${Math.max(0, this.w.value).toFixed(2)}px`);
    shell.style.setProperty('--shell-h', `${Math.max(0, this.h.value).toFixed(2)}px`);
    shell.style.setProperty('--shell-y', `${this.y.value.toFixed(2)}px`);
    shell.style.setProperty('--shell-o', `${Math.min(1, Math.max(0, this.o.value)).toFixed(3)}`);
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
      const rest = this.all.every(isAtRest);
      if (this.phase === 'closing' && (rest || this.o.value <= 0.01)) {
        this.raf = 0;
        this.onClosed();
        return;
      }
      if (rest) {
        this.raf = 0;
        return;
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /** New measurement of the content at final size. */
  measured(next: Size): void {
    this.size = next;
    if (!this.opened) {
      this.opened = true;
      this.w.value = next.w * START_ALONG;
      this.h.value = next.h * START_DEPTH;
      this.y.value = 16 * this.dir;
      this.o.value = 0;
      this.w.target = this.w.value;
      this.h.target = next.h;
      this.y.target = 0;
      this.o.target = 1;
      configure(
        [this.w, this.h],
        OPEN_S,
        OVERSHOOT_PX,
        Math.hypot(next.w - this.w.value, next.h - this.h.value),
      );
      configure([this.y], OPEN_S * 1.3, 0, 16);
      configure([this.o], OPEN_S * 0.5, 0, 1);
      this.write();
      this.wake();
      this.timer = window.setTimeout(() => {
        if (this.phase !== 'open') return;
        this.w.target = next.w;
        this.wake();
      }, CROSS_AXIS_DELAY_MS);
      return;
    }
    if (this.phase === 'open') {
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
  }

  close(): void {
    if (this.timer !== undefined) window.clearTimeout(this.timer);
    const target = this.size ?? { w: this.w.value, h: this.h.value };
    configure([this.w, this.h], CLOSE_S, 0, target.h);
    configure([this.y], CLOSE_S * 1.3, 0, 16);
    configure([this.o], CLOSE_S, 0, 1);
    this.w.target = target.w * START_ALONG;
    this.h.target = target.h * START_DEPTH;
    this.y.target = 16 * this.dir;
    this.o.target = 0;
    this.wake();
  }

  stop(): void {
    // Reset so a remount (React StrictMode runs effects twice) can wake the loop again.
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (this.timer !== undefined) window.clearTimeout(this.timer);
  }
}

function motionFor(ref: RefObject<SheetMotion | null>): SheetMotion {
  ref.current ??= new SheetMotion();
  return ref.current;
}

interface Props {
  phase: SheetPhase;
  /** Changing this while open morphs the surface to the new content's size. */
  contentKey: string;
  /** Edge of the toolbar the sheet grows from. */
  anchor: 'bottom' | 'top';
  className?: string;
  label: string;
  onClosed: () => void;
  children: ReactNode;
}

export function MorphSheet({
  phase,
  contentKey,
  anchor,
  className,
  label,
  onClosed,
  children,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size | null>(null);
  const motionRef = useRef<SheetMotion | null>(null);

  useLayoutEffect(() => {
    const motion = motionFor(motionRef);
    motion.shell = shellRef.current;
    motion.onClosed = onClosed;
    motion.dir = anchor === 'bottom' ? 1 : -1;
  }, [onClosed, anchor]);

  // Measure the content at final size (re-observed when the content changes).
  useLayoutEffect(() => {
    const frame = frameRef.current;
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

  useEffect(() => {
    const motion = motionFor(motionRef);
    motion.phase = phase;
    if (phase === 'closing') motion.close();
  }, [phase]);

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
        <div ref={frameRef} className="sheet-frame" key={contentKey}>
          {children}
        </div>
      </div>
    </div>
  );
}
