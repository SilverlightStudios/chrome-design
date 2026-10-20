// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { placeImages, placementRect } from '../src/content/images';
import { createInitialState, EditorStore, emptyDoc } from '../src/content/store';
import { messagePreview } from '../src/content/ui/format';
import { fitWithin } from '../src/shared/pixels';
import { PIXEL } from './helpers';

describe('placing images', () => {
  it('scales the longest edge down, never up', () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual([1600, 800]);
    expect(fitWithin(400, 300, 1600)).toEqual([400, 300]);
  });

  it('centres a picture on the drop point at its CSS size, capped to the viewport', () => {
    const view = { width: 1200, height: 800 };
    // A retina screenshot shows at half its pixel size.
    expect(placementRect({ width: 400, height: 200 }, { x: 600, y: 400 }, view, 2)).toEqual({
      x: 500,
      y: 350,
      width: 200,
      height: 100,
    });
    // Too big: no wider than half the viewport, proportions kept.
    const big = placementRect({ width: 3000, height: 1500 }, { x: 0, y: 0 }, view, 1);
    expect(big.width).toBe(600);
    expect(big.height).toBe(300);
  });

  it('adds placed images as one undo step and selects the last', () => {
    const store = new EditorStore(createInitialState(emptyDoc('https://x.test/', 'X')));
    store.set({ tool: 'draw' });
    const img = { name: 'a.png', src: PIXEL, width: 100, height: 50 };
    placeImages(store, [img, { ...img, name: 'b.png' }], { x: 300, y: 300 });
    const s = store.getState();
    expect(s.doc.annotations.map((a) => a.type === 'shape' && a.kind)).toEqual(['image', 'image']);
    expect(s.tool).toBe('select');
    expect(s.selectedId).toBe(s.doc.annotations[1]?.id);
    store.undo();
    expect(store.getState().doc.annotations).toHaveLength(0);
  });

  it('previews a picture-only comment by what it holds', () => {
    const att = { id: 'i', name: 'a.png', src: PIXEL, width: 1, height: 1 };
    expect(messagePreview({ id: 'm', body: 'Hi', createdAt: '', attachments: [att] })).toBe('Hi');
    expect(messagePreview({ id: 'm', body: '', createdAt: '', attachments: [att] })).toBe('Image');
    expect(messagePreview({ id: 'm', body: '', createdAt: '', attachments: [att, att] })).toBe(
      '2 images',
    );
  });
});
