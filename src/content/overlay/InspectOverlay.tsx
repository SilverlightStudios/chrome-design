import { useEffect, useMemo, useState } from 'react';
import { measureBetween } from '../../shared/measure';
import type { Rect } from '../../shared/model';
import { useEditor, useViewport } from '../context';
import { friendlyName } from '../describe';
import { usePresence } from '../motion/presence';
import { spacingFor } from './spacing';

/** How long the hover outline takes to fade out (in: a little quicker, in CSS). */
const HOVER_FADE_MS = 120;

const px = (v: string) => Number.parseFloat(v) || 0;

function clientRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
}

/** True while ⌥/Alt is held — Figma's "show me the spacing" gesture. */
function useAltHeld(): boolean {
  const [held, setHeld] = useState(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setHeld(true);
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Alt') setHeld(false);
    };
    const reset = () => setHeld(false);
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', reset);
    };
  }, []);
  return held;
}

/** One measured gap, in viewport space. */
interface Guide {
  key: string;
  axis: 'x' | 'y';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  value: number;
  /** A line to the page edge rather than to something on it. */
  dashed?: boolean;
  tone?: 'measure' | 'margin' | 'padding';
}

const labelWidth = (value: number) => String(value).length * 6.6 + 14;

/**
 * Every measurement draws the same way: a thin line with end caps and its value in a pill —
 * centred just above a horizontal line, just right of a vertical one — so labels sit beside
 * what they measure instead of on top of the box. Pills stay on screen.
 */
function Guides({ lines }: { lines: Guide[] }) {
  const vp = useViewport();
  const clampX = (x: number, w: number) => Math.min(vp.width - w / 2 - 4, Math.max(w / 2 + 4, x));
  const clampY = (y: number) => Math.min(vp.height - 12, Math.max(12, y));
  return (
    <>
      <svg className="measure guides" aria-hidden="true">
        {lines.map((l) => (
          <g key={l.key} data-tone={l.tone ?? 'measure'} data-dashed={l.dashed ? '' : undefined}>
            <line className="run" x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
            {l.axis === 'x' ? (
              <>
                <line x1={l.x1} y1={l.y1 - 3.5} x2={l.x1} y2={l.y1 + 3.5} />
                <line x1={l.x2} y1={l.y2 - 3.5} x2={l.x2} y2={l.y2 + 3.5} />
              </>
            ) : (
              <>
                <line x1={l.x1 - 3.5} y1={l.y1} x2={l.x1 + 3.5} y2={l.y1} />
                <line x1={l.x2 - 3.5} y1={l.y2} x2={l.x2 + 3.5} y2={l.y2} />
              </>
            )}
          </g>
        ))}
      </svg>
      {lines.map((l) => {
        const w = labelWidth(l.value);
        const mx = (l.x1 + l.x2) / 2;
        const my = (l.y1 + l.y2) / 2;
        const left = clampX(l.axis === 'x' ? mx : mx + 6 + w / 2, w);
        const top = clampY(l.axis === 'x' ? my - 12 : my);
        return (
          <div
            key={l.key}
            className="gap-label"
            data-tone={l.tone ?? 'measure'}
            style={{ left, top }}
          >
            {l.value}
          </div>
        );
      })}
    </>
  );
}

function SpacingView({ el }: { el: Element }) {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const m = [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)];
  const p = [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)];
  const b = [
    px(cs.borderTopWidth),
    px(cs.borderRightWidth),
    px(cs.borderBottomWidth),
    px(cs.borderLeftWidth),
  ];
  return (
    <>
      <div
        className="bm-margin"
        style={{
          left: r.left - Math.max(0, m[3]!),
          top: r.top - Math.max(0, m[0]!),
          width: r.width + Math.max(0, m[1]!) + Math.max(0, m[3]!),
          height: r.height + Math.max(0, m[0]!) + Math.max(0, m[2]!),
          borderWidth: m.map((v) => `${Math.max(0, v)}px`).join(' '),
        }}
      />
      <div
        className="bm-padding"
        style={{
          left: r.left + b[3]!,
          top: r.top + b[0]!,
          width: Math.max(0, r.width - b[1]! - b[3]!),
          height: Math.max(0, r.height - b[0]! - b[2]!),
          borderWidth: p.map((v) => `${v}px`).join(' '),
        }}
      />
      <Guides lines={boxGuides(r, m, b, p)} />
    </>
  );
}

