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
 * One tooltip per group of controls, after Spark's fluid tooltips
 * (examples/fluid-tooltips: useFluidTooltips.tsx + styles.module.css): a single dark label
 * that slides and resizes between controls (200 ms, cubic-bezier(0.22, 1, 0.36, 1)) while the
 * text travels 8 px in the direction of the move, with a small arrow. 350 ms to open cold,
 * instant while warm, 100 ms to let go; keyboard focus and reduced motion show it at once.
 *
 * Better on phones than Spark's (which never shows on touch): press and hold a control to see
 * its name, then slide along the group and the label follows from control to control; letting
 * go doesn't press anything. The label stays on screen at the edges, its arrow on the control.
 *
 * Any element with `data-tip` (and optional `data-kbd`) inside the group gets the label.
 * Menus grow out of the same surface: a control that owns a menu (`data-menu`) hands its
 * content to the group and the label opens up into it.
 */

const OPEN_DELAY_MS = 350;
const CLOSE_DELAY_MS = 100;
const HOLD_MS = 450;
const TIP_HEIGHT = 26;
const GAP = 10;
const MENU_GAP = 12;
const EDGE = 8;
const ARROW_INSET = 12;

type Direction = -1 | 0 | 1;

interface TipState {
  label: string;
  kbd: string;
  /** The label it's leaving (slides out while the new one slides in). */
  prev: { label: string; kbd: string } | null;
  direction: Direction;
  /** Bumps on every new label, restarting its animation. */
  seq: number;
  visible: boolean;
  /** Placed without sliding (it was hidden, or keyboard / reduced motion). */
  snap: boolean;
  instant: boolean;
  menu: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  /** The arrow's centre, from the label's left edge. */
  arrow: number;
  /** Centre of the control it belongs to (for the direction of the next move). */
  anchor: number;
}

const INITIAL: TipState = {
  label: '',
  kbd: '',
  prev: null,
  direction: 0,
  seq: 0,
  visible: false,
  snap: true,
  instant: false,
  menu: false,
  left: 0,
  top: 0,
  width: 0,
  height: TIP_HEIGHT,
  arrow: 0,
  anchor: 0,
};

