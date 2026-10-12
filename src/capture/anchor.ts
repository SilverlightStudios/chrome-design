import type { ElementAnchor, Point, Rect } from '../shared/model';

/** Computed style properties summarised on anchors / shown in the inspector. */
export const STYLE_SUMMARY_PROPS = [
  'display',
  'position',
  'width',
  'height',
  'margin',
  'padding',
  'font-family',
  'font-size',
  'font-weight',
  'line-height',
  'letter-spacing',
  'color',
  'background-color',
  'border',
  'border-radius',
  'box-shadow',
  'gap',
  'opacity',
] as const;

const SKIP_VALUES = new Set(['', 'none', 'normal', 'auto', '0px', 'rgba(0, 0, 0, 0)', 'static']);

export function pageRect(el: Element): Rect {
  const r = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  const sx = view?.scrollX ?? 0;
  const sy = view?.scrollY ?? 0;
  return {
    x: round(r.left + sx),
    y: round(r.top + sy),
    width: round(r.width),
    height: round(r.height),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`);
}

/** Class names that look generated (hashes, CSS modules) make brittle selectors. */
function isStableClass(name: string): boolean {
  if (name.length > 40) return false;
  if (/^(css|sc|jsx|emotion|styled)-[a-z0-9]+$/i.test(name)) return false;
  if (/[0-9a-f]{6,}/i.test(name) && /\d/.test(name)) return false;
  return /^[a-zA-Z_][\w-]*$/.test(name);
}

function isUnique(root: ParentNode, selector: string, el: Element): boolean {
  try {
    const found = root.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function segmentFor(el: Element): string {
  const tag = el.localName;
  const stable = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  let seg = tag + stable.map((c) => `.${cssEscape(c)}`).join('');
  const parent = el.parentElement;
  if (parent) {
    const same = Array.from(parent.children).filter((c) => c.localName === tag);
    if (same.length > 1) seg += `:nth-of-type(${same.indexOf(el) + 1})`;
  }
  return seg;
}

/** Shortest reasonably stable CSS selector that uniquely matches `el` in its document. */
export function uniqueSelector(el: Element): string {
  const doc = el.ownerDocument;
  if (el === doc.documentElement) return 'html';
  if (el === doc.body) return 'body';
  if (el.id && /^[a-zA-Z][\w-]*$/.test(el.id) && isUnique(doc, `#${cssEscape(el.id)}`, el)) {
    return `#${cssEscape(el.id)}`;
  }
  for (const attr of ['data-testid', 'data-test', 'data-qa', 'aria-label', 'name']) {
    const v = el.getAttribute(attr);
    if (v && v.length < 60) {
      const sel = `${el.localName}[${attr}="${v.replace(/"/g, '\\"')}"]`;
      if (isUnique(doc, sel, el)) return sel;
    }
  }
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && node !== doc.documentElement) {
    if (node !== el && node.id && /^[a-zA-Z][\w-]*$/.test(node.id)) {
      const idSel = `#${cssEscape(node.id)}`;
      if (isUnique(doc, idSel, node)) {
        parts.unshift(idSel);
        break;
      }
    }
    parts.unshift(segmentFor(node));
    const candidate = parts.join(' > ');
    if (isUnique(doc, candidate, el)) return candidate;
    node = node.parentElement;
  }
  const full = parts.join(' > ');
  return isUnique(doc, full, el) ? full : `html > ${full}`;
}

/** Human-friendly ancestry, e.g. `main > section.hero > h1`. */
export function describePath(el: Element, depth = 4): string {
  const parts: string[] = [];
  let node: Element | null = el;
  while (node && parts.length < depth && node.localName !== 'html' && node.localName !== 'body') {
    const cls = Array.from(node.classList).filter(isStableClass).slice(0, 1);
    parts.unshift(
      node.localName + (node.id ? `#${node.id}` : '') + cls.map((c) => `.${c}`).join(''),
    );
    node = node.parentElement;
  }
  return parts.join(' > ');
}

export function describeElement(el: Element): string {
  const cls = Array.from(el.classList).filter(isStableClass).slice(0, 2);
  return el.localName + (el.id ? `#${el.id}` : '') + cls.map((c) => `.${c}`).join('');
}

export function textExcerpt(el: Element, max = 140): string | undefined {
  const raw = (el as HTMLElement).innerText ?? el.textContent ?? '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function styleSummary(el: Element): Record<string, string> {
  const view = el.ownerDocument.defaultView;
  if (!view) return {};
  const cs = view.getComputedStyle(el);
  const out: Record<string, string> = {};
  for (const prop of STYLE_SUMMARY_PROPS) {
    const value = cs.getPropertyValue(prop).trim();
    if (
      prop === 'width' ||
      prop === 'height' ||
      prop === 'font-family' ||
      prop === 'font-size' ||
      prop === 'color'
    ) {
      if (value) out[prop] = value;
    } else if (!SKIP_VALUES.has(value) && !(prop === 'border' && value.startsWith('0px'))) {
      out[prop] = value;
    }
  }
  return out;
}

export function buildAnchor(el: Element): ElementAnchor {
  const anchor: ElementAnchor = {
    selector: uniqueSelector(el),
    path: describePath(el),
    tagName: el.localName,
    classList: Array.from(el.classList),
    rect: pageRect(el),
    styles: styleSummary(el),
  };
  if (el.id) anchor.id = el.id;
  const role = el.getAttribute('role');
  if (role) anchor.role = role;
  const label = el.getAttribute('aria-label');
  if (label) anchor.ariaLabel = label;
  const text = textExcerpt(el);
  if (text) anchor.text = text;
  return anchor;
}

export function resolveAnchor(anchor: ElementAnchor, doc: Document = document): Element | null {
  try {
    return doc.querySelector(anchor.selector);
  } catch {
    return null;
  }
}

/**
 * Where a pin attached to an element should be drawn now: the stored point, shifted by
 * however far the element moved since the anchor was taken (layout changes, resizes).
 */
export function currentAnchorPoint(
  point: Point,
  anchor: ElementAnchor | undefined,
  doc: Document = document,
): Point {
  if (!anchor) return point;
  const el = resolveAnchor(anchor, doc);
  if (!el) return point;
  const now = pageRect(el);
  if (now.width === 0 && now.height === 0) return point;
  return { x: point.x + (now.x - anchor.rect.x), y: point.y + (now.y - anchor.rect.y) };
}
