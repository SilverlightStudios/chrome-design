import type { ZipEntry } from '../export/zip';
import {
  bytesOf,
  type Canvas,
  type Context,
  canvasOf,
  cut,
  encode,
  type Picture,
  pixelsOf,
  scaled,
} from '../shared/pixels';
import { Content, changeRegions, type Rect } from './autocrop.ts';
import { cropFrames, screenOf } from './crop.ts';
import { formatClock, type Walkthrough, type WtFrame } from './model.ts';
import {
  contextLine,
  recordedLine,
  type TimelineEntry,
  timeline,
  untimedSpeech,
  voiceLine,
} from './summary.ts';

/**
 * The walkthrough as files: each picture with the clicks and the laser drawn on (the ink and
 * pins were on screen when it was taken) and its number, a contact sheet of them all, the
 * summary for an AI agent and the walkthrough itself.
 *
 *   summary.md         what happened (and what was said) picture by picture
 *   walkthrough.json   everything, on one clock (model.ts)
 *   contact-sheet.jpg  every picture, numbered
 *   frames/frame-NN.jpg
 *
 * Draws on an OffscreenCanvas: runs in the service worker (where the pictures are kept) and on
 * the page (the demo and shared files, which have no pictures), not in Node.
 */

/** A frame's picture, as taken (null when there isn't one). */
export type PictureOf = (frame: WtFrame) => Promise<ImageBitmap | null>;

const RED = '#FF3B30';
const BLUE = '#0088FF';
const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
/** Full pictures are kept at most this wide (crops keep the captured resolution). */
const FULL_EDGE = 1600;

/** The crops, worked out from the pictures' pixels (what changed, where there's content). */
export async function cropWithPictures(
  wt: Walkthrough,
  pictureOf: PictureOf,
): Promise<Walkthrough> {
  const screen = screenOf(wt);
  if (!screen) return wt;
  const changes: Rect[][] = [];
  const content: (Content | null)[] = [];
  let prev: ReturnType<typeof pixelsOf> | null = null;
  for (const frame of wt.frames) {
    const picture = await pictureOf(frame).catch(() => null);
    const px = picture ? pixelsOf(picture) : null;
    changes.push(prev && px ? changeRegions(prev, px) : []);
    content.push(px ? Content.fromPixels(px.rgba, px.w, px.h, screen) : null);
    prev = px;
  }
  return cropFrames(wt, changes, content);
}

