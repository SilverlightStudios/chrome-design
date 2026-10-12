import type { PingResponse, ToContentMessage } from '../shared/messages';
import { hasExtensionRuntime, reportState } from './ext';
import { isHandoffDocument, prepareHandoffPage, readHandoff } from './handoff';
import { type Mounted, mountEditor } from './mount';
import { setRuntimeSource } from './runtime';

/**
 * Content script entry. Injected on demand (activeTab + scripting), never declared for all
 * sites. Guarded so repeated injection only toggles the existing instance.
 */
interface ChromeDesignGlobal {
  toggle: () => Promise<void>;
  open: () => Promise<void>;
  close: () => void;
  isOpen: () => boolean;
  exportNow: () => Promise<unknown>;
}

declare global {
  interface Window {
    __chromeDesign?: ChromeDesignGlobal;
  }
}

// Read synchronously: inside a handoff file this is the file's own copy of this script.
const ownScript = document.currentScript?.textContent ?? '';

/**
 * Opened as a shared handoff file (the extension isn't needed): start the toolbar on the page
 * copy with the feedback from the file. Close pauses; the toolbar never leaves.
 */
function bootHandoff(): void {
  const data = readHandoff(ownScript);
  if (!data) return;
  setRuntimeSource(ownScript);
  prepareHandoffPage(data);
  let mounted: Mounted | null = null;
  const ready = mountEditor(() => undefined, data).then((m) => {
    mounted = m;
  });
  const resume = () => mounted?.store.set({ tool: 'select' });
  window.__chromeDesign = {
    open: async () => {
      await ready;
      resume();
    },
    close: () => mounted?.store.set({ tool: 'browse' }),
    toggle: async () => {
      await ready;
      if (mounted?.store.getState().tool === 'browse') resume();
      else mounted?.store.set({ tool: 'browse' });
    },
    isOpen: () => !!mounted,
    exportNow: async () => {
      await ready;
      return mounted?.exportNow();
    },
  };
}

if (isHandoffDocument() && !hasExtensionRuntime()) {
  if (!window.__chromeDesign) bootHandoff();
} else if (isHandoffDocument()) {
  // The extension was started on a handoff file: the file's own toolbar is already running.
  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage)
    chrome.runtime.onMessage.addListener((_message, _sender, sendResponse) => {
      sendResponse({ ok: true, open: true } satisfies PingResponse);
      return false;
    });
} else if (!window.__chromeDesign) {
  let mounted: Mounted | null = null;
  let opening: Promise<void> | null = null;

  let closing = false;
  const close = () => {
    if (!mounted || closing) return;
    closing = true;
    const m = mounted;
    void m.animateOut().then(() => {
      m.unmount();
      if (mounted === m) mounted = null;
      closing = false;
      reportState(false);
    });
  };
  const open = async () => {
    if (mounted) return;
    if (!opening) {
      opening = mountEditor(close).then((m) => {
        mounted = m;
        opening = null;
        reportState(true);
      });
    }
    await opening;
  };
  const api: ChromeDesignGlobal = {
    open,
    close,
    toggle: async () => (mounted && !closing ? close() : open()),
    isOpen: () => !!mounted && !closing,
    exportNow: async () => {
      await open();
      return mounted?.exportNow();
    },
  };
  window.__chromeDesign = api;

  if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
    chrome.runtime.onMessage.addListener((message: ToContentMessage, _sender, sendResponse) => {
      switch (message?.type) {
        case 'cd:toggle':
          void api
            .toggle()
            .then(() => sendResponse({ ok: true, open: api.isOpen() } satisfies PingResponse));
          return true;
        case 'cd:open':
          void api.open().then(() => sendResponse({ ok: true, open: true } satisfies PingResponse));
          return true;
        case 'cd:close':
          api.close();
          sendResponse({ ok: true, open: false } satisfies PingResponse);
          return false;
        case 'cd:export':
          void api
            .exportNow()
            .then(() => sendResponse({ ok: true, open: true } satisfies PingResponse));
          return true;
        case 'cd:ping':
          sendResponse({ ok: true, open: api.isOpen() } satisfies PingResponse);
          return false;
        default:
          return false;
      }
    });
  }
}
