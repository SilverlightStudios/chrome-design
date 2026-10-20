import { pageFetcher } from '../capture/assets';
import { createId, nowIso } from '../shared/ids';
import type { ImageAttachment, ImageShape, Point, Rect } from '../shared/model';
import { type Canvas, canvasOf, dataUrlOf, encode, fitWithin, pixelsOf } from '../shared/pixels';
import { backgroundFetcher } from './ext';
import type { EditorStore } from './store';

/**
 * Pictures the designer brings in: dropped or pasted onto the page (placed like on a canvas)
 * or attached to a comment. Everything is stored with the annotations as data URLs, so big
 * photos and retina screenshots are scaled down first to keep storage and exports small.
 */

/** Longest edge kept, in image pixels (sharp at 2× for anything up to 800 CSS px). */
export const MAX_IMAGE_EDGE = 1600;
const MAX_FILE_BYTES = 40 * 1024 * 1024;

export interface LoadedImage {
  name: string;
  src: string;
  width: number;
  height: number;
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

/** Image files carried by a drop or a paste. */
export function imageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  return Array.from(data.files).filter(isImageFile);
}

/** Whether a drag carries files (their types aren't readable until the drop). */
export function dragHasFiles(data: DataTransfer | null): boolean {
  return !!data && Array.from(data.types).includes('Files');
}

/** Whether a drag may carry a picture: files, or an image/link dragged from another page. */
export function dragHasImage(data: DataTransfer | null): boolean {
  if (!data) return false;
  const types = new Set(data.types);
  return types.has('Files') || types.has('text/uri-list') || types.has('text/html');
}

const URL_RE = /^(https?:\/\/\S+|data:image\/[\w.+-]+[;,]\S+)$/i;

/** A pasted or dropped string that is just a link (http(s) or a data:image URL). */
export function asImageLink(text: string): string | null {
  const t = text.trim();
  return URL_RE.test(t) ? t : null;
}

/**
 * Picture links in a drop or paste from another page: an <img> in the dragged HTML first
 * (dragging an image inside a link carries the link too), then the URL list, then plain text.
 */
export function imageUrls(data: DataTransfer | null): string[] {
  if (!data) return [];
  const urls: string[] = [];
  const html = data.getData('text/html');
  if (html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const img of Array.from(doc.images)) {
      const src = img.getAttribute('src');
      if (src && asImageLink(src)) urls.push(src);
    }
  }
  if (urls.length === 0) {
    for (const line of data.getData('text/uri-list').split(/\r?\n/)) {
      const link = !line.startsWith('#') && asImageLink(line);
      if (link) urls.push(link);
    }
  }
  if (urls.length === 0) {
    const link = asImageLink(data.getData('text/plain'));
    if (link) urls.push(link);
  }
  return [...new Set(urls)];
}

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function decode(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

/**
 * Read an image file into a data URL no larger than MAX_IMAGE_EDGE. Small files and GIFs are
 * kept as they are (a GIF keeps its animation); the rest are re-encoded (JPEG stays JPEG,
 * anything that may be transparent becomes WebP, or PNG where the browser can't write WebP).
 */
export async function loadImageFile(file: File): Promise<LoadedImage> {
  if (!isImageFile(file) || file.size > MAX_FILE_BYTES) throw new Error('Not a usable image');
  const original = await readAsDataUrl(file);
  return fromDataUrl(file, original);
}

async function fromDataUrl(file: File, original: string): Promise<LoadedImage> {
  const img = await decode(original);
  const w = img.naturalWidth || 300;
  const h = img.naturalHeight || 150;
  const name = file.name || 'Image';
  const keep =
    file.type === 'image/gif' ||
    file.type === 'image/svg+xml' ||
    (Math.max(w, h) <= MAX_IMAGE_EDGE && file.size <= 400 * 1024);
  if (keep) return { name, src: original, width: w, height: h };

  const [tw, th] = fitWithin(w, h, MAX_IMAGE_EDGE);
  const [canvas, ctx] = canvasOf(tw, th);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, tw, th);
  let blob = await (file.type === 'image/jpeg'
    ? encode(canvas, 'image/jpeg', 0.86)
    : encode(canvas, 'image/webp', 0.88));
  // Safari can't encode WebP and hands back a (large) PNG: use JPEG when nothing is see-through.
  if (blob.type === 'image/png' && isOpaque(canvas))
    blob = await encode(canvas, 'image/jpeg', 0.86);
  return { name, src: await dataUrlOf(blob), width: tw, height: th };
}

/** Whether a picture has no transparent pixels (checked on a small copy). */
function isOpaque(picture: Canvas): boolean {
  const [probe, ctx] = canvasOf(64, 64);
  ctx.drawImage(picture, 0, 0, 64, 64);
  const { rgba } = pixelsOf(probe);
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i]! < 255) return false;
  return true;
}

