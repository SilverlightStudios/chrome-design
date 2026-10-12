import type { Point, Rect, Shape } from './model';

export function rectFromPoints(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

export function rectContains(r: Rect, p: Point, pad = 0): boolean {
  return (
    p.x >= r.x - pad &&
    p.x <= r.x + r.width + pad &&
    p.y >= r.y - pad &&
    p.y <= r.y + r.height + pad
  );
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Shortest distance from p to the segment ab. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSq));
  return distance(p, { x: a.x + t * dx, y: a.y + t * dy });
}

/** Constrain b relative to a to 0/45/90° steps (Shift while drawing). */
export function snapAngle(a: Point, b: Point): Point {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const step = Math.PI / 4;
  const snapped = Math.round(angle / step) * step;
  const len = distance(a, b);
  return { x: a.x + Math.cos(snapped) * len, y: a.y + Math.sin(snapped) * len };
}

/** Make a rect square (Shift while drawing rect/ellipse), anchored at `a`. */
export function squareFrom(a: Point, b: Point): Point {
  const size = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  return { x: a.x + Math.sign(b.x - a.x || 1) * size, y: a.y + Math.sign(b.y - a.y || 1) * size };
}

/** Two points forming an arrowhead at `to`. */
export function arrowHead(from: Point, to: Point, size: number): [Point, Point] {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const spread = Math.PI / 7;
  return [
    { x: to.x - size * Math.cos(angle - spread), y: to.y - size * Math.sin(angle - spread) },
    { x: to.x - size * Math.cos(angle + spread), y: to.y - size * Math.sin(angle + spread) },
  ];
}

/** Ramer–Douglas–Peucker simplification for freehand strokes. */
export function simplifyPath(points: Point[], tolerance = 0.8): Point[] {
  if (points.length <= 2) return points.slice();
  const first = points[0]!;
  const last = points[points.length - 1]!;
  let maxDist = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i++) {
    const d = distanceToSegment(points[i]!, first, last);
    if (d > maxDist) {
      maxDist = d;
      index = i;
    }
  }
  if (maxDist <= tolerance) return [first, last];
  const left = simplifyPath(points.slice(0, index + 1), tolerance);
  const right = simplifyPath(points.slice(index), tolerance);
  return left.slice(0, -1).concat(right);
}