function badge(ctx: Context, text: string, k: number): void {
  const size = Math.round(15 * k);
  ctx.font = `600 ${size}px ${FONT}`;
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
function annotate(
  wt: Walkthrough,
  frame: WtFrame,
  picture: ImageBitmap,
  crop?: WtFrame['crop'],
): Canvas {
  const s = frame.scale;
  const sx = crop ? Math.max(0, Math.round(crop.x * s)) : 0;
  const sy = crop ? Math.max(0, Math.round(crop.y * s)) : 0;
  const w = crop ? Math.min(picture.width - sx, Math.round(crop.width * s)) : picture.width;
  const h = crop ? Math.min(picture.height - sy, Math.round(crop.height * s)) : picture.height;
  const canvas = cut(picture, [sx, sy, w, h]);
  const ctx = canvas.getContext('2d') as Context;
  // Marks and the number stay legible when the picture is shrunk onto the contact sheet.
  const k = Math.max(1, canvas.width / 900);
  const at = (x: number, y: number): [number, number] => [
    (x - frame.scroll.x) * s - sx,
    (y - frame.scroll.y) * s - sy,
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

/** Words wrapped to `width`, at most `max` lines (the last ends in … when cut). */
function wrap(ctx: Context, text: string, width: number, max: number): string[] {
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

/** A line of text on the contact sheet. */
interface Run {
  text: string;
  font: string;
  color: string;
  lead: number;
}

/** Lines of `text` in one style, wrapped to `width` (at most `max`), added to `runs`. */
function addRuns(
  ctx: Context,
  runs: Run[],
  width: number,
  [text, font, color, lead, max]: [string, string, string, number, number],
): void {
  ctx.font = font;
  for (const line of wrap(ctx, text, width, max)) runs.push({ text: line, font, color, lead });
}

const HEAD = `600 16px ${FONT}`;
const SMALL = `13px ${FONT}`;
const NOTE = `14px ${FONT}`;
const QUOTE = `italic 15px ${FONT}`;
const INK = '#111114';
const MUTED = '#5D6270';
const SAID = '#2B2F38';

/** Caption lines for one entry: number and time + what happened, the quote, the rest. */
function captionFor(ctx: Context, entry: TimelineEntry, width: number): Run[] {
  const runs: Run[] = [];
  const add = (...line: [string, string, string, number, number]) =>
    addRuns(ctx, runs, width, line);
  if (entry.screen) add(`⟨${entry.screen}⟩`, `600 13px ${FONT}`, '#2D5BD8', 18, 1);
  const head = `${entry.frame ? `#${entry.frame.index} ` : ''}${formatClock(entry.t)}`;
  add(`${head}  ${entry.what || ''}`.trim(), HEAD, INK, 22, 2);
  if (entry.said) add(`“${entry.said}”`, QUOTE, SAID, 21, 4);
  const more = entry.extras.length - 3;
  for (const x of entry.extras.slice(0, 3))
    add(`· ${formatClock(x.t)} ${x.text}`, SMALL, MUTED, 18, 1);
  if (more > 0) add(`· and ${more} more`, SMALL, MUTED, 18, 1);
  return runs;
}

function drawRuns(ctx: Context, runs: Run[], x: number, y: number): void {
  let at = y;
  ctx.textBaseline = 'alphabetic';
  for (const r of runs) {
    at += r.lead;
    ctx.font = r.font;
    ctx.fillStyle = r.color;
    ctx.fillText(r.text, x, at - 5);
  }
}

const height = (runs: Run[]) => runs.reduce((n, r) => n + r.lead, 0);

/**
 * The walkthrough as one picture: a header (page, length, when, how the voice lines up), then
 * every picture with its number, what happened, what was said and what else happened then.
 * Without pictures (demo page, shared file) it's the same as a list.
 */
function contactSheet(wt: Walkthrough, pictures: { frame: WtFrame; canvas: Picture }[]): Canvas {
  const entries = timeline(wt);
  const n = pictures.length;
  const cols = n <= 1 ? 1 : n <= 4 ? 2 : 3;
  const cellW = n === 0 ? 1100 : cols === 1 ? 1200 : cols === 2 ? 720 : 560;
  const gap = 20;
  const pad = 28;
  const width = pad * 2 + cols * cellW + (cols - 1) * gap;
  const probe = canvasOf(1, 1)[1];

  const header: Run[] = [];
  const addHeader = (...line: [string, string, string, number, number]) =>
    addRuns(probe, header, width - pad * 2, line);
  addHeader(`Walkthrough · ${wt.page.title || 'Untitled page'}`, `700 22px ${FONT}`, INK, 30, 2);
  addHeader(`${wt.page.url} · ${formatClock(wt.durationMs)}`, NOTE, MUTED, 20, 2);
  addHeader(recordedLine(wt), NOTE, MUTED, 20, 1);
  const details = contextLine(wt);
  if (details) addHeader(details, NOTE, MUTED, 20, 2);
  const voice = voiceLine(wt);
  if (voice) addHeader(voice, NOTE, MUTED, 20, 1);
  if (n)
    addHeader(
      'Red ink, numbered red pins and the red laser trail are the reviewer’s marks; blue rings are clicks.',
      NOTE,
      MUTED,
      20,
      2,
    );
  const untimed = untimedSpeech(wt);
  if (untimed) addHeader(`“${untimed}”`, QUOTE, SAID, 21, 8);
  const headerH = height(header) + 18;

  // Cells: each picture (or, without pictures, each entry) with its caption under it.
  const byFrame = new Map(entries.filter((e) => e.frame).map((e) => [e.frame!.index, e]));
  // Each row's pictures are as tall as its tallest (cropped pictures differ in shape).
  const picHeight = (pic: Picture) =>
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

export interface Bundle {
  files: ZipEntry[];
  /** The contact sheet: the whole walkthrough as one picture (previews, clipboard, Save image). */
  sheet: { jpeg: Blob; png: Blob; width: number; height: number };
}

const text = (s: string) => new TextEncoder().encode(s);
const jpeg = async (picture: Picture) => bytesOf(await encode(picture, 'image/jpeg', 0.86));

/** The files, and the contact sheet on its own. */
export async function buildBundle(
  wt: Walkthrough,
  summary: string,
  pictureOf: PictureOf,
): Promise<Bundle> {
  const cropped = !!wt.autocrop;
  const pictures: { frame: WtFrame; canvas: Picture }[] = [];
  const fulls: { frame: WtFrame; canvas: Picture }[] = [];
  for (const frame of wt.frames) {
    const picture = await pictureOf(frame).catch(() => null);
    if (!picture) continue;
    const full = scaled(annotate(wt, frame, picture), FULL_EDGE);
    const crop = frame.crop && frame.crop.kind !== 'full' ? frame.crop : undefined;
    pictures.push({ frame, canvas: crop ? annotate(wt, frame, picture, crop) : full });
    if (cropped) fulls.push({ frame, canvas: full });
    picture.close();
  }
  const frames: ZipEntry[] = [];
  for (const p of pictures) frames.push({ name: p.frame.file, data: await jpeg(p.canvas) });
  // Scrawl's layout: the cropped pictures, and the full ones beside them.
  for (const p of fulls)
    frames.push({
      name: p.frame.file.replace(/^frames\//, `${wt.autocrop!.fullFrames}/`),
      data: await jpeg(p.canvas),
    });
  if (cropped)
    frames.push({ name: wt.autocrop!.fullContactSheet, data: await jpeg(contactSheet(wt, fulls)) });
  const sheetCanvas = contactSheet(wt, pictures);
  const sheet = {
    jpeg: await encode(sheetCanvas, 'image/jpeg', 0.88),
    png: await encode(sheetCanvas, 'image/png'),
    width: sheetCanvas.width,
    height: sheetCanvas.height,
  };
  const files: ZipEntry[] = [
    { name: 'summary.md', data: text(summary) },
    { name: 'walkthrough.json', data: text(JSON.stringify(wt, null, 2)) },
    { name: 'contact-sheet.jpg', data: await bytesOf(sheet.jpeg) },
  ];
  return { files: [...files, ...frames], sheet };
}
