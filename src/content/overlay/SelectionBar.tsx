import { useCallback, useEffect, useState } from 'react';
import { buildAnchor } from '../../capture/anchor';
import { createId, nowIso } from '../../shared/ids';
import type { Rect, RedactShape } from '../../shared/model';
import { useEditor, useEnv, useViewport } from '../context';
import { friendlyLabel, friendlyName } from '../describe';
import { copyText, rgbToHex, toPage } from '../dom';
import { BottomSheet } from '../motion/BottomSheet';
import { LiquidGlass } from '../motion/glass';
import { usePresence } from '../motion/presence';
import { useCompact, useSheetPresence } from '../motion/sheets';
import { TooltipGroup } from '../motion/Tooltip';
import { childOf, parentOf, selectChild, selectParent } from '../pickNav';
import { Icon } from '../ui/icons';
import { draftForRegion } from './InteractionLayer';
import { guideClearance, spacingFor } from './spacing';

const BAR_H = 40;

function place(
  r: Rect,
  width: number,
  clear: { top: number; bottom: number } = { top: 0, bottom: 0 },
): { left: number; top: number; below: boolean } {
  // `width` is the bar's measured width (0 before the first layout).
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  // Clear of the spacing guide on that side, so its value stays readable.
  const above = r.y - BAR_H - 10 - clear.top;
  const below = above < 8;
  let top = below ? r.y + r.height + 34 + clear.bottom : above;
  top = Math.max(8, Math.min(vh - BAR_H - 96, top));
  const left = Math.max(8, Math.min(vw - width - 8, r.x + r.width / 2 - width / 2));
  return { left, top, below };
}

/**
 * The floating selection bar (Figma's contextual toolbar): names what is selected and offers
 * the next step — comment on it, see its details, or step out to its parent.
 */
