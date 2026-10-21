import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createId } from '../../shared/ids';
import { gridColumns } from '../../shared/measure';
import type { Guide } from '../../shared/model';
import { useEditor, useEnv, useViewport, type Viewport } from '../context';
import { capturePointer, isExtensionNode } from '../dom';
import { TooltipGroup } from '../motion/Tooltip';
import { Icon } from '../ui/icons';

export const RULER = 20;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = Number.parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function GridOverlay() {
  const grid = useEditor((s) => s.grid);
  const vp = useViewport();
  if (!grid.visible) return null;
  const cols = gridColumns(vp.width, grid);
  const fill = hexToRgba(grid.color, grid.opacity / 100);
  return (
    <div className="grid-overlay" aria-hidden="true">
      {cols.map((c) => (
        <div
          key={c.x}
          className="grid-col"
          style={{ left: c.x, width: c.width, background: fill }}
        />
      ))}
    </div>
  );
}

function drawRuler(
  canvas: HTMLCanvasElement,
  axis: 'x' | 'y',
  length: number,
  offset: number,
  highlight: [number, number] | null,
) {
  const dpr = window.devicePixelRatio || 1;
  const w = axis === 'x' ? length : RULER;
  const h = axis === 'x' ? RULER : length;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  // Colours come from the UI's own tokens (the canvas's CSS colour), so labels always match
  // the strip behind them, whatever the page or the system theme.
  const ink = getComputedStyle(canvas).color;
  const touch = matchMedia('(pointer: coarse)').matches;
  if (highlight) {
    ctx.fillStyle = 'rgba(86, 132, 245, 0.3)';
    const [a, b] = highlight;
    if (axis === 'x') ctx.fillRect(a - offset, 0, b - a, RULER);
    else ctx.fillRect(0, a - offset, RULER, b - a);
  }
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.font = `500 ${touch ? 10 : 9}px ui-sans-serif, system-ui, sans-serif`;
  ctx.lineWidth = 1;
  const start = Math.floor(offset / 10) * 10;
  ctx.globalAlpha = 0.45;
  ctx.beginPath();
  for (let v = start; v <= offset + length; v += 10) {
    const pos = Math.round(v - offset) + 0.5;
    const tick = v % 100 === 0 ? RULER : v % 50 === 0 ? 8 : 4;
    if (axis === 'x') {
      ctx.moveTo(pos, RULER);
      ctx.lineTo(pos, RULER - tick);
    } else {
      ctx.moveTo(RULER, pos);
      ctx.lineTo(RULER - tick, pos);
    }
    if (v % 100 === 0 && v !== 0) {
      ctx.globalAlpha = 0.75;
      if (axis === 'x') ctx.fillText(String(v), pos + 3, 9);
      else {
        ctx.save();
        ctx.translate(9, pos - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(v), 0, 0);
        ctx.restore();
      }
    }
    ctx.globalAlpha = 0.45;
  }
  ctx.stroke();
  ctx.globalAlpha = 0.15;
  ctx.beginPath();
  if (axis === 'x') {
    ctx.moveTo(0, RULER - 0.5);
    ctx.lineTo(w, RULER - 0.5);
  } else {
    ctx.moveTo(RULER - 0.5, 0);
    ctx.lineTo(RULER - 0.5, h);
  }
  ctx.stroke();
}

/** How close (CSS px) a guide comes to an edge before it snaps to it. */
const SNAP = 6;

interface Snap {
  position: number;
  /** The element it snapped to (outlined while dragging). */
  el: Element | null;
}

/**
 * Where a guide being dragged lands: the nearest edge or middle of an element near it, within
 * SNAP. Elements near the line are the ones under the pointer and just either side of it, with
 * their ancestors (so a section's edge counts as well as a button's), plus the selected element.
 */
function snapToContent(
  axis: Guide['axis'],
  value: number,
  clientX: number,
  clientY: number,
  picked: Element | null,
): Snap {
  const near = new Set<Element>(picked?.isConnected ? [picked] : []);
  for (const d of [-SNAP, 0, SNAP]) {
    const [x, y] = axis === 'x' ? [clientX + d, clientY] : [clientX, clientY + d];
    for (const el of document.elementsFromPoint(x, y))
      if (!isExtensionNode(el) && el !== document.documentElement && el !== document.body)
        near.add(el);
  }
  const scroll = axis === 'x' ? window.scrollX : window.scrollY;
  let best: Snap = { position: Math.round(value), el: null };
  let bestDist = SNAP;
  for (const el of near) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const [lo, hi] = axis === 'x' ? [r.left, r.right] : [r.top, r.bottom];
    // Edges win a tie with a middle.
    for (const [edge, bias] of [
      [lo, 0],
      [hi, 0],
      [(lo + hi) / 2, 0.5],
    ] as const) {
      const d = Math.abs(edge + scroll - value) + bias;
      if (d <= bestDist) {
        best = { position: Math.round(edge + scroll), el };
        bestDist = d;
      }
    }
  }
  return best;
}

interface GuideDrag {
  id: string | null;
  axis: Guide['axis'];
  position: number;
  /** The element it's snapped to. */
  snapped?: Element | null;
}

function toClient(g: { axis: Guide['axis']; position: number }, vp: Viewport): number {
  return g.axis === 'x' ? g.position - vp.scrollX : g.position - vp.scrollY;
}

