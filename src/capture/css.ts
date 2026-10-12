/**
 * Pure CSS text transforms used when building the static snapshot.
 * Regex-based on purpose: we only touch `url()` tokens, `@import` and viewport units.
 */

const URL_RE = /url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)'"\s]*))\s*\)/gi;
const IMPORT_RE = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)["']?\s*\)?([^;]*);/gi;

export function resolveUrl(raw: string, base: string): string | null {
  const value = raw.trim();
  if (!value || value.startsWith('#')) return null;
  try {
    return new URL(value, base).href;
  } catch {
    return null;
  }
}

/** Absolute URLs referenced by `url()` in a stylesheet. data: URLs are skipped. */
export function extractCssUrls(css: string, base: string): string[] {
  const out = new Set<string>();
  for (const match of css.matchAll(URL_RE)) {
    const raw = match[1] ?? match[2] ?? match[3] ?? '';
    if (/^data:/i.test(raw.trim())) continue;
    const abs = resolveUrl(raw, base);
    if (abs && /^(https?|blob):/i.test(abs)) out.add(abs);
  }
  return [...out];
}

/**
 * Rewrite every `url()` to an absolute URL, or to its embedded data URL when present in `assets`.
 * Fragment-only references (`url(#clip)`) are left alone.
 */
export function rewriteCssUrls(
  css: string,
  base: string,
  assets: ReadonlyMap<string, string>,
  /** Replace remote URLs that were not embedded, so the snapshot never touches the network. */
  offline = false,
): string {
  return css.replace(
    URL_RE,
    (whole, dq: string | undefined, sq: string | undefined, bare: string | undefined) => {
      const raw = (dq ?? sq ?? bare ?? '').trim();
      if (!raw || raw.startsWith('#') || /^data:/i.test(raw)) return whole;
      if (/^javascript:/i.test(raw)) return 'url("")';
      const abs = resolveUrl(raw, base);
      if (!abs) return whole;
      const embedded = assets.get(abs);
      if (!embedded && offline && /^(https?|blob):/i.test(abs)) {
        return `url("data:,") /* cd-missing: ${abs.replace(/\*\//g, '*%2F')} */`;
      }
      return `url("${(embedded ?? abs).replace(/"/g, '%22')}")`;
    },
  );
}

export interface CssImport {
  url: string;
  /** Media / layer / supports conditions after the URL. */
  condition: string;
  statement: string;
}

export function extractImports(css: string, base: string): CssImport[] {
  const out: CssImport[] = [];
  for (const match of css.matchAll(IMPORT_RE)) {
    const abs = resolveUrl(match[1] ?? '', base);
    if (abs) out.push({ url: abs, condition: (match[2] ?? '').trim(), statement: match[0] });
  }
  return out;
}

/** Wrap CSS in a media block (for `<link media>` / `@import … screen`). */
export function wrapMedia(css: string, media: string): string {
  const m = media.trim();
  if (!m || m === 'all') return css;
  return `@media ${m} {\n${css}\n}`;
}

/**
 * Inside `@font-face` blocks keep a single source: woff2 if present, else the first url().
 * This avoids embedding the same font 3–4 times in different formats.
 */
export function simplifyFontFaceSources(css: string): string {
  return css.replace(/@font-face\s*\{[^}]*\}/gi, (block) => {
    const decls = [...block.matchAll(/src\s*:\s*([^;}]+);?/gi)];
    const entries = decls.flatMap((m) => splitTopLevel(m[1] ?? '')).map((e) => e.trim());
    const urls = entries.filter((e) => /url\(/i.test(e));
    if (urls.length <= 1) return block;
    const preferred =
      urls.find((e) => /format\(\s*["']?woff2/i.test(e) || /\.woff2(\?|#|["')])/i.test(e)) ??
      urls.find((e) => /format\(\s*["']?woff["')]/i.test(e)) ??
      urls[0];
    let replaced = false;
    return block.replace(/src\s*:\s*([^;}]+);?/gi, () => {
      if (replaced) return '';
      replaced = true;
      return `src: ${preferred};`;
    });
  });
}

function splitTopLevel(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let current = '';
  for (const ch of value) {
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current);
  return out;
}

/**
 * Replace viewport-height based units with fixed px values. The snapshot iframe is as tall
 * as the whole document, so `100vh` would otherwise stretch to the full page height.
 * Width units are rewritten too so the snapshot keeps its layout when the viewer is narrower.
 */
export function rewriteViewportUnits(
  css: string,
  viewport: { width: number; height: number },
): string {
  if (!/\d(?:s|l|d)?v(?:h|w|min|max|b|i)\b/i.test(css)) return css;
  // Only declaration values are rewritten; selectors and at-rule preludes stay untouched
  // (e.g. Tailwind's `.h-\[100vh\]` selector must keep matching its class).
  let out = '';
  let segment = '';
  let quote: string | null = null;
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]!;
    if (quote) {
      segment += ch;
      if (ch === '\\') {
        segment += css[++i] ?? '';
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      segment += ch;
    } else if (ch === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      const stop = end === -1 ? css.length : end + 2;
      segment += css.slice(i, stop);
      i = stop - 1;
    } else if (ch === '{') {
      out += `${segment}{`;
      segment = '';
    } else if (ch === ';' || ch === '}') {
      out += `${rewriteDeclarations(segment, viewport)}${ch}`;
      segment = '';
    } else {
      segment += ch;
    }
  }
  return out + rewriteDeclarations(segment, viewport);
}

/** Rewrite viewport units in a declaration list (`a: 1vh; b: 2vw`), e.g. a style attribute. */
export function rewriteDeclarations(
  text: string,
  viewport: { width: number; height: number },
): string {
  const colon = text.indexOf(':');
  if (colon === -1) return text;
  if (text.includes(';')) {
    return text
      .split(';')
      .map((part) => rewriteDeclarations(part, viewport))
      .join(';');
  }
  return text.slice(0, colon + 1) + replaceUnits(text.slice(colon + 1), viewport);
}

function replaceUnits(value: string, viewport: { width: number; height: number }): string {
  const { width, height } = viewport;
  const vmin = Math.min(width, height);
  const vmax = Math.max(width, height);
  return value.replace(
    /(^|[^\w.#-])(-?(?:\d+\.?\d*|\.\d+))(s|l|d)?(vh|vw|vmin|vmax|vb|vi)\b/gi,
    (_m, pre: string, num: string, _variant: string | undefined, unit: string) => {
      const n = Number.parseFloat(num);
      const u = unit.toLowerCase();
      const basis =
        u === 'vh' || u === 'vb'
          ? height
          : u === 'vw' || u === 'vi'
            ? width
            : u === 'vmin'
              ? vmin
              : vmax;
      const px = Math.round(((n * basis) / 100) * 100) / 100;
      return `${pre}${px}px`;
    },
  );
}

/** Freeze motion in the snapshot: animations jump to their end state, transitions are disabled. */
export const FREEZE_CSS =
  '*,*::before,*::after{animation-duration:0s!important;animation-delay:0s!important;animation-iteration-count:1!important;transition:none!important;scroll-behavior:auto!important;caret-color:transparent!important}';