/** Smooth SVG path through points using quadratic midpoints. */
export function pointsToPath(points: Point[]): string {
  if (points.length === 0) return '';
  const p0 = points[0]!;
  if (points.length === 1) return `M${round1(p0.x)} ${round1(p0.y)}l0.01 0`;
  let d = `M${round1(p0.x)} ${round1(p0.y)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]!;
    const n = points[i + 1]!;
    d += ` Q${round1(p.x)} ${round1(p.y)} ${round1((p.x + n.x) / 2)} ${round1((p.y + n.y) / 2)}`;
  }
  const last = points[points.length - 1]!;
  d += ` L${round1(last.x)} ${round1(last.y)}`;
  return d;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function shapeBounds(shape: Shape): Rect {
  switch (shape.kind) {
    case 'pen': {
      const xs = shape.points.map((p) => p.x);
      const ys = shape.points.map((p) => p.y);
      const x = Math.min(...xs);
      const y = Math.min(...ys);
      return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
    }
    case 'line':
    case 'arrow':
      return rectFromPoints(shape.from, shape.to);
    case 'rect':
    case 'ellipse':
      return shape.rect;
    case 'text': {
      const lines = shape.text.split('\n');
      const width = Math.max(...lines.map((l) => l.length)) * shape.fontSize * 0.6;
      return {
        x: shape.point.x,
        y: shape.point.y,
        width,
        height: lines.length * shape.fontSize * 1.25,
      };
    }
  }
}

/** Whether `p` touches the visible stroke of a shape (eraser + hit testing). */
export function hitTestShape(shape: Shape, p: Point, tolerance: number): boolean {
  const tol = tolerance + shape.style.width / 2;
  switch (shape.kind) {
    case 'pen': {
      const pts = shape.points;
      if (pts.length === 1) return distance(p, pts[0]!) <= tol;
      for (let i = 1; i < pts.length; i++) {
        if (distanceToSegment(p, pts[i - 1]!, pts[i]!) <= tol) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return distanceToSegment(p, shape.from, shape.to) <= tol;
    case 'rect': {
      const { x, y, width, height } = shape.rect;
      const corners: Point[] = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
      for (let i = 0; i < 4; i++) {
        if (distanceToSegment(p, corners[i]!, corners[(i + 1) % 4]!) <= tol) return true;
      }
      return false;
    }
    case 'ellipse': {
      const { x, y, width, height } = shape.rect;
      const rx = width / 2;
      const ry = height / 2;
      if (rx < 1 || ry < 1) return rectContains(shape.rect, p, tol);
      const cx = x + rx;
      const cy = y + ry;
      // Normalised radial distance; compare against stroke band scaled by mean radius.
      const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      return Math.abs(k - 1) * Math.min(rx, ry) <= tol;
    }
    case 'text':
      return rectContains(shapeBounds(shape), p, tolerance);
  }
}

export function translateShape<T extends Shape>(shape: T, dx: number, dy: number): T {
  const move = (pt: Point): Point => ({ x: pt.x + dx, y: pt.y + dy });
  switch (shape.kind) {
    case 'pen':
      return { ...shape, points: shape.points.map(move) };
    case 'line':
    case 'arrow':
      return { ...shape, from: move(shape.from), to: move(shape.to) };
    case 'rect':
    case 'ellipse':
      return { ...shape, rect: { ...shape.rect, x: shape.rect.x + dx, y: shape.rect.y + dy } };
    case 'text':
      return { ...shape, point: move(shape.point) };
  }
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se' | 'from' | 'to';

/** Which handles a selected drawing offers (Figma-style). Text labels only move. */
export function handlesFor(shape: Shape): Handle[] {
  switch (shape.kind) {
    case 'line':
    case 'arrow':
      return ['from', 'to'];
    case 'text':
      return [];
    default:
      return ['nw', 'ne', 'sw', 'se'];
  }
}

function oppositeCorner(r: Rect, handle: Handle): Point {
  return {
    x: handle === 'nw' || handle === 'sw' ? r.x + r.width : r.x,
    y: handle === 'nw' || handle === 'ne' ? r.y + r.height : r.y,
  };
}

/**
 * Drag `handle` of `shape` to `p`. Corners keep the opposite corner fixed (Shift keeps the
 * aspect ratio); line/arrow endpoints move on their own (Shift snaps to 45°).
 */
export function resizeShape<T extends Shape>(
  shape: T,
  handle: Handle,
  p: Point,
  constrain = false,
): T {
  if (shape.kind === 'line' || shape.kind === 'arrow') {
    if (handle === 'from') return { ...shape, from: constrain ? snapAngle(shape.to, p) : p };
    if (handle === 'to') return { ...shape, to: constrain ? snapAngle(shape.from, p) : p };
    return shape;
  }
  if (shape.kind === 'text' || handle === 'from' || handle === 'to') return shape;
  const bounds = shapeBounds(shape);
  const anchor = oppositeCorner(bounds, handle);
  let end = p;
  if (constrain && bounds.width > 0 && bounds.height > 0) {
    const ratio = bounds.width / bounds.height;
    const w = Math.abs(p.x - anchor.x);
    const h = Math.abs(p.y - anchor.y);
    const size = Math.max(w, h * ratio);
    end = {
      x: anchor.x + Math.sign(p.x - anchor.x || 1) * size,
      y: anchor.y + Math.sign(p.y - anchor.y || 1) * (size / ratio),
    };
  }
  const next = rectFromPoints(anchor, end);
  if (shape.kind === 'rect' || shape.kind === 'ellipse') return { ...shape, rect: next };
  if (shape.kind !== 'pen') return shape;
  // Freehand: map every point from the old bounds into the new box.
  const sx = bounds.width > 0 ? next.width / bounds.width : 1;
  const sy = bounds.height > 0 ? next.height / bounds.height : 1;
  return {
    ...shape,
    points: shape.points.map((pt) => ({
      x: next.x + (pt.x - bounds.x) * sx,
      y: next.y + (pt.y - bounds.y) * sy,
    })),
  };
}
