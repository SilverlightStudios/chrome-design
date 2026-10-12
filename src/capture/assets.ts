import { guessMime, toDataUrl } from '../shared/base64';

export type FetchResult =
  | { ok: true; dataUrl: string; bytes: number; mime: string }
  | { ok: false; error: string };

/** A strategy for turning a URL into a data URL (page fetch, background fetch, …). */
export type AssetFetcher = (url: string, maxBytes: number) => Promise<FetchResult>;

export interface EmbedOptions {
  fetchers: AssetFetcher[];
  maxAssetBytes: number;
  maxTotalBytes: number;
  concurrency: number;
  onProgress?: (done: number, total: number) => void;
}

export const DEFAULT_EMBED_LIMITS = {
  maxAssetBytes: 8 * 1024 * 1024,
  maxTotalBytes: 80 * 1024 * 1024,
  concurrency: 6,
};

/** Downloads assets once, within a byte budget, remembering why each failure happened. */
export class AssetEmbedder {
  readonly embedded = new Map<string, string>();
  readonly failures = new Map<string, string>();
  bytes = 0;
  private readonly options: EmbedOptions;

  constructor(options: EmbedOptions) {
    this.options = options;
  }

  async embedAll(urls: Iterable<string>): Promise<void> {
    const queue = [...new Set(urls)].filter((u) => !this.embedded.has(u) && !this.failures.has(u));
    const total = queue.length;
    let done = 0;
    const worker = async () => {
      for (let url = queue.shift(); url !== undefined; url = queue.shift()) {
        await this.embedOne(url);
        done++;
        this.options.onProgress?.(done, total);
      }
    };
    const workers = Array.from({ length: Math.min(this.options.concurrency, total) }, worker);
    await Promise.all(workers);
  }

  async embedOne(url: string): Promise<string | null> {
    const cached = this.embedded.get(url);
    if (cached) return cached;
    if (url.startsWith('data:')) return url;
    const remaining = this.options.maxTotalBytes - this.bytes;
    if (remaining <= 0) {
      this.failures.set(url, 'total embed budget exhausted');
      return null;
    }
    const limit = Math.min(this.options.maxAssetBytes, remaining);
    let lastError = 'no fetcher available';
    for (const fetcher of this.options.fetchers) {
      try {
        const result = await fetcher(url, limit);
        if (result.ok) {
          this.bytes += result.bytes;
          this.embedded.set(url, result.dataUrl);
          this.failures.delete(url);
          return result.dataUrl;
        }
        lastError = result.error;
        if (result.error.startsWith('too large')) break;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }
    this.failures.set(url, lastError);
    return null;
  }

  /** Record a data URL obtained another way (e.g. canvas fallback). */
  add(url: string, dataUrl: string, bytes: number): void {
    this.embedded.set(url, dataUrl);
    this.failures.delete(url);
    this.bytes += bytes;
  }
}

const TIMEOUT_MS = 15_000;

/** Fetch from the page context (same-origin, CORS-enabled or blob: URLs). */
export const pageFetcher: AssetFetcher = async (url, maxBytes) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const sameOrigin = (() => {
      try {
        return new URL(url).origin === location.origin;
      } catch {
        return false;
      }
    })();
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: sameOrigin ? 'include' : 'omit',
      mode: url.startsWith('blob:') ? 'same-origin' : 'cors',
      cache: 'force-cache',
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > maxBytes) return { ok: false, error: `too large (${declared} bytes)` };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxBytes)
      return { ok: false, error: `too large (${buffer.byteLength} bytes)` };
    const mime = guessMime(url, response.headers.get('content-type'));
    return { ok: true, dataUrl: toDataUrl(buffer, mime), bytes: buffer.byteLength, mime };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: /abort/i.test(message) ? 'timed out' : `blocked (${message})` };
  } finally {
    clearTimeout(timer);
  }
};

/** Fetch a text resource (stylesheets) from the page context. */
export async function fetchText(url: string): Promise<string | null> {
  const result = await pageFetcher(url, 10 * 1024 * 1024);
  if (!result.ok) return null;
  return decodeDataUrlText(result.dataUrl);
}

export function decodeDataUrlText(dataUrl: string): string | null {
  const comma = dataUrl.indexOf(',');
  if (comma === -1) return null;
  const meta = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  try {
    if (meta.endsWith(';base64')) {
      const binary = atob(body);
      const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return decodeURIComponent(body);
  } catch {
    return null;
  }
}
