import { buildAnchor } from '../capture/anchor';
import { pageFetcher } from '../capture/assets';
import { capturePage } from '../capture/capture';
import { type BuildOutput, buildHandoff, imageIndex } from '../export/build';
import { buildChatPrompt } from '../export/prompt';
import { buildZip, type ZipEntry } from '../export/zip';
import { escapeHtml } from '../shared/escape';
import type {
  Annotation,
  AnnotationDoc,
  CommentThread,
  ElementAnchor,
  FullPageShot,
  ImageShape,
} from '../shared/model';
import { isComment, isShape } from '../shared/model';
import { bytesOf, cut, decode, encode } from '../shared/pixels';
import type { ExportOptions, ExportStatus } from './context';
import { containerOfRect, elementsInRect, overlappedChildren } from './dom';
import {
  askBackground,
  backgroundFetcher,
  captureVisibleTab,
  hasExtensionRuntime,
  withPictureTurn,
} from './ext';
import type { HandoffData } from './handoff';
import { hiddenUnder, maskAnchors, redactRects } from './redact';
import { getRuntimeSource } from './runtime';
import type { EditorStore } from './store';

function anchorsOf(a: Annotation): ElementAnchor[] {
  if (isShape(a)) {
    if (a.kind !== 'image' || !a.placement) return [];
    return [...(a.placement.inside ? [a.placement.inside] : []), ...a.placement.covers];
  }
  const t = (a as CommentThread).target;
  if (t.type === 'region') return t.anchors;
  if (t.type === 'shape') return [];
  return t.anchor ? [t.anchor] : [];
}

/** Where each placed image sits on the page right now: its container and what it covers. */
export function withPlacements(doc: AnnotationDoc): AnnotationDoc {
  return {
    ...doc,
    annotations: doc.annotations.map((a): Annotation => {
      if (!isShape(a) || a.kind !== 'image') return a;
      const inside = containerOfRect(a.rect);
      // Mostly-covered elements first, then whatever else in its container it overlaps.
      const covers = [
        ...new Set([...elementsInRect(a.rect, 4), ...overlappedChildren(inside, a.rect)]),
      ]
        .filter((el) => el !== inside && el !== document.body && el !== document.documentElement)
        .slice(0, 6);
      return {
        ...a,
        placement: {
          ...(inside ? { inside: buildAnchor(inside) } : {}),
          covers: covers.map(buildAnchor),
        },
      } satisfies ImageShape;
    }),
  };
}

/** Copy in pictures that were kept as links (the site may allow it by now, or via the extension). */
async function embedLinkedImages(doc: AnnotationDoc): Promise<AnnotationDoc> {
  const cache = new Map<string, Promise<string>>();
  const embed = (src: string): Promise<string> => {
    if (src.startsWith('data:')) return Promise.resolve(src);
    let job = cache.get(src);
    if (!job) {
      job = (async () => {
        for (const fetcher of [pageFetcher, backgroundFetcher]) {
          const result = await fetcher(src, 20 * 1024 * 1024).catch(() => null);
          if (result?.ok && result.mime.startsWith('image/')) return result.dataUrl;
        }
        return src;
      })();
      cache.set(src, job);
    }
    return job;
  };
  const annotations = await Promise.all(
    doc.annotations.map(async (a): Promise<Annotation> => {
      if (isShape(a)) return a.kind === 'image' ? { ...a, src: await embed(a.src) } : a;
      if (!isComment(a)) return a;
      const messages = await Promise.all(
        a.messages.map(async (m) =>
          m.attachments?.length
            ? {
                ...m,
                attachments: await Promise.all(
                  m.attachments.map(async (att) => ({ ...att, src: await embed(att.src) })),
                ),
              }
            : m,
        ),
      );
      return { ...a, messages };
    }),
  );
  return { ...doc, annotations };
}

/** The screenshot is kept this wide at most, so the handoff stays reasonably small. */
const SCREENSHOT_WIDTH = 1600;
const MAX_SCREENS = 16;
/** The full-page picture is kept this wide at most. */
const FULL_PAGE_WIDTH = 1280;

/**
 * The whole page, top to bottom, with the feedback drawn on: scroll a screen at a time and
 * capture each (the toolbar and panels are hidden, drawings and pins stay), stitched in the
 * service worker. Fixed and sticky page parts are hidden after the first screen so headers
 * aren't repeated. Extension only.
 */
