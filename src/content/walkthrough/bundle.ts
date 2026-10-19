import { type ZipEntry, zipEntries } from '../../export/zip';
import { escapeHtml } from '../../shared/escape';
import { formatClock, type Walkthrough, type WtFrame } from '../../walkthrough/model';
import { alignTranscript, buildSummary, describeEvent } from '../../walkthrough/summary';
import type { ParsedTranscript } from '../../walkthrough/transcript';
import type { Candidate, WalkthroughResult } from './recorder';

/**
 * The walkthrough as files: each picture with the clicks and the laser drawn on (the ink and
 * pins were on screen when it was taken) and its number, a contact sheet of them all, the
 * summary for an AI agent and the walkthrough itself.
 *
 *   <folder>/summary.md         what happened (and what was said) picture by picture
 *   <folder>/walkthrough.json   everything, on one clock (src/walkthrough/model.ts)
 *   <folder>/contact-sheet.jpg  every picture, numbered
 *   <folder>/frames/frame-NN.jpg
 */

const RED = '#FF3B30';
const BLUE = '#0088FF';

function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas');
  return [canvas, ctx];
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality?: number) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode failed'))), type, quality),
  );

/** What a picture shows, in a few words (contact sheet captions). */
export function frameCaption(wt: Walkthrough, frame: WtFrame): string {
  const mark = frame.mark ? wt.marks.find((m) => m.id === frame.mark) : undefined;
  if (mark) return mark.description;
  if (frame.reason === 'click' || frame.reason === 'navigate') {
    const event = wt.events.find(
      (e) => (e.kind === 'click' || e.kind === 'navigate') && Math.abs(e.t - frame.t) < 50,
    );
    if (event) return describeEvent(event);
  }
  const words: Partial<Record<WtFrame['reason'], string>> = {
    start: 'start',
    end: 'end',
    result: 'after the click',
    scroll: 'after scrolling',
    navigate: 'new page',
    cue: 'here',
  };
  return words[frame.reason] ?? '';
}

function badge(ctx: CanvasRenderingContext2D, text: string, k: number): void {
  const size = Math.round(15 * k);
  ctx.font = `600 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.75;
  const x = Math.round(10 * k);
  const y = Math.round(10 * k);
  ctx.fillStyle = 'rgba(17, 17, 20, 0.82)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, h / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + size * 0.6, y + h / 2 + 0.5);
}

/** One picture with the click that took it and any laser drawn on, and its number. */
async function annotate(
  wt: Walkthrough,
  frame: WtFrame,
  shot: Candidate,
): Promise<HTMLCanvasElement> {
  const img = await loadImage(shot.dataUrl);
  const [canvas, ctx] = canvasOf(img.naturalWidth, img.naturalHeight);
  ctx.drawImage(img, 0, 0);
  const s = shot.scale;
  // Marks and the number stay legible when the picture is shrunk onto the contact sheet.
  const k = Math.max(1, canvas.width / 900);
  const at = (x: number, y: number): [number, number] => [
    (x - shot.scroll.x) * s,
    (y - shot.scroll.y) * s,
  ];
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const e of wt.events) {
    if (e.kind !== 'click') continue;
    const mine =
      (frame.reason === 'click' && Math.abs(e.t - frame.t) < 50) ||
      (frame.reason === 'result' && e.t <= frame.t && frame.t - e.t < 2500);
    if (!mine) continue;
    const [x, y] = at(e.point.x, e.point.y);
    ctx.fillStyle = 'rgba(0, 136, 255, 0.27)';
    ctx.beginPath();
    ctx.arc(x, y, 14 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 1.75 * k;
    ctx.strokeStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x, y, 15 * k, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = BLUE;
    ctx.beginPath();
    ctx.arc(x, y, 17.5 * k, 0, Math.PI * 2);
    ctx.stroke();
  }

  for (const mark of wt.marks) {
    if (mark.shape !== 'laser' || mark.frame !== frame.file) continue;
    const stroke = wt.strokes[mark.strokes[0]!];
    if (!stroke || stroke.points.length < 2) continue;
    const pts = stroke.points.map(([x, y]) => at(x, y));
    for (const [width, color] of [
      [9 * k, 'rgba(255, 59, 48, 0.14)'],
      [5 * k, 'rgba(255, 59, 48, 0.32)'],
      [2.2 * k, RED],
    ] as const) {
      ctx.lineWidth = width;
      ctx.strokeStyle = color;
      ctx.beginPath();
      for (const [i, [x, y]] of pts.entries()) {
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      }
      ctx.stroke();
    }
    const [tx, ty] = pts.at(-1)!;
    ctx.fillStyle = RED;
    ctx.beginPath();
    ctx.arc(tx, ty, 4 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(tx, ty, 1.6 * k, 0, Math.PI * 2);
    ctx.fill();
  }

  badge(ctx, `#${frame.index}  ${formatClock(frame.t)}`, k);
  return canvas;
}

