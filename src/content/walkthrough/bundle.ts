import { type ZipEntry, zipEntries } from '../../export/zip';
import { escapeHtml } from '../../shared/escape';
import { formatClock, type Walkthrough, type WtFrame } from '../../walkthrough/model';
import {
  alignTranscript,
  buildSummary,
  contextLine,
  recordedLine,
  type TimelineEntry,
  timeline,
  untimedSpeech,
  voiceLine,
} from '../../walkthrough/summary';
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

/**
 * One picture with the click that took it and any laser drawn on, and its number; cut to
 * `crop` (CSS px of the viewport) when given, the marks redrawn at the crop's place.
 */
async function annotate(
  wt: Walkthrough,
  frame: WtFrame,
  shot: Candidate,
  crop?: { x: number; y: number; width: number; height: number },
): Promise<HTMLCanvasElement> {
  const img = await loadImage(shot.dataUrl);
  const s = shot.scale;
  const sx = crop ? Math.max(0, Math.round(crop.x * s)) : 0;
  const sy = crop ? Math.max(0, Math.round(crop.y * s)) : 0;
  const w = crop ? Math.min(img.naturalWidth - sx, Math.round(crop.width * s)) : img.naturalWidth;
  const h = crop
    ? Math.min(img.naturalHeight - sy, Math.round(crop.height * s))
    : img.naturalHeight;
  const [canvas, ctx] = canvasOf(w, h);
  ctx.drawImage(img, sx, sy, w, h, 0, 0, w, h);
  // Marks and the number stay legible when the picture is shrunk onto the contact sheet.
  const k = Math.max(1, canvas.width / 900);
  const at = (x: number, y: number): [number, number] => [
    (x - shot.scroll.x) * s - sx,
    (y - shot.scroll.y) * s - sy,
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

/** Full pictures are kept at most this wide (crops keep the captured resolution). */
const FULL_EDGE = 1600;

function downscale(canvas: HTMLCanvasElement, max: number): HTMLCanvasElement {
  if (canvas.width <= max) return canvas;
  const [out, ctx] = canvasOf(max, (canvas.height * max) / canvas.width);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(canvas, 0, 0, out.width, out.height);
  return out;
}

const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';

/** Words wrapped to `width`, at most `max` lines (the last ends in … when cut). */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i]!;
    if (ctx.measureText(next).width <= width || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = words[i]!;
    if (lines.length === max) {
      let last = lines[max - 1]!;
      while (last && ctx.measureText(`${last}…`).width > width) last = last.slice(0, -1);
      lines[max - 1] = `${last.trimEnd()}…`;
      return lines;
    }
  }
  if (line) lines.push(line);
  return lines;
}

interface Run {
  text: string;
  font: string;
  color: string;
  lead: number;
}

/** Caption lines for one entry: number and time + what happened, the quote, the rest. */
function captionFor(ctx: CanvasRenderingContext2D, entry: TimelineEntry, width: number): Run[] {
  const runs: Run[] = [];
  const add = (text: string, font: string, color: string, lead: number, max: number) => {
    ctx.font = font;
    for (const line of wrap(ctx, text, width, max)) runs.push({ text: line, font, color, lead });
  };
  if (entry.screen) add(`⟨${entry.screen}⟩`, `600 13px ${FONT}`, '#2D5BD8', 18, 1);
  const head = `${entry.frame ? `#${entry.frame.index} ` : ''}${formatClock(entry.t)}`;
  add(`${head}  ${entry.what || ''}`.trim(), `600 16px ${FONT}`, '#111114', 22, 2);
  if (entry.said) add(`“${entry.said}”`, `italic 15px ${FONT}`, '#2B2F38', 21, 4);
  const more = entry.extras.length - 3;
  for (const x of entry.extras.slice(0, 3))
    add(`· ${formatClock(x.t)} ${x.text}`, `13px ${FONT}`, '#5D6270', 18, 1);
  if (more > 0) add(`· and ${more} more`, `13px ${FONT}`, '#5D6270', 18, 1);
  return runs;
}

