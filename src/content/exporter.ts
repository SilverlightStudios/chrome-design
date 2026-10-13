import { buildAnchor } from '../capture/anchor';
import { pageFetcher } from '../capture/assets';
import { capturePage } from '../capture/capture';
import { buildHandoff } from '../export/build';
import { buildZip } from '../export/zip';
import type {
  Annotation,
  AnnotationDoc,
  CommentThread,
  ElementAnchor,
  ImageShape,
} from '../shared/model';
import { isComment, isShape } from '../shared/model';
import type { ExportOptions, ExportStatus } from './context';
import { containerOfRect, elementsInRect, overlappedChildren } from './dom';
import { backgroundFetcher, captureVisibleTab } from './ext';
import type { HandoffData } from './handoff';
import { getRuntimeSource } from './runtime';
import type { EditorStore } from './store';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

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
function withPlacements(doc: AnnotationDoc): AnnotationDoc {
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

/** Downscale a screenshot so the handoff stays reasonably small. */
async function shrinkScreenshot(
  dataUrl: string,
  maxWidth = 1600,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const width = Math.round(img.naturalWidth * scale);
  const height = Math.round(img.naturalHeight * scale);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return { dataUrl, width: img.naturalWidth, height: img.naturalHeight };
  ctx.drawImage(img, 0, 0, width, height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.86), width, height };
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
    const doc = withPlacements(await embedLinkedImages(s.doc));
    const anchors = doc.annotations.flatMap(anchorsOf);
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
        })
      : await capturePage({
          skip: skipFor(host),
          anchors,
          fetchers: [pageFetcher, backgroundFetcher],
          includeSource: options.includeSource,
          onProgress: progress,
          ...(options.includeScreenshot
            ? {
                screenshot: async () => {
                  // Hide toolbar/panels but keep annotations visible, as the designer saw them.
                  host.setAttribute('data-capturing', '');
                  await nextFrame();
                  await nextFrame();
                  await new Promise((r) => setTimeout(r, 60));
                  try {
                    const shot = await captureVisibleTab();
                    return shot ? await shrinkScreenshot(shot) : null;
                  } finally {
                    host.removeAttribute('data-capturing');
                  }
                },
              }
            : {}),
        });
    if (handoff) {
      capture.sourceHtml = handoff.source;
      if (handoff.screenshot) capture.screenshot = handoff.screenshot;
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
      const zip = buildZip(out, capture);
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