function fitText(ctx: CanvasRenderingContext2D, text: string, width: number): string {
  if (ctx.measureText(text).width <= width) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** Every picture in a grid, each with its number, time and what it shows. */
async function contactSheet(
  wt: Walkthrough,
  pictures: { frame: WtFrame; canvas: HTMLCanvasElement }[],
): Promise<HTMLCanvasElement | null> {
  if (pictures.length === 0) return null;
  const n = pictures.length;
  const cols = n === 1 ? 1 : n <= 4 ? 2 : 3;
  const cellW = cols === 1 ? 1200 : cols === 2 ? 720 : 560;
  const gap = 16;
  const pad = 20;
  const captionH = 34;
  const first = pictures[0]!.canvas;
  const cellH = Math.round((cellW * first.height) / first.width);
  const rows = Math.ceil(n / cols);
  const [canvas, ctx] = canvasOf(
    pad * 2 + cols * cellW + (cols - 1) * gap,
    pad * 2 + rows * (cellH + captionH) + (rows - 1) * gap,
  );
  ctx.fillStyle = '#F2F2F4';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  pictures.forEach(({ frame, canvas: pic }, i) => {
    const x = pad + (i % cols) * (cellW + gap);
    const y = pad + Math.floor(i / cols) * (cellH + captionH + gap);
    const scale = Math.min(cellW / pic.width, cellH / pic.height);
    const w = pic.width * scale;
    const h = pic.height * scale;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(x, y, cellW, cellH, 8);
    ctx.clip();
    ctx.fillStyle = '#fff';
    ctx.fillRect(x, y, cellW, cellH);
    ctx.drawImage(pic, x + (cellW - w) / 2, y + (cellH - h) / 2, w, h);
    ctx.restore();
    ctx.font = '600 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#111';
    ctx.textBaseline = 'middle';
    const head = `#${frame.index} ${formatClock(frame.t)}`;
    ctx.fillText(head, x + 2, y + cellH + captionH / 2);
    const headW = ctx.measureText(head).width + 10;
    ctx.font = '15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.fillStyle = '#444';
    ctx.fillText(
      fitText(ctx, frameCaption(wt, frame), cellW - headW - 4),
      x + 2 + headW,
      y + cellH + captionH / 2,
    );
  });
  return canvas;
}

export interface BuiltBundle {
  files: ZipEntry[];
  /** The contact sheet, for previews and the clipboard. */
  sheet: { jpeg: Blob; png: Blob; url: string; width: number; height: number } | null;
}

const built = new WeakMap<WalkthroughResult, Promise<BuiltBundle>>();
const text = (s: string) => new TextEncoder().encode(s);

/** The files (made once per result). */
export function buildBundle(result: WalkthroughResult): Promise<BuiltBundle> {
  let job = built.get(result);
  if (!job) {
    job = (async () => {
      const wt = result.walkthrough;
      const pictures: { frame: WtFrame; canvas: HTMLCanvasElement }[] = [];
      for (const frame of wt.frames) {
        const shot = result.shots.get(frame.file);
        if (shot) pictures.push({ frame, canvas: await annotate(wt, frame, shot) });
      }
      const frames: ZipEntry[] = [];
      for (const p of pictures)
        frames.push({
          name: p.frame.file,
          data: new Uint8Array(await (await toBlob(p.canvas, 'image/jpeg', 0.86)).arrayBuffer()),
        });
      const sheetCanvas = await contactSheet(wt, pictures);
      let sheet: BuiltBundle['sheet'] = null;
      const files: ZipEntry[] = [
        { name: 'summary.md', data: text(result.summary) },
        { name: 'walkthrough.json', data: text(JSON.stringify(wt, null, 2)) },
      ];
      if (sheetCanvas) {
        const jpeg = await toBlob(sheetCanvas, 'image/jpeg', 0.86);
        const png = await toBlob(sheetCanvas, 'image/png');
        sheet = {
          jpeg,
          png,
          url: URL.createObjectURL(jpeg),
          width: sheetCanvas.width,
          height: sheetCanvas.height,
        };
        files.push({ name: 'contact-sheet.jpg', data: new Uint8Array(await jpeg.arrayBuffer()) });
      }
      return { files: [...files, ...frames], sheet };
    })();
    built.set(result, job);
  }
  return job;
}

export async function walkthroughZip(result: WalkthroughResult): Promise<Blob> {
  const { files } = await buildBundle(result);
  const entries = files.map((f) => ({ ...f, name: `${result.folder}/${f.name}` }));
  return new Blob([zipEntries(entries)], { type: 'application/zip' });
}

/** The summary and contact sheet on the clipboard, for an AI chat. */
export async function copyWalkthrough(result: WalkthroughResult): Promise<boolean> {
  const { sheet } = await buildBundle(result);
  const plain = new Blob([result.summary], { type: 'text/plain' });
  try {
    const items: Record<string, Blob> = { 'text/plain': plain };
    if (sheet) {
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(sheet.jpeg);
      });
      items['text/html'] = new Blob(
        [
          `<meta charset="utf-8"><img src="${escapeHtml(dataUrl)}" alt="Walkthrough contact sheet"><pre>${escapeHtml(result.summary)}</pre>`,
        ],
        { type: 'text/html' },
      );
      items['image/png'] = sheet.png;
    }
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(result.summary);
      return true;
    } catch {
      return false;
    }
  }
}

