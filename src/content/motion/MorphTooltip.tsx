import {
  type CSSProperties,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { prefersReducedMotion } from './spring';

/*
 * One tooltip surface per toolbar that pours out of the hovered control, travels sideways
 * between controls leaving a gooey trail, and sinks back in — a port of Spark's
 * examples/morphing-tooltip (useMorphingTooltip.tsx + styles.module.css):
 *   pour 450ms, travel ×1.15, sink ×0.72, label re-forms ~30% into a move,
 *   only plain shapes are filtered (blur 5 + alpha 22/-11), labels stay crisp,
 *   keyboard focus and reduced motion snap without the goo, touch never opens it.
 * Open delay follows Spark's fluid tooltips (350ms cold, instant once warm).
 *
 * Menus grow out of the same surface: a control that owns a menu (data-menu) hands its content
 * to the group, and the tooltip extends from its label into the menu — or pours out of the
 * control into it when no label was showing — instead of a second panel stacking on top.
 * Clicking a control keeps the tooltip and lets it resize to the control's new label.
 */

const MORPH_MS = 450;
const TRAVEL_MS = Math.round(MORPH_MS * 1.15);
const CLOSE_MS = Math.round(MORPH_MS * 0.72);
const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 120;
const TIP_HEIGHT = 26;
const GAP = 10;
const MENU_GAP = 12;

type Morph = 'closed' | 'opening' | 'open' | 'moving' | 'closing' | 'menu';

interface Geometry {
  triggerLeft: number;
  triggerTop: number;
  triggerWidth: number;
  triggerHeight: number;
  tipLeft: number;
  tipWidth: number;
  tipHeight: number;
  restTop: number;
}

interface TipState extends Geometry {
  label: string;
  kbd: string;
  morph: Morph;
  visible: boolean;
  keyboard: boolean;
  trailLeft: number;
  trailWidth: number;
  travel: number;
}

const INITIAL: TipState = {
  label: '',
  kbd: '',
  morph: 'closed',
  visible: false,
  keyboard: false,
  triggerLeft: 0,
  triggerTop: 0,
  triggerWidth: 0,
  triggerHeight: 0,
  tipLeft: 0,
  tipWidth: 0,
  tipHeight: TIP_HEIGHT,
  restTop: 0,
  trailLeft: 0,
  trailWidth: 0,
  travel: 0,
};

interface Props {
  /** Tooltip sits above the controls (`up`) or below (`down`, toolbar docked at the top). */
  placement: 'up' | 'down';
  className?: string;
  ariaLabel?: string;
  /** Extra pointer handlers for the group (e.g. dragging the toolbar by its background). */
  onPointerDown?: (e: ReactPointerEvent<HTMLDivElement>) => void;
  children: ReactNode;
  style?: CSSProperties;
  /** An open menu: `owner` matches the data-menu of the control it belongs to. */
  menu?: { owner: string; label: string; content: ReactNode } | null;
}

function tipTarget(el: EventTarget | null): HTMLElement | null {
  return el instanceof Element ? (el.closest('[data-tip]') as HTMLElement | null) : null;
}

export function MorphTooltipGroup({
  placement,
  className,
  ariaLabel,
  onPointerDown,
  children,
  style,
  menu = null,
}: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The control under the mouse right now, so a click or a closing menu can return to it. */
  const hovered = useRef<HTMLElement | null>(null);
  const menuOpen = useRef(false);
  useLayoutEffect(() => {
    menuOpen.current = !!menu;
  });
  const [state, setState] = useState<TipState>(INITIAL);
  const stateRef = useRef(state);
  const timers = useRef({ open: 0, close: 0, settle: 0, frame: 0 });
  // Touch: press and hold a control to see its name (the release then doesn't trigger it).
  const hold = useRef<{ timer: number; fired: boolean; x: number; y: number }>({
    timer: 0,
    fired: false,
    x: 0,
    y: 0,
  });

  const commit = useCallback((next: TipState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clear = useCallback(() => {
    const t = timers.current;
    window.clearTimeout(t.open);
    window.clearTimeout(t.close);
    window.clearTimeout(t.settle);
    cancelAnimationFrame(t.frame);
  }, []);

  const geometryFor = useCallback(
    (el: HTMLElement): Geometry & { label: string; kbd: string } => {
      const group = groupRef.current!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const label = el.dataset.tip ?? '';
      const kbd = el.dataset.kbd ?? '';
      const m = measureRef.current!;
      m.querySelector('.tip-text')!.textContent = label;
      (m.querySelector('kbd') as HTMLElement).textContent = kbd;
      (m.querySelector('kbd') as HTMLElement).hidden = !kbd;
      const tipWidth = Math.ceil(m.getBoundingClientRect().width);
      const triggerLeft = r.left - group.left;
      const triggerTop = r.top - group.top;
      let tipLeft = triggerLeft + (r.width - tipWidth) / 2;
      // Keep the label on screen near the viewport edges.
      const absLeft = group.left + tipLeft;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      if (absLeft < 8) tipLeft += 8 - absLeft;
      if (absLeft + tipWidth > vw - 8) tipLeft -= absLeft + tipWidth - (vw - 8);
      const restTop =
        placement === 'up' ? triggerTop - TIP_HEIGHT - GAP : triggerTop + r.height + GAP;
      return {
        label,
        kbd,
        triggerLeft,
        triggerTop,
        triggerWidth: r.width,
        triggerHeight: r.height,
        tipLeft,
        tipWidth,
        tipHeight: TIP_HEIGHT,
        restTop,
      };
    },
    [placement],
  );

  const liveSurface = useCallback(() => {
    const tip = tipRef.current;
    const group = groupRef.current;
    if (!tip || !group) return null;
    const b = tip.getBoundingClientRect();
    return { left: b.left - group.getBoundingClientRect().left, width: b.width };
  }, []);

  /** The surface grown into a menu of `w` × `h` over its control, kept on screen. */
  const menuGeometry = useCallback(
    (el: HTMLElement, w: number, h: number): Geometry => {
      const group = groupRef.current!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const triggerLeft = r.left - group.left;
      const triggerTop = r.top - group.top;
      let tipLeft = triggerLeft + (r.width - w) / 2;
      const absLeft = group.left + tipLeft;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      if (absLeft < 8) tipLeft += 8 - absLeft;
      if (absLeft + w > vw - 8) tipLeft -= absLeft + w - (vw - 8);
      return {
        triggerLeft,
        triggerTop,
        triggerWidth: r.width,
        triggerHeight: r.height,
        tipLeft,
        tipWidth: w,
        tipHeight: h,
        restTop: placement === 'up' ? triggerTop - h - MENU_GAP : triggerTop + r.height + MENU_GAP,
      };
    },
    [placement],
  );

  const reveal = useCallback(
    (el: HTMLElement, keyboard: boolean) => {
      const g = geometryFor(el);
      clear();
      const current = stateRef.current;
      if (keyboard || prefersReducedMotion()) {
        commit({
          ...current,
          ...g,
          keyboard,
          morph: 'open',
          visible: true,
          trailLeft: g.tipLeft,
          trailWidth: g.tipWidth,
        });
        return;
      }
      if (current.visible || current.morph === 'closing') {
        if (current.visible && current.label === g.label && current.triggerLeft === g.triggerLeft)
          return;
        const trail = liveSurface();
        commit({
          ...current,
          ...g,
          keyboard: false,
          morph: 'moving',
          visible: true,
          trailLeft: trail ? trail.left : current.tipLeft,
          trailWidth: trail ? trail.width : current.tipWidth,
          travel: current.travel + 1,
        });
        timers.current.settle = window.setTimeout(() => {
          const s = stateRef.current;
          if (s.morph === 'moving') commit({ ...s, morph: 'open' });
        }, TRAVEL_MS);
        return;
      }
      commit({
        ...current,
        ...g,
        keyboard: false,
        morph: 'opening',
        visible: false,
        trailLeft: g.tipLeft,
        trailWidth: g.tipWidth,
        travel: current.travel + 1,
      });
      timers.current.frame = requestAnimationFrame(() => {
        const pending = stateRef.current;
        if (pending.morph !== 'opening') return;
        commit({ ...pending, visible: true });
        timers.current.settle = window.setTimeout(() => {
          const s = stateRef.current;
          if (s.morph === 'opening') commit({ ...s, morph: 'open' });
        }, MORPH_MS);
      });
    },
    [clear, commit, geometryFor, liveSurface],
  );

  const hide = useCallback(() => {
    clear();
    const current = stateRef.current;
    if (current.morph === 'closed') return;
    if (!current.visible || current.keyboard || prefersReducedMotion()) {
      commit({ ...current, morph: 'closed', visible: false, keyboard: false });
      return;
    }
    commit({ ...current, morph: 'closing', visible: false, keyboard: false });
    timers.current.settle = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.morph === 'closing') commit({ ...s, morph: 'closed' });
    }, CLOSE_MS);
  }, [clear, commit]);

  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const el = tipTarget(e.target);
    if (el) hovered.current = el;
    // An open menu holds the surface; other controls don't pull it away.
    if (menuOpen.current) return;
    if (!el || (el as HTMLButtonElement).disabled) return;
    window.clearTimeout(timers.current.close);
    const s = stateRef.current;
    if (s.visible || s.morph !== 'closed') {
      reveal(el, false);
      return;
    }
    window.clearTimeout(timers.current.open);
    timers.current.open = window.setTimeout(() => reveal(el, false), OPEN_DELAY_MS);
  };

  const onPointerLeave = () => {
    hovered.current = null;
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    if (menuOpen.current || stateRef.current.morph === 'closed') return;
    timers.current.close = window.setTimeout(hide, CLOSE_DELAY_MS);
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    const el = tipTarget(e.target);
    if (el && (e.target as HTMLElement).matches(':focus-visible')) reveal(el, true);
  };

  const onBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && groupRef.current?.contains(e.relatedTarget)) return;
    hide();
  };

  /** A menu closed: back to the label of whatever is under the mouse, or sink away. */
  const afterMenu = useCallback(() => {
    const el = hovered.current;
    if (!el?.isConnected || (el as HTMLButtonElement).disabled) {
      hide();
      return;
    }
    const g = geometryFor(el);
    const trail = liveSurface();
    clear();
    commit({
      ...stateRef.current,
      ...g,
      morph: 'moving',
      visible: true,
      trailLeft: trail ? trail.left : g.tipLeft,
      trailWidth: trail ? trail.width : g.tipWidth,
      travel: stateRef.current.travel + 1,
    });
    timers.current.settle = window.setTimeout(() => {
      const s = stateRef.current;
      if (s.morph === 'moving') commit({ ...s, morph: 'open' });
    }, TRAVEL_MS);
  }, [clear, commit, geometryFor, hide, liveSurface]);

  // A menu opened: grow the surface into it (from the label, or out of the control).
  const owner = menu?.owner ?? null;
  useLayoutEffect(() => {
    const group = groupRef.current;
    const content = menuRef.current;
    if (!owner || !group || !content) return;
    const trigger = group.querySelector<HTMLElement>(`[data-menu="${owner}"]`);
    if (!trigger) return;
    const sizeTo = (first: boolean) => {
      const b = content.getBoundingClientRect();
      const g = menuGeometry(trigger, Math.ceil(b.width), Math.ceil(b.height));
      const current = stateRef.current;
      if (!first) {
        commit({ ...current, ...g });
        return;
      }
      clear();
      const from = current.visible || current.morph === 'closing';
      if (prefersReducedMotion() || from) {
        commit({
          ...current,
          ...g,
          label: '',
          kbd: '',
          morph: 'menu',
          visible: true,
          keyboard: false,
        });
        return;
      }
      commit({
        ...current,
        ...g,
        label: '',
        kbd: '',
        morph: 'opening',
        visible: false,
        keyboard: false,
        trailLeft: g.tipLeft,
        trailWidth: g.tipWidth,
        travel: current.travel + 1,
      });
      timers.current.frame = requestAnimationFrame(() => {
        const pending = stateRef.current;
        if (pending.morph !== 'opening') return;
        commit({ ...pending, visible: true });
        timers.current.settle = window.setTimeout(() => {
          const s = stateRef.current;
          if (s.morph === 'opening') commit({ ...s, morph: 'menu' });
        }, MORPH_MS);
      });
    };
    sizeTo(true);
    const ro = new ResizeObserver(() => sizeTo(false));
    ro.observe(content);
    return () => {
      ro.disconnect();
      afterMenu();
    };
  }, [owner, clear, commit, menuGeometry, afterMenu]);

  useEffect(() => clear, [clear]);

  const s = state;
  const vars = {
    '--trigger-left': `${s.triggerLeft}px`,
    '--trigger-top': `${s.triggerTop}px`,
    '--trigger-width': `${s.triggerWidth}px`,
    '--trigger-height': `${s.triggerHeight}px`,
    '--tip-left': `${s.tipLeft}px`,
    '--tip-width': `${s.tipWidth}px`,
    '--tip-top': `${s.restTop}px`,
    '--trail-left': `${s.trailLeft}px`,
    '--trail-width': `${s.trailWidth}px`,
    '--morph-duration': `${MORPH_MS}ms`,
    '--morph-travel': `${TRAVEL_MS}ms`,
    '--morph-close': `${CLOSE_MS}ms`,
    '--tip-height': `${s.tipHeight}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      ref={groupRef}
      className={`tip-group ${className ?? ''}`}
      role="toolbar"
      aria-label={ariaLabel}
      data-morph={s.morph}
      data-visible={s.visible}
      data-keyboard={s.keyboard}
      data-placement={placement}
      data-menu={menu ? '' : undefined}
      style={vars}
      onPointerOver={onPointerOver}
      onPointerLeave={onPointerLeave}
      onPointerDown={(e) => {
        const inMenu = (e.target as Element).closest?.('[data-tip-menu]');
        if (e.pointerType === 'touch') hide();
        else if (!menuOpen.current && !inMenu) {
          // A click keeps the tooltip: once the control has updated, it resizes to the new
          // label (or stays put) instead of sinking and pouring out again.
          const el = tipTarget(e.target);
          window.setTimeout(() => {
            if (menuOpen.current || !el?.isConnected || hovered.current !== el) return;
            if (stateRef.current.morph !== 'closed') reveal(el, false);
          }, 0);
        }
        if (inMenu) return;
        window.clearTimeout(hold.current.timer);
        hold.current.fired = false;
        const el = tipTarget(e.target);
        if (
          e.pointerType === 'touch' &&
          el &&
          !el.dataset.longpress &&
          !(el as HTMLButtonElement).disabled
        ) {
          hold.current.x = e.clientX;
          hold.current.y = e.clientY;
          hold.current.timer = window.setTimeout(() => {
            hold.current.fired = true;
            reveal(el, false);
          }, 450);
        }
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        if (Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 10)
          window.clearTimeout(hold.current.timer);
      }}
      onPointerUp={() => {
        window.clearTimeout(hold.current.timer);
        if (hold.current.fired) timers.current.close = window.setTimeout(hide, 900);
      }}
      onPointerCancel={() => {
        window.clearTimeout(hold.current.timer);
        if (hold.current.fired) hide();
      }}
      onClickCapture={(e) => {
        if (!hold.current.fired) return;
        hold.current.fired = false;
        e.preventDefault();
        e.stopPropagation();
      }}
      onContextMenu={(e) => {
        // iOS/Android long-press menus would cover the label.
        if (e.nativeEvent instanceof PointerEvent && e.nativeEvent.pointerType === 'touch')
          e.preventDefault();
      }}
      onFocus={onFocus}
      onBlur={onBlur}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hide();
      }}
    >
      <div className="tip-goo" aria-hidden="true">
        {s.morph === 'closed' ? null : (
          <span className="tip-goo-set" key={s.travel}>
            <span className="tip-goo-plate" />
            <span className="tip-goo-surface" />
            <span className="tip-goo-neck" />
            <span className="tip-goo-trail" />
          </span>
        )}
      </div>
      {children}
      <div
        ref={tipRef}
        className="tip-surface"
        role={menu ? undefined : 'tooltip'}
        aria-hidden={menu ? undefined : !s.visible}
      >
        {menu ? (
          <div
            ref={menuRef}
            className="tip-menu"
            data-tip-menu=""
            role="dialog"
            aria-label={menu.label}
          >
            {menu.content}
          </div>
        ) : (
          <span className="tip-label" key={`${s.travel}-${s.label}`}>
            <span className="tip-text">{s.label}</span>
            {s.kbd ? <kbd>{s.kbd}</kbd> : null}
          </span>
        )}
      </div>
      <span ref={measureRef} className="tip-measure" aria-hidden="true">
        <span className="tip-text" />
        <kbd />
      </span>
    </div>
  );
}

/** The SVG filters used by the glass toolbar and the tooltip goo (must live in the shadow root). */
export const GOO_FILTER_ID = 'cd-goo';
