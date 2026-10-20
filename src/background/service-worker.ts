import { guessMime, toDataUrl } from '../shared/base64';
import {
  type BackgroundApi,
  type BackgroundReply,
  type BackgroundRequest,
  CONTENT_SCRIPT_FILE,
  type FetchAssetResponse,
  type RuntimeResponse,
  type SettingsResponse,
} from '../shared/messages';
import {
  addFullPageScreen,
  captureTab,
  captureTurn,
  finishFullPage,
  startFullPage,
} from './capture';
import { activeTab, sendToTab } from './inject';
import { deliverWalkthrough, fromTab, initVoiceLink, voiceSetting } from './voiceLink';
import {
  cropWalkthrough,
  filesOf,
  initWalkthroughFiles,
  sheetOf,
  takePicture,
} from './walkthroughFiles';
import {
  activeWalkthrough,
  beginWalkthrough,
  collectWalkthrough,
  endWalkthrough,
  initWalkthroughs,
  syncWalkthrough,
} from './walkthroughs';

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
    await setBadge(tab.id, result.open);
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
        : 'no host access (turn on “Allow other websites” in Chrome Design settings)',
    };
  } finally {
    clearTimeout(timer);
  }
}

function setBadge(tabId: number, open: boolean): Promise<unknown> {
  return Promise.all([
    chrome.action.setBadgeText({ text: open ? 'on' : '', tabId }),
    chrome.action.setBadgeBackgroundColor({ color: '#1E3FA8', tabId }),
  ]).catch(() => undefined);
}

async function resizeWindow(windowId: number, width: number): Promise<{ ok: boolean }> {
  // Screen-size presets: un-maximize the tab's window, then set its outer width.
  try {
    const win = await chrome.windows.get(windowId);
    if (win.state !== 'normal') await chrome.windows.update(windowId, { state: 'normal' });
    await chrome.windows.update(windowId, { width: Math.round(width) });
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

async function settings(): Promise<SettingsResponse> {
  const [allSites, commands, voice] = await Promise.all([
    chrome.permissions.contains({ origins: ['<all_urls>'] }),
    chrome.commands.getAll(),
    voiceSetting(),
  ]);
  const shortcut = commands.find((c) => c.name === 'toggle-chrome-design')?.shortcut ?? '';
  return { allSites, shortcut, voice };
}

/** The content script's own source, built into exported files so they open with the toolbar. */
async function runtimeSource(): Promise<RuntimeResponse> {
  try {
    return {
      ok: true,
      source: await (await fetch(chrome.runtime.getURL(CONTENT_SCRIPT_FILE))).text(),
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

type Tab = chrome.tabs.Tab & { id: number };

/** One answer per request a tab can make (shared/messages.ts lists them). */
const handlers: {
  [K in keyof BackgroundApi]: (
    message: BackgroundRequest<K>,
    tab: Tab,
  ) => BackgroundReply<K> | Promise<BackgroundReply<K>>;
} = {
  'cd:capture-turn': captureTurn,
  'cd:capture-visible-tab': (m, tab) => captureTab(tab.windowId, m.maxWidth),
  'cd:full-page-start': (m, tab) => startFullPage(tab.id, m.width, m.height, m.scale),
  'cd:full-page-screen': (m, tab) => addFullPageScreen(tab, m.y, m.view),
  'cd:full-page-finish': (m, tab) => finishFullPage(tab.id, m.height),
  'cd:fetch-asset': (m) => fetchAsset(m.url, m.maxBytes),
  'cd:open-options': () => chrome.runtime.openOptionsPage().then(() => ({ ok: true })),
  'cd:get-settings': settings,
  'cd:get-runtime': runtimeSource,
  'cd:resize-window': (m, tab) => resizeWindow(tab.windowId, m.width),
  'cd:state': (m, tab) => setBadge(tab.id, m.open).then(() => null),
  'cd:voice-send': (m, tab) => ({ ok: fromTab(m.message, tab.id) }),
  'cd:wt-begin': (m, tab) => beginWalkthrough(tab.id, m.info),
  'cd:wt-sync': (m, tab) => syncWalkthrough(tab.id, m),
  'cd:wt-collect': async (m, tab) => ({ pages: await collectWalkthrough(tab.id, m.pageId) }),
  'cd:wt-end': (_, tab) => endWalkthrough(tab.id),
  'cd:wt-active': (_, tab) => activeWalkthrough(tab.id),
  'cd:wt-picture': (m, tab) => takePicture(tab, m.session, m.key),
  'cd:wt-crop': (m, tab) => cropWalkthrough(tab.id, m),
  'cd:wt-sheet': sheetOf,
  'cd:wt-files': filesOf,
  'cd:wt-deliver': deliverWalkthrough,
};

chrome.runtime.onMessage.addListener((message: BackgroundRequest, sender, sendResponse) => {
  // Only our own content script, running in a tab.
  const tab = sender.tab;
  if (sender.id !== chrome.runtime.id || tab?.id === undefined) return false;
  const handler = handlers[message?.type] as
    | ((m: BackgroundRequest, tab: Tab) => unknown)
    | undefined;
  if (!handler) return false;
  void Promise.resolve()
    .then(() => handler(message, tab as Tab))
    .then(sendResponse, (error: unknown) => {
      console.warn('[Chrome Design]', message.type, error);
      sendResponse(null);
    });
  return true;
});

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'loading') {
    // A navigation removes the toolbar and may change what the page allows: reset the icon.
    void chrome.action.setBadgeText({ text: '', tabId }).catch(() => undefined);
    void chrome.action.setPopup({ tabId, popup: '' }).catch(() => undefined);
    void chrome.action.setTitle({ tabId, title: 'Chrome Design (⌥⇧D)' }).catch(() => undefined);
  }
});

initVoiceLink();
initWalkthroughs();
initWalkthroughFiles();