/** Add what was said (or take it away with `null`): the summary is rebuilt. */
export function withTranscript(
  result: WalkthroughResult,
  parsed: ParsedTranscript | null,
  options: { offsetMs?: number; source?: string } = {},
): WalkthroughResult {
  const { transcript: _old, ...rest } = result.walkthrough;
  const { heard: _heard, ...kept } = result;
  const walkthrough: Walkthrough = parsed
    ? { ...rest, transcript: alignTranscript(rest, parsed, options) }
    : rest;
  return {
    ...kept,
    walkthrough,
    summary: buildSummary(walkthrough),
    ...(parsed ? { heard: { parsed, name: options.source ?? parsed.format } } : {}),
  };
}

const base64Of = (bytes: Uint8Array): string => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const MIME: Record<string, string> = {
  md: 'text/markdown',
  json: 'application/json',
  jpg: 'image/jpeg',
};

/** The bundle as messages for the voice link (the bridge writes the files). */
export async function bundleForVoice(result: WalkthroughResult): Promise<{
  folder: string;
  walkthrough: Walkthrough;
  summary: string;
  files: { name: string; mime: string; base64: string }[];
}> {
  const { files } = await buildBundle(result);
  return {
    folder: result.folder,
    walkthrough: result.walkthrough,
    summary: result.summary,
    files: files
      .filter((f) => f.name !== 'summary.md' && f.name !== 'walkthrough.json')
      .map((f) => ({
        name: f.name,
        mime: MIME[f.name.split('.').at(-1) ?? ''] ?? 'application/octet-stream',
        base64: base64Of(f.data),
      })),
  };
}