export function SelectionBar() {
  const { store } = useEnv();
  const vp = useViewport();
  const tool = useEditor((s) => s.tool);
  const pickedEl = useEditor((s) => s.pickedEl);
  const pickedRegion = useEditor((s) => s.pickedRegion);
  const draft = useEditor((s) => s.draft);
  const showDetails = useEditor((s) => s.showDetails);
  const active = tool === 'select' && !draft;
  const key = active ? (pickedRegion ? 'region' : pickedEl?.isConnected ? 'el' : null) : null;
  const presence = usePresence(key, key === 'region' ? pickedRegion : pickedEl, 140);
  const [width, setWidth] = useState(0);
  // Measured width, so the bar centres on the selection and stays on screen.
  const barRef = useCallback((bar: HTMLDivElement) => {
    const ro = new ResizeObserver(() => setWidth(bar.offsetWidth));
    ro.observe(bar);
    return () => ro.disconnect();
  }, []);
  if (!presence.key || !presence.payload) return null;

  const isRegion = presence.key === 'region';
  const el = isRegion ? null : (presence.payload as Element);
  const region = isRegion ? (presence.payload as Rect) : null;
  const r: Rect = region
    ? {
        x: region.x - vp.scrollX,
        y: region.y - vp.scrollY,
        width: region.width,
        height: region.height,
      }
    : (() => {
        const b = el!.getBoundingClientRect();
        return { x: b.left, y: b.top, width: b.width, height: b.height };
      })();
  const label = el ? friendlyLabel(el) : 'Area';
  const guides = el ? spacingFor(el, vp.width, vp.height) : [];
  const pos = place(r, width || 260, {
    top: guideClearance(guides, 'top'),
    bottom: guideClearance(guides, 'bottom'),
  });

  const comment = () => {
    if (region) {
      store.set({ draft: draftForRegion(region), pickedRegion: null });
      return;
    }
    if (!el) return;
    const b = el.getBoundingClientRect();
    const point = toPage(b.left + Math.min(16, b.width / 2), b.top + Math.min(16, b.height / 2));
    store.set({ draft: { target: { type: 'element', point, anchor: buildAnchor(el) } } });
  };
  const parent = el ? parentOf(el) : null;
  const child = el ? childOf(el) : null;
  // Cover it with a blurred box: hidden in screenshots, its text and pictures left out of the
  // handoff. The box is selected so it can be adjusted or deleted.
  const hide = () => {
    const box = region ?? { ...toPage(r.x, r.y), width: r.width, height: r.height };
    const shape: RedactShape = {
      id: createId('s'),
      type: 'shape',
      kind: 'redact',
      rect: { x: box.x - 2, y: box.y - 2, width: box.width + 4, height: box.height + 4 },
      style: { ...store.getState().style },
      createdAt: nowIso(),
    };
    store.addAnnotation(shape);
    store.set({ selectedIds: [shape.id], pickedEl: null, pickedRegion: null, hoverEl: null });
  };

  return (
    <LiquidGlass
      filterId="cd-glass-selection"
      className="selection-bar ui"
      data-exiting={presence.exiting ? '' : undefined}
      inert={presence.exiting}
      data-below={pos.below ? '' : undefined}
      elRef={barRef}
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <TooltipGroup
        placement={pos.below ? 'down' : 'up'}
        className="sel-actions"
        ariaLabel="Selection"
      >
        <span className="sel-label" data-tip={label}>
          {label}
        </span>
        <button
          type="button"
          className="chip-btn icon-only"
          aria-label="Comment"
          data-tip="Comment"
          data-kbd="↵"
          onClick={comment}
        >
          <Icon.comment />
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label="Hide"
          data-tip="Hide (blur)"
          onClick={hide}
        >
          <Icon.eyeOff />
        </button>
        {el ? (
          <>
            <button
              type="button"
              className="icon-btn"
              aria-label="Details"
              data-tip="Details"
              data-on={showDetails ? '' : undefined}
              onClick={() => store.set({ showDetails: !showDetails })}
            >
              <Icon.info />
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label="Select the surrounding element"
              data-tip={
                parent
                  ? `Select ${friendlyName(parent).toLowerCase()} around it`
                  : 'Nothing around it'
              }
              data-kbd="↑"
              disabled={!parent}
              onClick={() => selectParent(store)}
            >
              <Icon.parent />
            </button>
            <button
              type="button"
              className="icon-btn flip"
              aria-label="Select inside"
              data-tip={
                child ? `Select ${friendlyName(child).toLowerCase()} inside` : 'Nothing inside'
              }
              data-kbd="↓"
              disabled={!child}
              onClick={() => selectChild(store)}
            >
              <Icon.parent />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="icon-btn"
            aria-label="Clear selection"
            data-tip="Clear selection"
            onClick={() => store.set({ pickedRegion: null })}
          >
            <Icon.close />
          </button>
        )}
      </TooltipGroup>
    </LiquidGlass>
  );
}

const WEIGHTS: Record<string, string> = {
  '100': 'Thin',
  '200': 'Extra light',
  '300': 'Light',
  '400': 'Regular',
  '500': 'Medium',
  '600': 'Semibold',
  '700': 'Bold',
  '800': 'Extra bold',
  '900': 'Black',
};

/** Colour value that copies itself; the label says "Copied" for a moment instead of a toast. */
function Swatch({ color }: { color: string }) {
  const [copied, setCopied] = useState(false);
  const hex = rgbToHex(color);
  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1200);
    return () => window.clearTimeout(t);
  }, [copied]);
  return (
    <TooltipGroup placement="up" className="swatch-tip" ariaLabel="Colour">
      <button
        type="button"
        className="color-value"
        data-tip={copied ? 'Copied' : 'Copy colour'}
        onClick={() => void copyText(hex).then((ok) => ok && setCopied(true))}
      >
        <span className="dot" style={{ background: color }} />
        {copied ? 'Copied' : hex}
      </button>
    </TooltipGroup>
  );
}

function spacing(cs: CSSStyleDeclaration, prop: 'margin' | 'padding'): string {
  const n = ['top', 'right', 'bottom', 'left'].map((side) =>
    Math.round(Number.parseFloat(cs.getPropertyValue(`${prop}-${side}`)) || 0),
  );
  if (n.every((v) => v === n[0])) return `${n[0]}`;
  if (n[0] === n[2] && n[1] === n[3]) return `${n[0]} · ${n[1]}`;
  return n.join(' · ');
}

