import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { buildAnchor } from '../../capture/anchor';
import {
  hitTestShape,
  rectFromPoints,
  simplifyPath,
  snapAngle,
  squareFrom,
  translateShape,
} from '../../shared/geometry';
import { createId, nowIso } from '../../shared/ids';
import { isShape, type Point, type Rect, type Shape } from '../../shared/model';
import { useEditor, useEnv } from '../context';
import { capturePointer, elementsInRect, pickElement, releasePointer, toPage } from '../dom';
import type { EditorStore } from '../store';

type Gesture =
  | { kind: 'pick'; start: Point; client: Point; moved: boolean }
  | { kind: 'move'; id: string; start: Point }
  | { kind: 'draw'; start: Point }
  | { kind: 'erase' };

const DRAG_THRESHOLD = 4;

function hitShape(store: EditorStore, p: Point): Shape | null {
  const shapes = store.getState().doc.annotations.filter(isShape);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    if (hitTestShape(shape, p, 6)) return shape;
  }
  return null;
}

function isPageRoot(el: Element | null): boolean {
  return !el || el === document.documentElement || el === document.body;
}

export function draftForPoint(p: Point, clientX: number, clientY: number) {
  const el = pickElement(clientX, clientY);
  if (isPageRoot(el)) return { target: { type: 'point' as const, point: p } };
  return { target: { type: 'element' as const, point: p, anchor: buildAnchor(el!) } };
}

export function draftForRegion(rect: Rect) {
  const anchors = elementsInRect(rect).map(buildAnchor);
  return { target: { type: 'region' as const, rect, anchors } };
}

