import { pageFetcher } from '../capture/assets';
import { capturePage } from '../capture/capture';
import { buildHandoff } from '../export/build';
import type { CommentThread, ElementAnchor } from '../shared/model';
import { isComment } from '../shared/model';
import type { ExportOptions, ExportStatus } from './context';
import { backgroundFetcher, captureVisibleTab } from './ext';
import type { EditorStore } from './store';

const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

function anchorsOf(thread: CommentThread): ElementAnchor[] {
  const t = thread.target;
  if (t.type === 'region') return t.anchors;
  return t.anchor ? [t.anchor] : [];
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

export function downloadText(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/html;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.documentElement.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const STAGE_LABEL: Record<string, string> = {
  styles: 'Reading stylesheets…',
  assets: 'Embedding assets…',
  snapshot: 'Serializing page…',
  screenshot: 'Taking screenshot…',
  done: 'Building file…',
};

export async function runExport(
  host: HTMLElement,
  store: EditorStore,
  options: ExportOptions,
  onStatus: (status: ExportStatus) => void,
): Promise<void> {
  try {
    const s = store.getState();
    const doc = s.doc;
    const anchors = doc.annotations.filter(isComment).flatMap(anchorsOf);
    const { capture, refs } = await capturePage({
      skip: (node) => node === host,
      anchors,
      fetchers: [pageFetcher, backgroundFetcher],
      includeSource: options.includeSource,
      onProgress: (stage, detail) =>
        onStatus({
          phase: 'working',
          label: `${STAGE_LABEL[stage] ?? stage}${detail ? ` ${detail}` : ''}`,
        }),
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
    onStatus({ phase: 'working', label: 'Building file…' });
    const out = await buildHandoff({ capture, doc, refs, grid: s.grid });
    downloadText(out.filename, out.html);
    onStatus({
      phase: 'done',
      filename: out.filename,
      bytes: out.bytes,
      warnings: capture.warnings,
    });
  } catch (error) {
    console.error('[Chrome Design] export failed', error);
    onStatus({ phase: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}
