import type { HiddenParts } from '../capture/serialize';
import { maskText } from '../capture/serialize';
import type { Annotation, AnnotationDoc, ElementAnchor, Rect } from '../shared/model';
import { isShape } from '../shared/model';

/**
 * Blurred boxes hide private things (names, emails, numbers) before a handoff is shared. In
 * screenshots the box is solid; in the page copy the text under it becomes dots and pictures
 * become grey boxes; text quoted in comment anchors is dotted too, and the page code (the
 * unsanitized original) is left out entirely.
 */

export function redactRects(doc: AnnotationDoc): Rect[] {
  return doc.annotations.flatMap((a) => (isShape(a) && a.kind === 'redact' ? [a.rect] : []));
}

function overlap(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

/** Share of `r`'s area under any of the boxes (0–1). */
export function coveredShare(r: Rect, boxes: readonly Rect[]): number {
  const area = r.width * r.height;
  if (area <= 0) return 0;
  return Math.min(1, boxes.reduce((sum, b) => sum + overlap(r, b), 0) / area);
}

const MEDIA = 'img, svg, canvas, video, picture, iframe, object, embed, input, textarea, select, a';

/** The page's text and elements under the boxes (live DOM, page coordinates). */
export function hiddenUnder(boxes: readonly Rect[], skip: (n: Node) => boolean): HiddenParts {
  const text = new Set<Node>();
  const elements = new Set<Element>();
  if (boxes.length === 0 || !document.body) return { text, elements };
  const sx = window.scrollX;
  const sy = window.scrollY;
  const page = (r: DOMRect): Rect => ({
    x: r.left + sx,
    y: r.top + sy,
    width: r.width,
    height: r.height,
  });
  const range = document.createRange();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.nodeValue?.trim() || skip(node.parentNode ?? node)) continue;
    const parent = node.parentElement;
    if (parent?.closest('chrome-design-root, [data-chrome-design]')) continue;
    range.selectNodeContents(node);
    const lines = Array.from(range.getClientRects()).map(page);
    if (lines.some((line) => coveredShare(line, boxes) >= 0.25)) text.add(node);
  }
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (el.closest('chrome-design-root, [data-chrome-design]')) continue;
    const r = page(el.getBoundingClientRect());
    if (coveredShare(r, boxes) < 0.5) continue;
    if (el.matches(MEDIA) || getComputedStyle(el).backgroundImage !== 'none') elements.add(el);
  }
  return { text, elements };
}

function maskAnchor(anchor: ElementAnchor, boxes: readonly Rect[]): ElementAnchor {
  if (!anchor.text || coveredShare(anchor.rect, boxes) < 0.25) return anchor;
  return { ...anchor, text: maskText(anchor.text) };
}

/** Comment anchors quote the element's text: dot it out where it's hidden. */
export function maskAnchors(doc: AnnotationDoc, boxes: readonly Rect[]): AnnotationDoc {
  if (boxes.length === 0) return doc;
  const annotations = doc.annotations.map((a): Annotation => {
    if (isShape(a)) {
      if (a.kind !== 'image' || !a.placement) return a;
      const { inside, covers } = a.placement;
      return {
        ...a,
        placement: {
          ...(inside ? { inside: maskAnchor(inside, boxes) } : {}),
          covers: covers.map((c) => maskAnchor(c, boxes)),
        },
      };
    }
    const t = a.target;
    if (t.type === 'region')
      return { ...a, target: { ...t, anchors: t.anchors.map((x) => maskAnchor(x, boxes)) } };
    if (t.type === 'element')
      return { ...a, target: { ...t, anchor: maskAnchor(t.anchor, boxes) } };
    if (t.type === 'point' && t.anchor)
      return { ...a, target: { ...t, anchor: maskAnchor(t.anchor, boxes) } };
    return a;
  });
  return { ...doc, annotations };
}