/** Margin and padding values as guides across each band, at the middle of its side. */
function boxGuides(r: DOMRect, m: number[], b: number[], p: number[]): Guide[] {
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const out: Guide[] = [];
  const add = (
    tone: 'margin' | 'padding',
    side: string,
    axis: 'x' | 'y',
    from: number,
    to: number,
    at: number,
  ) => {
    const value = Math.round(Math.abs(to - from));
    if (value < 1) return;
    out.push(
      axis === 'y'
        ? { key: `${tone}-${side}`, tone, axis, x1: at, x2: at, y1: from, y2: to, value }
        : { key: `${tone}-${side}`, tone, axis, y1: at, y2: at, x1: from, x2: to, value },
    );
  };
  add('margin', 'top', 'y', r.top - m[0]!, r.top, cx);
  add('margin', 'right', 'x', r.right, r.right + m[1]!, cy);
  add('margin', 'bottom', 'y', r.bottom, r.bottom + m[2]!, cx);
  add('margin', 'left', 'x', r.left - m[3]!, r.left, cy);
  add('padding', 'top', 'y', r.top + b[0]!, r.top + b[0]! + p[0]!, cx);
  add('padding', 'right', 'x', r.right - b[1]! - p[1]!, r.right - b[1]!, cy);
  add('padding', 'bottom', 'y', r.bottom - b[2]! - p[2]!, r.bottom - b[2]!, cx);
  add('padding', 'left', 'x', r.left + b[3]!, r.left + b[3]! + p[3]!, cy);
  return out;
}

function MeasureView({ a, b }: { a: Element; b: Element }) {
  const ra = clientRect(a);
  const rb = clientRect(b);
  const lines: Guide[] = measureBetween(ra, rb).map((l) => ({
    ...l,
    key: `${l.axis}${l.x1}${l.y1}${l.x2}${l.y2}`,
  }));
  return (
    <>
      <svg className="measure" aria-hidden="true">
        <rect className="measure-target" x={rb.x} y={rb.y} width={rb.width} height={rb.height} />
      </svg>
      <Guides lines={lines} />
    </>
  );
}

/**
 * Spacing guides for the selection: a line from each side to whatever is next to it (a
 * neighbour, the inside edge of the box it sits in, or the page edge — dashed), with the gap in
 * px. Measured in page space once per selection and layout; drawn in viewport space.
 */
function SpacingGuides({ lines }: { lines: Guide[] }) {
  return <Guides lines={lines} />;
}

/** The selection's spacing guides in viewport space (page-space measurement, cached). */
function useSpacingGuides(el: Element | null): Guide[] {
  const vp = useViewport();
  const { width: vw, height: vh } = vp;
  // Re-measured per selection and whenever the window (and so the layout) changes size.
  const lines = useMemo(() => (el ? spacingFor(el, vw, vh) : []), [el, vw, vh]);
  return lines.map((l) => ({
    key: l.side,
    axis: l.axis,
    x1: l.x1 - vp.scrollX,
    x2: l.x2 - vp.scrollX,
    y1: l.y1 - vp.scrollY,
    y2: l.y2 - vp.scrollY,
    value: l.value,
    dashed: l.to === 'page',
  }));
}

/**
 * Where the size pill goes under the selection: centred, unless the bottom guide and its
 * label run through there — then just left of them, or right of them when there's no room on
 * the left. Always kept on screen.
 */
function pillCentre(r: Rect, pillW: number, bottom: Guide | undefined, vw: number): number {
  const half = pillW / 2;
  const onScreen = (c: number) => Math.min(vw - half - 4, Math.max(half + 4, c));
  const centre = r.x + r.width / 2;
  if (!bottom) return onScreen(centre);
  const from = bottom.x1 - 6;
  const to = bottom.x1 + 6 + labelWidth(bottom.value) + 6;
  if (centre + half <= from || centre - half >= to) return onScreen(centre);
  const leftOf = from - half;
  return onScreen(leftOf - half >= 4 ? leftOf : to + half);
}

