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

const setup = () => {
  const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
  for (const id of ['a', 'b', 'c', 'd']) store.addAnnotation(rect(id, 0, 0));
  return store;
};
const order = (store: EditorStore) =>
  store
    .getState()
    .doc.annotations.map((a) => a.id)
    .join('');

describe('layer order, lock and hide', () => {
  it('brings forward, sends backward, and goes all the way', () => {
    const store = setup();
    store.arrange(['b'], 'forward');
    expect(order(store)).toBe('acbd');
    store.arrange(['b'], 'front');
    expect(order(store)).toBe('acdb');
    store.arrange(['d'], 'back');
    expect(order(store)).toBe('dacb');
    store.arrange(['a', 'c'], 'backward');
    expect(order(store)).toBe('acdb');
    store.undo();
    expect(order(store)).toBe('dacb');
  });

  it('locks and hides as flags (one undo step each) that picking skips', async () => {
    const { pickable } = await import('../src/content/store');
    const store = setup();
    store.setShapeFlag(['a', 'b'], 'locked', true);
    store.setShapeFlag(['c'], 'hidden', true);
    const shapes = store.getState().doc.annotations as Shape[];
    expect(shapes.map(pickable)).toEqual([false, false, false, true]);
    store.setShapeFlag(['a'], 'locked', false);
    expect('locked' in store.getState().doc.annotations[0]!).toBe(false);
    store.undo();
    expect((store.getState().doc.annotations[0] as Shape).locked).toBe(true);
  });
});
