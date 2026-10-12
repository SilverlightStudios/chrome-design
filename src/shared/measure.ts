import type { GridSpacing, Rect } from './model';

export interface MeasureLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Distance in px, rounded. */
  value: number;
  axis: 'x' | 'y';
}

/**
 * Red-line distances between a selected box `a` and a hovered box `b` (Figma-style):
 * gaps when they are apart, inner offsets when one contains the other.
 */
export function measureBetween(a: Rect, b: Rect): MeasureLine[] {
  const lines: MeasureLine[] = [];
  const aR = a.x + a.width;
  const aB = a.y + a.height;
  const bR = b.x + b.width;
  const bB = b.y + b.height;
  const midY = (Math.max(a.y, b.y) + Math.min(aB, bB)) / 2;
  const midX = (Math.max(a.x, b.x) + Math.min(aR, bR)) / 2;
  const overlapY = Math.min(aB, bB) > Math.max(a.y, b.y);
  const overlapX = Math.min(aR, bR) > Math.max(a.x, b.x);
  const yLine = overlapY ? midY : a.y + a.height / 2;
  const xLine = overlapX ? midX : a.x + a.width / 2;
  const push = (axis: 'x' | 'y', from: number, to: number, at: number) => {
    const value = Math.round(Math.abs(to - from));
    if (value === 0) return;
    lines.push(
      axis === 'x'
        ? { axis, x1: from, x2: to, y1: at, y2: at, value }
        : { axis, y1: from, y2: to, x1: at, x2: at, value },
    );
  };

  // Horizontal
  if (aR <= b.x) push('x', aR, b.x, yLine);
  else if (bR <= a.x) push('x', bR, a.x, yLine);
  else {
    const inside = a.x >= b.x && aR <= bR;
    const outside = b.x >= a.x && bR <= aR;
    if (inside || outside) {
      push('x', Math.min(a.x, b.x), Math.max(a.x, b.x), yLine);
      push('x', Math.min(aR, bR), Math.max(aR, bR), yLine);
    }
  }
  // Vertical
  if (aB <= b.y) push('y', aB, b.y, xLine);
  else if (bB <= a.y) push('y', bB, a.y, xLine);
  else {
    const inside = a.y >= b.y && aB <= bB;
    const outside = b.y >= a.y && bB <= aB;
    if (inside || outside) {
      push('y', Math.min(a.y, b.y), Math.max(a.y, b.y), xLine);
      push('y', Math.min(aB, bB), Math.max(aB, bB), xLine);
    }
  }
  return lines;
}

export interface EdgeDistance extends MeasureLine {
  side: 'top' | 'right' | 'bottom' | 'left';
  /** What the line runs to: a neighbouring element, the box it sits in, or the page edge. */
  to: 'element' | 'container' | 'page';
}

/**
 * The selected box's distance to whatever is next to it on each side (Figma's spacing guides):
 * the nearest element edge straight out from that side — a neighbour in line with the box, or
 * the inside edge of a box that contains it — and the page edge when there is nothing. Edges
 * flush with the box (under half a pixel) are skipped, so a line always shows a real gap.
 * All rects in the same space (page coordinates); `page` is the document size.
 */