/** Full-viewport capture layer. Active for every tool except `browse`. */
export function InteractionLayer() {
  const { store } = useEnv();
  const tool = useEditor((s) => s.tool);
  const drawTool = useEditor((s) => s.drawTool);
  const hoverShape = useEditor((s) => s.tool === 'select' && s.hoverShapeId !== null);
  const gesture = useRef<Gesture | null>(null);
  const hoverFrame = useRef(0);

  const updateHover = (x: number, y: number) => {
    cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      const el = pickElement(x, y);
      if (el !== store.getState().hoverEl) store.set({ hoverEl: el });
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const s = store.getState();
    const p = toPage(e.clientX, e.clientY);
    capturePointer(e.currentTarget, e.pointerId);
    if (s.openThreadId || s.draft) store.set({ openThreadId: null, draft: null });

    if (s.tool === 'select') {
      const hit = hitShape(store, p);
      if (hit) {
        store.set({ selectedId: hit.id, pickedEl: null });
        gesture.current = { kind: 'move', id: hit.id, start: p };
        return;
      }
      gesture.current = {
        kind: 'pick',
        start: p,
        client: { x: e.clientX, y: e.clientY },
        moved: false,
      };
      return;
    }
    if (s.tool === 'comment') {
      gesture.current = {
        kind: 'pick',
        start: p,
        client: { x: e.clientX, y: e.clientY },
        moved: false,
      };
      return;
    }
    if (s.tool === 'draw') {
      store.set({ selectedId: null });
      if (s.drawTool === 'text') {
        releasePointer(e.currentTarget, e.pointerId);
        if (!s.textEdit) store.set({ textEdit: { point: { x: p.x, y: p.y - 4 } } });
        return;
      }
      if (s.drawTool === 'eraser') {
        gesture.current = { kind: 'erase' };
        erase(p);
        return;
      }
      gesture.current = { kind: 'draw', start: p };
      const base = {
        id: createId('s'),
        type: 'shape' as const,
        style: { ...s.style },
        createdAt: nowIso(),
      };
      let preview: Shape;
      switch (s.drawTool) {
        case 'pen':
          preview = { ...base, kind: 'pen', points: [p] };
          break;
        case 'line':
        case 'arrow':
          preview = { ...base, kind: s.drawTool, from: p, to: p };
          break;
        default:
          preview = {
            ...base,
            kind: s.drawTool === 'ellipse' ? 'ellipse' : 'rect',
            rect: { x: p.x, y: p.y, width: 0, height: 0 },
          };
      }
      store.set({ preview });
    }
  };

  const erase = (p: Point) => {
    const s = store.getState();
    const hits = s.doc.annotations.filter(
      (a): a is Shape => isShape(a) && !s.erasing.includes(a.id) && hitTestShape(a, p, 8),
    );
    if (hits.length) store.set({ erasing: [...s.erasing, ...hits.map((h) => h.id)] });
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const s = store.getState();
    if (!g) {
      if (s.tool === 'select' || s.tool === 'comment') updateHover(e.clientX, e.clientY);
      if (s.tool === 'select') {
        const hit = hitShape(store, toPage(e.clientX, e.clientY));
        const id = hit?.id ?? null;
        if (id !== s.hoverShapeId) store.set({ hoverShapeId: id });
      }
      return;
    }
    const p = toPage(e.clientX, e.clientY);
    switch (g.kind) {
      case 'pick': {
        if (!g.moved && Math.hypot(e.clientX - g.client.x, e.clientY - g.client.y) < DRAG_THRESHOLD)
          return;
        g.moved = true;
        store.set({ region: rectFromPoints(g.start, p), hoverEl: null });
        return;
      }
      case 'move':
        store.set({ moving: { id: g.id, dx: p.x - g.start.x, dy: p.y - g.start.y } });
        return;
      case 'erase': {
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const ev of events.length ? events : [e.nativeEvent])
          erase(toPage(ev.clientX, ev.clientY));
        return;
      }
      case 'draw': {
        const preview = s.preview;
        if (!preview) return;
        if (preview.kind === 'pen') {
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
          const pts = (events.length ? events : [e.nativeEvent]).map((ev) =>
            toPage(ev.clientX, ev.clientY),
          );
          store.set({ preview: { ...preview, points: [...preview.points, ...pts] } });
        } else if (preview.kind === 'line' || preview.kind === 'arrow') {
          store.set({ preview: { ...preview, to: e.shiftKey ? snapAngle(g.start, p) : p } });
        } else if (preview.kind === 'rect' || preview.kind === 'ellipse') {
          const end = e.shiftKey ? squareFrom(g.start, p) : p;
          store.set({ preview: { ...preview, rect: rectFromPoints(g.start, end) } });
        }
        return;
      }
    }
  };

  const finish = (e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const s = store.getState();
    if (cancelled) {
      store.set({ preview: null, moving: null, erasing: [], region: null });
      return;
    }
    const p = toPage(e.clientX, e.clientY);
    switch (g.kind) {
      case 'pick': {
        if (g.moved && s.region && s.region.width > 6 && s.region.height > 6) {
          const draft = draftForRegion(s.region);
          store.set({ region: null, draft, openThreadId: null, pickedEl: null, selectedId: null });
          return;
        }
        store.set({ region: null });
        if (s.tool === 'comment') {
          store.set({ draft: draftForPoint(p, e.clientX, e.clientY), selectedId: null });
        } else {
          const el = pickElement(e.clientX, e.clientY);
          store.set({ pickedEl: isPageRoot(el) ? null : el, selectedId: null });
        }
        return;
      }
      case 'move': {
        const m = s.moving;
        store.set({ moving: null });
        if (m && (m.dx !== 0 || m.dy !== 0)) {
          store.updateAnnotation(m.id, (a) => (isShape(a) ? translateShape(a, m.dx, m.dy) : a));
        }
        return;
      }
      case 'erase': {
        const ids = s.erasing;
        store.set({ erasing: [] });
        store.removeAnnotations(ids);
        return;
      }
      case 'draw': {
        const preview = s.preview;
        store.set({ preview: null });
        if (!preview) return;
        let shape: Shape | null = null;
        if (preview.kind === 'pen') {
          shape = { ...preview, points: simplifyPath(preview.points, 0.6) };
        } else if (preview.kind === 'line' || preview.kind === 'arrow') {
          if (Math.hypot(preview.to.x - preview.from.x, preview.to.y - preview.from.y) >= 4)
            shape = preview;
        } else if (preview.kind === 'rect' || preview.kind === 'ellipse') {
          if (preview.rect.width >= 4 && preview.rect.height >= 4) shape = preview;
        }
        if (shape) store.addAnnotation(shape);
        return;
      }
    }
  };

  return (
    <div
      className="capture"
      data-tool={tool}
      data-draw-tool={tool === 'draw' ? drawTool : undefined}
      data-hover={hoverShape ? 'shape' : undefined}
      style={{ pointerEvents: tool === 'browse' ? 'none' : 'auto' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => finish(e, false)}
      onPointerCancel={(e) => finish(e, true)}
      onPointerLeave={() => {
        if (!gesture.current && (store.getState().hoverEl || store.getState().hoverShapeId)) {
          store.set({ hoverEl: null, hoverShapeId: null });
        }
      }}
      onContextMenu={(e) => {
        if (gesture.current) e.preventDefault();
      }}
    />
  );
}
