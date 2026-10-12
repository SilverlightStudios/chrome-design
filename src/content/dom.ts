import type { Point, Rect } from '../shared/model';

export const HOST_TAG = 'chrome-design-root';

export function isExtensionNode(node: Node | null | undefined): boolean {
  if (!node) return false;
  const root = node.getRootNode();
  const host = root instanceof ShadowRoot ? root.host : node;
  return host instanceof Element && host.localName === HOST_TAG;
}

/** Topmost page element at a viewport point, ignoring the extension UI. */
export function pickElement(x: number, y: number): Element | null {
  for (const el of document.elementsFromPoint(x, y)) {
    if (el.localName === HOST_TAG) continue;
    return el;
  }
  return null;
}

/**
 * Elements that are (mostly) inside a page-space rect: outermost matches only, capped.
 * An element counts when at least 60% of its box lies inside the region. If nothing
 * qualifies, the innermost element under the region's centre is used.
 */
export function elementsInRect(
  rect: { x: number; y: number; width: number; height: number },
  limit = 6,
): Element[] {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const found: Element[] = [];
  const walker = document.createTreeWalker(
    document.body ?? document.documentElement,
    NodeFilter.SHOW_ELEMENT,
    {
      acceptNode(node) {
        const el = node as Element;
        if (el.localName === HOST_TAG) return NodeFilter.FILTER_REJECT;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return NodeFilter.FILTER_SKIP;
        const x = r.left + sx;
        const y = r.top + sy;
        const ix = Math.max(0, Math.min(x + r.width, rect.x + rect.width) - Math.max(x, rect.x));
        const iy = Math.max(0, Math.min(y + r.height, rect.y + rect.height) - Math.max(y, rect.y));
        if (ix === 0 || iy === 0) return NodeFilter.FILTER_REJECT;
        return (ix * iy) / (r.width * r.height) >= 0.6
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_SKIP;
      },
    },
  );
  for (let n = walker.nextNode(); n && found.length < limit; n = walker.nextNode()) {
    const el = n as Element;
    if (!found.some((f) => f.contains(el))) found.push(el);
  }
  if (found.length === 0) {
    const centre = pickElement(rect.x + rect.width / 2 - sx, rect.y + rect.height / 2 - sy);
    if (centre && centre !== document.documentElement && centre !== document.body)
      found.push(centre);
  }
  return found;
}

/**
 * The smallest page element whose box holds the whole page-space rect (the section or
 * container something dropped there belongs in). Null when only the page itself does.
 */
export function containerOfRect(rect: Rect, tolerance = 2): Element | null {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const holds = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return false;
    return (
      r.left + sx <= rect.x + tolerance &&
      r.top + sy <= rect.y + tolerance &&
      r.right + sx >= rect.x + rect.width - tolerance &&
      r.bottom + sy >= rect.y + rect.height - tolerance
    );
  };
  let found: Element | null = null;
  let current: Element | null = document.body;
  while (current) {
    // The last matching child paints on top when siblings overlap.
    const next: Element | undefined = Array.from(current.children).findLast(
      (child) => !child.localName.startsWith('chrome-design') && holds(child),
    );
    if (!next) break;
    found = next;
    current = next;
  }
  return found;
}

/**
 * Children of `container` (the page body when null) that a page-space rect overlaps, most
 * overlapped first: what something dropped there sits on.
 */
export function overlappedChildren(container: Element | null, rect: Rect, limit = 4): Element[] {
  const parent = container ?? document.body;
  if (!parent) return [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  return Array.from(parent.children)
    .filter((child) => !child.localName.startsWith('chrome-design'))
    .map((child) => {
      const r = child.getBoundingClientRect();
      const ix = Math.max(
        0,
        Math.min(r.right + sx, rect.x + rect.width) - Math.max(r.left + sx, rect.x),
      );
      const iy = Math.max(
        0,
        Math.min(r.bottom + sy, rect.y + rect.height) - Math.max(r.top + sy, rect.y),
      );
      return { child, area: ix * iy };
    })
    .filter((c) => c.area > 0)
    .toSorted((a, b) => b.area - a.area)
    .slice(0, limit)
    .map((c) => c.child);
}

/**
 * Page-space boxes of the visible elements a selection can be measured against: everything
 * except the selection itself and what's inside it, the page root, and this UI. Capped so a
 * huge page stays quick (first `limit` in document order).
 */
export function measurableRects(target: Element, limit = 4000): Rect[] {
  const sx = window.scrollX;
  const sy = window.scrollY;
  const out: Rect[] = [];
  const root = document.body ?? document.documentElement;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode(node) {
      const el = node as Element;
      if (el === target || el.localName === HOST_TAG) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = walker.nextNode(); n && out.length < limit; n = walker.nextNode()) {
    const r = (n as Element).getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;
    out.push({ x: r.left + sx, y: r.top + sy, width: r.width, height: r.height });
  }
  return out;
}

export function toPage(clientX: number, clientY: number): Point {
  return { x: clientX + window.scrollX, y: clientY + window.scrollY };
}

/** True when a keyboard event originates from an editable field (page or extension UI). */
export function isTypingEvent(event: KeyboardEvent): boolean {
  const target = event.composedPath()[0];
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.localName;
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag === 'input') {
    const type = (target as HTMLInputElement).type;
    return !['checkbox', 'radio', 'button', 'submit', 'range', 'color'].includes(type);
  }
  return false;
}

export function rgbToHex(color: string): string {
  const m = color.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s/]+([\d.]+%?))?\s*\)/i);
  if (!m) return color;
  const hex = [m[1], m[2], m[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('');
  const alpha = m[4];
  if (alpha !== undefined) {
    const a = alpha.endsWith('%') ? Number.parseFloat(alpha) / 100 : Number.parseFloat(alpha);
    if (a < 1)
      return `#${hex}${Math.round(a * 255)
        .toString(16)
        .padStart(2, '0')}`.toUpperCase();
  }
  return `#${hex}`.toUpperCase();
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Pointer capture that tolerates synthetic / already-released pointers. */
export function capturePointer(el: Element, pointerId: number): void {
  try {
    el.setPointerCapture(pointerId);
  } catch {
    // synthetic events or pointer already gone
  }
}

export function releasePointer(el: Element, pointerId: number): void {
  try {
    if (el.hasPointerCapture(pointerId)) el.releasePointerCapture(pointerId);
  } catch {
    // ignore
  }
}
