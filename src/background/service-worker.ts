import { guessMime, toDataUrl } from '../shared/base64';
import type {
  CaptureVisibleTabResponse,
  FetchAssetResponse,
  ToBackgroundMessage,
} from '../shared/messages';
import { activeTab, sendToTab } from './inject';

/**
 * Service worker: keyboard command, screenshots and (optional) cross-origin asset fetches.
 * It never sends page content anywhere; asset fetches are plain GETs of URLs the page
 * already references, and only succeed for origins the extension has host access to.
 */

/**
 * One click on the toolbar icon (or ⌥⇧D) toggles the in-page toolbar. When the page can't be
 * scripted, the icon switches to a small explainer popup for that tab and opens it right away.
 */
async function toggle(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab || tab.id === undefined) return;
  const result = await sendToTab(tab, { type: 'cd:toggle' });
  if (result.ok) {
    await chrome.action
      .setBadgeText({ text: result.open ? 'on' : '', tabId: tab.id })
      .catch(() => undefined);
    await chrome.action
      .setBadgeBackgroundColor({ color: '#1E3FA8', tabId: tab.id })
      .catch(() => undefined);
    return;
  }
  const popup = `popup.html?reason=${encodeURIComponent(result.reason)}`;
  await chrome.action.setPopup({ tabId: tab.id, popup }).catch(() => undefined);
  await chrome.action
    .setTitle({ title: `Chrome Design: ${result.reason}`, tabId: tab.id })
    .catch(() => undefined);
  // Chrome 127+: open the explainer for this click; older versions show it on the next click.
  await chrome.action.openPopup?.().catch(() => undefined);
}

chrome.action.onClicked.addListener((tab) => {
  void toggle(tab);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'toggle-chrome-design') return;
  await toggle(await activeTab());
});

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

const MAX_ASSET = 15 * 1024 * 1024;

async function fetchAsset(url: string, maxBytes: number): Promise<FetchAssetResponse> {
  if (!/^https?:/i.test(url)) return { ok: false, error: 'unsupported scheme' };
  const limit = Math.min(maxBytes, MAX_ASSET);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      credentials: 'omit',
      signal: controller.signal,
      cache: 'force-cache',
    });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const declared = Number(response.headers.get('content-length') ?? '0');
    if (declared > limit) return { ok: false, error: `too large (${declared} bytes)` };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > limit)
      return { ok: false, error: `too large (${buffer.byteLength} bytes)` };
    const mime = guessMime(url, response.headers.get('content-type'));
    return { ok: true, dataUrl: toDataUrl(buffer, mime), bytes: buffer.byteLength, mime };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: /abort/i.test(message)
        ? 'timed out'
        : 'no host access (grant “Embed assets from other sites” in the popup)',
    };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message: ToBackgroundMessage, sender, sendResponse) => {
  // Only accept messages from our own content script running in a tab.
  if (sender.id !== chrome.runtime.id || !sender.tab) return false;
  if (message?.type === 'cd:capture-visible-tab') {
    chrome.tabs
      .captureVisibleTab(sender.tab.windowId, { format: 'png' })
      .then((dataUrl) => sendResponse({ ok: true, dataUrl } satisfies CaptureVisibleTabResponse))
      .catch((error: unknown) =>
        sendResponse({
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        } satisfies CaptureVisibleTabResponse),
      );
    return true;
  }
  if (message?.type === 'cd:state') {
    const tabId = sender.tab.id;
    if (tabId !== undefined) {
      void chrome.action
        .setBadgeText({ text: message.open ? 'on' : '', tabId })
        .catch(() => undefined);
      void chrome.action
        .setBadgeBackgroundColor({ color: '#1E3FA8', tabId })
        .catch(() => undefined);
    }
    return false;
  }
  if (message?.type === 'cd:open-options') {
    void chrome.runtime.openOptionsPage().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (message?.type === 'cd:fetch-asset') {
    void fetchAsset(message.url, message.maxBytes).then(sendResponse);
    return true;
  }
  return false;
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // A navigation removes the toolbar and may change what the page allows: reset the icon.
    void chrome.action.setBadgeText({ text: '', tabId }).catch(() => undefined);
    void chrome.action.setPopup({ tabId, popup: '' }).catch(() => undefined);
    void chrome.action.setTitle({ tabId, title: 'Chrome Design (⌥⇧D)' }).catch(() => undefined);
  }
});
