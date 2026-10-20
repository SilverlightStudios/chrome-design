import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useRef } from 'react';
import { Icon, type IconName } from './icons';

/** The toolbar's controls: a button with its tooltip and shortcut, a divider, flyouts. */

interface ButtonProps {
  icon: IconName;
  label: string;
  kbd?: string;
  active?: boolean;
  disabled?: boolean;
  badge?: number;
  className?: string;
  longPress?: 'menu';
  expanded?: boolean;
  /** The menu this control opens (grown out of the tooltip). */
  menu?: string;
  /** Opens a panel: the tooltip gets out of the way on click. */
  hideTip?: boolean;
  onClick: () => void;
  onPointerDown?: (e: ReactPointerEvent<HTMLButtonElement>) => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  children?: ReactNode;
}

export function ToolButton({
  icon,
  label,
  kbd,
  active,
  disabled,
  badge,
  className,
  longPress,
  expanded,
  menu,
  hideTip,
  onClick,
  onPointerDown,
  onContextMenu,
  children,
}: ButtonProps) {
  const Glyph = Icon[icon];
  return (
    <button
      type="button"
      className={`tb-btn ${className ?? ''}`}
      data-tip={label}
      data-kbd={kbd}
      data-longpress={longPress}
      data-menu={menu}
      data-tip-hide={hideTip ? '' : undefined}
      aria-label={kbd ? `${label} (${kbd})` : label}
      aria-pressed={active ?? undefined}
      aria-expanded={expanded}
      data-active={active ? '' : undefined}
      disabled={disabled}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onContextMenu={onContextMenu}
    >
      <Glyph />
      {badge ? <span className="tb-badge">{badge > 99 ? '99+' : badge}</span> : null}
      {children}
    </button>
  );
}

export function Divider() {
  return <span className="tb-sep" aria-hidden="true" />;
}

/** Closes a flyout when the pointer goes down anywhere outside it (shadow-DOM aware). */
export function useDismiss(
  open: boolean,
  inside: React.RefObject<HTMLElement | null>,
  close: () => void,
) {
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const el = inside.current;
      const path = e.composedPath();
      if (el && path.includes(el)) return;
      if (path.some((n) => n instanceof Element && n.hasAttribute('data-tip-menu'))) return;
      closeRef.current();
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open, inside]);
}
