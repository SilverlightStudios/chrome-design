import { type PointerEvent as ReactPointerEvent, useRef } from 'react';
import { buildAnchor } from '../../capture/anchor';
import {
  hitTestShape,
  rectFromPoints,
  shapeBounds,
  simplifyPath,
  snapAngle,
  squareFrom,
  translateShape,
} from '../../shared/geometry';
import { createId, nowIso } from '../../shared/ids';
import { isShape, type Point, type Rect, type Shape } from '../../shared/model';
import { spotIn } from '../../shared/targets';
import { useEditor, useEnv } from '../context';
import { capturePointer, elementsInRect, pickElement, releasePointer, toPage } from '../dom';
import type { EditorStore } from '../store';

type Gesture =
  | { kind: 'pick'; start: Point; client: Point; moved: boolean }
  | { kind: 'move'; shape: Shape; start: Point; moved: boolean }
  | { kind: 'draw'; start: Point }
  | { kind: 'erase' };

const DRAG_THRESHOLD = 4;

export function hitShape(store: EditorStore, p: Point, tolerance = 6): Shape | null {
  const shapes = store.getState().doc.annotations.filter(isShape);
  for (let i = shapes.length - 1; i >= 0; i--) {
    const shape = shapes[i]!;
    if (hitTestShape(shape, p, tolerance)) return shape;
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

/** A comment on a placed image or drawing, pinned where it was clicked within it. */
export function draftForShape(shape: Shape, p: Point) {
  return { target: { type: 'shape' as const, shapeId: shape.id, at: spotIn(shape, p), point: p } };
}

/** Start a comment on a selected image or drawing (pinned at its top-right corner). */
export function commentOnShape(store: EditorStore, shape: Shape): void {
  const b = shapeBounds(shape);
  store.set({
    draft: draftForShape(shape, { x: b.x + b.width, y: b.y }),
    openThreadId: null,
    pickedEl: null,
    pickedRegion: null,
  });
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

  const erase = (p: Point) => {
    const s = store.getState();
    const hits = s.doc.annotations.filter(
      (a): a is Shape => isShape(a) && !s.erasing.includes(a.id) && hitTestShape(a, p, 10),
    );
    if (hits.length) store.set({ erasing: [...s.erasing, ...hits.map((h) => h.id)] });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    const s = store.getState();
    const p = toPage(e.clientX, e.clientY);
    capturePointer(e.currentTarget, e.pointerId);
    if (s.openThreadId || s.draft) store.set({ openThreadId: null, draft: null });
    // Starting to work on the page puts the intro/help/more sheet away (it would cover popovers).
    if (s.panel === 'welcome' || s.panel === 'help' || s.panel === 'more')
      store.set({ panel: 'none' });

    if (s.tool === 'select') {
      const hit = hitShape(store, p, e.pointerType === 'touch' ? 14 : 6);
      if (hit) {
        // Figma: press on a drawing selects it and dragging moves it right away.
        store.set({ selectedId: hit.id, pickedEl: null, pickedRegion: null });
        gesture.current = { kind: 'move', shape: hit, start: p, moved: false };
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
        if (!s.textEdit && !s.editingTextId)
          store.set({ textEdit: { point: { x: p.x, y: p.y - 4 } } });
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

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    const s = store.getState();
    if (!g) {
      const overShape =
        (s.tool === 'select' || s.tool === 'comment') && e.pointerType !== 'touch'
          ? hitShape(store, toPage(e.clientX, e.clientY))
          : null;
      const id = overShape?.id ?? null;
      if (id !== s.hoverShapeId) store.set({ hoverShapeId: id });
      // Over a drawing the comment would be on it, so the page element isn't highlighted.
      if (overShape && s.tool === 'comment') {
        if (s.hoverEl) store.set({ hoverEl: null });
      } else if (s.tool === 'select' || s.tool === 'comment') updateHover(e.clientX, e.clientY);
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
      case 'move': {
        const dx = p.x - g.start.x;
        const dy = p.y - g.start.y;
        if (!g.moved && Math.hypot(dx, dy) < 2) return;
        g.moved = true;
        store.set({ liveShape: translateShape(g.shape, dx, dy), hoverShapeId: null });
        return;
      }
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
      store.set({ preview: null, liveShape: null, erasing: [], region: null });
      return;
    }
    const p = toPage(e.clientX, e.clientY);
    switch (g.kind) {
      case 'pick': {
        const region = s.region;
        store.set({ region: null });
        if (g.moved && region && region.width > 6 && region.height > 6) {
          if (s.tool === 'comment') {
            store.set({
              draft: draftForRegion(region),
              openThreadId: null,
              pickedEl: null,
              selectedId: null,
            });
          } else {
            // Select tool: keep the area selected; the selection bar offers "Comment".
            store.set({ pickedRegion: region, pickedEl: null, selectedId: null });
          }
          return;
        }
        if (s.tool === 'comment') {
          // On a placed image or drawing, the comment belongs to it.
          const shape = hitShape(store, p, e.pointerType === 'touch' ? 14 : 6);
          store.set({
            draft: shape ? draftForShape(shape, p) : draftForPoint(p, e.clientX, e.clientY),
            selectedId: null,
            hoverShapeId: null,
          });
        } else {
          const el = pickElement(e.clientX, e.clientY);
          store.set({ pickedEl: isPageRoot(el) ? null : el, selectedId: null, pickedRegion: null });
        }
        return;
      }
      case 'move': {
        const live = s.liveShape;
        store.set({ liveShape: null });
        if (g.moved && live) store.updateAnnotation(live.id, () => live);
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
        if (!shape) return;
        store.addAnnotation(shape);
        // Figma: after a shape, hand back the Select tool with the new shape ready to adjust.
        // The pencil stays out so you can keep sketching.
        if (shape.kind !== 'pen')
          store.set({ tool: 'select', selectedId: shape.id, hoverEl: null });
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
        const s = store.getState();
        if (!gesture.current && (s.hoverEl || s.hoverShapeId))
          store.set({ hoverEl: null, hoverShapeId: null });
      }}
      onContextMenu={(e) => {
        if (gesture.current) e.preventDefault();
      }}
    />
  );
}
