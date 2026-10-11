import { escapeHtml } from '../shared/escape';
import type { CaptureWarning, SanitizeReport } from '../shared/model';
import { FREEZE_CSS, resolveUrl, rewriteCssUrls, rewriteDeclarations, rewriteViewportUnits } from './css';
import {
  DROP_ATTRIBUTES,
  DROP_ELEMENTS,
  FRAME_ELEMENTS,
  isDangerousUrl,
  isEventHandlerAttribute,
  sanitizeInlineCss,
  URL_ATTRIBUTES,
} from './sanitize';

const SVG_NS = 'http://www.w3.org/2000/svg';
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';

const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
  'param',
  'keygen',
]);

export interface SnapshotContext {
  doc: Document;
  baseUrl: string;
  viewport: { width: number; height: number };
  /** Absolute URL → embedded data URL. */
  assets: ReadonlyMap<string, string>;
  /** Final (rewritten) CSS for `<style>` / `<link rel=stylesheet>` owner nodes. */
  stylesheetText: ReadonlyMap<Node, string>;
  /** Adopted stylesheets per root, already rewritten. */
  adoptedCss: ReadonlyMap<Document | ShadowRoot, string>;
  /** Elements to stamp with `data-cd-ref` (annotation anchors). */
  refs: ReadonlyMap<Element, string>;
  /** Pre-rendered data URLs for canvas / video elements. */
  mediaFrames: ReadonlyMap<Element, string>;
  /** Nodes that must never appear in the snapshot (the extension UI host). */
  skip: (node: Node) => boolean;
  /** Returns open or closed shadow roots (closed ones need chrome.dom). */
  shadowRootOf: (el: Element) => ShadowRoot | null;
  meta: { url: string; capturedAt: string };
  report: SanitizeReport;
  warnings: CaptureWarning[];
}

export function serializeSnapshot(ctx: SnapshotContext): string {
  const out: string[] = ['<!DOCTYPE html>\n'];
  emitElement(ctx.doc.documentElement, ctx, out);
  return out.join('');
}

function emitChildren(parent: ParentNode, ctx: SnapshotContext, out: string[]): void {
  for (let child = parent.firstChild; child; child = child.nextSibling) emitNode(child, ctx, out);
}

function emitNode(node: Node, ctx: SnapshotContext, out: string[]): void {
  if (ctx.skip(node)) return;
  switch (node.nodeType) {
    case 1:
      emitElement(node as Element, ctx, out);
      break;
    case 3:
      out.push(escapeText(node.nodeValue ?? ''));
      break;
    default:
      // Comments, processing instructions and CDATA are dropped.
      break;
  }
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/ /g, '&nbsp;');
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/ /g, '&nbsp;');
}

function absolutize(value: string, base: string): string {
  const v = value.trim();
  if (!v || v.startsWith('#') || /^(data|blob|mailto|tel):/i.test(v)) return v;
  return resolveUrl(v, base) ?? v;
}

function absolutizeSrcset(value: string, base: string): string {
  if (/data:/i.test(value)) return value;
  return value
    .split(/,\s+/)
    .map((candidate) => {
      const [url = '', ...rest] = candidate.trim().split(/\s+/);
      return [absolutize(url, base), ...rest].join(' ');
    })
    .join(', ');
}

function styleCss(css: string): string {
  // `</style` would end the raw-text element early.
  return css.replace(/<\/(style)/gi, '<\\/$1');
}

function isHtml(el: Element): boolean {
  return el.namespaceURI !== SVG_NS && el.namespaceURI !== MATHML_NS;
}

