import { buildAnchor } from '../capture/anchor';
import { translateShape } from '../shared/geometry';
import { isShape } from '../shared/model';
import { isTypingEvent, toPage } from './dom';
import type { DrawToolId, EditorStore, ToolId } from './store';

const TOOL_KEYS: Record<string, ToolId> = { v: 'select', c: 'comment', d: 'draw' };
const DRAW_KEYS: Record<string, DrawToolId> = {
  p: 'pen',
  l: 'line',
  a: 'arrow',
  r: 'rect',
  o: 'ellipse',
  t: 'text',
  e: 'eraser',
};

/**
 * Global shortcuts. Returns true when the event was handled (caller stops propagation so
 * the page's own shortcuts do not fire while the toolbar is in use).
 */
export function handleShortcut(
  event: KeyboardEvent,
  store: EditorStore,
  close: () => void,
  /** Called after a destructive shortcut so the UI can offer Undo. */
  notify?: (message: string) => void,
): boolean {
  if (isTypingEvent(event)) return false;
  const s = store.getState();
  const mod = event.metaKey || event.ctrlKey;
  const key = event.key;
  const lower = key.length === 1 ? key.toLowerCase() : key;

  if (event.altKey && event.shiftKey && (lower === 'd' || event.code === 'KeyD')) {
    close();
    return true;
  }
  // Paused: the page owns the keyboard (its own shortcuts, undo, Escape) until a tool is picked.
  if (s.tool === 'browse') return false;
  if (mod && lower === 'z') {
    if (event.shiftKey) store.redo();
    else store.undo();
    return true;
  }
  if (mod && lower === 'y') {
    store.redo();
    return true;
  }
  if (mod || event.altKey) return false;

  if (key === 'Escape') {
    if (s.preview || s.region || s.moving) store.set({ preview: null, region: null, moving: null });
    else if (s.draft || s.openThreadId) store.set({ draft: null, openThreadId: null });
    else if (s.panel !== 'none') store.set({ panel: 'none' });
    else if (s.selectedId) store.set({ selectedId: null });
    else if (s.pickedEl) store.set({ pickedEl: null });
    else if (s.tool === 'draw' || s.tool === 'comment') store.set({ tool: 'select' });
    else if (s.tool === 'select') store.set({ tool: 'browse', hoverEl: null });
    else return false;
    return true;
  }

  if ((key === 'Delete' || key === 'Backspace') && s.selectedId) {
    const target = s.doc.annotations.find((a) => a.id === s.selectedId);
    store.removeAnnotations([s.selectedId]);
    if (target)
      notify?.(target.type === 'comment' ? `Deleted comment ${target.number}` : 'Deleted drawing');
    return true;
  }

  if (key.startsWith('Arrow')) {
    const selected = s.doc.annotations.find((a) => a.id === s.selectedId);
    if (selected && isShape(selected)) {
      const step = event.shiftKey ? 10 : 1;
      const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
      const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
      store.updateAnnotation(selected.id, (a) => (isShape(a) ? translateShape(a, dx, dy) : a));
      return true;
    }
    if (s.pickedEl && s.tool === 'select') {
      if (
        key === 'ArrowUp' &&
        s.pickedEl.parentElement &&
        s.pickedEl.parentElement !== document.documentElement
      ) {
        store.set({ pickedEl: s.pickedEl.parentElement });
        return true;
      }
      if (key === 'ArrowDown' && s.pickedEl.firstElementChild) {
        store.set({ pickedEl: s.pickedEl.firstElementChild });
        return true;
      }
    }
    return false;
  }

  if (key === 'Enter' && s.pickedEl && s.tool === 'select' && !s.draft) {
    const r = s.pickedEl.getBoundingClientRect();
    const point = toPage(r.left + Math.min(16, r.width / 2), r.top + Math.min(16, r.height / 2));
    store.set({ draft: { target: { type: 'element', point, anchor: buildAnchor(s.pickedEl) } } });
    return true;
  }

  if (s.tool === 'draw' && !event.shiftKey && DRAW_KEYS[lower]) {
    store.set({ drawTool: DRAW_KEYS[lower]!, selectedId: null });
    return true;
  }
  if (!event.shiftKey && TOOL_KEYS[lower]) {
    store.set({ tool: TOOL_KEYS[lower]!, selectedId: null, draft: null, hoverEl: null });
    return true;
  }
  if (!event.shiftKey && lower === 'm') {
    store.set({ rulers: !s.rulers });
    return true;
  }
  if (!event.shiftKey && lower === 'g') {
    store.set({ grid: { ...s.grid, visible: !s.grid.visible } });
    return true;
  }
  if (!event.shiftKey && lower === 'f') {
    store.set({ panel: s.panel === 'list' ? 'none' : 'list' });
    return true;
  }
  if (event.shiftKey && lower === 'e') {
    store.set({ panel: s.panel === 'export' ? 'none' : 'export' });
    return true;
  }
  if (key === '?') {
    store.set({ panel: s.panel === 'help' ? 'none' : 'help' });
    return true;
  }
  return false;
}
