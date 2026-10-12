import { useCallback, useEffect, useState } from 'react';
import { buildAnchor } from '../../capture/anchor';
import type { Rect } from '../../shared/model';
import { useEditor, useEnv, useViewport } from '../context';
import { friendlyLabel, friendlyName } from '../describe';
import { copyText, rgbToHex, toPage } from '../dom';
import { BottomSheet, useCompact, useSheetPresence } from '../motion/MorphSheet';
import { usePresence } from '../motion/presence';
import { Icon } from '../ui/icons';
import { draftForRegion } from './InteractionLayer';

const BAR_H = 40;

function place(r: Rect, width: number): { left: number; top: number; below: boolean } {
  // `width` is the bar's measured width (0 before the first layout).
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const vh = window.innerHeight;
  const below = r.y < BAR_H + 22 || r.y - BAR_H - 10 < 0;
  let top = below ? r.y + r.height + 34 : r.y - BAR_H - 10;
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
  const barRef = useCallback((bar: HTMLDivElement | null) => {
    if (!bar) return;
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
  const pos = place(r, width || 260);

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
  const parent =
    el?.parentElement && el.parentElement !== document.documentElement ? el.parentElement : null;

  return (
    <div
      className="selection-bar glass-css ui"
      data-exiting={presence.exiting ? '' : undefined}
      inert={presence.exiting}
      data-below={pos.below ? '' : undefined}
      ref={barRef}
      style={{ left: pos.left, top: pos.top }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span className="sel-label" title={label}>
        {label}
      </span>
      <button type="button" className="chip-btn" onClick={comment}>
        <Icon.comment /> Comment
      </button>
      {el ? (
        <>
          <button
            type="button"
            className="icon-btn"
            aria-label="Details"
            title="Details"
            data-on={showDetails ? '' : undefined}
            onClick={() => store.set({ showDetails: !showDetails })}
          >
            <Icon.info />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label="Select the surrounding element"
            title={
              parent
                ? `Select ${friendlyName(parent).toLowerCase()} around it (↑)`
                : 'Nothing around it'
            }
            disabled={!parent}
            onClick={() => parent && store.set({ pickedEl: parent })}
          >
            <Icon.parent />
          </button>
        </>
      ) : (
        <button
          type="button"
          className="icon-btn"
          aria-label="Clear selection"
          onClick={() => store.set({ pickedRegion: null })}
        >
          <Icon.close />
        </button>
      )}
    </div>
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
    <button
      type="button"
      className="color-value"
      title="Copy colour"
      onClick={() => void copyText(hex).then((ok) => ok && setCopied(true))}
    >
      <span className="dot" style={{ background: color }} />
      {copied ? 'Copied' : hex}
    </button>
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
      <header className="panel-head">
        <b title={friendlyLabel(el)}>{friendlyLabel(el)}</b>
        <button type="button" className="icon-btn" aria-label="Close details" onClick={onClose}>
          <Icon.close />
        </button>
      </header>
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