function sizeLabel(r: Rect): string {
  return `${Math.round(r.width)} × ${Math.round(r.height)}`;
}

/**
 * What the designer is pointing at, in plain terms: a clean outline with the element's name on
 * hover, a stronger outline and its size once selected, and the spacing red-lines while ⌥ is
 * held (like Figma). Viewport space; re-measured on scroll.
 */
export function InspectOverlay() {
  const vp = useViewport();
  const tool = useEditor((s) => s.tool);
  const hoverEl = useEditor((s) => s.hoverEl);
  const pickedEl = useEditor((s) => s.pickedEl);
  const pickedRegion = useEditor((s) => s.pickedRegion);
  const region = useEditor((s) => s.region);
  const hoverShapeId = useEditor((s) => s.hoverShapeId);
  const draft = useEditor((s) => s.draft);
  const alt = useAltHeld();
  const active = tool === 'select' || tool === 'comment';

  // While a comment is being written, the bubble's own outline takes over.
  const picked = tool === 'select' && !draft && pickedEl?.isConnected ? pickedEl : null;
  const hovering =
    active && hoverEl?.isConnected && !region && !hoverShapeId && !draft && hoverEl !== picked
      ? hoverEl
      : null;
  // Holding ⌥ swaps them for the padding/margin view (or the distance to the hovered element).
  const guides = useSpacingGuides(picked && !alt ? picked : null);
  // The hover outline fades out (from one element to the next it just moves).
  const hover = usePresence(hovering ? 'hover' : null, hovering, HOVER_FADE_MS);
  if (!active && !hover.key) return null;
  const outlined = hover.payload?.isConnected ? hover.payload : null;
  const hr = outlined ? clientRect(outlined) : null;
  const pr = picked ? clientRect(picked) : null;
  const pillText = pr ? sizeLabel(pr) : '';
  const pillX = pr
    ? pillCentre(
        pr,
        pillText.length * 6.6 + 14,
        guides.find((g) => g.key === 'bottom'),
        vp.width,
      )
    : 0;
  const area =
    tool === 'select' && !draft && pickedRegion
      ? {
          x: pickedRegion.x - vp.scrollX,
          y: pickedRegion.y - vp.scrollY,
          width: pickedRegion.width,
          height: pickedRegion.height,
        }
      : null;

  return (
    <div className="inspect-layer" aria-hidden="true" data-tool={tool}>
      {alt && hovering && !picked && <SpacingView el={hovering} />}
      {alt && picked && (!hovering || hovering === picked) && <SpacingView el={picked} />}
      {hr && (
        <>
          <div
            className="hover-outline"
            data-exiting={hover.exiting ? '' : undefined}
            style={{ left: hr.x, top: hr.y, width: hr.width, height: hr.height }}
          />
          <div
            className="name-tag"
            data-exiting={hover.exiting ? '' : undefined}
            style={{ left: Math.max(4, hr.x), top: hr.y < 26 ? hr.y + hr.height + 4 : hr.y - 24 }}
          >
            {tool === 'comment'
              ? `Comment on ${friendlyName(outlined!).toLowerCase()}`
              : friendlyName(outlined!)}
          </div>
        </>
      )}
      {guides.length > 0 && <SpacingGuides lines={guides} />}
      {pr && (
        <>
          <div
            className="picked-outline"
            style={{ left: pr.x, top: pr.y, width: pr.width, height: pr.height }}
          />
          <div className="size-pill fixed" style={{ left: pillX, top: pr.y + pr.height + 8 }}>
            {pillText}
          </div>
        </>
      )}
      {area && (
        <>
          <div
            className="picked-outline area"
            style={{ left: area.x, top: area.y, width: area.width, height: area.height }}
          />
          <div
            className="size-pill fixed"
            style={{ left: area.x + area.width / 2, top: area.y + area.height + 8 }}
          >
            {sizeLabel(area)}
          </div>
        </>
      )}
      {alt && picked && hovering && hovering !== picked && <MeasureView a={picked} b={hovering} />}
    </div>
  );
}
