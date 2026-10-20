import {
  area,
  Content,
  type Crop,
  changeRegions,
  computeCrops,
  cropLabel,
  type Item,
  type Rect,
} from '../../walkthrough/autocrop';
import type { Walkthrough, WtFrame } from '../../walkthrough/model';
import { buildSummary } from '../../walkthrough/summary';
import type { WalkthroughResult } from './assemble';

/**
 * Feeds a finished walkthrough to the auto-crop (src/walkthrough/autocrop.ts, Scrawl's): the
 * ink, laser, clicks, scrolls and where the pointer rested, placed on screen as they were when
 * they happened, plus what changed between pictures and where each picture has content. The
 * crops go on the frames (`frame.crop`) and `walkthrough.autocrop`; the pictures themselves are
 * cut when the bundle is built (bundle.ts), with the full ones kept beside them.
 */

interface Pixels {
  rgba: Uint8ClampedArray;
  w: number;
  h: number;
}

async function pixels(dataUrl: string): Promise<Pixels | null> {
  try {
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0);
    return {
      rgba: ctx.getImageData(0, 0, canvas.width, canvas.height).data,
      w: canvas.width,
      h: canvas.height,
    };
  } catch {
    return null;
  }
}

/** Evenly spaced points, at most `max` (Scrawl's `subsample`). */
function subsample<T>(v: T[], max: number): T[] {
  if (v.length <= max || max < 2) return v;
  return Array.from(
    { length: max },
    (_, i) => v[Math.floor((i * (v.length - 1) + Math.floor((max - 1) / 2)) / (max - 1))]!,
  );
}

export function cropInput(
  wt: Walkthrough,
  screen: [number, number],
  changes: Rect[][],
): Omit<Parameters<typeof computeCrops>[0], 'content'> {
  const [sw, sh] = screen;
  const scrolls = wt.scrolls ?? [];
  // Where the page was scrolled at `t`, so page positions land where they were on screen.
  const scrollAt = (t: number): [number, number] => {
    let at: [number, number] = [wt.frames[0]?.scroll.x ?? 0, wt.frames[0]?.scroll.y ?? 0];
    for (const [st, x, y] of scrolls) {
      if (st > t) break;
      at = [x, y];
    }
    return at;
  };
  const norm = (x: number, y: number, t: number): [number, number, number] => {
    const [sx, sy] = scrollAt(t);
    return [(x - sx) / sw, (y - sy) / sh, t];
  };
  const items: Item[] = [];
  const markFrame = new Map<number, number>();
  wt.marks.forEach((m) => {
    const k = wt.frames.findIndex((f) => f.file === m.frame);
    if (k >= 0) for (const i of m.strokes) markFrame.set(i, k);
  });
  wt.strokes.forEach((s, i) => {
    if (s.points.length === 0) return;
    const pts = subsample(
      s.points.map(([x, y, dt]) => norm(x, y, s.t0 + dt)),
      48,
    );
    const kind = s.laser ? 'laser' : 'stroke';
    const k = kind === 'stroke' ? markFrame.get(i) : undefined;
    items.push({
      kind,
      t0: s.t0,
      t1: s.t1,
      pts,
      dwell: 0,
      ...(k !== undefined ? { keyframe: k } : {}),
    });
  });
  const cursorAt = (t: number) => {
    let found: [number, number, number] | null = null;
    for (const c of wt.cursor) {
      if (c[0] > t) break;
      found = c;
    }
    return found;
  };
  for (const e of wt.events) {
    if (e.kind === 'click')
      items.push({
        kind: 'click',
        t0: e.t,
        t1: e.t,
        pts: [norm(e.point.x, e.point.y, e.t)],
        dwell: 0,
      });
    if (e.kind === 'appear' && e.rect) {
      // The picture taken for it (reason `change`, same moment) keeps it in its crop.
      const k = wt.frames.findIndex((f) => f.reason === 'change' && Math.abs(f.t - e.t) < 50);
      if (k >= 0) {
        const { x, y, width: w, height: h } = e.rect;
        items.push({
          kind: 'appear',
          t0: e.t,
          t1: e.t,
          pts: [norm(x, y, e.t), norm(x + w, y, e.t), norm(x, y + h, e.t), norm(x + w, y + h, e.t)],
          dwell: 0,
          keyframe: k,
        });
      }
    }
    if (e.kind === 'scroll') {
      const c = cursorAt(e.t);
      if (c)
        items.push({ kind: 'scroll', t0: e.t, t1: e.t, pts: [norm(c[1], c[2], e.t)], dwell: 0 });
    }
  }
  wt.cursor.forEach((c, i) => {
    const next = wt.cursor[i + 1]?.[0] ?? Math.max(wt.durationMs, c[0]);
    items.push({
      kind: 'cursor',
      t0: c[0],
      t1: next,
      pts: [norm(c[1], c[2], c[0])],
      dwell: Math.min(Math.max(0, next - c[0]), 4000) / 1000,
    });
  });
  changes.forEach((regions, k) => {
    const t = wt.frames[k]?.t;
    if (t === undefined) return;
    for (const b of regions)
      items.push({
        kind: 'change',
        t0: t,
        t1: t,
        pts: [
          [b[0], b[1], t],
          [b[2], b[1], t],
          [b[0], b[3], t],
          [b[2], b[3], t],
          [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2, t],
        ],
        dwell: Math.sqrt(area(b)),
        keyframe: k,
      });
  });
  return {
    screen,
    duration: wt.durationMs,
    keyframes: wt.frames.map((f) => f.t),
    items,
  };
}

