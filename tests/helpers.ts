import type { AssetFetcher } from '../src/capture/assets';
import type { AnnotationDoc, CommentThread, Shape } from '../src/shared/model';

export const AT = '2026-10-11T12:00:00.000Z';

/** A 1×1 PNG. */
export const PIXEL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Fake network: serves fixed bodies for known URLs, fails everything else. */
export function fakeFetcher(files: Record<string, { body: string; mime: string }>): AssetFetcher {
  return async (url) => {
    const file = files[url];
    if (!file) return { ok: false, error: 'blocked (CORS)' };
    const b64 = Buffer.from(file.body, 'utf8').toString('base64');
    return {
      ok: true,
      dataUrl: `data:${file.mime};base64,${b64}`,
      bytes: file.body.length,
      mime: file.mime,
    };
  };
}

export function sampleDoc(url: string): AnnotationDoc {
  const comment: CommentThread = {
    id: 'c1',
    type: 'comment',
    number: 1,
    intent: 'change',
    status: 'open',
    target: {
      type: 'element',
      point: { x: 40, y: 30 },
      anchor: {
        selector: '#hero-title',
        path: 'main > h1#hero-title',
        tagName: 'h1',
        id: 'hero-title',
        classList: [],
        rect: { x: 20, y: 20, width: 400, height: 48 },
        styles: { 'font-size': '32px' },
        text: 'Welcome',
      },
    },
    messages: [{ id: 'm1', body: 'Make the headline bigger and </script> bolder', createdAt: AT }],
    createdAt: AT,
    updatedAt: AT,
  };
  const decision: CommentThread = {
    id: 'c2',
    type: 'comment',
    number: 2,
    intent: 'decision',
    status: 'open',
    target: { type: 'region', rect: { x: 0, y: 100, width: 300, height: 200 }, anchors: [] },
    messages: [
      {
        id: 'm2',
        body: 'Keep the brand blue here.',
        createdAt: AT,
        attachments: [{ id: 'i1', name: 'brand.png', src: PIXEL, width: 1, height: 1 }],
      },
    ],
    createdAt: AT,
    updatedAt: AT,
  };
  const arrow: Shape = {
    id: 's1',
    type: 'shape',
    kind: 'arrow',
    from: { x: 10, y: 200 },
    to: { x: 60, y: 60 },
    style: { color: '#ef4444', width: 3, dashed: false },
    createdAt: AT,
  };
  const pen: Shape = {
    id: 's2',
    type: 'shape',
    kind: 'pen',
    points: [
      { x: 1, y: 1 },
      { x: 5, y: 9 },
      { x: 9, y: 2 },
    ],
    style: { color: '#3b82f6', width: 2, dashed: true },
    createdAt: AT,
  };
  const mockup: Shape = {
    id: 's3',
    type: 'shape',
    kind: 'image',
    name: 'hero-mockup.png',
    src: PIXEL,
    rect: { x: 500, y: 40, width: 240, height: 160 },
    style: { color: '#3b82f6', width: 3, dashed: false },
    createdAt: AT,
  };
  return {
    url,
    title: 'Fixture',
    brief: 'Tighten the hero.',
    annotations: [comment, decision, arrow, pen, mockup],
    guides: [],
    updatedAt: AT,
  };
}