function drawRuns(ctx: CanvasRenderingContext2D, runs: Run[], x: number, y: number): number {
  let at = y;
  ctx.textBaseline = 'alphabetic';
  for (const r of runs) {
    at += r.lead;
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, x, at - 5);
  }
  return at;
}

const height = (runs: Run[]) => runs.reduce((n, r) => n + r.lead, 0);

/**
 * The walkthrough as one picture: a header (page, length, when, how the voice lines up), then
 * every picture with its number, what happened, what was said and what else happened then.
 * Without pictures (demo page, shared file) it's the same as a list.
 */
async function contactSheet(
  wt: Walkthrough,
  pictures: { frame: WtFrame; canvas: HTMLCanvasElement }[],
): Promise<HTMLCanvasElement> {
  const entries = timeline(wt);
  const n = pictures.length;
  const cols = n === 0 ? 1 : n === 1 ? 1 : n <= 4 ? 2 : 3;
  const cellW = n === 0 ? 1100 : cols === 1 ? 1200 : cols === 2 ? 720 : 560;
  const gap = 20;
  const pad = 28;
  const width = pad * 2 + cols * cellW + (cols - 1) * gap;
  const probe = canvasOf(1, 1)[1];

  // Header.
  const inner = width - pad * 2;
  const header: Run[] = [];
  const addHeader = (text: string, font: string, color: string, lead: number, max: number) => {
    probe.font = font;
    for (const line of wrap(probe, text, inner, max))
      header.push({ text: line, font, color, lead });
  };
  addHeader(
    `Walkthrough · ${wt.page.title || 'Untitled page'}`,
    `700 22px ${FONT}`,
    '#111114',
    30,
    2,
  );
  addHeader(`${wt.page.url} · ${formatClock(wt.durationMs)}`, `14px ${FONT}`, '#5D6270', 20, 2);
  addHeader(recordedLine(wt), `14px ${FONT}`, '#5D6270', 20, 1);
  const details = contextLine(wt);
  if (details) addHeader(details, `14px ${FONT}`, '#5D6270', 20, 2);
  const voice = voiceLine(wt);
  if (voice) addHeader(voice, `14px ${FONT}`, '#5D6270', 20, 1);
  if (n)
    addHeader(
      'Red ink, numbered red pins and the red laser trail are the reviewer’s marks; blue rings are clicks.',
      `14px ${FONT}`,
      '#5D6270',
      20,
      2,
    );
  const untimed = untimedSpeech(wt);
  if (untimed) addHeader(`“${untimed}”`, `italic 15px ${FONT}`, '#2B2F38', 21, 8);
  const headerH = height(header) + 18;

  // Cells: each picture (or, without pictures, each entry) with its caption under it.
  const byFrame = new Map(entries.filter((e) => e.frame).map((e) => [e.frame!.index, e]));
  // Each row's pictures are as tall as its tallest (cropped pictures differ in shape).
  const picHeight = (pic: HTMLCanvasElement) =>
    Math.round(Math.min((cellW * pic.height) / pic.width, cellW * 1.25));
  const cells = (n ? pictures.map((p) => byFrame.get(p.frame.index)) : entries).map((entry) =>
    entry ? captionFor(probe, entry, cellW - 4) : [],
  );
  const rows: number[] = [];
  const picRows: number[] = [];
  for (let i = 0; i < cells.length; i += cols) {
    const caption = Math.max(...cells.slice(i, i + cols).map(height));
    const picH = n ? Math.max(...pictures.slice(i, i + cols).map((p) => picHeight(p.canvas))) : 0;
    picRows.push(picH);
    rows.push((n ? picH + 10 : 0) + caption);
  }
  const rowGap = n ? gap : 12;
  const total =
    pad * 2 + headerH + rows.reduce((a, b) => a + b, 0) + Math.max(0, rows.length - 1) * rowGap;
  const [canvas, ctx] = canvasOf(width, Math.max(total, pad * 2 + headerH));
  ctx.fillStyle = '#F4F4F6';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  drawRuns(ctx, header, pad, pad);

  let y = pad + headerH;
  rows.forEach((rowH, r) => {
    const picH = picRows[r]!;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (i >= cells.length) break;
      const x = pad + c * (cellW + gap);
      let top = y;
      const pic = pictures[i]?.canvas;
      if (n && pic) {
        const scale = Math.min(cellW / pic.width, picH / pic.height);
        const w = pic.width * scale;
        const h = pic.height * scale;
        ctx.save();
        ctx.beginPath();
        ctx.roundRect(x, top, cellW, picH, 10);
        ctx.clip();
        ctx.fillStyle = '#fff';
        ctx.fillRect(x, top, cellW, picH);
        ctx.drawImage(pic, x + (cellW - w) / 2, top + (picH - h) / 2, w, h);
        ctx.restore();
        ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(x + 0.5, top + 0.5, cellW - 1, picH - 1, 10);
        ctx.stroke();
        top += picH + 10;
      }
      drawRuns(ctx, cells[i]!, x + 2, top);
    }
    y += rowH + rowGap;
  });
  return canvas;
}

