// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { handleShortcut } from '../src/content/keyboard';
import { createInitialState, EditorStore, emptyDoc } from '../src/content/store';
import type { Shape } from '../src/shared/model';
import { AT } from './helpers';

function setup() {
  const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
  let closed = 0;
  const notes: string[] = [];
  const press = (
    key: string,
    init: KeyboardEventInit = {},
    target: EventTarget = document.body,
  ) => {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, composed: true, ...init });
    let handled = false;
    target.addEventListener(
      'keydown',
      (e) => {
        handled = handleShortcut(
          e as KeyboardEvent,
          store,
          () => closed++,
          (m) => notes.push(m),
        );
      },
      { once: true },
    );
    target.dispatchEvent(event);
    return handled;
  };
  return { store, press, closed: () => closed, notes };
}

describe('keyboard shortcuts', () => {
  it('switches tools and draw sub-tools', () => {
    const { store, press } = setup();
    press('c');
    expect(store.getState().tool).toBe('comment');
    press('d');
    press('a');
    expect(store.getState()).toMatchObject({ tool: 'draw', drawTool: 'arrow' });
    press('e');
    expect(store.getState().drawTool).toBe('eraser');
  });

  it('Escape steps back: panel → tool → browse', () => {
    const { store, press } = setup();
    store.set({ tool: 'draw', panel: 'list' });
    press('Escape');
    expect(store.getState().panel).toBe('none');
    press('Escape');
    expect(store.getState().tool).toBe('select');
    press('Escape');
    expect(store.getState().tool).toBe('browse');
    expect(press('Escape')).toBe(false);
  });

  it('undo/redo, delete and nudge the selected shape', () => {
    const { store, press } = setup();
    const shape: Shape = {
      id: 's',
      type: 'shape',
      kind: 'line',
      from: { x: 0, y: 0 },
      to: { x: 10, y: 0 },
      style: { color: '#000', width: 2, dashed: false },
      createdAt: AT,
    };
    store.addAnnotation(shape);
    store.set({ selectedId: 's' });
    press('ArrowRight', { shiftKey: true });
    expect(store.getState().doc.annotations[0]).toMatchObject({ from: { x: 10, y: 0 } });
    press('z', { metaKey: true });
    expect(store.getState().doc.annotations[0]).toMatchObject({ from: { x: 0, y: 0 } });
    press('z', { metaKey: true, shiftKey: true });
    press('Backspace');
    expect(store.getState().doc.annotations).toEqual([]);
  });

  it('ignores keys typed into fields and toggles with ⌥⇧D', () => {
    const { store, press, closed } = setup();
    const input = document.createElement('input');
    document.body.appendChild(input);
    expect(press('c', {}, input)).toBe(false);
    expect(store.getState().tool).toBe('select');
    press('D', { altKey: true, shiftKey: true });
    expect(closed()).toBe(1);
  });

  it('opens panels and toggles rulers/grid', () => {
    const { store, press } = setup();
    press('E', { shiftKey: true });
    expect(store.getState().panel).toBe('export');
    press('?');
    expect(store.getState().panel).toBe('help');
    press('m');
    press('g');
    expect(store.getState().rulers).toBe(true);
    expect(store.getState().grid.visible).toBe(true);
  });

  it('uses Figma single-key tools and remembers the last shape', () => {
    const { store, press } = setup();
    press('r');
    expect(store.getState()).toMatchObject({ tool: 'draw', drawTool: 'rect', lastShape: 'rect' });
    press('o');
    expect(store.getState()).toMatchObject({ drawTool: 'ellipse', lastShape: 'ellipse' });
    press('p');
    // The pencil is not a shape: the Shapes button keeps showing the ellipse.
    expect(store.getState()).toMatchObject({ drawTool: 'pen', lastShape: 'ellipse' });
    press('t');
    expect(store.getState().drawTool).toBe('text');
    press('v');
    expect(store.getState().tool).toBe('select');
  });

  it('Escape closes details, then the selection, then pauses', () => {
    const { store, press } = setup();
    const target = document.createElement('button');
    document.body.appendChild(target);
    store.set({ tool: 'select', pickedEl: target, showDetails: true });
    press('Escape');
    expect(store.getState()).toMatchObject({ showDetails: false, pickedEl: target });
    press('Escape');
    expect(store.getState().pickedEl).toBeNull();
    press('Escape');
    expect(store.getState().tool).toBe('browse');
  });

  it('Enter comments on the selected element', () => {
    const { store, press } = setup();
    const target = document.createElement('button');
    target.textContent = 'Start free';
    document.body.appendChild(target);
    store.set({ tool: 'select', pickedEl: target });
    expect(press('Enter')).toBe(true);
    expect(store.getState().draft?.target).toMatchObject({
      type: 'element',
      anchor: { tagName: 'button' },
    });
  });

  it('offers Undo after deleting and leaves the page its keys while paused', () => {
    const { store, press, notes } = setup();
    store.addAnnotation({
      id: 's',
      type: 'shape',
      kind: 'rect',
      rect: { x: 0, y: 0, width: 10, height: 10 },
      style: { color: '#000', width: 2, dashed: false },
      createdAt: AT,
    });
    store.set({ selectedId: 's' });
    press('Delete');
    expect(notes).toEqual(['Drawing deleted']);
    store.set({ tool: 'browse' });
    expect(press('c')).toBe(false);
    expect(press('Escape')).toBe(false);
    expect(store.getState().tool).toBe('browse');
  });

  it('opens help with ⇧/', () => {
    const { store, press } = setup();
    press('?', { shiftKey: true });
    expect(store.getState().panel).toBe('help');
  });
});
