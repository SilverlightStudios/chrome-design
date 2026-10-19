/**
 * Auto-crop: each picture cropped to where its moment happened, ported from Scrawl's
 * `src/autocrop.rs` (MIT, Kit Langton) with its settings. Everything is deterministic: weighted
 * activity, margins, minimum size, zoom cap, merging neighbours, then edges moved into blank
 * space so they don't cut through text.
 *
 * In a browser tab the tab is the window, so Scrawl's window-snapping step has nothing to snap
 * to and this is its "around the activity" path (`CropKind::Activity`): the activity box with
 * `context` of the screen as margin. Rects are `[x0, y0, x1, y1]` normalized to the viewport.
 *
 * Pure (no DOM): `Content` and `changeRegions` take raw RGBA pixels, so it runs in tests and Node.
 */

export type Rect = [number, number, number, number];
export const FULL: Rect = [0, 0, 1, 1];

export const area = (r: Rect) => Math.max(0, r[2] - r[0]) * Math.max(0, r[3] - r[1]);
export const union = (a: Rect, b: Rect): Rect => [
  Math.min(a[0], b[0]),
  Math.min(a[1], b[1]),
  Math.max(a[2], b[2]),
  Math.max(a[3], b[3]),
];
export const intersect = (a: Rect, b: Rect): Rect => [
  Math.max(a[0], b[0]),
  Math.max(a[1], b[1]),
  Math.min(a[2], b[2]),
  Math.min(a[3], b[3]),
];
export function iou(a: Rect, b: Rect): number {
  const i = area(intersect(a, b));
  const u = area(a) + area(b) - i;
  return u <= 0 ? 0 : i / u;
}
export function contains(outer: Rect, inner: Rect): boolean {
  const E = 1e-4;
  return (
    inner[0] >= outer[0] - E &&
    inner[1] >= outer[1] - E &&
    inner[2] <= outer[2] + E &&
    inner[3] <= outer[3] + E
  );
}
const clip01 = (r: Rect) => intersect(r, FULL);
const unionOpt = (a: Rect | null, b: Rect) => (a ? union(a, b) : b);
const sameRect = (a: Rect, b: Rect) => a.every((v, i) => v === b[i]);

/** Scrawl's defaults (`Settings::default`), in CSS px where Scrawl uses points. */
export const SETTINGS = {
  context: 0.15,
  keepInput: true,
  padding: 0,
  minW: 320,
  minH: 200,
  maxZoom: 4,
  wStroke: 1,
  wClick: 0.6,
  wLaser: 0.4,
  wScroll: 0.3,
  wCursor: 0.15,
  wChange: 0.1,
  passiveCap: 0.5,
  minDwell: 0.15,
  outlier: 0.12,
  mergeIou: 0.6,
  fullAbove: 0.85,
  snapOut: 120,
  snapOutFrac: 0.6,
  snapIn: 60,
  trim: 24,
  causeReach: 40,
  contentReach: 360,
  contentExtra: 160,
};

/**
 * `appear` is Chrome Design's own: a picture taken because something showed up (a toast, a
 * dialog) keeps that thing in its crop, weighed like a click. Everything else is Scrawl's.
 */
export type ItemKind =
  | 'stroke'
  | 'click'
  | 'drag'
  | 'laser'
  | 'scroll'
  | 'cursor'
  | 'change'
  | 'appear';
const deliberate = (k: ItemKind) => k !== 'cursor' && k !== 'change';

export interface Item {
  kind: ItemKind;
  t0: number;
  t1: number;
  /** `[x, y, t]`, normalized. */
  pts: [number, number, number][];
  /** Seconds the cursor rested here (for a change: its size). */
  dwell: number;
  /** Ink grouped into a picture's mark, and that picture's changes, belong to it alone. */
  keyframe?: number;
}

export type CropKind = 'activity' | 'fallback' | 'full';

