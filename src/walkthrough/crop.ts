import {
  area,
  type Content,
  type Crop,
  computeCrops,
  cropLabel,
  type Input,
  type Item,
  type Rect,
} from './autocrop.ts';
import type { Walkthrough, WtFrame } from './model.ts';

/**
 * A walkthrough's pictures cropped to where each moment happened (autocrop.ts, Scrawl's): the
 * ink, laser, clicks, scrolls, what appeared and where the pointer rested, placed on screen as
 * they were when they happened, plus what changed between pictures and where each has content.
 * The crops go on the frames (`frame.crop`) and `walkthrough.autocrop`; the pictures are cut
 * when the bundle is drawn (bundle.ts), with the full ones kept beside them.
 */

/** Evenly spaced points, at most `max` (Scrawl's `subsample`). */
function subsample<T>(v: T[], max: number): T[] {
  if (v.length <= max || max < 2) return v;
  return Array.from(
    { length: max },
    (_, i) => v[Math.floor((i * (v.length - 1) + Math.floor((max - 1) / 2)) / (max - 1))]!,
  );
}

/** The viewport the pictures show, in CSS px. */
export function screenOf(wt: Walkthrough): [number, number] | null {
  const f = wt.frames[0];
  return f ? [f.width / f.scale, f.height / f.scale] : null;
}

export function cropInput(
  wt: Walkthrough,
  screen: [number, number],
  changes: Rect[][],
): Omit<Input, 'content'> {
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
  for (const m of wt.marks) {
    const k = wt.frames.findIndex((f) => f.file === m.frame);
    if (k >= 0) for (const i of m.strokes) markFrame.set(i, k);
  }
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
  const cursorAt = (t: number) => wt.cursor.findLast((c) => c[0] <= t) ?? null;
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
  return { screen, duration: wt.durationMs, keyframes: wt.frames.map((f) => f.t), items };
}

/**
 * The walkthrough with its pictures' crops worked out: `changes` and `content` per frame (from
 * the pictures' pixels). Unchanged when nothing is worth cropping.
 */
export function cropFrames(
  wt: Walkthrough,
  changes: Rect[][],
  content: (Content | null)[],
): Walkthrough {
  const screen = screenOf(wt);
  if (!screen) return wt;
  let crops: Crop[];
  try {
    crops = computeCrops({ ...cropInput(wt, screen, changes), content });
  } catch (error) {
    // A crop bug must never cost the walkthrough: keep the full pictures.
    console.warn('[Chrome Design] auto-crop failed', error);
    return wt;
  }
  const label = cropLabel(crops);
  if (!label) return wt;
  const frames: WtFrame[] = wt.frames.map((f, k) => {
    const { rect: r, kind, reason } = crops[k]!;
    return {
      ...f,
      crop: {
        x: Math.round(r[0] * screen[0]),
        y: Math.round(r[1] * screen[1]),
        width: Math.round((r[2] - r[0]) * screen[0]),
        height: Math.round((r[3] - r[1]) * screen[1]),
        kind,
        reason,
      },
    };
  });
  return {
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
}
