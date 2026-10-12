import { type PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from 'react';
import { createId } from '../../shared/ids';
import { gridColumns } from '../../shared/measure';
import type { Guide } from '../../shared/model';
import { useEditor, useEnv, useViewport, type Viewport } from '../context';
import { capturePointer, pickElement } from '../dom';

export const RULER = 20;
const SNAP = 5;

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
  ctx.fillStyle = '#1c1d21';
  ctx.fillRect(0, 0, w, h);
  if (highlight) {
    ctx.fillStyle = 'rgba(64, 132, 255, 0.35)';
    const [a, b] = highlight;
    if (axis === 'x') ctx.fillRect(a - offset, 0, b - a, RULER);
    else ctx.fillRect(0, a - offset, RULER, b - a);
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.32)';
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
  ctx.lineWidth = 1;
  const start = Math.floor(offset / 10) * 10;
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
      if (axis === 'x') ctx.fillText(String(v), pos + 3, 9);
      else {
        ctx.save();
        ctx.translate(9, pos - 3);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(String(v), 0, 0);
        ctx.restore();
      }
    }
  }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255,255,255,0.12)';
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

/** Snap a page coordinate to the nearest edge of the element under the pointer. */
function snapToContent(
  axis: Guide['axis'],
  value: number,
  clientX: number,
  clientY: number,
): number {
  const el = pickElement(clientX, clientY);
  if (!el || el === document.documentElement || el === document.body) return value;
  const r = el.getBoundingClientRect();
  const edges =
    axis === 'x'
      ? [r.left, r.left + r.width / 2, r.right].map((v) => v + window.scrollX)
      : [r.top, r.top + r.height / 2, r.bottom].map((v) => v + window.scrollY);
  let best = value;
  let bestDist = SNAP + 1;
  for (const edge of edges) {
    const d = Math.abs(edge - value);
    if (d < bestDist) {
      best = edge;
      bestDist = d;
    }
  }
  return Math.round(best);
}

interface GuideDrag {
  id: string | null;
  axis: Guide['axis'];
  position: number;
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
  const dragRef = useRef<GuideDrag | null>(null);

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

  const begin = (e: ReactPointerEvent<HTMLElement>, d: GuideDrag) => {
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e.currentTarget, e.pointerId);
    dragRef.current = d;
    setDrag(d);
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    if (!d) return;
    const raw = d.axis === 'x' ? e.clientX + window.scrollX : e.clientY + window.scrollY;
    const next = {
      ...d,
      position: e.altKey ? Math.round(raw) : snapToContent(d.axis, raw, e.clientX, e.clientY),
    };
    dragRef.current = next;
    setDrag(next);
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const d = dragRef.current;
    dragRef.current = null;
    setDrag(null);
    if (!d) return;
    const onRuler = d.axis === 'x' ? e.clientX < RULER : e.clientY < RULER;
    if (d.id) {
      if (onRuler) store.removeGuide(d.id);
      else store.moveGuide(d.id, d.position);
    } else if (!onRuler) {
      store.addGuide({ id: createId('g'), axis: d.axis, position: d.position });
    }
  };
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end };

  const shown = guides.filter((g) => g.id !== drag?.id);
  return (
    <div className="rulers ui">
      {shown.map((g) => {
        const c = toClient(g, vp);
        return (
          <div
            key={g.id}
            className="guide"
            data-axis={g.axis}
            style={g.axis === 'x' ? { left: c } : { top: c }}
            onPointerDown={(e) => begin(e, { id: g.id, axis: g.axis, position: g.position })}
            onDoubleClick={() => store.removeGuide(g.id)}
            {...handlers}
          >
            <span className="guide-label">{Math.round(g.position)}</span>
          </div>
        );
      })}
      {drag && (
        <div
          className="guide"
          data-axis={drag.axis}
          data-dragging=""
          style={drag.axis === 'x' ? { left: toClient(drag, vp) } : { top: toClient(drag, vp) }}
        >
          <span className="guide-label">{Math.round(drag.position)}</span>
        </div>
      )}
      <canvas
        ref={topRef}
        className="ruler ruler-x"
        aria-label="Horizontal ruler: drag down to add a guide"
        onPointerDown={(e) =>
          begin(e, { id: null, axis: 'y', position: e.clientY + window.scrollY })
        }
        {...handlers}
      />
      <canvas
        ref={leftRef}
        className="ruler ruler-y"
        aria-label="Vertical ruler: drag right to add a guide"
        onPointerDown={(e) =>
          begin(e, { id: null, axis: 'x', position: e.clientX + window.scrollX })
        }
        {...handlers}
      />
      <button
        type="button"
        className="ruler-corner"
        aria-label="Clear guides"
        title="Clear guides"
        onClick={() => store.clearGuides()}
      >
        ⟲
      </button>
    </div>
  );
}