/** Plain-language details for the selected element (opened from the selection bar). */
export function DetailsCard() {
  useViewport();
  const { store } = useEnv();
  const compact = useCompact();
  const pickedEl = useEditor((s) => s.pickedEl);
  const tool = useEditor((s) => s.tool);
  const show = useEditor((s) => s.showDetails);
  const open = show && tool === 'select' && !!pickedEl?.isConnected;
  const presence = usePresence(open && !compact ? 'details' : null, pickedEl, 160);
  // Phones: a bottom sheet, so it never covers the selection bar or the element.
  const sheet = useSheetPresence<Element>(open && compact ? pickedEl : null);
  const close = () => store.set({ showDetails: false });

  if (compact) {
    const el = sheet.shown;
    if (!el?.isConnected) return null;
    return (
      <BottomSheet
        phase={sheet.phase}
        contentKey="details"
        render={() => <DetailsContent el={el} onClose={close} />}
        label="Details"
        className="details-sheet"
        onClosed={sheet.onClosed}
        onDismiss={close}
      />
    );
  }
  const el = presence.payload;
  if (!presence.key || !el?.isConnected) return null;
  return (
    <aside
      className="details-card glass-css ui"
      aria-label="Details"
      data-exiting={presence.exiting ? '' : undefined}
      inert={presence.exiting}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <DetailsContent el={el} onClose={close} />
    </aside>
  );
}

function DetailsContent({ el, onClose }: { el: Element; onClose: () => void }) {
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  const family = cs.fontFamily.split(',')[0]?.replace(/["']/g, '').trim() ?? '';
  const hasFill = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent';
  const hasBorder = Number.parseFloat(cs.borderTopWidth) > 0 && cs.borderTopStyle !== 'none';
  const radius =
    cs.borderTopLeftRadius !== '0px' ? Math.round(Number.parseFloat(cs.borderTopLeftRadius)) : 0;
  const hasText = ((el as HTMLElement).innerText ?? '').trim().length > 0;
  const opacity = Number.parseFloat(cs.opacity);

  return (
    <div className="details">
      <TooltipGroup placement="down" className="panel-head" ariaLabel="Details">
        <b data-tip={friendlyLabel(el)}>{friendlyLabel(el)}</b>
        <button
          type="button"
          className="icon-btn"
          aria-label="Close details"
          data-tip="Close"
          onClick={onClose}
        >
          <Icon.close />
        </button>
      </TooltipGroup>
      <dl>
        <dt>Size</dt>
        <dd>
          {Math.round(r.width)} × {Math.round(r.height)}
        </dd>
        {hasText && (
          <>
            <dt>Text</dt>
            <dd>
              {family} · {WEIGHTS[cs.fontWeight] ?? cs.fontWeight}
              <br />
              {Math.round(Number.parseFloat(cs.fontSize))}
              {cs.lineHeight !== 'normal'
                ? ` / ${Math.round(Number.parseFloat(cs.lineHeight))}`
                : ''}
            </dd>
            <dt>Text colour</dt>
            <dd>
              <Swatch color={cs.color} />
            </dd>
          </>
        )}
        {hasFill && (
          <>
            <dt>Fill</dt>
            <dd>
              <Swatch color={cs.backgroundColor} />
            </dd>
          </>
        )}
        {hasBorder && (
          <>
            <dt>Border</dt>
            <dd>
              {Math.round(Number.parseFloat(cs.borderTopWidth))} ·{' '}
              <Swatch color={cs.borderTopColor} />
            </dd>
          </>
        )}
        {radius > 0 && (
          <>
            <dt>Corners</dt>
            <dd>{radius}</dd>
          </>
        )}
        <dt>Padding</dt>
        <dd>{spacing(cs, 'padding')}</dd>
        <dt>Margin</dt>
        <dd>{spacing(cs, 'margin')}</dd>
        {opacity < 1 && (
          <>
            <dt>Opacity</dt>
            <dd>{Math.round(opacity * 100)}%</dd>
          </>
        )}
      </dl>
    </div>
  );
}