function emitElement(el: Element, ctx: SnapshotContext, out: string[]): void {
  if (ctx.skip(el)) return;
  const name = el.localName;
  const lower = name.toLowerCase();
  const html = isHtml(el);

  if (DROP_ELEMENTS.has(lower)) {
    if (lower === 'script') ctx.report.scripts++;
    else ctx.report.other++;
    return;
  }
  if (!html && (lower === 'animate' || lower === 'set') && /href/i.test(el.getAttribute('attributeName') ?? '')) {
    ctx.report.other++;
    return;
  }

  if (html) {
    if (lower === 'meta') {
      if (el.hasAttribute('http-equiv') || el.hasAttribute('charset')) return;
    } else if (lower === 'link') {
      emitLink(el, ctx, out);
      return;
    } else if (lower === 'style') {
      const css = ctx.stylesheetText.get(el) ?? rewriteSheetText(el.textContent ?? '', ctx.baseUrl, ctx);
      const media = el.getAttribute('media');
      out.push(`<style${media ? ` media="${escapeAttr(media)}"` : ''}>${styleCss(css)}</style>`);
      return;
    } else if (FRAME_ELEMENTS.has(lower)) {
      emitPlaceholder(el, ctx, out);
      return;
    } else if (lower === 'canvas' || lower === 'video') {
      emitMediaFrame(el, ctx, out);
      return;
    } else if (lower === 'audio' || lower === 'track') {
      ctx.report.other++;
      return;
    } else if (lower === 'source' && el.parentElement?.localName === 'picture') {
      const img = el.parentElement.querySelector('img');
      if (img && ctx.assets.has(currentImageUrl(img as HTMLImageElement, ctx.baseUrl))) return;
    }
  }

  const attrs = collectAttributes(el, ctx);
  applyLiveState(el, attrs, ctx);
  const ref = ctx.refs.get(el);
  if (ref) attrs.set('data-cd-ref', ref);

  out.push(`<${name}`);
  for (const [k, v] of attrs) out.push(v === '' && k !== 'value' && k !== 'alt' ? ` ${k}` : ` ${k}="${escapeAttr(v)}"`);
  out.push('>');

  if (html && VOID_ELEMENTS.has(lower)) return;

  if (lower === 'head' && html) {
    out.push(
      `<meta charset="utf-8"><meta name="chrome-design-snapshot" content="${escapeAttr(`${ctx.meta.url} @ ${ctx.meta.capturedAt}`)}">`,
    );
  }

  const shadow = ctx.shadowRootOf(el);
  if (shadow) {
    out.push('<template shadowrootmode="open">');
    const adopted = ctx.adoptedCss.get(shadow);
    if (adopted) out.push(`<style data-cd-adopted>${styleCss(adopted)}</style>`);
    emitChildren(shadow, ctx, out);
    out.push('</template>');
  }

  if (html && lower === 'textarea') {
    const value = (el as HTMLTextAreaElement).value;
    out.push(value.startsWith('\n') ? `\n${escapeText(value)}` : escapeText(value));
  } else if (!html && lower === 'style') {
    // SVG <style> is parsed as normal markup, so escape it as text.
    const css = rewriteSheetText(el.textContent ?? '', ctx.baseUrl, ctx);
    out.push(escapeText(css));
  } else {
    if (html && (lower === 'pre' || lower === 'listing') && el.firstChild?.nodeType === 3) {
      if ((el.firstChild.nodeValue ?? '').startsWith('\n')) out.push('\n');
    }
    emitChildren(el, ctx, out);
  }

  if (lower === 'head' && html) {
    const adopted = ctx.adoptedCss.get(ctx.doc);
    if (adopted) out.push(`<style data-cd-adopted>${styleCss(adopted)}</style>`);
    out.push(`<style data-cd-freeze>${FREEZE_CSS}</style>`);
  }
  out.push(`</${name}>`);
}

function rewriteSheetText(css: string, base: string, ctx: SnapshotContext): string {
  return rewriteViewportUnits(rewriteCssUrls(css, base, ctx.assets), ctx.viewport);
}

function collectAttributes(el: Element, ctx: SnapshotContext): Map<string, string> {
  const attrs = new Map<string, string>();
  const lowerTag = el.localName.toLowerCase();
  for (const attr of Array.from(el.attributes)) {
    const name = attr.name;
    const lower = name.toLowerCase();
    let value = attr.value;
    if (isEventHandlerAttribute(lower)) {
      ctx.report.eventHandlers++;
      continue;
    }
    if (DROP_ATTRIBUTES.has(lower)) {
      if (lower === 'action' || lower === 'formaction' || lower === 'srcdoc') ctx.report.other++;
      continue;
    }
    if (lower.startsWith('data-cd-')) continue;
    if (lower === 'style') {
      value = sanitizeInlineCss(rewriteDeclarations(rewriteCssUrls(value, ctx.baseUrl, ctx.assets), ctx.viewport));
    } else if (URL_ATTRIBUTES.has(lower)) {
      if (isDangerousUrl(value)) {
        ctx.report.javascriptUrls++;
        continue;
      }
      value = absolutize(value, ctx.baseUrl);
      const embedded = ctx.assets.get(value);
      if (embedded && lower !== 'cite' && !(lowerTag === 'a' && lower === 'href')) value = embedded;
    } else if (lower === 'srcset' || lower === 'imagesrcset') {
      value = absolutizeSrcset(value, ctx.baseUrl);
    }
    attrs.set(name, value);
  }
  return attrs;
}

export function currentImageUrl(img: HTMLImageElement, base: string): string {
  const raw = img.currentSrc || img.getAttribute('src') || '';
  return absolutize(raw, base);
}

