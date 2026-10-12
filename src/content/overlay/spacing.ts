import { type EdgeDistance, edgeDistances } from '../../shared/measure';
import { measurableRects } from '../dom';

/**
 * The selection's spacing guides (page space), shared by the guides themselves and the
 * selection bar, which keeps clear of them. Measured once per element and window size.
 */
const cache = new WeakMap<Element, { key: string; lines: EdgeDistance[] }>();

export function spacingFor(el: Element, vw: number, vh: number): EdgeDistance[] {
  const key = `${vw}x${vh}`;
  const hit = cache.get(el);
  if (hit && hit.key === key) return hit.lines;
  const r = el.getBoundingClientRect();
  const target = {
    x: r.left + window.scrollX,
    y: r.top + window.scrollY,
    width: r.width,
    height: r.height,
  };
  const doc = document.documentElement;
  const lines = edgeDistances(target, measurableRects(el), {
    width: doc.clientWidth || vw,
    height: Math.max(doc.scrollHeight, document.body?.scrollHeight ?? 0, vh),
  });
  cache.set(el, { key, lines });
  return lines;
}

/** Room a floating bar above (or below) the selection should leave for the guide there. */
export function guideClearance(lines: EdgeDistance[], side: 'top' | 'bottom'): number {
  const line = lines.find((l) => l.side === side);
  // A long guide's label sits far from the selection; only short ones need the room.
  return line && line.value <= 120 ? line.value + 4 : 0;
}
