import { memo, type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { pinColor } from '../../export/overlay';
import {
  arrowHead,
  type Handle,
  handlesFor,
  hitTestShape,
  pointsToPath,
  resizeRect,
  resizeShape,
  shapeBounds,
  transformShape,
  translateShape,
  unionBounds,
} from '../../shared/geometry';
import {
  type CommentThread,
  isComment,
  isShape,
  type Point,
  type Rect,
  type Shape,
  type TextShape,
} from '../../shared/model';
import { findShape, spotIn } from '../../shared/targets';
import { livePinPoint } from '../actions';
import { addCopies, cloneShapes } from '../clipboard';
import { useEditor, useEnv, useLayoutVersion } from '../context';
import { capturePointer, toPage } from '../dom';
import { usePresence } from '../motion/presence';
import { messagePreview } from '../ui/format';
import { CommentPopover } from './CommentPopover';
import { TextEditor } from './TextEditor';

/** Lines with their character offset (a stable key for each line). */
function textLines(text: string): { line: string; offset: number }[] {
  let offset = 0;
  return text.split('\n').map((line) => {
    const entry = { line, offset };
    offset += line.length + 1;
    return entry;
  });
}

export const ShapeView = memo(function ShapeView({ shape }: { shape: Shape }) {
  const { color, width, dashed } = shape.style;
  const common = {
    stroke: color,
    strokeWidth: width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    fill: 'none',
    strokeDasharray: dashed ? `${width * 3} ${width * 2}` : undefined,
  };
  switch (shape.kind) {
    case 'pen':
      return <path d={pointsToPath(shape.points)} {...common} />;
    case 'line':
      return (
        <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} {...common} />
      );
    case 'arrow': {
      const [a, b] = arrowHead(shape.from, shape.to, Math.max(10, width * 4));
      return (
        <g>
          <line x1={shape.from.x} y1={shape.from.y} x2={shape.to.x} y2={shape.to.y} {...common} />
          <polyline
            points={`${a.x},${a.y} ${shape.to.x},${shape.to.y} ${b.x},${b.y}`}
            {...common}
            strokeDasharray={undefined}
          />
        </g>
      );
    }
    case 'rect':
      return (
        <rect
          x={shape.rect.x}
          y={shape.rect.y}
          width={shape.rect.width}
          height={shape.rect.height}
          rx={2}
          {...common}
        />
      );
    case 'ellipse':
      return (
        <ellipse
          cx={shape.rect.x + shape.rect.width / 2}
          cy={shape.rect.y + shape.rect.height / 2}
          rx={shape.rect.width / 2}
          ry={shape.rect.height / 2}
          {...common}
        />
      );
    case 'text':
      return (
        <text
          x={shape.point.x}
          y={shape.point.y + shape.fontSize}
          fill={color}
          fontSize={shape.fontSize}
          fontWeight={600}
          fontFamily="system-ui, -apple-system, 'Segoe UI', sans-serif"
          paintOrder="stroke"
          stroke="#ffffff"
          strokeWidth={3}
          strokeLinejoin="round"
        >
          {textLines(shape.text).map(({ line, offset }) => (
            <tspan key={offset} x={shape.point.x} dy={offset === 0 ? 0 : shape.fontSize * 1.25}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      );
    case 'image':
      return (
        <image
          className="placed-image"
          href={shape.src}
          x={shape.rect.x}
          y={shape.rect.y}
          width={shape.rect.width}
          height={shape.rect.height}
          preserveAspectRatio="none"
        />
      );
  }
});

type SelectionGesture =
  | {
      kind: 'move';
      start: Point;
      originals: Shape[];
      moved: boolean;
      toggle: string | null;
      /** ⌥-drag: `originals` are fresh copies, added where they're dropped. */
      copies: boolean;
    }
  | { kind: 'resize'; handle: Handle; originals: Shape[]; box: Rect };

/** A box around a drawing with a little air (text) or none (images), as the frame hugs it. */
function frameOf(shapes: Shape[]): Rect {
  if (shapes.length === 1) {
    const shape = shapes[0]!;
    const b = shapeBounds(shape);
    const pad = shape.kind === 'text' ? 4 : shape.kind === 'image' ? 0 : shape.style.width / 2;
    return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
  }
  return unionBounds(shapes);
}

/**
 * Figma-style selection: a frame you can drag to move, corner (or endpoint) handles to
 * resize, a size pill, and double-click / tap again to edit a text label. Several drawings
 * move and scale together as one box. Shift-click toggles one in or out. Touch-friendly: the
 * frame and handles opt out of page scrolling (touch-action: none).
 */
function Selection({ shapes }: { shapes: Shape[] }) {
  const { store } = useEnv();
  const gesture = useRef<SelectionGesture | null>(null);
  const single = shapes.length === 1 ? shapes[0]! : null;
  const frame = frameOf(shapes);
  const b = single ? shapeBounds(single) : frame;

  const start = (e: ReactPointerEvent<HTMLElement>, g: SelectionGesture) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    capturePointer(e.currentTarget, e.pointerId);
    gesture.current = g;
  };
  const move = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    if (!g) return;
    const p = toPage(e.clientX, e.clientY);
    if (g.kind === 'move') {
      const dx = p.x - g.start.x;
      const dy = p.y - g.start.y;
      if (!g.moved && Math.hypot(dx, dy) < 3) return;
      g.moved = true;
      store.set({ liveShapes: g.originals.map((s) => translateShape(s, dx, dy)) });
    } else if (g.originals.length === 1) {
      store.set({ liveShapes: [resizeShape(g.originals[0]!, g.handle, p, e.shiftKey)] });
    } else {
      // Pictures keep their proportions unless Shift is held; drawings only with Shift.
      const hasImage = g.originals.some((s) => s.kind === 'image');
      const box = resizeRect(g.box, g.handle, p, hasImage ? !e.shiftKey : e.shiftKey);
      store.set({ liveShapes: g.originals.map((s) => transformShape(s, g.box, box)) });
    }
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const live = store.getState().liveShapes;
    store.set({ liveShapes: [] });
    if (g.kind === 'move' && !g.moved) {
      if (g.toggle) {
        const ids = store.getState().selectedIds;
        store.set({ selectedIds: ids.filter((id) => id !== g.toggle) });
        return;
      }
      // A tap on an already-selected label edits it (touch has no double-click).
      const only = g.originals.length === 1 ? g.originals[0]! : null;
      if (only?.kind === 'text' && e.pointerType === 'touch') store.set({ editingTextId: only.id });
      return;
    }
    if (g.kind === 'move' && g.copies) addCopies(store, live);
    else store.replaceShapes(live);
  };
  const cancel = () => {
    gesture.current = null;
    store.set({ liveShapes: [] });
  };

  const isSegment = single?.kind === 'line' || single?.kind === 'arrow';
  const handles: Handle[] = single ? handlesFor(single) : ['nw', 'ne', 'sw', 'se'];
  const handlePos = (h: Handle): Point => {
    if (h === 'from' && (single?.kind === 'line' || single?.kind === 'arrow')) return single.from;
    if (h === 'to' && (single?.kind === 'line' || single?.kind === 'arrow')) return single.to;
    return {
      x: h === 'nw' || h === 'sw' ? frame.x : frame.x + frame.width,
      y: h === 'nw' || h === 'ne' ? frame.y : frame.y + frame.height,
    };
  };

  return (
    <>
      {single ? null : (
        <svg className="shape-layer" width="1" height="1" aria-hidden="true">
          {shapes.map((s) => {
            const sb = shapeBounds(s);
            return (
              <rect
                key={s.id}
                className="multi-box"
                x={sb.x}
                y={sb.y}
                width={sb.width}
                height={sb.height}
              />
            );
          })}
        </svg>
      )}
      <div
        className="sel-frame"
        data-segment={isSegment ? '' : undefined}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        onPointerDown={(e) => {
          const p = toPage(e.clientX, e.clientY);
          // Shift-click a selected drawing to take it out of the selection.
          const toggle = e.shiftKey
            ? (shapes.toReversed().find((s) => hitTestShape(s, p, 6))?.id ?? single?.id ?? null)
            : null;
          start(e, {
            kind: 'move',
            start: p,
            originals: e.altKey ? cloneShapes(shapes, 0, 0) : shapes,
            moved: false,
            toggle,
            copies: e.altKey,
          });
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        onDoubleClick={() => {
          if (single?.kind === 'text') store.set({ editingTextId: single.id });
        }}
      />
      {handles.map((h) => {
        const p = handlePos(h);
        return (
          <div
            key={h}
            className="sel-handle"
            data-handle={h}
            data-round={isSegment ? '' : undefined}
            style={{ left: p.x, top: p.y }}
            onPointerDown={(e) =>
              start(e, { kind: 'resize', handle: h, originals: shapes, box: frameOf(shapes) })
            }
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={cancel}
          />
        );
      })}
      <div
        className="size-pill"
        style={{ left: frame.x + frame.width / 2, top: frame.y + frame.height + 8 }}
      >
        {single?.kind === 'text' ? 'Label' : `${Math.round(b.width)} × ${Math.round(b.height)}`}
      </div>
    </>
  );
}

function Pin({
  thread,
  shapes,
  active,
  interactive,
}: {
  thread: CommentThread;
  /** Drawings as drawn right now (a dragged one carries its pins along). */
  shapes: Shape[];
  active: boolean;
  interactive: boolean;
}) {
  const { store } = useEnv();
  const p = livePinPoint(thread, shapes);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const onDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    capturePointer(e.currentTarget, e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  };
  const onMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    if (!d) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
    if (d.moved) {
      e.currentTarget.dataset.lifted = '';
      e.currentTarget.style.translate = `${e.clientX - d.x}px ${e.clientY - d.y}px`;
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
    delete e.currentTarget.dataset.lifted;
    e.currentTarget.style.translate = '';
    if (!d) return;
    if (!d.moved) {
      const s = store.getState();
      store.set({
        openThreadId: s.openThreadId === thread.id ? null : thread.id,
        selectedId: thread.id,
        draft: null,
      });
      return;
    }
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    store.updateAnnotation(thread.id, (a) => {
      if (!isComment(a)) return a;
      const t = a.target;
      if (t.type === 'region')
        return { ...a, target: { ...t, rect: { ...t.rect, x: t.rect.x + dx, y: t.rect.y + dy } } };
      if (t.type === 'shape') {
        // Stays on its image or drawing: the new spot within its box.
        const shape = findShape(store.getState().doc.annotations, t.shapeId);
        const to = { x: p.x + dx, y: p.y + dy };
        return shape ? { ...a, target: { ...t, at: spotIn(shape, to), point: to } } : a;
      }
      return { ...a, target: { ...t, point: { x: t.point.x + dx, y: t.point.y + dy } } };
    });
  };

  return (
    <button
      type="button"
      className="pin"
      data-intent={thread.intent}
      data-status={thread.status}
      data-active={active ? '' : undefined}
      style={{
        left: p.x,
        top: p.y,
        ['--pin' as string]: pinColor(thread),
        pointerEvents: interactive ? 'auto' : 'none',
      }}
      aria-label={`Comment ${thread.number}: ${messagePreview(thread.messages[0])}`}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={(e) => {
        drag.current = null;
        delete e.currentTarget.dataset.lifted;
        e.currentTarget.style.translate = '';
      }}
    >
      <span>{thread.number}</span>
      <span className="pin-preview" aria-hidden="true">
        {messagePreview(thread.messages[0])}
      </span>
    </button>
  );
}

/** A dashed box around what a comment is about (an area, a page element, or a placed thing). */
function TargetOutline({
  thread,
  shapes,
  active,
}: {
  thread: CommentThread;
  shapes: Shape[];
  active: boolean;
}) {
  const t = thread.target;
  if (t.type === 'region') {
    return (
      <div
        className="target-outline region"
        data-active={active ? '' : undefined}
        style={{
          left: t.rect.x,
          top: t.rect.y,
          width: t.rect.width,
          height: t.rect.height,
          ['--pin' as string]: pinColor(thread),
        }}
      />
    );
  }
  if (!active) return null;
  if (t.type === 'shape') {
    const shape = findShape(shapes, t.shapeId);
    if (!shape) return null;
    const b = outlineBox(shape);
    return (
      <div
        className="target-outline"
        data-active=""
        style={{ ...b, ['--pin' as string]: pinColor(thread) }}
      />
    );
  }
  if (!t.anchor) return null;
  const p = livePinPoint(thread, shapes);
  const dx = p.x - t.point.x;
  const dy = p.y - t.point.y;
  const r = t.anchor.rect;
  return (
    <div
      className="target-outline"
      data-active=""
      style={{
        left: r.x + dx,
        top: r.y + dy,
        width: r.width,
        height: r.height,
        ['--pin' as string]: pinColor(thread),
      }}
    />
  );
}

/** A placed thing's box with a little air, for outlines. */
function outlineBox(shape: Shape): { left: number; top: number; width: number; height: number } {
  const b = shapeBounds(shape);
  const pad = 4 + (shape.kind === 'image' ? 0 : shape.style.width / 2);
  return { left: b.x - pad, top: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

/** While composing, outlines what the comment is about (under the bubble, never over it). */
function DraftOutline({ target, shapes }: { target: CommentThread['target']; shapes: Shape[] }) {
  if (target.type === 'shape') {
    const shape = findShape(shapes, target.shapeId);
    return shape ? (
      <div className="target-outline draft" data-active="" style={outlineBox(shape)} />
    ) : null;
  }
  const r = target.type === 'region' ? target.rect : target.anchor?.rect;
  if (!r) return null;
  return (
    <div
      className={`target-outline draft${target.type === 'region' ? ' region' : ''}`}
      data-active=""
      style={{ left: r.x, top: r.y, width: r.width, height: r.height }}
    />
  );
}

/** Page-space layer: drawings, pins, region outlines, popovers. Scrolls natively with the page. */
export function AnnotationLayer() {
  useLayoutVersion();
  const annotations = useEditor((s) => s.doc.annotations);
  const selectedId = useEditor((s) => s.selectedId);
  const selectedIds = useEditor((s) => s.selectedIds);
  const openThreadId = useEditor((s) => s.openThreadId);
  const draft = useEditor((s) => s.draft);
  const preview = useEditor((s) => s.preview);
  const liveShapes = useEditor((s) => s.liveShapes);
  const erasing = useEditor((s) => s.erasing);
  const region = useEditor((s) => s.region);
  const textEdit = useEditor((s) => s.textEdit);
  const editingTextId = useEditor((s) => s.editingTextId);
  const tool = useEditor((s) => s.tool);
  const hoverShapeId = useEditor((s) => s.hoverShapeId);

  const live = new Map(liveShapes.map((s) => [s.id, s]));
  const docShapes = annotations.filter(isShape);
  // ⌥-drag shows the copies being dragged before they're added.
  const known = new Set(docShapes.map((s) => s.id));
  const shapes = [
    ...docShapes.map((s) => live.get(s.id) ?? s),
    ...liveShapes.filter((s) => !known.has(s.id)),
  ];
  const threads = annotations.filter(isComment);
  const selected =
    tool === 'select'
      ? shapes.filter(
          (s) => selectedIds.includes(s.id) && !erasing.includes(s.id) && s.id !== editingTextId,
        )
      : [];
  const editingText = shapes.find(
    (s): s is TextShape => s.id === editingTextId && s.kind === 'text',
  );
  const pinsInteractive = tool !== 'draw';
  const hovered =
    hoverShapeId && !selectedIds.includes(hoverShapeId) && liveShapes.length === 0
      ? shapes.find((s) => s.id === hoverShapeId)
      : undefined;

  // The popover plays its exit before unmounting (keyed: a different thread replaces it).
  const popoverKey = draft ? 'draft' : openThreadId;
  const popover = usePresence(popoverKey, draft, 160);
  const popoverThread =
    popover.key && popover.key !== 'draft' ? threads.find((t) => t.id === popover.key) : undefined;

  return (
    <div className="page-layer">
      <svg className="shape-layer" width="1" height="1" aria-hidden="true">
        {shapes.map((shape) => {
          if (erasing.includes(shape.id) || shape.id === editingTextId) return null;
          return <ShapeView key={shape.id} shape={shape} />;
        })}
        {preview && <ShapeView shape={preview} />}
        {hovered
          ? (() => {
              const hb = shapeBounds(hovered);
              const hp = 6 + hovered.style.width / 2;
              return (
                <rect
                  className="hover-box"
                  x={hb.x - hp}
                  y={hb.y - hp}
                  width={hb.width + hp * 2}
                  height={hb.height + hp * 2}
                  rx={4}
                />
              );
            })()
          : null}
      </svg>
      {threads.map((t) => (
        <TargetOutline
          key={`o-${t.id}`}
          thread={t}
          shapes={shapes}
          active={t.id === selectedId || t.id === openThreadId}
        />
      ))}
      {popover.key === 'draft' && popover.payload && !popover.exiting && (
        <DraftOutline target={popover.payload.target} shapes={shapes} />
      )}
      {region && (
        <div
          className="region-drag"
          style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
        >
          <span>
            {Math.round(region.width)} × {Math.round(region.height)}
          </span>
        </div>
      )}
      {selected.length > 0 && (
        <Selection key={selected.map((s) => s.id).join()} shapes={selected} />
      )}
      {threads.map((t) => (
        <Pin
          key={t.id}
          thread={t}
          shapes={shapes}
          active={t.id === selectedId || t.id === openThreadId}
          interactive={pinsInteractive}
        />
      ))}
      {popover.key === 'draft' && popover.payload && (
        <CommentPopover key="draft" draft={popover.payload} exiting={popover.exiting} />
      )}
      {popoverThread && (
        <CommentPopover key={popoverThread.id} thread={popoverThread} exiting={popover.exiting} />
      )}
      {textEdit && (
        <TextEditor key={`${textEdit.point.x},${textEdit.point.y}`} point={textEdit.point} />
      )}
      {editingText && (
        <TextEditor key={editingText.id} point={editingText.point} shape={editingText} />
      )}
    </div>
  );
}
