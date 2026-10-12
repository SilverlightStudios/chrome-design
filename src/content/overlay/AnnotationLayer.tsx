import { memo, type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { pinColor } from '../../export/overlay';
import {
  arrowHead,
  type Handle,
  handlesFor,
  pointsToPath,
  resizeShape,
  shapeBounds,
  translateShape,
} from '../../shared/geometry';
import {
  type CommentThread,
  isComment,
  isShape,
  type Point,
  type Shape,
  type TextShape,
} from '../../shared/model';
import { livePinPoint } from '../actions';
import { useEditor, useEnv, useLayoutVersion } from '../context';
import { capturePointer, toPage } from '../dom';
import { usePresence } from '../motion/presence';
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
  }
});

type SelectionGesture =
  | { kind: 'move'; start: Point; original: Shape; moved: boolean }
  | { kind: 'resize'; handle: Handle; original: Shape };

/**
 * Figma-style selection for a drawing: a frame you can drag to move, corner (or endpoint)
 * handles to resize, a size pill, and double-click / tap again to edit a text label.
 * Touch-friendly: the frame and handles opt out of page scrolling (touch-action: none).
 */
function ShapeSelection({ shape }: { shape: Shape }) {
  const { store } = useEnv();
  const gesture = useRef<SelectionGesture | null>(null);
  const b = shapeBounds(shape);
  // Figma hugs the shape: handles sit on its corners (text gets a little air).
  const pad = shape.kind === 'text' ? 4 : shape.style.width / 2;
  const frame = {
    x: b.x - pad,
    y: b.y - pad,
    width: b.width + pad * 2,
    height: b.height + pad * 2,
  };

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
      store.set({ liveShape: translateShape(g.original, dx, dy) });
    } else {
      store.set({ liveShape: resizeShape(g.original, g.handle, p, e.shiftKey) });
    }
  };
  const end = (e: ReactPointerEvent<HTMLElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const live = store.getState().liveShape;
    store.set({ liveShape: null });
    if (g.kind === 'move' && !g.moved) {
      // A tap on an already-selected label edits it (touch has no double-click).
      if (g.original.kind === 'text' && e.pointerType === 'touch')
        store.set({ editingTextId: g.original.id });
      return;
    }
    if (live) store.updateAnnotation(live.id, () => live);
  };
  const cancel = () => {
    gesture.current = null;
    store.set({ liveShape: null });
  };

  const handlePos = (h: Handle): Point => {
    if (h === 'from' && (shape.kind === 'line' || shape.kind === 'arrow')) return shape.from;
    if (h === 'to' && (shape.kind === 'line' || shape.kind === 'arrow')) return shape.to;
    return {
      x: h === 'nw' || h === 'sw' ? frame.x : frame.x + frame.width,
      y: h === 'nw' || h === 'ne' ? frame.y : frame.y + frame.height,
    };
  };
  const isSegment = shape.kind === 'line' || shape.kind === 'arrow';

  return (
    <>
      <div
        className="sel-frame"
        data-segment={isSegment ? '' : undefined}
        style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }}
        onPointerDown={(e) =>
          start(e, {
            kind: 'move',
            start: toPage(e.clientX, e.clientY),
            original: shape,
            moved: false,
          })
        }
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={cancel}
        onDoubleClick={() => {
          if (shape.kind === 'text') store.set({ editingTextId: shape.id });
        }}
      />
      {handlesFor(shape).map((h) => {
        const p = handlePos(h);
        return (
          <div
            key={h}
            className="sel-handle"
            data-handle={h}
            data-round={isSegment ? '' : undefined}
            style={{ left: p.x, top: p.y }}
            onPointerDown={(e) => start(e, { kind: 'resize', handle: h, original: shape })}
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
        {shape.kind === 'text' ? 'Label' : `${Math.round(b.width)} × ${Math.round(b.height)}`}
      </div>
    </>
  );
}

function Pin({
  thread,
  active,
  interactive,
}: {
  thread: CommentThread;
  active: boolean;
  interactive: boolean;
}) {
  const { store } = useEnv();
  const p = livePinPoint(thread);
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
      aria-label={`Comment ${thread.number}: ${thread.messages[0]?.body ?? ''}`}
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
        {thread.messages[0]?.body}
      </span>
    </button>
  );
}

function TargetOutline({ thread, active }: { thread: CommentThread; active: boolean }) {
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
  if (!active || !t.anchor) return null;
  const p = livePinPoint(thread);
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

/** While composing, outlines what the comment is about (under the bubble, never over it). */
function DraftOutline({ target }: { target: CommentThread['target'] }) {
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
  const openThreadId = useEditor((s) => s.openThreadId);
  const draft = useEditor((s) => s.draft);
  const preview = useEditor((s) => s.preview);
  const liveShape = useEditor((s) => s.liveShape);
  const erasing = useEditor((s) => s.erasing);
  const region = useEditor((s) => s.region);
  const textEdit = useEditor((s) => s.textEdit);
  const editingTextId = useEditor((s) => s.editingTextId);
  const tool = useEditor((s) => s.tool);
  const hoverShapeId = useEditor((s) => s.hoverShapeId);

  const shapes = annotations.filter(isShape).map((s) => (liveShape?.id === s.id ? liveShape : s));
  const threads = annotations.filter(isComment);
  const selectedShape = tool === 'select' ? shapes.find((s) => s.id === selectedId) : undefined;
  const editingText = shapes.find(
    (s): s is TextShape => s.id === editingTextId && s.kind === 'text',
  );
  const pinsInteractive = tool !== 'draw';
  const hovered =
    hoverShapeId && hoverShapeId !== selectedId && !liveShape
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
          active={t.id === selectedId || t.id === openThreadId}
        />
      ))}
      {popover.key === 'draft' && popover.payload && !popover.exiting && (
        <DraftOutline target={popover.payload.target} />
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
      {selectedShape &&
        !erasing.includes(selectedShape.id) &&
        selectedShape.id !== editingTextId && (
          <ShapeSelection key={selectedShape.id} shape={selectedShape} />
        )}
      {threads.map((t) => (
        <Pin
          key={t.id}
          thread={t}
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
