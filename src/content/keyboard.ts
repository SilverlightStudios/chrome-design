import { buildAnchor } from '../capture/anchor';
import { translateShape } from '../shared/geometry';
import { isShape } from '../shared/model';
import { isTypingEvent, toPage } from './dom';
import { draftForRegion } from './overlay/InteractionLayer';
import { type DrawToolId, type EditorState, type EditorStore, isShapeTool } from './store';

/** Figma's single-key tools. */
const DRAW_KEYS: Record<string, DrawToolId> = {
  p: 'pen',
  d: 'pen',
  e: 'eraser',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
  t: 'text',
};

function pickDraw(store: EditorStore, tool: DrawToolId): void {
  const patch: Partial<EditorState> = {
    tool: 'draw',
    drawTool: tool,
    selectedId: null,
    pickedEl: null,
    pickedRegion: null,
    hoverEl: null,
  };
  if (isShapeTool(tool)) patch.lastShape = tool;
  if (store.getState().panel === 'welcome') patch.panel = 'none';
  store.set(patch);
}

/**
 * Global shortcuts. Returns true when the event was handled (caller stops propagation so
 * the page's own shortcuts do not fire while a tool is in use).
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
    if (s.preview || s.region || s.liveShape)
      store.set({ preview: null, region: null, liveShape: null });
    else if (s.draft || s.openThreadId) store.set({ draft: null, openThreadId: null });
    else if (s.panel !== 'none') store.set({ panel: 'none' });
    else if (s.selectedId) store.set({ selectedId: null });
    else if (s.showDetails && s.pickedEl) store.set({ showDetails: false });
    else if (s.pickedEl || s.pickedRegion) store.set({ pickedEl: null, pickedRegion: null });
    else if (s.tool === 'draw' || s.tool === 'comment') store.set({ tool: 'select' });
    else if (s.tool === 'select') store.set({ tool: 'browse', hoverEl: null });
    else return false;
    return true;
  }

  if ((key === 'Delete' || key === 'Backspace') && s.selectedId) {
    const target = s.doc.annotations.find((a) => a.id === s.selectedId);
    store.removeAnnotations([s.selectedId]);
    if (target)
      notify?.(target.type === 'comment' ? `Comment ${target.number} deleted` : 'Drawing deleted');
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

  if (key === 'Enter' && s.tool === 'select' && !s.draft) {
    if (s.pickedRegion) {
      store.set({ draft: draftForRegion(s.pickedRegion), pickedRegion: null });
      return true;
    }
    if (s.pickedEl) {
      const r = s.pickedEl.getBoundingClientRect();
      const point = toPage(r.left + Math.min(16, r.width / 2), r.top + Math.min(16, r.height / 2));
      store.set({ draft: { target: { type: 'element', point, anchor: buildAnchor(s.pickedEl) } } });
      return true;
    }
    const selected = s.doc.annotations.find((a) => a.id === s.selectedId);
    if (selected && isShape(selected) && selected.kind === 'text') {
      store.set({ editingTextId: selected.id });
      return true;
    }
  }

  if (event.shiftKey) {
    if (lower === 'e') {
      store.set({ panel: s.panel === 'export' ? 'none' : 'export' });
      return true;
    }
    if (key === '?') {
      store.set({ panel: s.panel === 'help' ? 'none' : 'help' });
      return true;
    }
    return false;
  }

  if (lower === 'v' || lower === 'c') {
    store.set({
      tool: lower === 'v' ? 'select' : 'comment',
      selectedId: null,
      draft: null,
      hoverEl: null,
      ...(s.panel === 'welcome' ? { panel: 'none' as const } : {}),
    });
    return true;
  }
  const draw = DRAW_KEYS[lower];
  if (draw) {
    pickDraw(store, draw);
    return true;
  }
  if (lower === 'm') {
    store.set({ rulers: !s.rulers });
    return true;
  }
  if (lower === 'g') {
    store.set({ grid: { ...s.grid, visible: !s.grid.visible } });
    return true;
  }
  if (lower === 'f') {
    store.set({ panel: s.panel === 'list' ? 'none' : 'list' });
    return true;
  }
  if (key === '?') {
    store.set({ panel: s.panel === 'help' ? 'none' : 'help' });
    return true;
  }
  return false;
}
