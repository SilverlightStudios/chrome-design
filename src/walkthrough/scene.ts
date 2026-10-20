/**
 * Has the screen changed? Scrawl's keyframe measures (`src/keyframes.rs`, MIT, Kit Langton):
 * a 64×36 luma thumbnail compared globally and by its 8×6 blocks (the 4th-most-changed block,
 * so a cursor across a block corner never counts), and a ≤128-cell luma grid for "did this
 * region change". Pure: takes RGBA pixels.
 */

const TW = 64;
const TH = 36;
/** A run of frames changing by more than this is a transition (Scrawl's `delta > 0.08`). */
export const SCENE_CHANGE = 0.08;
/** A grid cell changed when its mean luma moved by more than this. */
export const CELL_CHANGE = 0.04;

export interface Look {
  thumb: Float32Array;
  grid: { cols: number; rows: number; cells: Float32Array };
}

/** Thumbnail and grid of a picture (`rgba` is `w`×`h`). */
export function look(rgba: Uint8ClampedArray, w: number, h: number): Look {
  const thumb = new Float32Array(TW * TH);
  if (w > 0 && h > 0)
    for (let y = 0; y < TH; y++) {
      const sy = Math.min(Math.floor(((2 * y + 1) * h) / (2 * TH)), h - 1);
      for (let x = 0; x < TW; x++) {
        const sx = Math.min(Math.floor(((2 * x + 1) * w) / (2 * TW)), w - 1);
        const o = (sy * w + sx) * 4;
        thumb[y * TW + x] =
          (0.2126 * rgba[o]! + 0.7152 * rgba[o + 1]! + 0.0722 * rgba[o + 2]!) / 255;
      }
    }
  const cols = Math.min(w, 128);
  const rows = Math.min(h, 128);
  const sums = new Float32Array(cols * rows);
  const counts = new Uint32Array(cols * rows);
  const step = Math.max(1, Math.floor(Math.max(w, h) / (128 * 4)));
  for (let y = 0; y < h; y += step) {
    const row = Math.floor((y * rows) / h) * cols;
    for (let x = 0; x < w; x += step) {
      const o = (y * w + x) * 4;
      const i = row + Math.floor((x * cols) / w);
      sums[i] = sums[i]! + (54 * rgba[o]! + 183 * rgba[o + 1]! + 19 * rgba[o + 2]!) / 256 / 255;
      counts[i]! += 1;
    }
  }
  const cells = sums.map((s, i) => s / Math.max(1, counts[i]!));
  return { thumb, grid: { cols, rows, cells } };
}

/** Global luma difference, or the 4th-most-changed block ×1.4 when that is more (0–1). */
export function sceneDiff(a: Look, b: Look): number {
  let global = 0;
  for (let i = 0; i < a.thumb.length; i++) global += Math.abs(a.thumb[i]! - b.thumb[i]!);
  global = Math.min(1, global / a.thumb.length);
  const COLS = 8;
  const ROWS = 6;
  const BW = TW / COLS;
  const BH = TH / ROWS;
  const blocks: number[] = [];
  for (let by = 0; by < ROWS; by++)
    for (let bx = 0; bx < COLS; bx++) {
      let sum = 0;
      for (let y = by * BH; y < (by + 1) * BH; y++)
        for (let x = bx * BW; x < (bx + 1) * BW; x++)
          sum += Math.abs(a.thumb[y * TW + x]! - b.thumb[y * TW + x]!);
      blocks.push(sum / (BW * BH));
    }
  const fourth = blocks.toSorted((x, y) => y - x)[3] ?? 0;
  return Math.max(global, Math.min(1, fourth * 1.4));
}

/** Cells `lo..hi` (fractions) of `n`, at least one. */
function span(lo: number, hi: number, n: number): [number, number] {
  const l = Math.min(Math.floor(lo * n), n - 1);
  return [Math.max(l, 0), Math.min(Math.max(Math.ceil(hi * n), l + 1), n)];
}

/** The share of grid cells inside `rect` (normalized `[x0, y0, x1, y1]`) whose luma changed. */
export function regionDiff(a: Look, b: Look, rect: [number, number, number, number]): number {
  const g = a.grid;
  const h = b.grid;
  if (g.cols !== h.cols || g.rows !== h.rows || g.cells.length === 0) return 1;
  const [r0, r1] = span(rect[1], rect[3], g.rows);
  const [c0, c1] = span(rect[0], rect[2], g.cols);
  let changed = 0;
  for (let y = r0; y < r1; y++)
    for (let x = c0; x < c1; x++) {
      const i = y * g.cols + x;
      if (Math.abs(g.cells[i]! - h.cells[i]!) > CELL_CHANGE) changed++;
    }
  return changed / Math.max(1, (r1 - r0) * (c1 - c0));
}

/** A look as plain JSON (messages between the page and the service worker carry no arrays of floats). */
export interface LookWire {
  thumb: string;
  grid: { cols: number; rows: number; cells: string };
}

const floatsToBase64 = (v: Float32Array) => {
  const bytes = new Uint8Array(v.buffer, v.byteOffset, v.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000)
    s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};

const base64ToFloats = (b64: string) =>
  new Float32Array(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer);

export function lookToWire(l: Look): LookWire {
  return {
    thumb: floatsToBase64(l.thumb),
    grid: { cols: l.grid.cols, rows: l.grid.rows, cells: floatsToBase64(l.grid.cells) },
  };
}

export function lookFromWire(w: LookWire): Look {
  return {
    thumb: base64ToFloats(w.thumb),
    grid: { cols: w.grid.cols, rows: w.grid.rows, cells: base64ToFloats(w.grid.cells) },
  };
}
