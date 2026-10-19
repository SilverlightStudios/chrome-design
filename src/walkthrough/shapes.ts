/**
 * Reading freehand ink as gestures: a circle, an underline, a line, an arrow (a line plus one
 * or two short strokes at an end), a pin, or just a mark. Strokes drawn within MARK_GAP_MS of
 * each other are one gesture. The rules are ported from Scrawl (MIT, Kit Langton,
 * github.com/kitlangton/scrawl `src/sketch.rs`), on CSS pixels instead of capture pixels.
 */
import {
  MARK_GAP_MS,
  MAX_MARK_STROKES,
  type WtMark,
  type WtPoint,
  type WtRect,
  type WtShape,
  type WtStroke,
  type WtTarget,
} from './model.ts';

export type StrokeShape = 'tap' | 'circle' | 'underline' | 'line' | 'mark';

function bounds(points: readonly [number, number, number][]): WtRect {
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

const dist = (a: WtPoint, b: WtPoint) => Math.hypot(a.x - b.x, a.y - b.y);
const pt = (p: readonly [number, number, number] | undefined): WtPoint =>
  p ? { x: p[0], y: p[1] } : { x: 0, y: 0 };

export function strokeBounds(stroke: WtStroke): WtRect {
  return bounds(stroke.points);
}

/** What one stroke looks like on its own. */
export function shapeOf(stroke: WtStroke): StrokeShape {
  const points = stroke.points;
  if (points.length === 0) return 'tap';
  const b = bounds(points);
  const { width: w, height: h } = b;
  const big = Math.max(w, h);
  let len = 0;
  for (let i = 1; i < points.length; i++) len += dist(pt(points[i - 1]), pt(points[i]));
  const first = pt(points[0]);
  const last = pt(points.at(-1));
  const chord = dist(first, last);
  let shoelace = 0;
  for (let i = 1; i < points.length; i++) {
    const p = points[i - 1]!;
    const q = points[i]!;
    shoelace += p[0] * q[1] - q[0] * p[1];
  }
  shoelace += last.x * first.y - first.x * last.y;
  const area = Math.abs(shoelace) / 2;
  if (Math.hypot(w, h) < 14) return 'tap';
  if (
    chord < 0.35 * big &&
    len > 2 * big &&
    Math.min(w, h) >= 18 &&
    // Scrawl wants roundish loops (0.42); a wide oval round a heading is a circle here too.
    Math.min(w, h) > 0.18 * big &&
    area > 0.32 * w * h
  )
    return 'circle';
  if (chord > 0.88 * len) return w > 2.5 * h ? 'underline' : 'line';
  return 'mark';
}

const union = (rects: WtRect[]): WtRect => {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.width));
  const y1 = Math.max(...rects.map((r) => r.y + r.height));
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
};

