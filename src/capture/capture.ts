import type { CaptureWarning, ElementAnchor, PageCapture, PageMeta } from '../shared/model';
import { resolveAnchor } from './anchor';
import {
  AssetEmbedder,
  type AssetFetcher,
  DEFAULT_EMBED_LIMITS,
  decodeDataUrlText,
} from './assets';
import {
  extractCssUrls,
  extractImports,
  resolveUrl,
  rewriteCssUrls,
  rewriteViewportUnits,
  simplifyFontFaceSources,
  wrapMedia,
} from './css';
import { recordMediaAnswers } from './media';
import { emptySanitizeReport } from './sanitize';
import { currentImageUrl, serializeSnapshot } from './serialize';

export type CaptureStage = 'styles' | 'assets' | 'snapshot' | 'screenshot' | 'done';

export interface CaptureOptions {
  doc?: Document;
  /** Excludes the extension UI from every serialization. */
  skip: (node: Node) => boolean;
  /** Anchors to stamp as `data-cd-ref` in the snapshot. */
  anchors: ElementAnchor[];
  fetchers: AssetFetcher[];
  includeSource: boolean;
  screenshot?: () => Promise<{ dataUrl: string; width: number; height: number } | null>;
  onProgress?: (stage: CaptureStage, detail?: string) => void;
  limits?: Partial<typeof DEFAULT_EMBED_LIMITS>;
  shadowRootOf?: (el: Element) => ShadowRoot | null;
  /**
   * Page facts to record instead of reading them from `doc` (re-exporting from a handoff file,
   * where the document is a copy of a page that lives elsewhere).
   */
  meta?: PageMeta;
}

export interface CaptureResult {
  capture: PageCapture;
  /** anchor selector → data-cd-ref value */
  refs: Map<string, string>;
}

interface SheetSource {
  owner: Node;
  css: string;
  base: string;
}

export function defaultShadowRootOf(el: Element): ShadowRoot | null {
  const dom = typeof chrome !== 'undefined' ? chrome.dom : undefined;
  if (dom?.openOrClosedShadowRoot && el instanceof HTMLElement) {
    try {
      return (dom.openOrClosedShadowRoot(el) as ShadowRoot | null) ?? null;
    } catch {
      return el.shadowRoot;
    }
  }
  return el.shadowRoot;
}

export function collectPageMeta(doc: Document): PageMeta {
  const view = doc.defaultView ?? window;
  const root = doc.documentElement;
  const body = doc.body;
  return {
    url: doc.location?.href ?? doc.URL,
    title: doc.title,
    lang: root.lang || '',
    charset: doc.characterSet,
    capturedAt: new Date().toISOString(),
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    userAgent: view.navigator.userAgent,
    colorScheme: view.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
    viewport: {
      width: root.clientWidth || view.innerWidth,
      height: view.innerHeight,
      devicePixelRatio: view.devicePixelRatio || 1,
    },
    scroll: { x: Math.round(view.scrollX), y: Math.round(view.scrollY) },
    document: {
      width: Math.max(root.scrollWidth, body?.scrollWidth ?? 0),
      height: Math.max(root.scrollHeight, body?.scrollHeight ?? 0),
    },
  };
}