export function RulersAndGuides() {
  const { store } = useEnv();
  const rulers = useEditor((s) => s.rulers);
  const guides = useEditor((s) => s.doc.guides);
  const hoverEl = useEditor((s) => s.hoverEl);
  const pickedEl = useEditor((s) => s.pickedEl);
  const vp = useViewport();
  const topRef = useRef<HTMLCanvasElement>(null);
  const leftRef = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<GuideDrag | null>(null);
  // Ends a drag in progress (listeners on the window, so the release always arrives).
  const stopDrag = useRef<(() => void) | null>(null);
  useEffect(() => () => stopDrag.current?.(), []);

  const focus = pickedEl?.isConnected ? pickedEl : hoverEl?.isConnected ? hoverEl : null;
  const fr = focus?.getBoundingClientRect();

  useEffect(() => {
    if (!rulers) return;
    const hx: [number, number] | null = fr ? [fr.left + vp.scrollX, fr.right + vp.scrollX] : null;
    const hy: [number, number] | null = fr ? [fr.top + vp.scrollY, fr.bottom + vp.scrollY] : null;
    if (topRef.current) drawRuler(topRef.current, 'x', vp.width - RULER, vp.scrollX + RULER, hx);
    if (leftRef.current) drawRuler(leftRef.current, 'y', vp.height - RULER, vp.scrollY + RULER, hy);
  });

  if (!rulers) return null;

  /**
   * A guide follows the pointer until it's let go, wherever that is: the move and release are
   * heard on the window (the guide being dragged may be re-rendered under the pointer).
   * Released on its ruler, a guide is removed (or never added).
   */
  const begin = (e: ReactPointerEvent<HTMLElement>, start: GuideDrag) => {
    e.stopPropagation();
    e.preventDefault();
    stopDrag.current?.();
    capturePointer(e.currentTarget, e.pointerId);
    const pointerId = e.pointerId;
    let d = start;
    setDrag(d);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      const raw = d.axis === 'x' ? ev.clientX + window.scrollX : ev.clientY + window.scrollY;
      const snap = ev.altKey
        ? { position: Math.round(raw), el: null }
        : snapToContent(d.axis, raw, ev.clientX, ev.clientY, store.getState().pickedEl);
      d = { ...d, position: snap.position, snapped: snap.el };
      setDrag(d);
    };
    const up = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      stop();
      if (ev.type === 'pointercancel') return;
      const onRuler = d.axis === 'x' ? ev.clientX < RULER : ev.clientY < RULER;
      if (d.id) {
        if (onRuler) store.removeGuide(d.id);
        else store.moveGuide(d.id, d.position);
      } else if (!onRuler) {
        store.addGuide({ id: createId('g'), axis: d.axis, position: d.position });
      }
    };
    const stop = () => {
      stopDrag.current = null;
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', up, true);
      window.removeEventListener('blur', stop);
      setDrag(null);
    };
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    window.addEventListener('blur', stop);
    stopDrag.current = stop;
  };

  // The guide being moved stays the same element (it holds the pointer), at the drag's place.
  const shown: GuideDrag[] = guides.map((g) => (g.id === drag?.id ? drag : g));
  if (drag && !drag.id) shown.push(drag);
  const snapped = drag?.snapped?.isConnected ? drag.snapped.getBoundingClientRect() : null;
  return (
    <div className="rulers ui">
      <div className="ruler-strip x" />
      <div className="ruler-strip y" />
      {snapped ? (
        <div
          className="guide-snap"
          aria-hidden="true"
          style={{
            left: snapped.left,
            top: snapped.top,
            width: snapped.width,
            height: snapped.height,
          }}
        />
      ) : null}
      {shown.map((g) => {
        const c = toClient(g, vp);
        const id = g.id;
        const dragging = g === drag;
        return (
          <div
            key={id ?? 'new'}
            className="guide"
            data-axis={g.axis}
            data-dragging={dragging ? '' : undefined}
            style={g.axis === 'x' ? { left: c } : { top: c }}
            onPointerDown={(e) => id && begin(e, { id, axis: g.axis, position: g.position })}
            onDoubleClick={() => id && store.removeGuide(id)}
          >
            <span className="guide-label">
              {Math.round(g.position)}
              {id && !dragging ? (
                <button
                  type="button"
                  className="guide-remove"
                  aria-label="Remove guide"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => store.removeGuide(id)}
                >
                  <Icon.close />
                </button>
              ) : null}
            </span>
          </div>
        );
      })}
      <canvas
        ref={topRef}
        className="ruler ruler-x"
        aria-label="Horizontal ruler: drag down to add a guide"
        onPointerDown={(e) =>
          begin(e, { id: null, axis: 'y', position: e.clientY + window.scrollY })
        }
      />
      <canvas
        ref={leftRef}
        className="ruler ruler-y"
        aria-label="Vertical ruler: drag right to add a guide"
        onPointerDown={(e) =>
          begin(e, { id: null, axis: 'x', position: e.clientX + window.scrollX })
        }
      />
      <TooltipGroup placement="down" className="ruler-corner-tip" ariaLabel="Guides">
        <button
          type="button"
          className="ruler-corner"
          aria-label="Clear guides"
          data-tip="Clear guides"
          onClick={() => store.clearGuides()}
        >
          ⟲
        </button>
      </TooltipGroup>
    </div>
  );
}
