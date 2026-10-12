import type { Rect } from './model';

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

/** Column rectangles for the layout grid overlay, in viewport x coordinates. */
export function gridColumns(
  viewportWidth: number,
  grid: {
    mode: 'stretch' | 'fixed';
    count: number;
    columnWidth: number;
    margin: number;
    gutter: number;
  },
): { x: number; width: number }[] {
  const count = Math.max(1, Math.round(grid.count));
  const gutter = Math.max(0, grid.gutter);
  if (grid.mode === 'fixed') {
    const width = Math.max(1, grid.columnWidth);
    const total = count * width + (count - 1) * gutter;
    const start = (viewportWidth - total) / 2;
    return Array.from({ length: count }, (_, i) => ({ x: start + i * (width + gutter), width }));
  }
  const margin = Math.max(0, grid.margin);
  const width = Math.max(0, (viewportWidth - margin * 2 - gutter * (count - 1)) / count);
  return Array.from({ length: count }, (_, i) => ({ x: margin + i * (width + gutter), width }));
}
