/**
 * Sanitization policy for the static snapshot. The snapshot is additionally rendered in a
 * sandboxed iframe (no `allow-scripts`) under a CSP of `default-src 'none'`, so this is one
 * of three independent layers.
 */

/** Elements removed outright (content included). */
export const DROP_ELEMENTS = new Set([
  'script',
  'noscript',
  'base',
  'template',
  'xmp',
  'plaintext',
  'noembed',
  'noframes',
  'applet',
  'param',
]);

/** Embedded browsing contexts / plugins replaced with a same-size placeholder box. */
export const FRAME_ELEMENTS = new Set([
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'portal',
  'fencedframe',
]);

/** Attributes that can carry a URL (subject to scheme checks and absolutisation). */
export const URL_ATTRIBUTES = new Set([
  'href',
  'src',
  'xlink:href',
  'action',
  'formaction',
  'poster',
  'background',
  'data',
  'cite',
  'longdesc',
  'manifest',
  'codebase',
  'lowsrc',
  'dynsrc',
  'ping',
]);

/** Attributes that are always dropped. */
export const DROP_ATTRIBUTES = new Set([
  'srcdoc',
  'nonce',
  'integrity',
  'ping',
  'formaction',
  'action',
  'autofocus',
  'http-equiv',
  'loading',
  'fetchpriority',
  'decoding',
  'is',
  'popovertarget',
  'commandfor',
]);

/** True for event handler attributes (`onclick`, `onLoad`, `onanimationend`, …). */
export function isEventHandlerAttribute(name: string): boolean {
  return /^on/i.test(name);
}

/**
 * Schemes that can execute code or render active documents. Whitespace and control
 * characters are stripped first, matching how browsers parse URL schemes.
 */
export function isDangerousUrl(value: string): boolean {
  let normalised = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code > 0x20 && (code < 0x7f || code > 0x9f)) normalised += ch;
  }
  normalised = normalised.toLowerCase();
  if (/^(javascript|vbscript|livescript|mocha):/.test(normalised)) return true;
  // Document-like data URLs could render active content; image/font data URLs are inert.
  return /^data:(text\/html|application\/xhtml|text\/xml|application\/xml|text\/javascript|application\/javascript)/.test(
    normalised,
  );
}

/** Strip any `expression(` / `-moz-binding` legacy script vectors from inline CSS. */
export function sanitizeInlineCss(css: string): string {
  return css.replace(/expression\s*\(/gi, 'invalid(').replace(/-moz-binding\s*:/gi, '-x-binding:');
}

export function emptySanitizeReport() {
  return { scripts: 0, eventHandlers: 0, javascriptUrls: 0, frames: 0, embeds: 0, other: 0 };
}
