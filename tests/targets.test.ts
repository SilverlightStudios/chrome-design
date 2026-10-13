// @vitest-environment jsdom
import Ajv2020 from 'ajv/dist/2020';
import { describe, expect, it } from 'vitest';
import { createInitialState, EditorStore } from '../src/content/store';
import { buildHandoff } from '../src/export/build';
import { translateShape } from '../src/shared/geometry';
import type { CommentThread, ImageShape, PageCapture } from '../src/shared/model';
import { handoffSchema } from '../src/shared/schema';
import { spotIn, storedTargetPoint } from '../src/shared/targets';
import { AT, PIXEL } from './helpers';

const image: ImageShape = {
  id: 'img',
  type: 'shape',
  kind: 'image',
  name: 'Card.png',
  src: PIXEL,
  rect: { x: 100, y: 100, width: 200, height: 100 },
  style: { color: '#000', width: 2, dashed: false },
  createdAt: AT,
};

const onImage: CommentThread = {
  id: 'c-img',
  type: 'comment',
  number: 1,
  intent: 'change',
  status: 'open',
  target: {
    type: 'shape',
    shapeId: 'img',
    at: spotIn(image, { x: 300, y: 100 }),
    point: { x: 300, y: 100 },
  },
  messages: [{ id: 'm', body: 'Use this card for the team plan', createdAt: AT }],
  createdAt: AT,
  updatedAt: AT,
};

describe('comments on placed things', () => {
  it('keep their spot within the image as it moves and scales', () => {
    expect(onImage.target).toMatchObject({ at: { x: 1, y: 0 } });
    const moved = translateShape(image, 50, 20);
    expect(storedTargetPoint(onImage.target, [moved])).toEqual({ x: 350, y: 120 });
    const bigger = { ...image, rect: { ...image.rect, width: 400 } };
    expect(storedTargetPoint(onImage.target, [bigger])).toEqual({ x: 500, y: 100 });
  });

  it('stay on the page where they were when the image is deleted (undoably)', () => {
    const store = new EditorStore(
      createInitialState({
        url: 'https://x.test/',
        title: 'X',
        brief: '',
        annotations: [translateShape(image, 10, 0), onImage],
        guides: [],
        updatedAt: AT,
      }),
    );
    store.removeAnnotations(['img']);
    const left = store.getState().doc.annotations;
    expect(left).toHaveLength(1);
    expect((left[0] as CommentThread).target).toEqual({ type: 'point', point: { x: 310, y: 100 } });
    store.undo();
    expect((store.getState().doc.annotations[1] as CommentThread).target.type).toBe('shape');
  });

  it('are exported as being on the picture, schema-valid', async () => {
    const capture: PageCapture = {
      meta: {
        url: 'https://x.test/',
        title: 'X',
        lang: 'en',
        charset: 'UTF-8',
        capturedAt: AT,
        timeZone: 'UTC',
        userAgent: 't',
        colorScheme: 'light',
        viewport: { width: 1000, height: 800, devicePixelRatio: 1 },
        scroll: { x: 0, y: 0 },
        document: { width: 1000, height: 800 },
      },
      snapshotHtml: '<!DOCTYPE html>\n<html><head></head><body></body></html>',
      sourceHtml: '',
      sanitize: { scripts: 0, eventHandlers: 0, javascriptUrls: 0, frames: 0, embeds: 0, other: 0 },
      assets: { embedded: 0, embeddedBytes: 0, failed: 0 },
      warnings: [],
    };
    const out = await buildHandoff({
      capture,
      doc: {
        url: 'https://x.test/',
        title: 'X',
        brief: '',
        annotations: [image, onImage],
        guides: [],
        updatedAt: AT,
      },
      exportedAt: AT,
    });
    expect(out.html).toContain(
      '#1 Change request (open) on placed image images/placed-01-card.png ("Card.png")',
    );
    expect(out.html).toContain('comment #1 is on it');
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    expect(ajv.validate(handoffSchema, out.payload)).toBe(true);
  });
});