export function edgeDistances(
  target: Rect,
  others: Rect[],
  page: { width: number; height: number },
): EdgeDistance[] {
  const t = { l: target.x, t: target.y, r: target.x + target.width, b: target.y + target.height };
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  const best = {
    right: { at: page.width, to: 'page' as EdgeDistance['to'], mid: cy },
    left: { at: 0, to: 'page' as EdgeDistance['to'], mid: cy },
    bottom: { at: page.height, to: 'page' as EdgeDistance['to'], mid: cx },
    top: { at: 0, to: 'page' as EdgeDistance['to'], mid: cx },
  };
  const GAP = 0.5;
  for (const o of others) {
    const r = { l: o.x, t: o.y, r: o.x + o.width, b: o.y + o.height };
    const rowsOverlap = r.t < t.b - GAP && r.b > t.t + GAP;
    const colsOverlap = r.l < t.r - GAP && r.r > t.l + GAP;
    const contains = r.l <= t.l + GAP && r.r >= t.r - GAP && r.t <= t.t + GAP && r.b >= t.b - GAP;
    const midRow = (Math.max(r.t, t.t) + Math.min(r.b, t.b)) / 2;
    const midCol = (Math.max(r.l, t.l) + Math.min(r.r, t.r)) / 2;
    if (contains) {
      // The inside edges of a box around it.
      if (r.r - t.r > GAP && r.r < best.right.at)
        best.right = { at: r.r, to: 'container', mid: cy };
      if (t.l - r.l > GAP && r.l > best.left.at) best.left = { at: r.l, to: 'container', mid: cy };
      if (r.b - t.b > GAP && r.b < best.bottom.at)
        best.bottom = { at: r.b, to: 'container', mid: cx };
      if (t.t - r.t > GAP && r.t > best.top.at) best.top = { at: r.t, to: 'container', mid: cx };
      continue;
    }
    if (rowsOverlap) {
      if (r.l - t.r > GAP && r.l < best.right.at)
        best.right = { at: r.l, to: 'element', mid: midRow };
      if (t.l - r.r > GAP && r.r > best.left.at)
        best.left = { at: r.r, to: 'element', mid: midRow };
    }
    if (colsOverlap) {
      if (r.t - t.b > GAP && r.t < best.bottom.at)
        best.bottom = { at: r.t, to: 'element', mid: midCol };
      if (t.t - r.b > GAP && r.b > best.top.at) best.top = { at: r.b, to: 'element', mid: midCol };
    }
  }
  const out: EdgeDistance[] = [];
  const push = (side: EdgeDistance['side'], from: number, hit: (typeof best)['top']) => {
    const value = Math.round(Math.abs(hit.at - from));
    if (value === 0) return;
    const horizontal = side === 'left' || side === 'right';
    out.push(
      horizontal
        ? { side, to: hit.to, axis: 'x', x1: from, x2: hit.at, y1: hit.mid, y2: hit.mid, value }
        : { side, to: hit.to, axis: 'y', y1: from, y2: hit.at, x1: hit.mid, x2: hit.mid, value },
    );
  };
  push('top', t.t, best.top);
  push('right', t.r, best.right);
  push('bottom', t.b, best.bottom);
  push('left', t.l, best.left);
  return out;
}

/** Column rectangles for the layout grid overlay, in viewport x coordinates. */
export function gridColumns(
  viewportWidth: number,
  grid: {
    mode: 'stretch' | 'fixed';
    count: number;
    columnWidth: number;
    spacing?: GridSpacing;
    margin: number;
    gutter: number;
  },
): { x: number; width: number }[] {
  const count = Math.max(1, Math.round(grid.count));
  const margin = Math.max(0, grid.margin);
  const columns = (start: number, width: number, gap: number) =>
    Array.from({ length: count }, (_, i) => ({ x: start + i * (width + gap), width }));
  if (grid.mode === 'stretch') {
    const gutter = Math.max(0, grid.gutter);
    const width = Math.max(0, (viewportWidth - margin * 2 - gutter * (count - 1)) / count);
    return columns(margin, width, gutter);
  }
  const width = Math.max(1, grid.columnWidth);
  const spacing = grid.spacing ?? 'center';
  const free = viewportWidth - margin * 2 - count * width;
  let gap = Math.max(0, grid.gutter);
  let start: number;
  if (spacing === 'between' || spacing === 'around' || spacing === 'evenly') {
    const slots = spacing === 'between' ? count - 1 : spacing === 'around' ? count : count + 1;
    gap = slots > 0 ? free / slots : 0;
    start = spacing === 'between' ? margin : spacing === 'around' ? margin + gap / 2 : margin + gap;
    // One column has nothing to spread against; too little room means no gaps at all.
    if (slots === 0 || gap < 0) {
      gap = Math.max(0, gap);
      start = (viewportWidth - count * width - (count - 1) * gap) / 2;
    }
  } else {
    const total = count * width + (count - 1) * gap;
    start =
      spacing === 'start'
        ? margin
        : spacing === 'end'
          ? viewportWidth - margin - total
          : (viewportWidth - total) / 2;
  }
  return columns(start, width, gap);
}
