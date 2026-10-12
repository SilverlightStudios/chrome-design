import { useEffect, useState } from 'react';
import { measureBetween } from '../../shared/measure';
import type { Rect } from '../../shared/model';
import { useEditor, useViewport } from '../context';
import { friendlyName } from '../describe';

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
    </>
  );
}

function MeasureView({ a, b }: { a: Element; b: Element }) {
  const ra = clientRect(a);
  const rb = clientRect(b);
  const lines = measureBetween(ra, rb);
  return (
    <svg className="measure" aria-hidden="true">
      <rect className="measure-target" x={rb.x} y={rb.y} width={rb.width} height={rb.height} />
      {lines.map((l) => {
        const mx = (l.x1 + l.x2) / 2;
        const my = (l.y1 + l.y2) / 2;
        return (
          <g key={`${l.axis}${l.x1}${l.y1}${l.x2}${l.y2}`}>
            <line x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
            {l.axis === 'x' ? (
              <>
                <line x1={l.x1} y1={l.y1 - 4} x2={l.x1} y2={l.y1 + 4} />
                <line x1={l.x2} y1={l.y2 - 4} x2={l.x2} y2={l.y2 + 4} />
              </>
            ) : (
              <>
                <line x1={l.x1 - 4} y1={l.y1} x2={l.x1 + 4} y2={l.y1} />
                <line x1={l.x2 - 4} y1={l.y2} x2={l.x2 + 4} y2={l.y2} />
              </>
            )}
            <foreignObject x={mx - 30} y={my - 10} width={60} height={20}>
              <div className="measure-label">{l.value}</div>
            </foreignObject>
          </g>
        );
      })}
    </svg>
  );
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
  if (tool !== 'select' && tool !== 'comment') return null;

  // While a comment is being written, the bubble's own outline takes over.
  const picked = tool === 'select' && !draft && pickedEl?.isConnected ? pickedEl : null;
  const hovering =
    hoverEl?.isConnected && !region && !hoverShapeId && !draft && hoverEl !== picked
      ? hoverEl
      : null;
  const hr = hovering ? clientRect(hovering) : null;
  const pr = picked ? clientRect(picked) : null;
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
            style={{ left: hr.x, top: hr.y, width: hr.width, height: hr.height }}
          />
          <div
            className="name-tag"
            style={{ left: Math.max(4, hr.x), top: hr.y < 26 ? hr.y + hr.height + 4 : hr.y - 24 }}
          >
            {tool === 'comment'
              ? `Comment on ${friendlyName(hovering!).toLowerCase()}`
              : friendlyName(hovering!)}
          </div>
        </>
      )}
      {pr && (
        <>
          <div
            className="picked-outline"
            style={{ left: pr.x, top: pr.y, width: pr.width, height: pr.height }}
          />
          <div
            className="size-pill fixed"
            style={{ left: pr.x + pr.width / 2, top: pr.y + pr.height + 8 }}
          >
            {sizeLabel(pr)}
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
