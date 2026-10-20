import type { AssetFetcher } from '../capture/assets';
import type { BackgroundApi, BackgroundReply, SettingsResponse } from '../shared/messages';

/** Thin wrapper over extension APIs so the UI also runs on the demo page (no `chrome.runtime`). */
export function hasExtensionRuntime(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

/** Ask the service worker (null on the demo page, or when it can't answer). */
export function askBackground<K extends keyof BackgroundApi>(
  type: K,
  ...body: object extends BackgroundApi[K]['body'] ? [] : [BackgroundApi[K]['body']]
): Promise<BackgroundReply<K> | null> {
  if (!hasExtensionRuntime()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...body[0] }, (reply: BackgroundReply<K>) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(reply ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

/**
 * A picture of the tab as it is now (PNG data URL; null without the extension). Waits for its
 * turn (Chrome allows two a second), then hides this UI (`host`, when given) for the picture.
 */
export async function captureVisibleTab(host?: HTMLElement): Promise<string | null> {
  if (!hasExtensionRuntime()) return null;
  await askBackground('cd:capture-turn');
  host?.setAttribute('data-capturing', '');
  try {
    // Let the page paint without the UI (and settle after a scroll).
    await nextFrame();
    await nextFrame();
    const reply = await askBackground('cd:capture-visible-tab');
    return reply?.ok ? reply.dataUrl : null;
  } finally {
    host?.removeAttribute('data-capturing');
  }
}

/**
 * Asset fetch through the service worker. Only succeeds for origins the extension has host
 * access to (the active tab's origin, or all sites if the optional permission was granted).
 */
export const backgroundFetcher: AssetFetcher = async (url, maxBytes) => {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'unsupported scheme' };
  const reply = await askBackground('cd:fetch-asset', { url, maxBytes });
  return reply ?? { ok: false, error: 'extension background unavailable' };
};

/** Opens the extension's full settings page in a tab. False on the demo page (no extension). */
export async function openSettingsPage(): Promise<boolean> {
  return (await askBackground('cd:open-options'))?.ok === true;
}

/** Current extension settings, or null on the demo page. */
export function getSettings(): Promise<SettingsResponse | null> {
  return askBackground('cd:get-settings');
}

/** Keeps the toolbar icon's badge in sync when the toolbar is closed from the page. */
export function reportState(open: boolean): void {
  void askBackground('cd:state', { open });
}

/**
 * Resize the browser window so the page's viewport is `width` CSS px wide (the window's frame
 * is added on). False without the extension.
 */
export async function resizeViewport(width: number): Promise<boolean> {
  // The window frame plus a classic scrollbar sit outside the page's width.
  const frame = Math.max(0, window.outerWidth - window.innerWidth);
  const scrollbar = Math.max(0, window.innerWidth - document.documentElement.clientWidth);
  const reply = await askBackground('cd:resize-window', {
    width: Math.round(width + scrollbar + frame),
  });
  return reply?.ok === true;
}