/** Reflect live DOM state (form values, open state, chosen image source, scroll offsets). */
function applyLiveState(el: Element, attrs: Map<string, string>, ctx: SnapshotContext): void {
  const tag = el.localName.toLowerCase();
  if (tag === 'img') {
    const img = el as HTMLImageElement;
    const url = currentImageUrl(img, ctx.baseUrl);
    const embedded = ctx.assets.get(url);
    if (embedded) {
      attrs.set('src', embedded);
      attrs.delete('srcset');
      attrs.delete('sizes');
    } else if (url && !attrs.has('src')) {
      attrs.set('src', url);
    }
  } else if (tag === 'input') {
    const input = el as HTMLInputElement;
    const type = (input.type || 'text').toLowerCase();
    if (type === 'checkbox' || type === 'radio') {
      if (input.checked) attrs.set('checked', '');
      else attrs.delete('checked');
    } else if (type === 'password') {
      attrs.set('value', input.value ? '••••••••' : '');
    } else if (type !== 'file' && type !== 'image' && type !== 'hidden') {
      attrs.set('value', input.value);
    }
  } else if (tag === 'option') {
    if ((el as HTMLOptionElement).selected) attrs.set('selected', '');
    else attrs.delete('selected');
  } else if (tag === 'details' || tag === 'dialog') {
    if ((el as HTMLDetailsElement).open) attrs.set('open', '');
    else attrs.delete('open');
  }
  if (tag !== 'html' && tag !== 'body') {
    const { scrollTop, scrollLeft } = el;
    if (scrollTop > 0 || scrollLeft > 0) attrs.set('data-cd-scroll', `${Math.round(scrollTop)},${Math.round(scrollLeft)}`);
  }
}

function emitLink(el: Element, ctx: SnapshotContext, out: string[]): void {
  const rel = (el.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
  if (!rel.includes('stylesheet')) return;
  const css = ctx.stylesheetText.get(el);
  if (css === undefined) return;
  const href = absolutize(el.getAttribute('href') ?? '', ctx.baseUrl);
  out.push(`<style data-cd-from="${escapeAttr(href)}">${styleCss(css)}</style>`);
}

function sizeStyle(el: Element): { width: number; height: number; display: string } {
  const rect = el.getBoundingClientRect();
  const view = el.ownerDocument.defaultView;
  const display = view ? view.getComputedStyle(el).display : 'block';
  return { width: Math.round(rect.width), height: Math.round(rect.height), display };
}

function keepIdentity(el: Element): string {
  const parts: string[] = [];
  for (const name of ['id', 'class']) {
    const v = el.getAttribute(name);
    if (v) parts.push(` ${name}="${escapeAttr(v)}"`);
  }
  return parts.join('');
}

function emitPlaceholder(el: Element, ctx: SnapshotContext, out: string[]): void {
  const tag = el.localName.toLowerCase();
  if (tag === 'object' || tag === 'embed') ctx.report.embeds++;
  else ctx.report.frames++;
  const src = absolutize(el.getAttribute('src') ?? el.getAttribute('data') ?? '', ctx.baseUrl);
  const { width, height, display } = sizeStyle(el);
  if (width === 0 && height === 0) return;
  let host = 'inline content';
  try {
    if (src) host = new URL(src).host || src;
  } catch {
    host = src;
  }
  ctx.warnings.push({
    code: 'frame-not-captured',
    message: `Embedded <${tag}> was replaced by a placeholder (${width}×${height}).`,
    ...(src ? { url: src } : {}),
  });
  const ref = ctx.refs.get(el);
  const style = `display:${display === 'inline' ? 'inline-flex' : 'flex'};align-items:center;justify-content:center;width:${width}px;height:${height}px;box-sizing:border-box;border:1px dashed #94a3b8;background:repeating-linear-gradient(45deg,#f1f5f9 0 10px,#e2e8f0 10px 20px);color:#475569;font:12px/1.4 system-ui,sans-serif;overflow:hidden;text-align:center`;
  out.push(
    `<div data-cd-placeholder="${tag}"${keepIdentity(el)}${ref ? ` data-cd-ref="${ref}"` : ''} title="${escapeAttr(src || tag)}" style="${style}">${escapeText(`Embedded ${tag} not captured — ${host}`)}</div>`,
  );
}

function emitMediaFrame(el: Element, ctx: SnapshotContext, out: string[]): void {
  const tag = el.localName.toLowerCase();
  const { width, height, display } = sizeStyle(el);
  const frame = ctx.mediaFrames.get(el);
  const ref = ctx.refs.get(el);
  const styleAttr = el.getAttribute('style');
  const style = `${styleAttr ? `${sanitizeInlineCss(rewriteDeclarations(styleAttr, ctx.viewport))};` : ''}width:${width}px;height:${height}px;display:${display === 'inline' ? 'inline-block' : display};object-fit:cover`;
  if (frame) {
    out.push(
      `<img data-cd-flattened="${tag}"${keepIdentity(el)}${ref ? ` data-cd-ref="${ref}"` : ''} alt="${escapeAttr(`Flattened ${tag}`)}" src="${escapeAttr(frame)}" style="${escapeAttr(style)}">`,
    );
    return;
  }
  if (width === 0 && height === 0) return;
  out.push(
    `<div data-cd-placeholder="${tag}"${keepIdentity(el)}${ref ? ` data-cd-ref="${ref}"` : ''} style="${escapeAttr(`${style};background:#0f172a;color:#cbd5e1;font:12px system-ui,sans-serif;display:flex;align-items:center;justify-content:center`)}">${escapeText(`${tag} (not captured)`)}</div>`,
  );
}
