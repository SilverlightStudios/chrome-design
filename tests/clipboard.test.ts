// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  cloneShapes,
  duplicateSelection,
  pasteShapes,
  shapesFromHtml,
  shapesToHtml,
} from '../src/content/clipboard';
import { createInitialState, EditorStore, emptyDoc } from '../src/content/store';
import type { Shape } from '../src/shared/model';

const box: Shape = {
  id: 'a',
  type: 'shape',
  kind: 'rect',
  rect: { x: 10, y: 10, width: 50, height: 40 },
  style: { color: '#ef4444', width: 3, dashed: false },
  createdAt: '2026-01-01T00:00:00.000Z',
};

function storeWith(shapes: Shape[]) {
  const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
  for (const s of shapes) store.addAnnotation(s);
  store.set({ tool: 'select', selectedIds: shapes.map((s) => s.id) });
  return store;
}

describe('copy, paste and duplicate', () => {
  it('carries drawings through the clipboard HTML, quotes and all', () => {
    const tricky = {
      ...box,
      kind: 'text',
      point: { x: 1, y: 2 },
      text: 'Say "hi" <b>',
      fontSize: 16,
    } as Shape;
    expect(shapesFromHtml(shapesToHtml([box, tricky]))).toEqual([box, tricky]);
    expect(shapesFromHtml('<p>just text</p>')).toBeNull();
  });

  it('makes fresh copies with new ids', () => {
    const [copy] = cloneShapes([box], 5, 6);
    expect(copy!.id).not.toBe('a');
    expect(copy).toMatchObject({ rect: { x: 15, y: 16 } });
  });

  it('duplicates the selection just below-right and selects the copies, one undo step', () => {
    const store = storeWith([box]);
    expect(duplicateSelection(store)).toBe(true);
    const s = store.getState();
    expect(s.doc.annotations).toHaveLength(2);
    expect(s.selectedIds).toEqual([s.doc.annotations[1]!.id]);
    expect(s.doc.annotations[1]).toMatchObject({ rect: { x: 26, y: 26 } });
    store.undo();
    expect(store.getState().doc.annotations).toHaveLength(1);
  });

  it('steps each paste further while the originals are on screen', () => {
    const store = storeWith([]);
    pasteShapes(store, [box]);
    pasteShapes(store, [box]);
    const rects = store
      .getState()
      .doc.annotations.map((a) => (a as Extract<Shape, { rect: unknown }>).rect.x);
    expect(rects[1]! - rects[0]!).toBe(16);
  });
});