/** The walkthrough with its pictures' crops worked out (unchanged when nothing is worth it). */
export async function applyAutocrop(result: WalkthroughResult): Promise<WalkthroughResult> {
  const wt = result.walkthrough;
  if (wt.frames.length === 0) return result;
  const shots = wt.frames.map((f) => result.shots.get(f.file));
  const first = shots[0];
  if (!first) return result;
  const screen: [number, number] = [first.width / first.scale, first.height / first.scale];
  const px: (Pixels | null)[] = [];
  for (const shot of shots) px.push(shot ? await pixels(shot.dataUrl) : null);
  const changes: Rect[][] = px.map((cur, k) => {
    const prev = k > 0 ? px[k - 1] : null;
    return prev && cur ? changeRegions(prev, cur) : [];
  });
  const content = px.map((p) => (p ? Content.fromPixels(p.rgba, p.w, p.h, screen) : null));
  let crops: Crop[];
  try {
    crops = computeCrops({ ...cropInput(wt, screen, changes), content });
  } catch (error) {
    // A crop bug must never cost the walkthrough: keep the full pictures.
    console.warn('[Chrome Design] auto-crop failed', error);
    return result;
  }
  const label = cropLabel(crops);
  if (!label) return result;
  const frames: WtFrame[] = wt.frames.map((f, k) => {
    const c = crops[k]!;
    const r = c.rect;
    return {
      ...f,
      crop: {
        x: Math.round(r[0] * screen[0]),
        y: Math.round(r[1] * screen[1]),
        width: Math.round((r[2] - r[0]) * screen[0]),
        height: Math.round((r[3] - r[1]) * screen[1]),
        kind: c.kind,
        reason: c.reason,
      },
    };
  });
  const walkthrough: Walkthrough = {
    ...wt,
    frames,
    autocrop: {
      label,
      fullFrames: 'frames-full',
      fullContactSheet: 'contact-sheet-full.jpg',
      changes: changes.map((list) =>
        list.map((b) => b.map((v) => Math.round(v * 1000) / 1000) as Rect),
      ),
    },
  };
  return { ...result, walkthrough, summary: buildSummary(walkthrough) };
}