function dataUrlToFile(dataUrl: string, name: string): File | null {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) return null;
  const [, mime = '', b64, body = ''] = match;
  try {
    const bytes = b64
      ? Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
      : new TextEncoder().encode(decodeURIComponent(body));
    return new File([bytes], name, { type: mime });
  } catch {
    return null;
  }
}

function nameFromUrl(url: string): string {
  if (url.startsWith('data:')) return 'Pasted image';
  try {
    const last = new URL(url).pathname.split('/').findLast((part) => part.length > 0);
    return last ? decodeURIComponent(last).slice(0, 80) : new URL(url).hostname;
  } catch {
    return 'Image';
  }
}

/**
 * A picture from a link (dragged from another site, or a pasted URL). It's copied in when the
 * site allows it (CORS, or the extension may read that site); otherwise it's kept as the link,
 * shown live on the page and embedded at export time if it can be by then.
 */
export async function loadImageUrl(url: string): Promise<LoadedImage> {
  const name = nameFromUrl(url);
  if (url.startsWith('data:')) {
    const file = dataUrlToFile(url, name);
    if (!file || !isImageFile(file)) throw new Error('Not an image');
    return fromDataUrl(file, url);
  }
  for (const fetcher of [pageFetcher, backgroundFetcher]) {
    try {
      const result = await fetcher(url, MAX_FILE_BYTES);
      if (!result.ok || !result.mime.startsWith('image/')) continue;
      const file = dataUrlToFile(result.dataUrl, name);
      if (file) return await fromDataUrl(file, result.dataUrl);
    } catch {
      // try the next way in
    }
  }
  const img = await decode(url);
  return { name, src: url, width: img.naturalWidth || 300, height: img.naturalHeight || 150 };
}

export async function loadImageUrls(urls: string[]): Promise<LoadedImage[]> {
  const loaded = await Promise.allSettled(urls.map(loadImageUrl));
  return loaded.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

export async function loadImageFiles(files: File[]): Promise<LoadedImage[]> {
  const loaded = await Promise.allSettled(files.map(loadImageFile));
  return loaded.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

export function toAttachment(img: LoadedImage): ImageAttachment {
  return { id: createId('i'), name: img.name, src: img.src, width: img.width, height: img.height };
}

function viewport(): { width: number; height: number } {
  return {
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

/**
 * Where a picture lands: centred on `at` (page space), at its natural CSS size (retina
 * screenshots count as 2×) but never wider than half the viewport (80% on a phone) or taller
 * than 60% of it.
 */
export function placementRect(
  img: Pick<LoadedImage, 'width' | 'height'>,
  at: Point,
  view = viewport(),
  dpr = window.devicePixelRatio || 1,
): Rect {
  const density = Math.max(1, Math.min(dpr, 2));
  const natural = { w: img.width / density, h: img.height / density };
  const maxWidth = view.width * (view.width < 600 ? 0.8 : 0.5);
  const scale = Math.min(1, maxWidth / natural.w, (view.height * 0.6) / natural.h);
  const width = Math.max(24, Math.round(natural.w * scale));
  const height = Math.max(24, Math.round(natural.h * scale));
  return { x: Math.round(at.x - width / 2), y: Math.round(at.y - height / 2), width, height };
}

/** The middle of what's on screen, in page space. */
export function viewportCentre(): Point {
  const v = viewport();
  return { x: window.scrollX + v.width / 2, y: window.scrollY + v.height / 2 };
}

/**
 * Put pictures on the page around `at` (a little cascade when there are several), then hand
 * back the Select tool with the last one selected, ready to move or resize.
 */
export function placeImages(store: EditorStore, images: LoadedImage[], at: Point): void {
  if (images.length === 0) return;
  const s = store.getState();
  const shapes: ImageShape[] = images.map((img, i) => ({
    id: createId('s'),
    type: 'shape',
    kind: 'image',
    style: { ...s.style },
    createdAt: nowIso(),
    name: img.name,
    src: img.src,
    rect: placementRect(img, { x: at.x + i * 24, y: at.y + i * 24 }),
  }));
  store.commit((doc) => ({ ...doc, annotations: [...doc.annotations, ...shapes] }));
  store.set({
    tool: 'select',
    selectedId: shapes[shapes.length - 1]!.id,
    pickedEl: null,
    pickedRegion: null,
    hoverEl: null,
    draft: null,
    openThreadId: null,
  });
}

/** Open the system picker for images (works on iPhone, where nothing can be dragged in). */
export function pickImageFiles(multiple = true): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.multiple = multiple;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}

/** Pick images from the system picker and place them in the middle of the screen. */
export async function placeImagesFromPicker(
  store: EditorStore,
  onError?: (message: string) => void,
): Promise<void> {
  const files = await pickImageFiles();
  if (files.length === 0) return;
  const images = await loadImageFiles(files);
  if (images.length) placeImages(store, images, viewportCentre());
  else onError?.('That image couldn’t be opened');
}
