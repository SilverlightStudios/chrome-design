import type { AssetFetcher } from '../capture/assets';
import type {
  CaptureVisibleTabResponse,
  FetchAssetResponse,
  SettingsResponse,
  ToBackgroundMessage,
} from '../shared/messages';

/** Thin wrapper over extension APIs so the UI also runs on the demo page (no `chrome.runtime`). */
export function hasExtensionRuntime(): boolean {
  return typeof chrome !== 'undefined' && !!chrome.runtime?.id;
}

function send<T>(message: ToBackgroundMessage): Promise<T | null> {
  if (!hasExtensionRuntime()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (response: T) => {
        if (chrome.runtime.lastError) resolve(null);
        else resolve(response ?? null);
      });
    } catch {
      resolve(null);
    }
  });
}

export async function captureVisibleTab(): Promise<string | null> {
  const response = await send<CaptureVisibleTabResponse>({ type: 'cd:capture-visible-tab' });
  return response?.ok ? response.dataUrl : null;
}

/**
 * Asset fetch through the service worker. Only succeeds for origins the extension has host
 * access to (the active tab's origin, or all sites if the optional permission was granted).
 */
export const backgroundFetcher: AssetFetcher = async (url, maxBytes) => {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'unsupported scheme' };
  const response = await send<FetchAssetResponse>({ type: 'cd:fetch-asset', url, maxBytes });
  if (!response) return { ok: false, error: 'extension background unavailable' };
  return response;
};

/** Opens the extension's full settings page in a tab. False on the demo page (no extension). */
export async function openSettingsPage(): Promise<boolean> {
  return (await send<{ ok: boolean }>({ type: 'cd:open-options' }))?.ok === true;
}

/** Current extension settings, or null on the demo page. */
export function getSettings(): Promise<SettingsResponse | null> {
  return send<SettingsResponse>({ type: 'cd:get-settings' });
}

/** Keeps the toolbar icon's badge in sync when the toolbar is closed from the page. */
export function reportState(open: boolean): void {
  void send<unknown>({ type: 'cd:state', open });
}
