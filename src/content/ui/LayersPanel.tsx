import { type PointerEvent as ReactPointerEvent, useRef, useState } from 'react';
import { shapeBounds } from '../../shared/geometry';
import { isShape, type Shape } from '../../shared/model';
import { shapeLabel } from '../../shared/targets';
import { useEditor, useEnv } from '../context';
import { capturePointer } from '../dom';
import { Icon, type IconName } from './icons';
import { PanelHead } from './PanelHead';

const ROW = 46;

const KIND_ICON: Record<Shape['kind'], IconName> = {
  pen: 'draw',
  line: 'line',
  arrow: 'arrow',
  rect: 'rect',
  ellipse: 'ellipse',
  text: 'text',
  image: 'image',
  redact: 'eyeOff',
};

function detail(shape: Shape): string {
  if (shape.kind === 'image') return shape.name;
  if (shape.kind === 'text') return shape.text.split('\n')[0] ?? '';
  return '';
}

/**
 * Everything drawn or placed, front to back: tap to select (and scroll to it), the eye to hide
 * or show, the lock to make it click-through, and the grip to drag it up or down the order.
 */
export function LayersPanel() {
  const { store } = useEnv();
  const annotations = useEditor((s) => s.doc.annotations);
  const selectedIds = useEditor((s) => s.selectedIds);
  const shapes = annotations.filter(isShape).toReversed();
  const drag = useRef<{ id: string; from: number; startY: number } | null>(null);
  const [dragging, setDragging] = useState<{ id: string; dy: number } | null>(null);

  const reveal = (shape: Shape) => {
    const b = shapeBounds(shape);
    window.scrollTo({
      top: Math.max(0, b.y + b.height / 2 - window.innerHeight / 2),
      behavior: 'smooth',
    });
    store.set({ tool: 'select', selectedIds: [shape.id], pickedEl: null, pickedRegion: null });
  };

  const target = (from: number, dy: number) =>
    Math.max(0, Math.min(shapes.length - 1, from + Math.round(dy / ROW)));
  const onDown = (e: ReactPointerEvent<HTMLButtonElement>, id: string, from: number) => {
    e.preventDefault();
    capturePointer(e.currentTarget, e.pointerId);
    drag.current = { id, from, startY: e.clientY };
    setDragging({ id, dy: 0 });
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (d) setDragging({ id: d.id, dy: e.clientY - d.startY });
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    if (!d) return;
    const to = target(d.from, e.clientY - d.startY);
    if (to === d.from) return;
    const order = shapes.map((s) => s.id);
    order.splice(to, 0, ...order.splice(d.from, 1));
    store.setShapeOrder(order.toReversed());
  };

  const from = dragging ? shapes.findIndex((s) => s.id === dragging.id) : -1;
  const to = dragging ? target(from, dragging.dy) : -1;
  // Rows between the dragged row's start and where it would land make room for it.
  const shift = (i: number) => {
    if (!dragging || i === from) return 0;
    if (from < to && i > from && i <= to) return -ROW;
    if (from > to && i < from && i >= to) return ROW;
    return 0;
  };

  return (
    <div className="panel layers-panel">
      <PanelHead title="Layers" />
      <ol className="layer-list" style={{ height: shapes.length * ROW }}>
        {shapes.map((shape, i) => {
          const Glyph = Icon[KIND_ICON[shape.kind]];
          const isDragged = dragging?.id === shape.id;
          return (
            <li
              key={shape.id}
              className="layer-row"
              data-selected={selectedIds.includes(shape.id) ? '' : undefined}
              data-hidden={shape.hidden ? '' : undefined}
              data-dragging={isDragged ? '' : undefined}
              style={{
                top: i * ROW,
                translate: `0 ${isDragged ? (dragging?.dy ?? 0) : shift(i)}px`,
              }}
            >
              <button
                type="button"
                className="layer-grip"
                aria-label={`Move ${shapeLabel(shape)} up or down`}
                onPointerDown={(e) => onDown(e, shape.id, i)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={() => {
                  drag.current = null;
                  setDragging(null);
                }}
              >
                <Icon.grip />
              </button>
              <button type="button" className="layer-name" onClick={() => reveal(shape)}>
                <Glyph />
                <span>{shapeLabel(shape)}</span>
                {detail(shape) ? <small>{detail(shape)}</small> : null}
              </button>
              <button
                type="button"
                className="icon-btn"
                data-on={shape.hidden ? '' : undefined}
                aria-label={shape.hidden ? 'Show' : 'Hide'}
                aria-pressed={!!shape.hidden}
                onClick={() => store.setShapeFlag([shape.id], 'hidden', !shape.hidden)}
              >
                {shape.hidden ? <Icon.eyeOff /> : <Icon.eye />}
              </button>
              <button
                type="button"
                className="icon-btn"
                data-on={shape.locked ? '' : undefined}
                aria-label={shape.locked ? 'Unlock' : 'Lock'}
                aria-pressed={!!shape.locked}
                onClick={() => store.setShapeFlag([shape.id], 'locked', !shape.locked)}
              >
                {shape.locked ? <Icon.lock /> : <Icon.unlock />}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
