import { currentAnchorPoint } from '../capture/anchor';
import type { Annotation, CommentThread, Point } from '../shared/model';
import { findShape, pointIn } from '../shared/targets';
import type { EditorStore } from './store';

/**
 * Live page position of a thread's pin: follows its anchor element if the page moved, or the
 * image / drawing it belongs to (`annotations` should include a drawing being dragged).
 */
export function livePinPoint(thread: CommentThread, annotations: readonly Annotation[]): Point {
  const t = thread.target;
  if (t.type === 'region') return { x: t.rect.x, y: t.rect.y };
  if (t.type === 'shape') {
    const shape = findShape(annotations, t.shapeId);
    return shape ? pointIn(shape, t.at) : t.point;
  }
  return currentAnchorPoint(t.point, t.anchor);
}

export function revealThread(store: EditorStore, thread: CommentThread): void {
  const p = livePinPoint(thread, store.getState().doc.annotations);
  window.scrollTo({
    top: Math.max(0, p.y - window.innerHeight / 3),
    left: Math.max(0, p.x - window.innerWidth / 2),
    behavior: 'smooth',
  });
  const s = store.getState();
  store.set({
    openThreadId: thread.id,
    selectedId: thread.id,
    draft: null,
    tool: s.tool === 'draw' || s.tool === 'browse' ? 'select' : s.tool,
    panel: 'none',
  });
}