async function captureFullPage(
  host: HTMLElement,
  onProgress: (done: number, total: number) => void,
): Promise<FullPageShot | null> {
  const root = document.documentElement;
  const view = { width: root.clientWidth || window.innerWidth, height: window.innerHeight };
  const pageH = Math.max(root.scrollHeight, document.body?.scrollHeight ?? 0);
  const total = Math.min(MAX_SCREENS, Math.ceil(pageH / view.height));
  const width = Math.min(FULL_PAGE_WIDTH, view.width);
  const scale = width / view.width;
  const start = { x: window.scrollX, y: window.scrollY };
  const behavior = root.style.scrollBehavior;
  root.style.scrollBehavior = 'auto';
  host.setAttribute('data-capturing', '');
  const hidden: { el: HTMLElement; value: string; priority: string }[] = [];
  let lastY = 0;
  try {
    await askBackground('cd:full-page-start', {
      width,
      height: Math.min(pageH, total * view.height) * scale,
      scale,
    });
    for (let i = 0; i < total; i++) {
      window.scrollTo(0, i * view.height);
      if (i === 1) {
        for (const el of Array.from(document.body?.querySelectorAll<HTMLElement>('*') ?? [])) {
          if (el.localName.startsWith('chrome-design')) continue;
          const position = getComputedStyle(el).position;
          if (position !== 'fixed' && position !== 'sticky') continue;
          hidden.push({
            el,
            value: el.style.getPropertyValue('visibility'),
            priority: el.style.getPropertyPriority('visibility'),
          });
          el.style.setProperty('visibility', 'hidden', 'important');
        }
      }
      lastY = window.scrollY;
      const screen = await withPictureTurn(undefined, () =>
        askBackground('cd:full-page-screen', {
          y: lastY,
          view: { ...view, innerWidth: window.innerWidth || view.width },
        }),
      );
      if (!screen?.ok) return null;
      onProgress(i + 1, total);
    }
  } finally {
    for (const h of hidden) h.el.style.setProperty('visibility', h.value, h.priority);
    window.scrollTo(start.x, start.y);
    root.style.scrollBehavior = behavior;
    host.removeAttribute('data-capturing');
  }
  return askBackground('cd:full-page-finish', {
    height: Math.min(pageH, lastY + view.height),
  });
}

/**
 * Each placed image as it sits on the page: a crop of the full-page picture around it, so an
 * agent sees the picture in its place without hunting through a tall screenshot.
 */
async function contextCrops(out: BuildOutput, shot: FullPageShot): Promise<ZipEntry[]> {
  const page = await decode(shot.dataUrl);
  const crops: ZipEntry[] = [];
  for (const entry of out.payload.images) {
    if (entry.kind !== 'placed' || !entry.rect) continue;
    const r = entry.rect;
    const margin = Math.max(160, Math.max(r.width, r.height) * 0.5);
    const x0 = Math.max(0, (r.x - margin) * shot.scale);
    const y0 = Math.max(0, (r.y - margin) * shot.scale);
    const x1 = Math.min(shot.width, (r.x + r.width + margin) * shot.scale);
    const y1 = Math.min(shot.height, (r.y + r.height + margin) * shot.scale);
    if (x1 - x0 < 8 || y1 - y0 < 8) continue;
    const crop = cut(page, [x0, y0, x1 - x0, y1 - y0]);
    crops.push({
      name: entry.file.replace(/\.[a-z0-9]+$/i, '-in-context.jpg'),
      data: await bytesOf(await encode(crop, 'image/jpeg', 0.85)),
    });
  }
  page.close();
  return crops;
}

/** The drawings and comment pins as they'd show in a picture of the page. */
function pictureKey(annotations: readonly Annotation[]): string {
  return JSON.stringify(
    annotations.map((a) => {
      if (!isShape(a)) return { id: a.id, target: a.target, status: a.status };
      if (a.kind !== 'image') return a;
      const { placement: _placement, ...shape } = a;
      return shape;
    }),
  );
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  a.setAttribute('data-chrome-design-ignore', '');
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function downloadText(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: 'text/html;charset=utf-8' }));
}

const STAGE_LABEL: Record<string, string> = {
  styles: 'Reading stylesheets…',
  assets: 'Embedding assets…',
  snapshot: 'Serializing page…',
  screenshot: 'Taking screenshot…',
  done: 'Building file…',
};

/** Everything the exporter must leave out of the page copy: this UI and the handoff wrapper. */
function skipFor(host: HTMLElement) {
  return (node: Node) =>
    node === host ||
    (node instanceof Element &&
      (node.hasAttribute('data-chrome-design-ignore') || node.hasAttribute('data-chrome-design')));
}

/**
 * Build and download the handoff. On a live page that means copying the page; inside a shared
 * handoff file (`handoff`) the page is already a copy, so its original facts, screenshot and
 * source are carried over and only the feedback is new.
 */
