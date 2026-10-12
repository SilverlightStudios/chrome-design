import { currentAnchorPoint } from '../capture/anchor';
import type { CommentThread, Point } from '../shared/model';
import type { EditorStore } from './store';

/** Live page position of a thread's pin (follows its anchor element if it moved). */
export function livePinPoint(thread: CommentThread): Point {
  const t = thread.target;
  if (t.type === 'region') return { x: t.rect.x, y: t.rect.y };
  return currentAnchorPoint(t.point, t.anchor);
}

export function revealThread(store: EditorStore, thread: CommentThread): void {
  const p = livePinPoint(thread);
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