export interface Crop {
  rect: Rect;
  kind: CropKind;
  reason: string;
  /** The activity itself (deliberate input, where the cursor rested, what a click changed). */
  need?: Rect;
  slice: [number, number];
  merged?: number;
}

/** Which 3 px cells of a picture have edges in them (text, borders, icons): an integral image. */
export class Content {
  static readonly CELL = 3;
  cols: number;
  rows: number;
  private sum: Uint32Array;

  constructor(cols: number, rows: number, sum: Uint32Array) {
    this.cols = cols;
    this.rows = rows;
    this.sum = sum;
  }

  /** From RGBA pixels covering a `screen` of CSS px. */
  static fromPixels(
    rgba: Uint8ClampedArray,
    w: number,
    h: number,
    screen: [number, number],
  ): Content {
    const cols = Math.max(1, Math.round(screen[0] / Content.CELL));
    const rows = Math.max(1, Math.round(screen[1] / Content.CELL));
    const sum = new Uint32Array((cols + 1) * (rows + 1));
    if (w < 2 || h < 2) return new Content(cols, rows, sum);
    const luma = (x: number, y: number) => {
      const i = (y * w + x) * 4;
      return ((rgba[i]! * 3 + rgba[i + 1]! * 6 + rgba[i + 2]!) / 10) | 0;
    };
    const step = Math.max(1, Math.floor(Math.floor(w / cols) / 3));
    for (let r = 0; r < rows; r++) {
      const y0 = Math.floor((r * h) / rows);
      const y1 = Math.min(Math.floor(((r + 1) * h) / rows), h - 1);
      let rowAcc = 0;
      for (let c = 0; c < cols; c++) {
        const x0 = Math.floor((c * w) / cols);
        const x1 = Math.min(Math.floor(((c + 1) * w) / cols), w - 1);
        let busy = false;
        cell: for (let y = y0; y < Math.max(y1, y0 + 1); y += step) {
          for (let x = x0; x < Math.max(x1, x0 + 1); x += step) {
            const l = luma(x, y);
            if (Math.abs(l - luma(x + 1, y)) >= 28 || Math.abs(l - luma(x, y + 1)) >= 28) {
              busy = true;
              break cell;
            }
          }
        }
        rowAcc += busy ? 1 : 0;
        sum[(r + 1) * (cols + 1) + c + 1] = sum[r * (cols + 1) + c + 1]! + rowAcc;
      }
    }
    return new Content(cols, rows, sum);
  }

  /** Busy cells in columns `c0..c1` and rows `r0..r1`. */
  count(c0: number, r0: number, c1: number, r1: number): number {
    const cc1 = Math.min(c1, this.cols);
    const rr1 = Math.min(r1, this.rows);
    if (c0 >= cc1 || r0 >= rr1) return 0;
    const at = (c: number, r: number) => this.sum[r * (this.cols + 1) + c]!;
    return at(cc1, rr1) + at(c0, r0) - at(c0, rr1) - at(cc1, r0);
  }
}

/**
 * Coarse regions that differ between two pictures (compared by position), largest first: 64
 * columns of square cells, 8×8 samples each, a cell changed when its mean luma moved by 10+,
 * 8-connected cells joined, lone cells dropped, at most 8 boxes.
 */