interface Props {
  /** The label sits above the controls (`up`) or below (`down`). */
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

const usable = (el: HTMLElement | null): el is HTMLElement =>
  !!el && !!el.dataset.tip && !(el as HTMLButtonElement).disabled;

export function TooltipGroup({
  placement,
  className,
  ariaLabel,
  onPointerDown,
  children,
  style,
  menu = null,
}: Props) {
  const groupRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  /** The control under the mouse right now, so a click or a closing menu can return to it. */
  const hovered = useRef<HTMLElement | null>(null);
  /** The control the label belongs to. */
  const current = useRef<HTMLElement | null>(null);
  const menuOpen = useRef(false);
  useLayoutEffect(() => {
    menuOpen.current = !!menu;
  });
  const [state, setState] = useState<TipState>(INITIAL);
  const stateRef = useRef(state);
  const timers = useRef({ open: 0, close: 0, frame: 0 });
  // Touch: press and hold to see a name, then slide to the others.
  const hold = useRef({ timer: 0, fired: false, x: 0, y: 0 });

  const commit = useCallback((next: TipState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clear = useCallback(() => {
    const t = timers.current;
    window.clearTimeout(t.open);
    window.clearTimeout(t.close);
    cancelAnimationFrame(t.frame);
  }, []);

  /** Where a label (or a menu) of `width` × `height` goes for this control, kept on screen. */
  const place = useCallback(
    (el: HTMLElement, width: number, height: number, gap: number) => {
      const group = groupRef.current!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const centre = r.left - group.left + r.width / 2;
      let left = centre - width / 2;
      const vw = document.documentElement.clientWidth || window.innerWidth;
      const abs = group.left + left;
      if (abs < EDGE) left += EDGE - abs;
      if (abs + width > vw - EDGE) left -= abs + width - (vw - EDGE);
      const triggerTop = r.top - group.top;
      return {
        left,
        width,
        height,
        top: placement === 'up' ? triggerTop - height - gap : triggerTop + r.height + gap,
        arrow: Math.max(ARROW_INSET, Math.min(width - ARROW_INSET, centre - left)),
        anchor: centre,
      };
    },
    [placement],
  );

  const measure = useCallback((label: string, kbd: string) => {
    const m = measureRef.current!;
    m.querySelector('.tip-text')!.textContent = label;
    const k = m.querySelector('kbd') as HTMLElement;
    k.textContent = kbd;
    k.hidden = !kbd;
    return Math.ceil(m.getBoundingClientRect().width);
  }, []);

  const reveal = useCallback(
    (el: HTMLElement, keyboard: boolean) => {
      const label = el.dataset.tip ?? '';
      const kbd = el.dataset.kbd ?? '';
      const geo = place(el, measure(label, kbd), TIP_HEIGHT, GAP);
      clear();
      const s = stateRef.current;
      const still = keyboard || prefersReducedMotion();
      current.current = el;
      if (s.visible && !s.menu) {
        if (s.label === label && Math.abs(s.anchor - geo.anchor) < 1) return;
        const direction: Direction =
          still || Math.abs(geo.anchor - s.anchor) < 1 ? 0 : geo.anchor > s.anchor ? 1 : -1;
        commit({
          ...s,
          ...geo,
          label,
          kbd,
          prev: direction ? { label: s.label, kbd: s.kbd } : null,
          direction,
          seq: s.seq + 1,
          snap: still,
          instant: keyboard,
          menu: false,
        });
        return;
      }
      if (s.visible && s.menu) {
        // Back from a menu: the surface shrinks to the label.
        commit({
          ...s,
          ...geo,
          label,
          kbd,
          prev: null,
          direction: 0,
          seq: s.seq + 1,
          snap: still,
          instant: keyboard,
          menu: false,
        });
        return;
      }
      // From hidden: placed first (no slide from wherever it was last), then shown.
      commit({
        ...s,
        ...geo,
        label,
        kbd,
        prev: null,
        direction: 0,
        seq: s.seq + 1,
        visible: false,
        snap: true,
        instant: keyboard,
        menu: false,
      });
      timers.current.frame = requestAnimationFrame(() => {
        const next = stateRef.current;
        if (current.current !== el) return;
        commit({ ...next, visible: true, snap: false });
      });
    },
    [clear, commit, measure, place],
  );

  const hide = useCallback(() => {
    clear();
    current.current = null;
    const s = stateRef.current;
    if (!s.visible) return;
    commit({ ...s, visible: false, prev: null, direction: 0, instant: s.instant });
  }, [clear, commit]);

  const onPointerOver = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch') return;
    const el = tipTarget(e.target);
    if (el) hovered.current = el;
    // An open menu holds the surface; other controls don't pull it away.
    if (menuOpen.current || !usable(el)) return;
    window.clearTimeout(timers.current.close);
    if (stateRef.current.visible) {
      reveal(el, false);
      return;
    }
    window.clearTimeout(timers.current.open);
    timers.current.open = window.setTimeout(() => reveal(el, false), OPEN_DELAY_MS);
  };

  const onPointerOut = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Off a control onto the group's background: let go after a moment.
    if (e.pointerType === 'touch' || menuOpen.current) return;
    if (tipTarget(e.relatedTarget) && groupRef.current?.contains(e.relatedTarget as Node)) return;
    hovered.current = null;
    window.clearTimeout(timers.current.open);
    window.clearTimeout(timers.current.close);
    if (stateRef.current.visible) timers.current.close = window.setTimeout(hide, CLOSE_DELAY_MS);
  };

  const onFocus = (e: ReactFocusEvent<HTMLDivElement>) => {
    const el = tipTarget(e.target);
    if (usable(el) && !menuOpen.current && (e.target as HTMLElement).matches(':focus-visible'))
      reveal(el, true);
  };

  const onBlur = (e: ReactFocusEvent<HTMLDivElement>) => {
    if (e.relatedTarget instanceof Node && groupRef.current?.contains(e.relatedTarget)) return;
    if (!menuOpen.current) hide();
  };

  /** The control under a finger (pointer capture keeps events on the first one). */
  const controlAt = (x: number, y: number): HTMLElement | null => {
    const group = groupRef.current;
    if (!group) return null;
    const root = group.getRootNode() as Document | ShadowRoot;
    const hit = tipTarget(root.elementFromPoint?.(x, y) ?? null);
    return hit && group.contains(hit) ? hit : null;
  };

  // A menu closed: back to the label of whatever is under the mouse, or away.
  const afterMenu = useCallback(() => {
    const el = hovered.current;
    if (usable(el) && el.isConnected) reveal(el, false);
    else hide();
  }, [hide, reveal]);

  // A menu opened: the surface opens up into it, from the label or out of the control.
  const owner = menu?.owner ?? null;
  useLayoutEffect(() => {
    const group = groupRef.current;
    const content = menuRef.current;
    if (!owner || !group || !content) return;
    const trigger = group.querySelector<HTMLElement>(`[data-menu="${owner}"]`);
    if (!trigger) return;
    const size = (first: boolean) => {
      const b = content.getBoundingClientRect();
      const geo = place(trigger, Math.ceil(b.width), Math.ceil(b.height), MENU_GAP);
      const s = stateRef.current;
      clear();
      current.current = trigger;
      if (!first || s.visible) {
        commit({ ...s, ...geo, menu: true, visible: true, prev: null, direction: 0, snap: false });
        return;
      }
      commit({ ...s, ...geo, menu: true, visible: false, prev: null, direction: 0, snap: true });
      timers.current.frame = requestAnimationFrame(() =>
        commit({ ...stateRef.current, visible: true, snap: false }),
      );
    };
    size(true);
    const ro = new ResizeObserver(() => size(false));
    ro.observe(content);
    return () => {
      ro.disconnect();
      afterMenu();
    };
  }, [owner, clear, commit, place, afterMenu]);

  useEffect(() => clear, [clear]);

  const s = state;
  const vars = {
    '--tip-left': `${s.left}px`,
    '--tip-top': `${s.top}px`,
    '--tip-width': `${s.width}px`,
    '--tip-height': `${s.height}px`,
    '--tip-arrow': `${s.arrow}px`,
    '--tip-travel': `${s.direction * 8}px`,
    ...style,
  } as CSSProperties;

  return (
    <div
      ref={groupRef}
      className={`tip-group ${className ?? ''}`}
      role="toolbar"
      aria-label={ariaLabel}
      data-visible={s.visible}
      data-snap={s.snap || s.instant ? '' : undefined}
      data-placement={placement}
      data-menu={menu ? '' : undefined}
      style={vars}
      onPointerOver={onPointerOver}
      onPointerOut={onPointerOut}
      onPointerDown={(e) => {
        const inMenu = (e.target as Element).closest?.('[data-tip-menu]');
        if (e.pointerType === 'touch') {
          if (!hold.current.fired) hide();
        } else if (!menuOpen.current && !inMenu) {
          // A click keeps the label: once the control has updated, it resizes to the new one.
          const el = tipTarget(e.target);
          if (el?.dataset.tipHide !== undefined) hide();
          else
            window.setTimeout(() => {
              if (menuOpen.current || !el?.isConnected || hovered.current !== el) return;
              if (stateRef.current.visible && usable(el)) reveal(el, false);
            }, 0);
        }
        if (inMenu) return;
        window.clearTimeout(hold.current.timer);
        hold.current.fired = false;
        const el = tipTarget(e.target);
        if (e.pointerType === 'touch' && usable(el) && !el.dataset.longpress) {
          hold.current.x = e.clientX;
          hold.current.y = e.clientY;
          hold.current.timer = window.setTimeout(() => {
            hold.current.fired = true;
            reveal(el, false);
          }, HOLD_MS);
        }
        onPointerDown?.(e);
      }}
      onPointerMove={(e) => {
        if (e.pointerType !== 'touch') return;
        if (!hold.current.fired) {
          if (Math.hypot(e.clientX - hold.current.x, e.clientY - hold.current.y) > 10)
            window.clearTimeout(hold.current.timer);
          return;
        }
        // Holding: slide along the controls and the label follows.
        const el = controlAt(e.clientX, e.clientY);
        if (usable(el) && el !== current.current) reveal(el, false);
      }}
      onPointerUp={() => {
        window.clearTimeout(hold.current.timer);
        if (hold.current.fired) timers.current.close = window.setTimeout(hide, 900);
      }}
      onPointerCancel={() => {
        window.clearTimeout(hold.current.timer);
        if (hold.current.fired) hide();
        hold.current.fired = false;
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
      {children}
      <div
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
          <span className="tip-viewport" data-direction={s.direction}>
            {s.prev ? (
              <span className="tip-label previous" key={`p${s.seq}`} aria-hidden="true">
                <span className="tip-text">{s.prev.label}</span>
                {s.prev.kbd ? <kbd>{s.prev.kbd}</kbd> : null}
              </span>
            ) : null}
            <span className="tip-label current" key={`c${s.seq}`}>
              <span className="tip-text">{s.label}</span>
              {s.kbd ? <kbd>{s.kbd}</kbd> : null}
            </span>
          </span>
        )}
        <span className="tip-arrow" aria-hidden="true" />
      </div>
      <span ref={measureRef} className="tip-measure" aria-hidden="true">
        <span className="tip-text" />
        <kbd />
      </span>
    </div>
  );
}
