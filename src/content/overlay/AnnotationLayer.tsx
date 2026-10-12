import { memo, type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { pinColor } from '../../export/overlay';
import { arrowHead, pointsToPath, shapeBounds, translateShape } from '../../shared/geometry';
import { type CommentThread, isComment, isShape, type Shape } from '../../shared/model';
import { livePinPoint } from '../actions';
import { useEditor, useEnv, useLayoutVersion } from '../context';
import { capturePointer } from '../dom';
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

function SelectionBox({ shape }: { shape: Shape }) {
  const b = shapeBounds(shape);
  const pad = 6 + shape.style.width / 2;
  return (
    <rect
      className="sel-box"
      x={b.x - pad}
      y={b.y - pad}
      width={b.width + pad * 2}
      height={b.height + pad * 2}
      rx={4}
    />
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
      e.currentTarget.style.translate = `${e.clientX - d.x}px ${e.clientY - d.y}px`;
    }
  };
  const onUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const d = drag.current;
    drag.current = null;
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
      onPointerCancel={() => {
        drag.current = null;
      }}
    >
      <span>{thread.number}</span>
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

/** Page-space layer: drawings, pins, region outlines, popovers. Scrolls natively with the page. */
export function AnnotationLayer() {
  useLayoutVersion();
  const annotations = useEditor((s) => s.doc.annotations);
  const selectedId = useEditor((s) => s.selectedId);
  const openThreadId = useEditor((s) => s.openThreadId);
  const draft = useEditor((s) => s.draft);
  const preview = useEditor((s) => s.preview);
  const moving = useEditor((s) => s.moving);
  const erasing = useEditor((s) => s.erasing);
  const region = useEditor((s) => s.region);
  const textEdit = useEditor((s) => s.textEdit);
  const tool = useEditor((s) => s.tool);

  const shapes = annotations.filter(isShape);
  const threads = annotations.filter(isComment);
  const selectedShape = shapes.find((s) => s.id === selectedId);
  const openThread = threads.find((t) => t.id === openThreadId);
  const pinsInteractive = tool !== 'draw';

  return (
    <div className="page-layer">
      <svg className="shape-layer" width="1" height="1" aria-hidden="true">
        {shapes.map((shape) => {
          if (erasing.includes(shape.id)) return null;
          const s = moving?.id === shape.id ? translateShape(shape, moving.dx, moving.dy) : shape;
          return <ShapeView key={shape.id} shape={s} />;
        })}
        {preview && <ShapeView shape={preview} />}
        {selectedShape && !erasing.includes(selectedShape.id) && (
          <SelectionBox
            shape={
              moving?.id === selectedShape.id
                ? translateShape(selectedShape, moving.dx, moving.dy)
                : selectedShape
            }
          />
        )}
      </svg>
      {threads.map((t) => (
        <TargetOutline
          key={`o-${t.id}`}
          thread={t}
          active={t.id === selectedId || t.id === openThreadId}
        />
      ))}
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
      {threads.map((t) => (
        <Pin
          key={t.id}
          thread={t}
          active={t.id === selectedId || t.id === openThreadId}
          interactive={pinsInteractive}
        />
      ))}
      {draft && <CommentPopover key="draft" draft={draft} />}
      {openThread && !draft && <CommentPopover key={openThread.id} thread={openThread} />}
      {textEdit && <TextEditor point={textEdit.point} />}
    </div>
  );
}