export function changeRegions(
  prev: { rgba: Uint8ClampedArray; w: number; h: number },
  cur: { rgba: Uint8ClampedArray; w: number; h: number },
): Rect[] {
  const COLS = 64;
  const SAMPLES = 8;
  if (prev.w < COLS || cur.w < COLS || prev.h < 8 || cur.h < 8) return [];
  const cell = Math.floor(cur.w / COLS);
  const rows = Math.max(1, Math.floor(cur.h / cell));
  const luma = (f: typeof prev, nx: number, ny: number) => {
    const x = Math.min(Math.floor(nx * f.w), f.w - 1);
    const y = Math.min(Math.floor(ny * f.h), f.h - 1);
    const i = (y * f.w + x) * 4;
    return ((f.rgba[i]! * 3 + f.rgba[i + 1]! * 6 + f.rgba[i + 2]!) / 10) | 0;
  };
  const changed = new Uint8Array(COLS * rows);
  for (let row = 0; row < rows; row++)
    for (let col = 0; col < COLS; col++) {
      let diff = 0;
      for (let sy = 0; sy < SAMPLES; sy++)
        for (let sx = 0; sx < SAMPLES; sx++) {
          const nx = (col + (sx + 0.5) / SAMPLES) / COLS;
          const ny = (row + (sy + 0.5) / SAMPLES) / rows;
          diff += Math.abs(luma(prev, nx, ny) - luma(cur, nx, ny));
        }
      changed[row * COLS + col] = Math.floor(diff / (SAMPLES * SAMPLES)) >= 10 ? 1 : 0;
    }
  const seen = new Uint8Array(changed.length);
  const boxes: [number, Rect][] = [];
  for (let start = 0; start < changed.length; start++) {
    if (!changed[start] || seen[start]) continue;
    const stack = [start];
    seen[start] = 1;
    let c0 = COLS;
    let r0 = rows;
    let c1 = 0;
    let r1 = 0;
    let count = 0;
    while (stack.length) {
      const i = stack.pop()!;
      const r = Math.floor(i / COLS);
      const c = i % COLS;
      c0 = Math.min(c0, c);
      r0 = Math.min(r0, r);
      c1 = Math.max(c1, c);
      r1 = Math.max(r1, r);
      count++;
      for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
          const nr = r + dr;
          const nc = c + dc;
          if (nr < 0 || nc < 0 || nr >= rows || nc >= COLS) continue;
          const j = nr * COLS + nc;
          if (changed[j] && !seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
    }
    if (count >= 2)
      boxes.push([
        (c1 - c0 + 1) * (r1 - r0 + 1),
        [c0 / COLS, r0 / rows, (c1 + 1) / COLS, (r1 + 1) / rows],
      ]);
  }
  return boxes
    .toSorted((a, b) => b[0] - a[0])
    .slice(0, 8)
    .map((b) => b[1]);
}

export interface Input {
  /** The viewport in CSS px. */
  screen: [number, number];
  duration: number;
  /** Each picture's moment. */
  keyframes: number[];
  items: Item[];
  /** Per picture, for snapping edges (null when its pixels weren't read). */
  content: (Content | null)[];
}

interface Pt {
  x: number;
  y: number;
  t: number;
  w: number;
  dwell: number;
  kind: ItemKind;
  outlier: boolean;
}

function bbox(pts: Iterable<[number, number]>): Rect | null {
  let r: Rect | null = null;
  for (const [x, y] of pts) r = unionOpt(r, [x, y, x, y]);
  return r;
}

function weight(item: Item): number {
  const s = SETTINGS;
  switch (item.kind) {
    case 'stroke':
      return s.wStroke;
    case 'click':
    case 'drag':
    case 'appear':
      return s.wClick;
    case 'laser':
      return s.wLaser;
    case 'scroll':
      return s.wScroll;
    case 'cursor':
      return s.wCursor * item.dwell;
    case 'change':
      return s.wChange * Math.min(1, Math.max(0.2, item.dwell * 3));
  }
}

function wmedian(pts: Pt[], key: (p: Pt) => number): number {
  const v = pts.map((p) => [key(p), p.w] as const).toSorted((a, b) => a[0] - b[0]);
  const half = v.reduce((n, p) => n + p[1], 0) / 2;
  let acc = 0;
  for (const [value, w] of v) {
    acc += w;
    if (acc >= half) return value;
  }
  return v.at(-1)?.[0] ?? 0.5;
}

/** Evenly spaced items, at most `max`. */
function subsample<T>(v: T[], max: number): T[] {
  if (v.length <= max || max < 2) return v;
  return Array.from(
    { length: max },
    (_, i) => v[Math.floor((i * (v.length - 1) + Math.floor((max - 1) / 2)) / (max - 1))]!,
  );
}

/** Keeps a centre on screen for a crop of half-size `half`. */
const keepOn = (c: number, half: number) => Math.min(Math.max(c, half), 1 - half);
/** A line is empty when at most a tenth of it is busy (rules across the crop don't count). */
const tol = (span: number) => Math.floor(Math.max(0, span / 10));
const few = (span: number) => Math.floor(Math.max(0, span / 30));

/** How many lines from `from` stepping `step` are empty, stopping at `limit`. */
function blank(from: number, step: number, limit: number, empty: (i: number) => boolean): number {
  let n = 0;
  while ((from + step * n - limit) * step < 0 && empty(from + step * n)) n++;
  return n;
}

/** Scrawl's `Ctx` (exported for tests). */
export class Ctx {
  readonly input: Input;
  readonly s = SETTINGS;
  sw: number;
  sh: number;
  // No parameter properties: Node runs this file with type stripping only.
  constructor(input: Input) {
    this.input = input;
    this.sw = Math.max(1, input.screen[0]);
    this.sh = Math.max(1, input.screen[1]);
  }

  slice(k: number): [number, number] {
    const kfs = this.input.keyframes;
    const t = kfs[k]!;
    const a = k === 0 ? 0 : Math.floor((kfs[k - 1]! + t) / 2);
    const b =
      k + 1 === kfs.length ? Math.max(this.input.duration, t) : Math.floor((t + kfs[k + 1]!) / 2);
    return [a, b];
  }

  pad(r: Rect, pt: number): Rect {
    const px = pt / this.sw;
    const py = pt / this.sh;
    return [r[0] - px, r[1] - py, r[2] + px, r[3] + py];
  }

  /** `core` grown by `context` of `within`'s size (geometric mean of its sides). */
  margin(core: Rect, within: Rect): Rect {
    const pt =
      this.s.context *
      Math.sqrt((within[2] - within[0]) * this.sw * ((within[3] - within[1]) * this.sh));
    return this.pad(core, pt);
  }

  /** Minimum size and maximum zoom (only growing), then kept on screen. */
  shape(r: Rect): Rect {
    const s = this.s;
    const cx0 = (r[0] + r[2]) / 2;
    const cy0 = (r[1] + r[3]) / 2;
    let w = Math.max(r[2] - r[0], 1e-4) * this.sw;
    let h = Math.max(r[3] - r[1], 1e-4) * this.sh;
    w = Math.max(w, Math.min(s.minW, this.sw));
    h = Math.max(h, Math.min(s.minH, this.sh));
    const need = 1 / Math.max(s.maxZoom, 1);
    const cover = Math.max(w / this.sw, h / this.sh);
    if (cover < need) {
      w *= need / cover;
      h *= need / cover;
    }
    const nw = Math.min(w / this.sw, 1);
    const nh = Math.min(h / this.sh, 1);
    const cx = keepOn(cx0, nw / 2);
    const cy = keepOn(cy0, nh / 2);
    return [cx - nw / 2, cy - nh / 2, cx + nw / 2, cy + nh / 2];
  }

  finish(r: Rect): Rect {
    const out = this.shape(this.pad(r, this.s.padding));
    return area(out) >= this.s.fullAbove ? FULL : out;
  }

  crop(k: number): Crop | null {
    const s = this.s;
    const slice = this.slice(k);
    let pts: Pt[] = [];
    for (const item of this.input.items) {
      const inSlice = item.t1 >= slice[0] && item.t0 <= slice[1];
      if (
        (item.kind === 'stroke' || item.kind === 'change' || item.kind === 'appear') &&
        item.keyframe !== undefined
      ) {
        if (item.keyframe !== k) continue;
      } else if (!inSlice) continue;
      const w = weight(item);
      if (w <= 0 || item.pts.length === 0) continue;
      const each = w / item.pts.length;
      for (const [x, y, t] of item.pts)
        pts.push({ x, y, t, w: each, dwell: item.dwell, kind: item.kind, outlier: false });
    }
    const anchors = subsample(
      pts.filter((p) => deliberate(p.kind)),
      300,
    );
    const diag = Math.hypot(this.sw, this.sh);
    const dist = (a: { x: number; y: number }, x: number, y: number) =>
      Math.hypot((a.x - x) * this.sw, (a.y - y) * this.sh) / diag;
    const cursors = pts.filter((p) => p.kind === 'cursor');
    const center =
      anchors.length === 0 && cursors.length
        ? ([wmedian(cursors, (p) => p.x), wmedian(cursors, (p) => p.y)] as const)
        : null;
    pts = pts.map((p) => {
      if (p.kind !== 'cursor') return p;
      const d = anchors.length
        ? Math.min(...anchors.map((a) => dist(a, p.x, p.y)))
        : center
          ? dist(p, center[0], center[1])
          : 0;
      return { ...p, outlier: d > s.outlier };
    });
    const deliberateW = pts.filter((p) => deliberate(p.kind)).reduce((n, p) => n + p.w, 0);
    const passiveW = pts
      .filter((p) => !deliberate(p.kind) && !p.outlier)
      .reduce((n, p) => n + p.w, 0);
    if (deliberateW > 0 && passiveW > s.passiveCap * deliberateW) {
      const f = (s.passiveCap * deliberateW) / passiveW;
      pts = pts.map((p) => (deliberate(p.kind) ? p : { ...p, w: p.w * f }));
    }
    const kept = pts.filter((p) => !p.outlier);
    const total = kept.reduce((n, p) => n + p.w, 0);
    if (total <= 0) return null;

    // The box: deliberate input and where the cursor rested; what changed only when nothing else.
    const ink = bbox(kept.filter((p) => deliberate(p.kind)).map((p) => [p.x, p.y]));
    const rested = bbox(
      kept
        .filter((p) => deliberate(p.kind) || (p.kind === 'cursor' && p.dwell >= s.minDwell))
        .map((p) => [p.x, p.y]),
    );
    // Changes near a click, drag or scroll are what it did: the scrolled page, a popover.
    const pokes = pts
      .filter((p) => p.kind === 'click' || p.kind === 'drag' || p.kind === 'scroll')
      .map((p) => [p.x, p.y] as const);
    const rx = s.causeReach / this.sw;
    const ry = s.causeReach / this.sh;
    let caused: Rect | null = null;
    for (const it of this.input.items) {
      if (it.kind !== 'change' || it.keyframe !== k) continue;
      if (it.t0 < slice[0] || it.t0 > slice[1]) continue;
      const b = bbox(it.pts.map(([x, y]) => [x, y]));
      if (!b || s.causeReach <= 0) continue;
      if (
        pokes.some(([x, y]) => x >= b[0] - rx && x <= b[2] + rx && y >= b[1] - ry && y <= b[3] + ry)
      )
        caused = unionOpt(caused, b);
    }
    const need = rested && caused ? union(rested, caused) : (rested ?? caused);
    const activity = need ?? bbox(kept.map((p) => [p.x, p.y]));

    const core0 = activity ?? ink ?? FULL;
    let rect = this.margin(core0, FULL);
    let reason = 'around the activity';
    if (s.keepInput && ink && !contains(rect, ink)) {
      rect = union(rect, ink);
      reason += ' + input outside it';
    }
    rect = this.finish(rect);
    return {
      rect,
      kind: sameRect(rect, FULL) ? 'full' : 'activity',
      reason,
      ...(activity ? { need: activity } : {}),
      slice,
    };
  }

  fallback(slice: [number, number], previous: Crop | null): Crop {
    return previous
      ? { rect: previous.rect, kind: 'fallback', reason: 'talk only: the previous crop', slice }
      : { rect: FULL, kind: 'full', reason: 'talk only: the whole screen', slice };
  }

  reachContent(r: Rect, content: Content, keep: Rect): Rect | null {
    const s = this.s;
    if (s.contentReach <= 0) return null;
    const { cols, rows } = content;
    const c0 = Math.max(0, Math.floor(r[0] * cols));
    const c1 = Math.ceil(r[2] * cols);
    const r0 = Math.max(0, Math.floor(r[1] * rows));
    const r1 = Math.min(Math.ceil(r[3] * rows), rows);
    const slack = Math.floor(Math.max(0, c1 - c0) / 60);
    const empty = (row: number) => content.count(c0, row, c1, row + 1) <= slack;
    let best: [number, number] = [0, 0];
    let run = 0;
    for (let row = r0; row < r1; row++) {
      run = empty(row) ? run + 1 : 0;
      if (run > best[1] - best[0]) best = [row + 1 - run, row + 1];
    }
    if ((best[1] - best[0]) * 2 < Math.max(0, r1 - r0)) return null;
    const reach = Math.floor(s.contentReach / Content.CELL);
    const extra = s.contentExtra / Content.CELL;
    const k0 = Math.floor(keep[1] * rows);
    const k1 = Math.ceil(keep[3] * rows);
    if (best[1] <= k0 + 1) {
      for (let row = r0 - 1; row >= Math.max(0, r0 - reach); row--)
        if (!empty(row)) return [r[0], Math.max(0, row - extra) / rows, r[2], r[3]];
      return null;
    }
    if (best[0] + 1 >= k1) {
      for (let row = r1; row < Math.min(r1 + reach, rows); row++)
        if (!empty(row)) return [r[0], r[1], r[2], Math.min(rows, row + 1 + extra) / rows];
      return null;
    }
    return null;
  }

  /** Widens `r` so its left and right edges don't cut through lines of text. */
  finishLines(r: Rect, content: Content, within: Rect): Rect {
    const cell = Content.CELL;
    const cols = content.cols;
    const rows = content.rows;
    const reach = Math.round(
      Math.max(this.s.snapOut, this.s.snapOutFrac * (r[2] - r[0]) * this.sw) / cell,
    );
    const gap = Math.round(12 / cell);
    if (reach <= 0) return r;
    const busy = (c: number, row: number) =>
      c >= 0 && c < cols && content.count(c, row, c + 1, row + 1) > 0;
    let c0 = Math.floor(r[0] * cols);
    let c1 = Math.ceil(r[2] * cols);
    const r0 = Math.max(0, Math.floor(r[1] * rows));
    const r1 = Math.min(Math.ceil(r[3] * rows), rows);
    const w0 = Math.max(0, Math.floor(Math.max(within[0], 0) * cols));
    const w1 = Math.min(Math.ceil(Math.min(within[2], 1) * cols), cols);
    // Where the line on `row` that crosses boundary `edge` ends going `dir` (undefined: nothing
    // crosses; null: runs past `limit`).
    const lineEnd = (
      row: number,
      edge: number,
      dir: number,
      limit: number,
    ): number | null | undefined => {
      const outside = dir > 0 ? edge : edge - 1;
      const inside = outside - dir;
      const near = (from: number, step: number) => {
        for (let k = 0; k < gap; k++) if (busy(from + step * k, row)) return true;
        return false;
      };
      if (!near(inside, -dir) || !near(outside, dir)) return undefined;
      let c = outside;
      let last = inside;
      let gapRun = 0;
      while (gapRun < gap) {
        if ((c - limit) * dir > 0 || c < 0 || c >= cols) return null;
        if (busy(c, row)) {
          last = c;
          gapRun = 0;
        } else gapRun++;
        c += dir;
      }
      // Ending right at the window's edge is a border, not the end of a line.
      return (limit - last) * dir >= 2 * gap ? last : null;
    };
    let right = c1;
    let left = c0;
    for (let row = r0; row < r1; row++) {
      const end = lineEnd(row, c1, 1, Math.min(c1 + reach, w1) - 1);
      if (typeof end === 'number') right = Math.max(right, end + 1 + gap);
      const start = lineEnd(row, c0, -1, Math.max(c0 - reach, w0));
      if (typeof start === 'number') left = Math.min(left, start - gap);
    }
    c1 = Math.min(right, w1);
    c0 = Math.max(left, w0);
    return clip01([c0 / cols, r[1], c1 / cols, r[3]]);
  }

  /** Moves each edge to the nearest empty stretch within `snapOut` out or `snapIn` in, never into `keep`. */
  snap(r: Rect, content: Content, keep: Rect): Rect {
    const s = this.s;
    const cols = content.cols;
    const rows = content.rows;
    const cell = Content.CELL;
    const reach = (size: number) => Math.round(Math.max(s.snapOut, s.snapOutFrac * size) / cell);
    const outX = reach((r[2] - r[0]) * this.sw);
    const outY = reach((r[3] - r[1]) * this.sh);
    const inn = Math.round(s.snapIn / cell);
    if (outX <= 0 && inn <= 0) return r;
    const snapEdge = (
      pos: number,
      limit: number,
      n: number,
      gap: number,
      dir: number,
      out: number,
      empty: (i: number) => boolean,
    ) => {
      const clean = (b: number) => {
        for (let k = 0; k < gap; k++) {
          const line = dir < 0 ? b + k : b - 1 - k;
          if (!(line < 0 || line >= n || empty(line))) return false;
        }
        return true;
      };
      if (clean(pos)) return pos;
      for (let d = 1; d <= Math.max(out, inn); d++) {
        const o = pos + dir * d;
        if (d <= out && o >= 0 && o <= n && clean(o)) return o;
        const i = pos - dir * d;
        const insideKeep = dir < 0 ? i > limit : i < limit;
        if (d <= inn && !insideKeep && i >= 0 && i <= n && clean(i)) return i;
      }
      return pos;
    };
    let c0 = Math.floor(r[0] * cols);
    let c1 = Math.ceil(r[2] * cols);
    let r0 = Math.floor(r[1] * rows);
    let r1 = Math.ceil(r[3] * rows);
    const k = [
      Math.floor(keep[0] * cols),
      Math.floor(keep[1] * rows),
      Math.ceil(keep[2] * cols),
      Math.ceil(keep[3] * rows),
    ] as const;
    {
      const rr0 = Math.max(0, r0);
      const rr1 = Math.max(0, r1);
      const colEmpty = (c: number) => content.count(c, rr0, c + 1, rr1) <= tol(r1 - r0);
      const gapCols = Math.round(12 / cell);
      c0 = snapEdge(c0, k[0], cols, gapCols, -1, outX, colEmpty);
      c1 = snapEdge(c1, k[2], cols, gapCols, 1, outX, colEmpty);
    }
    {
      const cc0 = Math.max(0, c0);
      const cc1 = Math.max(0, c1);
      const rowEmpty = (row: number) => content.count(cc0, row, cc1, row + 1) <= tol(c1 - c0);
      r0 = snapEdge(r0, k[1], rows, 1, -1, outY, rowEmpty);
      r1 = snapEdge(r1, k[3], rows, 1, 1, outY, rowEmpty);
    }
    // Trim blank margins, keeping `trim` of white.
    const margin = Math.round(s.trim / cell);
    if (s.trim > 0) {
      const minC = Math.round(Math.max(s.minW, this.sw / Math.max(s.maxZoom, 1)) / cell);
      const minR = Math.round(s.minH / cell);
      {
        const rr0 = Math.max(0, r0);
        const rr1 = Math.max(0, r1);
        const colEmpty = (c: number) =>
          content.count(Math.max(0, c), rr0, Math.max(0, c) + 1, rr1) <= few(r1 - r0);
        const left = blank(c0, 1, k[0], colEmpty);
        const right = blank(c1 - 1, -1, k[2] - 1, colEmpty);
        const spare = Math.max(0, c1 - c0 - minC);
        const cutL = Math.min(Math.max(left - margin, 0), spare);
        const cutR = Math.min(Math.max(right - margin, 0), spare - cutL);
        c0 += cutL;
        c1 -= cutR;
      }
      {
        const cc0 = Math.max(0, c0);
        const cc1 = Math.max(0, c1);
        const rowEmpty = (row: number) =>
          content.count(cc0, Math.max(0, row), cc1, Math.max(0, row) + 1) <= few(c1 - c0);
        const top = blank(r0, 1, k[1], rowEmpty);
        const bottom = blank(r1 - 1, -1, k[3] - 1, rowEmpty);
        const spare = Math.max(0, r1 - r0 - minR);
        const cutT = Math.min(Math.max(top - margin, 0), spare);
        const cutB = Math.min(Math.max(bottom - margin, 0), spare - cutT);
        r0 += cutT;
        r1 -= cutB;
      }
    }
    return clip01([c0 / cols, r0 / rows, c1 / cols, r1 / rows]);
  }
}

/** The crop for every picture (Scrawl's `compute` with `Scope::Grouped`). */
export function computeCrops(input: Input): Crop[] {
  const n = input.keyframes.length;
  if (n === 0) return [];
  const ctx = new Ctx(input);
  const s = ctx.s;
  const raw = Array.from({ length: n }, (_, k) => ctx.crop(k));
  const out: Crop[] = raw.map((crop, k) => {
    if (crop) return { ...crop };
    // The nearest earlier crop with activity, else the next one.
    let previous: Crop | null = null;
    for (let j = k - 1; j >= 0 && !previous; j--) previous = raw[j] ?? null;
    for (let j = k + 1; j < n && !previous; j++) previous = raw[j] ?? null;
    return ctx.fallback(ctx.slice(k), previous);
  });
  // Neighbouring crops that overlap by `mergeIou` become one.
  let start = 0;
  for (let k = 1; k <= n; k++) {
    const u = out.slice(start, k).reduce<Rect | null>((r, c) => unionOpt(r, c.rect), null)!;
    if (k < n && iou(u, out[k]!.rect) >= s.mergeIou) continue;
    if (k - start > 1) {
      let merged = ctx.shape(u);
      if (area(merged) >= s.fullAbove) merged = FULL;
      for (const c of out.slice(start, k)) {
        c.rect = merged;
        c.merged = k - start;
      }
    }
    start = k;
  }
  // Edges into white space, reach for content across blank space, finish lines of text.
  out.forEach((c, k) => {
    const content = input.content[k];
    if (c.kind === 'activity' && !sameRect(c.rect, FULL) && content) {
      const r = c.rect;
      const mid: Rect = [
        (r[0] + r[2]) / 2,
        (r[1] + r[3]) / 2,
        (r[0] + r[2]) / 2,
        (r[1] + r[3]) / 2,
      ];
      const keep = c.need ? intersect(c.need, r) : mid;
      let snapped = ctx.snap(c.rect, content, keep);
      const grown = ctx.reachContent(snapped, content, keep);
      if (grown) snapped = ctx.snap(grown, content, keep);
      snapped = ctx.finishLines(snapped, content, FULL);
      c.rect = area(snapped) >= s.fullAbove ? FULL : snapped;
    }
    if (sameRect(c.rect, FULL)) c.kind = 'full';
  });
  return out;
}

/** The summary's name for what was cropped to, or null when nothing was. */
export function cropLabel(crops: Crop[]): string | null {
  return crops.some((c) => c.kind !== 'full') ? 'the activity' : null;
}
