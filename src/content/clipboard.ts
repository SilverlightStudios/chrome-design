import { translateShape, unionBounds } from '../shared/geometry';
import { createId, nowIso } from '../shared/ids';
import type { Shape } from '../shared/model';
import { type EditorStore, selectedShapes } from './store';

/**
 * Copy, cut, paste and duplicate for drawings and placed images. Copies go on the system
 * clipboard as HTML carrying the drawings (so they paste into another page, another tab or a
 * shared handoff file) plus a plain-text line; a copy kept in memory covers browsers that
 * drop the HTML.
 */

const ATTR = 'data-chrome-design-shapes';
const GAP = 16;

let memory: Shape[] = [];
let pastes = 0;

function plainText(shapes: readonly Shape[]): string {
  return `${shapes.length} drawing${shapes.length === 1 ? '' : 's'} (Chrome Design)`;
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

export function shapesToHtml(shapes: readonly Shape[]): string {
  return `<meta charset="utf-8"><div ${ATTR}="${escapeAttr(JSON.stringify(shapes))}">${plainText(shapes)}</div>`;
}

export function shapesFromHtml(html: string): Shape[] | null {
  if (!html.includes(ATTR)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const raw = doc.querySelector(`[${ATTR}]`)?.getAttribute(ATTR);
  if (!raw) return null;
  try {
    const shapes = JSON.parse(raw) as Shape[];
    return Array.isArray(shapes) && shapes.every((s) => s?.type === 'shape') ? shapes : null;
  } catch {
    return null;
  }
}

/** Fresh copies (new ids), moved by (dx, dy). */
export function cloneShapes(shapes: readonly Shape[], dx: number, dy: number): Shape[] {
  return shapes.map((s) => ({
    ...translateShape(s, dx, dy),
    id: createId('s'),
    createdAt: nowIso(),
  }));
}

function addAndSelect(store: EditorStore, shapes: Shape[]): void {
  if (shapes.length === 0) return;
  store.commit((doc) => ({ ...doc, annotations: [...doc.annotations, ...shapes] }));
  store.set({
    tool: 'select',
    selectedIds: shapes.map((s) => s.id),
    pickedEl: null,
    pickedRegion: null,
    draft: null,
    openThreadId: null,
  });
}

/** ⌥-drag finished: add the dragged copies and select them (one undo step). */
export function addCopies(store: EditorStore, shapes: Shape[]): void {
  addAndSelect(store, shapes);
}

/** Write the selection to a copy/cut event. Returns false when nothing is selected. */
export function copySelection(store: EditorStore, data: DataTransfer | null): boolean {
  const shapes = selectedShapes(store.getState());
  if (shapes.length === 0) return false;
  memory = shapes;
  pastes = 0;
  data?.setData('text/html', shapesToHtml(shapes));
  data?.setData('text/plain', plainText(shapes));
  return true;
}

/** Drawings carried by a paste (ours from any page, or this page's last copy). */
export function shapesInPaste(data: DataTransfer | null): Shape[] | null {
  const fromHtml = shapesFromHtml(data?.getData('text/html') ?? '');
  if (fromHtml) return fromHtml;
  if (memory.length && data?.getData('text/plain') === plainText(memory)) return memory;
  return null;
}

function inView(r: { x: number; y: number; width: number; height: number }): boolean {
  const vw = document.documentElement.clientWidth || window.innerWidth;
  return (
    r.x + r.width > window.scrollX &&
    r.x < window.scrollX + vw &&
    r.y + r.height > window.scrollY &&
    r.y < window.scrollY + window.innerHeight
  );
}

/**
 * Paste drawings: a little below-right of the originals while they're on screen (each paste
 * steps further), otherwise in the middle of the screen.
 */
export function pasteShapes(store: EditorStore, shapes: readonly Shape[]): void {
  if (shapes.length === 0) return;
  const box = unionBounds(shapes);
  pastes++;
  let dx = GAP * pastes;
  let dy = GAP * pastes;
  if (!inView(box)) {
    const vw = document.documentElement.clientWidth || window.innerWidth;
    dx = window.scrollX + vw / 2 - (box.x + box.width / 2);
    dy = window.scrollY + window.innerHeight / 2 - (box.y + box.height / 2);
  }
  addAndSelect(store, cloneShapes(shapes, dx, dy));
}

/** ⌘D / the Duplicate button: copies of the selection, just below-right. */
export function duplicateSelection(store: EditorStore): boolean {
  const shapes = selectedShapes(store.getState());
  if (shapes.length === 0) return false;
  addAndSelect(store, cloneShapes(shapes, GAP, GAP));
  return true;
}

/** Remove the selection after a cut. */
export function removeSelection(store: EditorStore): void {
  store.removeAnnotations(selectedShapes(store.getState()).map((s) => s.id));
}