export interface BuiltBundle {
  files: ZipEntry[];
  /** The contact sheet: the whole walkthrough as one picture (previews, clipboard, Save image). */
  sheet: { jpeg: Blob; png: Blob; url: string; width: number; height: number };
}

const built = new WeakMap<WalkthroughResult, Promise<BuiltBundle>>();
const text = (s: string) => new TextEncoder().encode(s);

/** The files (made once per result). */
export function buildBundle(result: WalkthroughResult): Promise<BuiltBundle> {
  let job = built.get(result);
  if (!job) {
    job = (async () => {
      const wt = result.walkthrough;
      const cropped = !!wt.autocrop;
      const pictures: { frame: WtFrame; canvas: HTMLCanvasElement }[] = [];
      const fulls: { frame: WtFrame; canvas: HTMLCanvasElement }[] = [];
      for (const frame of wt.frames) {
        const shot = result.shots.get(frame.file);
        if (!shot) continue;
        const full = downscale(await annotate(wt, frame, shot), FULL_EDGE);
        const crop = frame.crop && frame.crop.kind !== 'full' ? frame.crop : undefined;
        pictures.push({ frame, canvas: crop ? await annotate(wt, frame, shot, crop) : full });
        if (cropped) fulls.push({ frame, canvas: full });
      }
      const jpegOf = async (canvas: HTMLCanvasElement) =>
        new Uint8Array(await (await toBlob(canvas, 'image/jpeg', 0.86)).arrayBuffer());
      const frames: ZipEntry[] = [];
      for (const p of pictures) frames.push({ name: p.frame.file, data: await jpegOf(p.canvas) });
      // Scrawl's layout: the cropped pictures, and the full ones beside them.
      for (const p of fulls)
        frames.push({
          name: p.frame.file.replace(/^frames\//, `${wt.autocrop!.fullFrames}/`),
          data: await jpegOf(p.canvas),
        });
      if (cropped)
        frames.push({
          name: wt.autocrop!.fullContactSheet,
          data: await jpegOf(await contactSheet(wt, fulls)),
        });
      const sheetCanvas = await contactSheet(wt, pictures);
      const jpeg = await toBlob(sheetCanvas, 'image/jpeg', 0.88);
      const png = await toBlob(sheetCanvas, 'image/png');
      const sheet = {
        jpeg,
        png,
        url: URL.createObjectURL(jpeg),
        width: sheetCanvas.width,
        height: sheetCanvas.height,
      };
      const files: ZipEntry[] = [
        { name: 'summary.md', data: text(result.summary) },
        { name: 'walkthrough.json', data: text(JSON.stringify(wt, null, 2)) },
        { name: 'contact-sheet.jpg', data: new Uint8Array(await jpeg.arrayBuffer()) },
      ];
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
    {
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
