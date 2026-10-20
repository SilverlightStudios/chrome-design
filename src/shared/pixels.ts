import { arrayBufferToBase64 } from './base64';

/**
 * The one way pictures are read, resized and written: on an OffscreenCanvas, so the same code
 * runs on the page and in the service worker (which takes the heavy work: walkthrough
 * pictures, crops and contact sheets, screenshots, the full-page picture).
 */

export type Canvas = OffscreenCanvas;
export type Context = OffscreenCanvasRenderingContext2D;
export type Picture = ImageBitmap | OffscreenCanvas;

export function canvasOf(width: number, height: number): [Canvas, Context] {
  const canvas = new OffscreenCanvas(
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
  );
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  return [canvas, ctx];
}

/** A picture from a Blob or a data: URL. */
export async function decode(src: Blob | string): Promise<ImageBitmap> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob);
}

/** Scale (w, h) down so the longest edge is at most `max`. */
export function fitWithin(width: number, height: number, max: number): [number, number] {
  const scale = Math.min(1, max / Math.max(width, height, 1));
  return [Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale))];
}

/** The picture at most `maxWidth` wide (the same canvas when it already is). */
export function scaled(picture: Picture, maxWidth: number): Picture {
  if (picture.width <= maxWidth) return picture;
  const [canvas, ctx] = canvasOf(maxWidth, (picture.height * maxWidth) / picture.width);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** A part of the picture (`[x, y, w, h]` in its pixels) as its own canvas. */
export function cut(picture: Picture, [x, y, w, h]: [number, number, number, number]): Canvas {
  const [canvas, ctx] = canvasOf(w, h);
  ctx.drawImage(picture, x, y, w, h, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/** The picture as a canvas (itself when it is one). */
function asCanvas(picture: Picture): Canvas {
  if (picture instanceof OffscreenCanvas) return picture;
  const [canvas, ctx] = canvasOf(picture.width, picture.height);
  ctx.drawImage(picture, 0, 0);
  return canvas;
}

export function pixelsOf(picture: Picture): { rgba: Uint8ClampedArray; w: number; h: number } {
  const canvas = asCanvas(picture);
  const ctx = canvas.getContext('2d') as Context;
  return {
    rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
    w: canvas.width,
    h: canvas.height,
  };
}

/** JPEG (at `quality`), PNG, or WebP; a browser that can't write WebP hands back PNG. */
export function encode(picture: Picture, type = 'image/jpeg', quality = 0.86): Promise<Blob> {
  return asCanvas(picture).convertToBlob({ type, quality });
}

export async function dataUrlOf(blob: Blob): Promise<string> {
  return `data:${blob.type};base64,${arrayBufferToBase64(await blob.arrayBuffer())}`;
}

export async function bytesOf(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}