function collectRoots(
  doc: Document,
  skip: (n: Node) => boolean,
  shadowRootOf: (el: Element) => ShadowRoot | null,
) {
  const roots: (Document | ShadowRoot)[] = [doc];
  const visit = (root: Document | ShadowRoot) => {
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: (n) => (skip(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const sr = shadowRootOf(n as Element);
      if (sr) {
        roots.push(sr);
        visit(sr);
      }
    }
  };
  visit(doc);
  return roots;
}

function rulesText(sheet: CSSStyleSheet | null | undefined): string | null {
  if (!sheet) return null;
  try {
    return Array.from(sheet.cssRules, (r) => r.cssText).join('\n');
  } catch {
    return null; // cross-origin without CORS
  }
}

async function fetchCssText(url: string, fetchers: AssetFetcher[]): Promise<string | null> {
  for (const fetcher of fetchers) {
    try {
      const result = await fetcher(url, 10 * 1024 * 1024);
      if (result.ok) {
        const text = decodeDataUrlText(result.dataUrl);
        if (text !== null) return text;
      }
    } catch {
      // try next strategy
    }
  }
  return null;
}

async function inlineImports(
  css: string,
  base: string,
  fetchers: AssetFetcher[],
  warnings: CaptureWarning[],
  depth = 0,
): Promise<string> {
  const imports = extractImports(css, base);
  if (imports.length === 0) return css;
  let result = css;
  for (const imp of imports) {
    let text = depth < 4 ? await fetchCssText(imp.url, fetchers) : null;
    if (text === null) {
      warnings.push({
        code: 'stylesheet-unreadable',
        message: 'Imported stylesheet could not be read.',
        url: imp.url,
      });
      result = result.replace(imp.statement, '');
      continue;
    }
    text = await inlineImports(text, imp.url, fetchers, warnings, depth + 1);
    text = rewriteCssUrls(text, imp.url, new Map());
    const layer = /^layer(?:\(([^)]*)\))?/i.exec(imp.condition);
    let wrapped = text;
    if (layer) {
      wrapped = `@layer${layer[1] ? ` ${layer[1]}` : ''} {\n${text}\n}`;
      const rest = imp.condition.slice(layer[0].length).trim();
      if (rest) wrapped = wrapMedia(wrapped, rest);
    } else if (imp.condition) {
      wrapped = wrapMedia(text, imp.condition);
    }
    result = result.replace(imp.statement, wrapped);
  }
  return result;
}

async function gatherStylesheets(
  roots: (Document | ShadowRoot)[],
  doc: Document,
  skip: (n: Node) => boolean,
  fetchers: AssetFetcher[],
  warnings: CaptureWarning[],
): Promise<{ sheets: SheetSource[]; adopted: Map<Document | ShadowRoot, SheetSource[]> }> {
  const sheets: SheetSource[] = [];
  const adopted = new Map<Document | ShadowRoot, SheetSource[]>();
  const base = doc.baseURI;
  for (const root of roots) {
    const owners = Array.from(root.querySelectorAll('style, link[rel~="stylesheet" i]')).filter(
      (n) => !skip(n),
    );
    for (const owner of owners) {
      if (owner.localName === 'style') {
        const text = owner.textContent ?? '';
        const css = text.trim()
          ? text
          : (rulesText((owner as HTMLStyleElement).sheet as CSSStyleSheet) ?? '');
        sheets.push({ owner, css: await inlineImports(css, base, fetchers, warnings), base });
        continue;
      }
      const link = owner as HTMLLinkElement;
      if (link.disabled) continue;
      const href = resolveUrl(link.getAttribute('href') ?? '', base);
      if (!href) continue;
      let css = await fetchCssText(href, fetchers);
      if (css === null) css = rulesText(link.sheet as CSSStyleSheet);
      if (css === null) {
        warnings.push({
          code: 'stylesheet-unreadable',
          message:
            'Stylesheet could not be read (cross-origin without CORS). The snapshot may look unstyled in places.',
          url: href,
        });
        continue;
      }
      css = await inlineImports(css, href, fetchers, warnings);
      sheets.push({ owner, css: wrapMedia(css, link.media), base: href });
    }
    const adoptedSheets =
      (root as Document & { adoptedStyleSheets?: CSSStyleSheet[] }).adoptedStyleSheets ?? [];
    const texts = adoptedSheets.map((s) => rulesText(s)).filter((t): t is string => !!t);
    if (texts.length)
      adopted.set(
        root,
        texts.map((css) => ({ owner: root, css, base })),
      );
  }
  for (const s of sheets) s.css = simplifyFontFaceSources(s.css);
  return { sheets, adopted };
}