export async function runExport(
  host: HTMLElement,
  store: EditorStore,
  options: ExportOptions,
  onStatus: (status: ExportStatus) => void,
  handoff?: HandoffData,
): Promise<void> {
  try {
    const s = store.getState();
    onStatus({ phase: 'working', label: 'Reading stylesheets…' });
    const boxes = redactRects(s.doc);
    const doc = maskAnchors(withPlacements(await embedLinkedImages(s.doc)), boxes);
    const anchors = doc.annotations.flatMap(anchorsOf);
    const hidden = boxes.length ? hiddenUnder(boxes, skipFor(host)) : undefined;
    const progress = (stage: string, detail?: string) =>
      onStatus({
        phase: 'working',
        label: `${STAGE_LABEL[stage] ?? stage}${detail ? ` ${detail}` : ''}`,
      });
    const { capture, refs } = handoff
      ? await capturePage({
          skip: skipFor(host),
          anchors,
          fetchers: [pageFetcher],
          includeSource: false,
          meta: handoff.payload.page,
          onProgress: progress,
          ...(hidden ? { hidden } : {}),
        })
      : await capturePage({
          skip: skipFor(host),
          anchors,
          fetchers: [pageFetcher, backgroundFetcher],
          includeSource: options.includeSource,
          onProgress: progress,
          ...(hidden ? { hidden } : {}),
          ...(options.includeScreenshot
            ? {
                // Toolbar and panels hidden, the feedback visible: as the designer saw it.
                screenshot: () => captureVisibleTab(host, SCREENSHOT_WIDTH),
              }
            : {}),
        });
    if (handoff) {
      capture.sourceHtml = handoff.source;
      if (handoff.screenshot) capture.screenshot = handoff.screenshot;
      // The full-page picture shows the feedback as exported; keep it only while that's true.
      if (
        handoff.fullPage &&
        pictureKey(handoff.payload.annotations) === pictureKey(s.doc.annotations)
      )
        capture.fullPage = handoff.fullPage;
    } else if (options.includeScreenshot && hasExtensionRuntime()) {
      const full = await captureFullPage(host, (done, total) =>
        onStatus({ phase: 'working', label: `Taking screenshot… ${done}/${total}` }),
      ).catch(() => null);
      if (full) capture.fullPage = full;
    }
    if (boxes.length) {
      // The page code is the unsanitized original: with parts hidden, it stays out.
      if (capture.sourceHtml)
        capture.warnings.push({
          code: 'source-left-out',
          message: 'The page code was left out because parts of the page are hidden.',
        });
      capture.sourceHtml = '';
    }
    onStatus({ phase: 'working', label: 'Building file…' });
    const runtime = await getRuntimeSource();
    const out = await buildHandoff({
      capture,
      doc,
      refs,
      grid: s.grid,
      ...(runtime ? { runtime } : {}),
    });
    let filename = out.filename;
    let bytes = out.bytes;
    if (options.format === 'zip') {
      const crops = capture.fullPage ? await contextCrops(out, capture.fullPage) : [];
      const zip = buildZip(out, capture, crops);
      filename = out.filename.replace(/\.html$/, '.zip');
      bytes = zip.size;
      downloadBlob(filename, zip);
    } else {
      downloadText(filename, out.html);
    }
    onStatus({ phase: 'done', filename, bytes, warnings: capture.warnings });
  } catch (error) {
    console.error('[Chrome Design] export failed', error);
    onStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Copy the feedback for an AI chat: the instructions and every comment, drawing and placed
 * image (with where it sits) as text, plus an HTML version carrying the pictures for editors
 * that take them. False when the clipboard refuses.
 */
export async function copyForAi(store: EditorStore, handoff?: HandoffData): Promise<boolean> {
  const s = store.getState();
  const boxes = redactRects(s.doc);
  const doc = maskAnchors(withPlacements(s.doc), boxes);
  const meta = handoff?.payload.page ?? {
    url: location.href,
    title: document.title,
    viewport: {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
  };
  const images = imageIndex(doc.annotations);
  const text = buildChatPrompt(doc, meta, images);
  const srcs = new Map<string, string>();
  for (const a of doc.annotations) {
    if (isShape(a) && a.kind === 'image') srcs.set(a.id, a.src);
    if (isComment(a))
      for (const m of a.messages) for (const att of m.attachments ?? []) srcs.set(att.id, att.src);
  }
  const pictures = images
    .map((i) => ({ name: i.file, src: srcs.get(i.attachmentId ?? i.annotationId) ?? '' }))
    .filter((p) => p.src.startsWith('data:image/'))
    .map(
      (p) =>
        `<figure><img src="${escapeHtml(p.src)}" alt="${escapeHtml(p.name)}"><figcaption>${escapeHtml(p.name)}</figcaption></figure>`,
    )
    .join('');
  const html = `<meta charset="utf-8"><pre>${escapeHtml(text)}</pre>${pictures}`;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        'text/plain': new Blob([text], { type: 'text/plain' }),
        'text/html': new Blob([html], { type: 'text/html' }),
      }),
    ]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  }
}
