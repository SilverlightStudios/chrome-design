import type { Point } from '../shared/model';

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

/** Elements fully inside a page-space rect (outermost only, capped). */
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
        if (r.width === 0 && r.height === 0) return NodeFilter.FILTER_SKIP;
        const x = r.left + sx;
        const y = r.top + sy;
        const inside =
          x >= rect.x &&
          y >= rect.y &&
          x + r.width <= rect.x + rect.width &&
          y + r.height <= rect.y + rect.height;
        if (inside) return NodeFilter.FILTER_ACCEPT;
        const intersects =
          x < rect.x + rect.width &&
          x + r.width > rect.x &&
          y < rect.y + rect.height &&
          y + r.height > rect.y;
        return intersects ? NodeFilter.FILTER_SKIP : NodeFilter.FILTER_REJECT;
      },
    },
  );
  for (let n = walker.nextNode(); n && found.length < limit; n = walker.nextNode()) {
    const el = n as Element;
    if (!found.some((f) => f.contains(el))) found.push(el);
  }
  return found;
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
