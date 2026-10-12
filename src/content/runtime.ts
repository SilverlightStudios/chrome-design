import type { RuntimeResponse } from '../shared/messages';
import { hasExtensionRuntime, sendToBackground } from './ext';

/**
 * The Chrome Design script's own source, which every exported file carries so it opens with
 * the toolbar on. In the extension the service worker reads `content.js`; inside a handoff
 * file it's the file's own script; the demo page serves a built copy.
 */
let known: string | null = null;
let pending: Promise<string | null> | null = null;

declare global {
  interface Window {
    /** Demo page only: where to fetch the built script from. */
    __chromeDesignRuntimeUrl?: string;
  }
}

export function setRuntimeSource(source: string): void {
  if (source) known = source;
}

export function getRuntimeSource(): Promise<string | null> {
  if (known) return Promise.resolve(known);
  if (!pending) {
    pending = (async () => {
      if (hasExtensionRuntime()) {
        const response = await sendToBackground<RuntimeResponse>({ type: 'cd:get-runtime' });
        return response?.ok ? response.source : null;
      }
      const url = window.__chromeDesignRuntimeUrl;
      if (!url) return null;
      try {
        const response = await fetch(url);
        return response.ok ? await response.text() : null;
      } catch {
        return null;
      }
    })().then((source) => {
      if (source) known = source;
      else pending = null;
      return source;
    });
  }
  return pending;
}
