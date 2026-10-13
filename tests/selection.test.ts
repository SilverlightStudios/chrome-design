import { describe, expect, it } from 'vitest';
import { createInitialState, EditorStore, emptyDoc, selectedShapes } from '../src/content/store';
import { resizeRect, transformShape, translateShape, unionBounds } from '../src/shared/geometry';
import type { Shape } from '../src/shared/model';

const style = { color: '#000', width: 2, dashed: false };
const at = '2026-01-01T00:00:00.000Z';
const rect = (id: string, x: number, y: number): Shape => ({
  id,
  type: 'shape',
  kind: 'rect',
  rect: { x, y, width: 100, height: 50 },
  style,
  createdAt: at,
});

describe('selecting several drawings', () => {
  it('keeps selectedId as the last of selectedIds, whichever is set', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    store.set({ selectedIds: ['a', 'b'] });
    expect(store.getState().selectedId).toBe('b');
    store.set({ selectedId: 'c' });
    expect(store.getState().selectedIds).toEqual(['c']);
    store.set({ selectedId: null });
    expect(store.getState().selectedIds).toEqual([]);
  });

  it('moves and deletes a group as one undo step, dropping gone ids from the selection', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    store.addAnnotation(rect('a', 0, 0));
    store.addAnnotation(rect('b', 200, 0));
    store.set({ tool: 'select', selectedIds: ['a', 'b'] });
    expect(selectedShapes(store.getState()).map((s) => s.id)).toEqual(['a', 'b']);
    store.replaceShapes(selectedShapes(store.getState()).map((s) => translateShape(s, 0, 40)));
    expect(store.getState().past).toHaveLength(3);
    store.removeAnnotations(['a', 'b']);
    expect(store.getState().selectedIds).toEqual([]);
    store.undo();
    expect(store.getState().doc.annotations).toHaveLength(2);
  });

  it('scales a group from its box', () => {
    const shapes = [rect('a', 0, 0), rect('b', 200, 50)];
    const box = unionBounds(shapes);
    expect(box).toEqual({ x: 0, y: 0, width: 300, height: 100 });
    const bigger = resizeRect(box, 'se', { x: 600, y: 150 }, true);
    expect(bigger).toEqual({ x: 0, y: 0, width: 600, height: 200 });
    expect(transformShape(shapes[1]!, box, bigger)).toMatchObject({
      rect: { x: 400, y: 100, width: 200, height: 100 },
    });
  });
});