function collectDomAssetUrls(
  roots: (Document | ShadowRoot)[],
  skip: (n: Node) => boolean,
  base: string,
): string[] {
  const urls: string[] = [];
  const add = (raw: string | null | undefined) => {
    if (!raw || raw.startsWith('data:')) return;
    const abs = resolveUrl(raw, base);
    if (abs && /^(https?|blob):/i.test(abs)) urls.push(abs);
  };
  for (const root of roots) {
    for (const el of Array.from(
      root.querySelectorAll('img, input[type="image" i], video[poster], image, [style*="url("]'),
    )) {
      if (skip(el)) continue;
      const tag = el.localName.toLowerCase();
      if (tag === 'img') add(currentImageUrl(el as HTMLImageElement, base));
      else if (tag === 'input') add(el.getAttribute('src'));
      else if (tag === 'video') add(el.getAttribute('poster'));
      else if (tag === 'image') add(el.getAttribute('href') ?? el.getAttribute('xlink:href'));
      const style = el.getAttribute('style');
      if (style) urls.push(...extractCssUrls(style, base));
    }
  }
  return urls;
}

function canvasFromImage(img: HTMLImageElement): string | null {
  if (!img.complete || img.naturalWidth === 0) return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.getContext('2d')?.drawImage(img, 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    return null; // tainted
  }
}

function mediaFrame(
  el: Element,
  embedded: Map<string, string>,
  base: string,
  warnings: CaptureWarning[],
): string | null {
  if (el instanceof HTMLCanvasElement) {
    try {
      return el.toDataURL('image/png');
    } catch {
      warnings.push({
        code: 'canvas-tainted',
        message: 'A <canvas> contains cross-origin pixels and was replaced by a placeholder.',
      });
      return null;
    }
  }
  if (el instanceof HTMLVideoElement) {
    if (el.readyState >= 2 && el.videoWidth > 0) {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = el.videoWidth;
        canvas.height = el.videoHeight;
        canvas.getContext('2d')?.drawImage(el, 0, 0);
        const data = canvas.toDataURL('image/jpeg', 0.85);
        warnings.push({
          code: 'media-flattened',
          message: 'A <video> was flattened to its current frame.',
        });
        return data;
      } catch {
        // fall through to poster
      }
    }
    const poster = resolveUrl(el.getAttribute('poster') ?? '', base);
    if (poster && embedded.has(poster)) return embedded.get(poster)!;
    warnings.push({
      code: 'media-flattened',
      message: 'A <video> could not be captured and was replaced by a placeholder.',
    });
  }
  return null;
}

function serializeSource(doc: Document, skip: (n: Node) => boolean): string {
  const root = doc.documentElement;
  // Collect the extension UI hosts (subtrees are rejected, so nested matches are not visited).
  const skipped: Element[] = [];
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
    acceptNode: (n) => {
      if (!skip(n)) return NodeFilter.FILTER_ACCEPT;
      skipped.push(n as Element);
      return NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) {
    // walk to collect
  }
  // outerHTML does not include shadow content, so removing the host markup is exact.
  let html = root.outerHTML;
  for (const el of skipped) html = html.replace(el.outerHTML, '');
  const dt = doc.doctype;
  const doctype = dt
    ? `<!DOCTYPE ${dt.name}${dt.publicId ? ` PUBLIC "${dt.publicId}"` : ''}${dt.systemId ? ` "${dt.systemId}"` : ''}>\n`
    : '';
  return doctype + html;
}

