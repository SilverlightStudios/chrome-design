/**
 * Serialization helpers for embedding untrusted text inside the exported HTML file.
 * Every helper here is pure and reversible so the payload stays recoverable.
 */

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Escape text for an HTML text node or a quoted attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch);
}

/**
 * JSON for a `<script type="application/json">` block: `<`, `>`, `&`, U+2028 and U+2029
 * are emitted as unicode escapes so the block can never be closed early.
 * `JSON.parse(block.textContent)` returns the original value.
 */
export function jsonForScript(value: unknown, space?: number): string {
  return JSON.stringify(value, null, space)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

/**
 * Raw HTML inside `<script type="text/html">`. Only `</script` and `<!--` can change the
 * tokenizer state there, so those (case-insensitive) get a backslash after `<`.
 * Existing `<\…script` / `<\…!--` runs get one extra backslash, making it bijective.
 * Reverse with `unescapeScriptText`.
 */
export const SCRIPT_TEXT_ESCAPING = 'chrome-design/script-text-v1: "<" + N backslashes + ("/script" | "script" | "!--") is stored with N+1 backslashes; remove one backslash to restore.';

const ESCAPE_RE = /<(\\*)(\/?script|!--)/gi;
const UNESCAPE_RE = /<(\\*)\\(\/?script|!--)/gi;

export function escapeScriptText(html: string): string {
  return html.replace(ESCAPE_RE, (_m, slashes: string, rest: string) => `<${slashes}\\${rest}`);
}

export function unescapeScriptText(text: string): string {
  return text.replace(UNESCAPE_RE, (_m, slashes: string, rest: string) => `<${slashes}${rest}`);
}

/** Escape text for inclusion inside an HTML comment (`--` is not allowed). */
export function escapeHtmlComment(text: string): string {
  return text.replace(/--/g, '- -').replace(/<!/g, '< !');
}

/** UTF-8 byte length without allocating a Buffer (works in browser and Node). */
export function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}
