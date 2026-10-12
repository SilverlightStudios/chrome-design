import type { PingResponse, ToContentMessage } from '../shared/messages';
import { reportState } from './ext';
import { type Mounted, mountEditor } from './mount';

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

if (!window.__chromeDesign) {
  let mounted: Mounted | null = null;
  let opening: Promise<void> | null = null;

  const close = () => {
    if (!mounted) return;
    mounted.unmount();
    mounted = null;
    reportState(false);
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
    toggle: async () => (mounted ? close() : open()),
    isOpen: () => !!mounted,
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
