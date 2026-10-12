import { describeElement } from '../../capture/anchor';
import { measureBetween } from '../../shared/measure';
import type { Rect } from '../../shared/model';
import { useEditor, useViewport } from '../context';

interface Box {
  rect: Rect;
  margin: [number, number, number, number];
  padding: [number, number, number, number];
  border: [number, number, number, number];
}

const px = (v: string) => Number.parseFloat(v) || 0;

function boxModel(el: Element): Box {
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  return {
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    margin: [px(cs.marginTop), px(cs.marginRight), px(cs.marginBottom), px(cs.marginLeft)],
    padding: [px(cs.paddingTop), px(cs.paddingRight), px(cs.paddingBottom), px(cs.paddingLeft)],
    border: [
      px(cs.borderTopWidth),
      px(cs.borderRightWidth),
      px(cs.borderBottomWidth),
      px(cs.borderLeftWidth),
    ],
  };
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10);
}

function BoxModelView({ el, variant }: { el: Element; variant: 'hover' | 'picked' }) {
  const { rect: r, margin: m, padding: p, border: b } = boxModel(el);
  const label = `${describeElement(el)}`;
  const size = `${fmt(r.width)} × ${fmt(r.height)}`;
  const labelBelow = r.y < 28;
  return (
    <div className="boxmodel" data-variant={variant}>
      {variant === 'hover' && (
        <>
          <div
            className="bm-margin"
            style={{
              left: r.x - m[3],
              top: r.y - m[0],
              width: r.width + m[1] + m[3],
              height: r.height + m[0] + m[2],
              borderWidth: `${Math.max(0, m[0])}px ${Math.max(0, m[1])}px ${Math.max(0, m[2])}px ${Math.max(0, m[3])}px`,
            }}
          />
          <div
            className="bm-padding"
            style={{
              left: r.x + b[3],
              top: r.y + b[0],
              width: Math.max(0, r.width - b[1] - b[3]),
              height: Math.max(0, r.height - b[0] - b[2]),
              borderWidth: `${p[0]}px ${p[1]}px ${p[2]}px ${p[3]}px`,
            }}
          />
        </>
      )}
      <div
        className="bm-outline"
        style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
      />
      <div
        className="bm-label"
        style={{ left: Math.max(4, r.x), top: labelBelow ? r.y + r.height + 6 : r.y - 24 }}
      >
        <span className="bm-tag">{label}</span>
        <span className="bm-size">{size}</span>
      </div>
    </div>
  );
}

function MeasureView({ a, b }: { a: Element; b: Element }) {
  const ra = a.getBoundingClientRect();
  const rb = b.getBoundingClientRect();
  const lines = measureBetween(
    { x: ra.left, y: ra.top, width: ra.width, height: ra.height },
    { x: rb.left, y: rb.top, width: rb.width, height: rb.height },
  );
  return (
    <svg className="measure" aria-hidden="true">
      <rect className="measure-target" x={rb.left} y={rb.top} width={rb.width} height={rb.height} />
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

/** Hover / selection box model and red-line distances (viewport space). */
export function InspectOverlay() {
  useViewport(); // re-measure on scroll/resize
  const tool = useEditor((s) => s.tool);
  const hoverEl = useEditor((s) => s.hoverEl);
  const pickedEl = useEditor((s) => s.pickedEl);
  const region = useEditor((s) => s.region);
  const hoverShapeId = useEditor((s) => s.hoverShapeId);
  if (tool !== 'select' && tool !== 'comment') return null;
  const showHover =
    hoverEl && !region && !hoverShapeId && hoverEl.isConnected && hoverEl !== pickedEl;
  return (
    <div className="inspect-layer" aria-hidden="true">
      {pickedEl?.isConnected && tool === 'select' && (
        <BoxModelView el={pickedEl} variant="picked" />
      )}
      {showHover && <BoxModelView el={hoverEl} variant="hover" />}
      {showHover && pickedEl?.isConnected && tool === 'select' && (
        <MeasureView a={pickedEl} b={hoverEl} />
      )}
    </div>
  );
}
