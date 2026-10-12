import { describe, expect, it } from 'vitest';
import { createInitialState, EditorStore, emptyDoc, nextCommentNumber } from '../src/content/store';
import type { Shape } from '../src/shared/model';
import { AT, sampleDoc } from './helpers';

const rect = (id: string): Shape => ({
  id,
  type: 'shape',
  kind: 'rect',
  rect: { x: 0, y: 0, width: 10, height: 10 },
  style: { color: '#000', width: 2, dashed: false },
  createdAt: AT,
});

describe('EditorStore history', () => {
  it('undoes and redoes document changes in order', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    store.addAnnotation(rect('a'));
    store.addAnnotation(rect('b'));
    expect(store.getState().doc.annotations.map((a) => a.id)).toEqual(['a', 'b']);
    store.undo();
    expect(store.getState().doc.annotations.map((a) => a.id)).toEqual(['a']);
    store.undo();
    expect(store.getState().doc.annotations).toEqual([]);
    expect(store.canUndo()).toBe(false);
    store.redo();
    store.redo();
    expect(store.getState().doc.annotations.map((a) => a.id)).toEqual(['a', 'b']);
    expect(store.canRedo()).toBe(false);
  });

  it('drops the redo stack after a new change and clears dangling selection', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    store.addAnnotation(rect('a'));
    store.set({ selectedId: 'a' });
    store.undo();
    expect(store.getState().selectedId).toBeNull();
    store.addAnnotation(rect('c'));
    expect(store.canRedo()).toBe(false);
  });

  it('keeps the brief out of history and notifies persistence', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    let saves = 0;
    store.onDocChange(() => saves++);
    store.setBrief('hello');
    store.addAnnotation(rect('a'));
    expect(saves).toBe(2);
    store.undo();
    expect(store.getState().doc.brief).toBe('hello');
  });

  it('removes shapes only with clearShapes, and everything with clearAll (undoable)', () => {
    const store = new EditorStore(createInitialState(sampleDoc('https://x.test/')));
    store.clearShapes();
    expect(store.getState().doc.annotations.every((a) => a.type === 'comment')).toBe(true);
    store.clearAll();
    expect(store.getState().doc.annotations).toEqual([]);
    store.undo();
    store.undo();
    expect(store.getState().doc.annotations).toHaveLength(4);
  });

  it('numbers comments after the highest existing number', () => {
    expect(nextCommentNumber(sampleDoc('https://x.test/').annotations)).toBe(3);
    expect(nextCommentNumber([])).toBe(1);
  });
});

describe('panel back button', () => {
  it('remembers where a panel came from until a panel is opened another way', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    store.set({ panel: 'grid', panelBack: 'more' });
    expect(store.getState().panelBack).toBe('more');
    store.set({ grid: { ...store.getState().grid, count: 6 } });
    expect(store.getState().panelBack).toBe('more');
    // Back to More, or a shortcut opening a panel directly: nothing to go back to.
    store.set({ panel: 'more' });
    expect(store.getState().panelBack).toBeNull();
  });
});