const centre = (r: WtRect): WtPoint => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** `Heading “Pricing”` and `Text “…”`, or an area when nothing was under it. */
function names(targets: (WtTarget | undefined)[]): string {
  const labels = [...new Set(targets.filter((t): t is WtTarget => !!t).map((t) => t.label))];
  if (labels.length === 0) return 'an area';
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels.at(-1)}`;
}

export function describeMark(mark: Omit<WtMark, 'description'>): string {
  switch (mark.shape) {
    case 'circle':
      return `circled ${names(mark.also?.length ? mark.also : [mark.on])}`;
    case 'underline':
      return `underlined ${names([mark.on])}`;
    case 'line':
      return `drew a line from ${names([mark.also?.[0]])} to ${names([mark.on])}`;
    case 'arrow': {
      const from = mark.also?.[0];
      return from && from.label !== mark.on?.label
        ? `drew an arrow from ${from.label} to ${names([mark.on])}`
        : `drew an arrow pointing to ${names([mark.on])}`;
    }
    case 'pin':
      return `pin ${mark.pin ?? 1} on ${names([mark.on])}`;
    case 'laser':
      return mark.also?.length
        ? `pointed at ${mark.also.map((t) => t.label).join(', then ')}`
        : 'pointed at an area';
    default:
      return `marked ${names([mark.on])}`;
  }
}

/** Group strokes into marks (pins and laser gestures are always their own). */
export function marksOf(strokes: readonly WtStroke[]): WtMark[] {
  const groups: number[][] = [];
  strokes.forEach((stroke, i) => {
    const group = groups.at(-1);
    const prev = group ? strokes[group.at(-1)!] : undefined;
    if (
      group &&
      prev &&
      !prev.laser &&
      !stroke.laser &&
      prev.pin === undefined &&
      stroke.pin === undefined &&
      stroke.t0 - prev.t1 <= MARK_GAP_MS &&
      group.length < MAX_MARK_STROKES
    ) {
      group.push(i);
      return;
    }
    groups.push([i]);
  });

  return groups.map((group, n) => {
    const first = strokes[group[0]!]!;
    const t1 = Math.max(...group.map((j) => strokes[j]!.t1));
    const box = union(group.map((j) => strokeBounds(strokes[j]!)));
    const base = { id: `m${n + 1}`, t0: first.t0, t1, strokes: group, box };
    let mark: Omit<WtMark, 'description'>;

    if (first.laser) {
      mark = { ...base, shape: 'laser', also: first.hits?.path ?? [] };
      const on = first.hits?.path?.at(-1) ?? first.hits?.end;
      if (on) mark.on = on;
    } else if (first.pin !== undefined) {
      const at = pt(first.points[0]);
      mark = {
        ...base,
        shape: 'pin',
        pin: first.pin,
        box: { x: at.x, y: at.y, width: 0, height: 0 },
      };
      const on = first.hits?.center;
      if (on) mark.on = on;
    } else {
      // The biggest stroke decides; the others may be an arrowhead or more of the same.
      const sized = group
        .map((j) => {
          const s = strokes[j]!;
          const b = strokeBounds(s);
          return { s, shape: shapeOf(s), b, size: b.width + b.height };
        })
        .toSorted((a, b) => b.size - a.size);
      const main = sized[0]!;
      const rest = sized.slice(1);
      const a = pt(main.s.points[0]);
      const z = pt(main.s.points.at(-1));
      let shape: WtShape = 'mark';
      let from: WtPoint | undefined;
      let to: WtPoint | undefined;
      let tipAtEnd = true;
      if ((main.shape === 'line' || main.shape === 'underline') && rest.length >= 1) {
        const len = dist(a, z);
        const near = (p: WtPoint) =>
          rest.length <= 2 && rest.every((r) => dist(centre(r.b), p) < 0.35 * len);
        if (near(z) || near(a)) {
          shape = 'arrow';
          tipAtEnd = near(z);
          from = tipAtEnd ? a : z;
          to = tipAtEnd ? z : a;
        }
      }
      if (
        shape !== 'arrow' &&
        (rest.every((r) => r.shape === main.shape) || main.shape === 'circle')
      ) {
        if (main.shape === 'circle') shape = 'circle';
        else if (main.shape === 'line' && rest.length === 0) {
          shape = 'line';
          from = a;
          to = z;
        } else if (main.shape === 'underline') shape = 'underline';
      }
      const hits = main.s.hits ?? {};
      mark = { ...base, shape };
      if (from) mark.from = from;
      if (to) mark.to = to;
      if (shape === 'circle') {
        if (shape === 'circle' && rest.some((r) => r.shape !== 'circle')) mark.box = main.b;
        const inside = hits.inside?.slice(0, 2) ?? [];
        if (inside.length) mark.also = inside;
        const on = inside[0] ?? hits.center;
        if (on) mark.on = on;
      } else if (shape === 'arrow') {
        const tip = tipAtEnd ? hits.end : hits.start;
        const tail = tipAtEnd ? hits.start : hits.end;
        if (tip) mark.on = tip;
        if (tail) mark.also = [tail];
      } else if (shape === 'line') {
        if (hits.end) mark.on = hits.end;
        if (hits.start) mark.also = [hits.start];
      } else {
        const on = hits.center;
        if (on) mark.on = on;
      }
    }
    return { ...mark, description: describeMark(mark) };
  });
}
