import { CONTENT_SCRIPT_FILE, type PingResponse, type ToContentMessage } from '../shared/messages';

export type TabResult = { ok: true; open: boolean } | { ok: false; reason: string };

/**
 * Pages where extensions cannot inject scripts. Returns a human-readable reason or null.
 * `fileAccess` reflects "Allow access to file URLs" on chrome://extensions.
 */
export function restrictedReason(url: string | undefined, fileAccess: boolean): string | null {
  if (!url) return 'Chrome Design can’t read this tab. Reload the page and try again.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'This page has an unsupported address.';
  }
  const scheme = parsed.protocol;
  if (scheme === 'file:') {
    return fileAccess
      ? null
      : 'Local files need “Allow access to file URLs” enabled for Chrome Design on chrome://extensions.';
  }
  if (scheme !== 'http:' && scheme !== 'https:') {
    return `Chrome blocks extensions on ${scheme}// pages (browser settings, new tab, PDFs and other extensions).`;
  }
  const host = parsed.hostname;
  if (
    host === 'chromewebstore.google.com' ||
    (host === 'chrome.google.com' && parsed.pathname.startsWith('/webstore'))
  ) {
    return 'Chrome blocks extensions on the Chrome Web Store.';
  }
  return null;
}

async function send(tabId: number, message: ToContentMessage): Promise<PingResponse | null> {
  try {
    return (await chrome.tabs.sendMessage(tabId, message)) as PingResponse;
  } catch {
    return null;
  }
}

/** Inject the content script if needed (activeTab grant), then deliver `message`. */
export async function sendToTab(
  tab: chrome.tabs.Tab,
  message: ToContentMessage,
): Promise<TabResult> {
  if (tab.id === undefined) return { ok: false, reason: 'No active tab.' };
  const fileAccess = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
  const reason = restrictedReason(tab.url ?? tab.pendingUrl, fileAccess);
  if (reason) return { ok: false, reason };

  const existing = await send(tab.id, message);
  if (existing) return { ok: true, open: existing.open };
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: [CONTENT_SCRIPT_FILE],
    });
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      reason: /cannot access|cannot be scripted|permission/i.test(text)
        ? 'Chrome Design doesn’t have access to this page. Click the extension icon on the page (or press ⌥⇧D) to grant access for this tab.'
        : `Could not start on this page: ${text}`,
    };
  }
  const response = await send(tab.id, message);
  return response
    ? { ok: true, open: response.open }
    : { ok: false, reason: 'The page did not respond. Reload it and try again.' };
}

export async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}