export async function capturePage(options: CaptureOptions): Promise<CaptureResult> {
  const doc = options.doc ?? document;
  const skip = options.skip;
  const shadowRootOf = options.shadowRootOf ?? defaultShadowRootOf;
  const warnings: CaptureWarning[] = [];
  const report = emptySanitizeReport();
  const meta = options.meta ?? collectPageMeta(doc);
  const base = doc.baseURI;

  options.onProgress?.('styles');
  const roots = collectRoots(doc, skip, shadowRootOf);
  const { sheets, adopted } = await gatherStylesheets(roots, doc, skip, options.fetchers, warnings);

  options.onProgress?.('assets');
  const domUrls = collectDomAssetUrls(roots, skip, base);
  const cssUrls = sheets.flatMap((s) => extractCssUrls(s.css, s.base));
  for (const list of adopted.values())
    for (const s of list) cssUrls.push(...extractCssUrls(s.css, s.base));
  const embedder = new AssetEmbedder({
    fetchers: options.fetchers,
    ...DEFAULT_EMBED_LIMITS,
    ...options.limits,
    onProgress: (done, total) => options.onProgress?.('assets', `${done}/${total}`),
  });
  await embedder.embedAll([...domUrls, ...cssUrls]);

  // Canvas fallback for images that are loaded but not fetchable (works for same-origin / CORS images).
  for (const root of roots) {
    for (const img of Array.from(root.querySelectorAll('img'))) {
      const url = currentImageUrl(img, base);
      if (!embedder.failures.has(url)) continue;
      const data = canvasFromImage(img);
      if (data) embedder.add(url, data, Math.round(data.length * 0.75));
    }
  }

  const mediaFrames = new Map<Element, string>();
  for (const root of roots) {
    for (const el of Array.from(root.querySelectorAll('canvas, video'))) {
      if (skip(el)) continue;
      const frame = mediaFrame(el, embedder.embedded, base, warnings);
      if (frame) mediaFrames.set(el, frame);
    }
  }

  const viewport = { width: meta.viewport.width, height: meta.viewport.height };
  const finalCss = (s: SheetSource) =>
    rewriteViewportUnits(rewriteCssUrls(s.css, s.base, embedder.embedded, true), viewport);
  const stylesheetText = new Map<Node, string>(sheets.map((s) => [s.owner, finalCss(s)]));
  const adoptedCss = new Map<Document | ShadowRoot, string>();
  for (const [root, list] of adopted) adoptedCss.set(root, list.map(finalCss).join('\n'));
  if (!options.meta) {
    const attributeQueries = roots.flatMap((root) =>
      Array.from(root.querySelectorAll('style[media], link[media]'))
        .filter((el) => !skip(el))
        .map((el) => el.getAttribute('media') ?? ''),
    );
    const answers = recordMediaAnswers(
      [...stylesheetText.values(), ...adoptedCss.values()],
      attributeQueries,
      (q) => (doc.defaultView ?? window).matchMedia(q).matches,
    );
    if (Object.keys(answers).length) meta.media = answers;
  }

  const refsByElement = new Map<Element, string>();
  const refs = new Map<string, string>();
  let refCounter = 0;
  for (const anchor of options.anchors) {
    if (refs.has(anchor.selector)) continue;
    const el = resolveAnchor(anchor, doc);
    if (!el || skip(el)) continue;
    const existing = refsByElement.get(el);
    const ref = existing ?? `cd-${++refCounter}`;
    refsByElement.set(el, ref);
    refs.set(anchor.selector, ref);
  }

  options.onProgress?.('snapshot');
  const snapshotHtml = serializeSnapshot({
    doc,
    baseUrl: base,
    viewport,
    assets: embedder.embedded,
    stylesheetText,
    adoptedCss,
    refs: refsByElement,
    mediaFrames,
    skip,
    shadowRootOf,
    meta: { url: meta.url, capturedAt: meta.capturedAt },
    report,
    warnings,
  });

  for (const [url, reason] of embedder.failures) {
    warnings.push({
      code:
        reason.startsWith('too large') || reason.includes('budget')
          ? 'asset-too-large'
          : 'asset-not-embedded',
      message: `Asset not embedded: ${reason}. It will be missing from the offline snapshot.`,
      url,
    });
  }

  let screenshot: PageCapture['screenshot'];
  if (options.screenshot) {
    options.onProgress?.('screenshot');
    const shot = await options.screenshot().catch(() => null);
    if (shot) screenshot = shot;
    else
      warnings.push({
        code: 'screenshot-unavailable',
        message: 'Viewport screenshot could not be taken on this page.',
      });
  }

  options.onProgress?.('done');
  const capture: PageCapture = {
    meta,
    snapshotHtml,
    sourceHtml: options.includeSource ? serializeSource(doc, skip) : '',
    sanitize: report,
    assets: {
      embedded: embedder.embedded.size,
      embeddedBytes: embedder.bytes,
      failed: embedder.failures.size,
    },
    warnings: dedupeWarnings(warnings),
  };
  if (screenshot) capture.screenshot = screenshot;
  return { capture, refs };
}

function dedupeWarnings(warnings: CaptureWarning[]): CaptureWarning[] {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const key = `${w.code}|${w.url ?? ''}|${w.url ? '' : w.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
