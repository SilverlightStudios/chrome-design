import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import type { ExportOptions, ExportStatus } from './context';
import { HOST_TAG } from './dom';
import { runExport } from './exporter';
import { openSettings } from './ext';
import { debounce, loadDoc, loadGrid, pageKey, saveDoc, saveGrid } from './persistence';
import { createInitialState, EditorStore, emptyDoc } from './store';
import css from './styles.css?inline';

export interface Mounted {
  store: EditorStore;
  host: HTMLElement;
  unmount: () => void;
  exportNow: (options?: Partial<ExportOptions>) => Promise<ExportStatus>;
}

/**
 * Create the shadow-DOM host and render the editor. Nothing is written to the page except
 * this single host element, which is removed again on unmount.
 */
/** Inline styles for the host: `!important` so page rules like `html > * { display: none }` lose. */
const HOST_STYLE: [string, string][] = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'absolute'],
  ['inset', '0 auto auto 0'],
  ['width', '0'],
  ['height', '0'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['background', 'transparent'],
  ['overflow', 'visible'],
  ['z-index', '2147483647'],
  ['pointer-events', 'none'],
  ['visibility', 'visible'],
  ['opacity', '1'],
  ['transform', 'none'],
  ['filter', 'none'],
  ['contain', 'none'],
];

function styleHost(host: HTMLElement): void {
  for (const [prop, value] of HOST_STYLE) host.style.setProperty(prop, value, 'important');
}

/**
 * Put the host in the browser's top layer (popover="manual"): it then escapes page
 * transforms, `overflow: hidden` ancestors and z-index stacking contexts, and an absolutely
 * positioned top-layer box still scrolls with the document. Falls back to max z-index.
 */
function promote(host: HTMLElement): void {
  if (typeof host.showPopover !== 'function') return;
  try {
    if (host.matches(':popover-open')) host.hidePopover();
    host.showPopover();
  } catch {
    // not supported / not connected: z-index fallback stays in place
  }
}

function currentHref(): string {
  return location.href;
}

export async function mountEditor(onClose: () => void): Promise<Mounted> {
  let href = currentHref();
  const [savedDoc, grid] = await Promise.all([loadDoc(href), loadGrid(href)]);
  const doc = savedDoc ?? emptyDoc(href, document.title);
  const store = new EditorStore(createInitialState({ ...doc, title: document.title }, grid));

  const host = document.createElement(HOST_TAG);
  host.setAttribute('data-chrome-design', '');
  host.setAttribute('popover', 'manual');
  styleHost(host);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const container = document.createElement('div');
  container.style.pointerEvents = 'auto';
  shadow.appendChild(container);
  document.documentElement.appendChild(host);
  promote(host);

  // Keep the host last in the top layer when the page opens dialogs/popovers/fullscreen.
  const reassert = debounce(() => {
    if (!host.isConnected) document.documentElement.appendChild(host);
    styleHost(host);
    promote(host);
  }, 50);
  const topLayerWatch = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'childList' && !host.isConnected) return reassert();
      const el = r.target as Element;
      if (el !== host && (el.localName === 'dialog' || el.hasAttribute('popover')))
        return reassert();
    }
  });
  topLayerWatch.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['open'],
  });
  const onToggle = (e: Event) => {
    if (e.target !== host) reassert();
  };
  document.addEventListener('toggle', onToggle, true);
  document.addEventListener('fullscreenchange', reassert);

  const persistDoc = debounce(() => void saveDoc(href, store.getState().doc), 300);
  const persistGrid = debounce(() => void saveGrid(href, store.getState().grid), 300);
  let lastGrid = store.getState().grid;
  const offDoc = store.onDocChange(persistDoc);
  const offState = store.subscribe(() => {
    const g = store.getState().grid;
    if (g !== lastGrid) {
      lastGrid = g;
      persistGrid();
    }
  });

  // Single-page apps: when the URL changes, save this page's notes and load the next page's.
  let toast: ((msg: string) => void) | null = null;
  const navWatch = window.setInterval(async () => {
    const next = currentHref();
    if (pageKey(next) === pageKey(href)) return;
    const prev = href;
    href = next;
    await saveDoc(prev, store.getState().doc);
    const loaded = await loadDoc(next);
    store.replaceDoc(loaded ?? emptyDoc(next, document.title));
    const count = store.getState().doc.annotations.length;
    toast?.(
      count
        ? `New page — ${count} saved annotation${count === 1 ? '' : 's'} loaded`
        : 'New page — fresh canvas',
    );
  }, 600);

  const exportWith = (options: ExportOptions, onStatus: (s: ExportStatus) => void) =>
    runExport(host, store, options, onStatus);

  const root: Root = createRoot(container);
  root.render(
    <StrictMode>
      <App
        env={{ store, host, shadow, close: onClose, runExport: exportWith, openSettings }}
        onReady={(t) => {
          toast = t;
        }}
      />
    </StrictMode>,
  );

  return {
    store,
    host,
    unmount: () => {
      window.clearInterval(navWatch);
      topLayerWatch.disconnect();
      document.removeEventListener('toggle', onToggle, true);
      document.removeEventListener('fullscreenchange', reassert);
      offDoc();
      offState();
      void saveDoc(href, store.getState().doc);
      root.unmount();
      try {
        if (host.matches(':popover-open')) host.hidePopover();
      } catch {
        // ignore
      }
      host.remove();
    },
    exportNow: (options) =>
      new Promise((resolve) => {
        let last: ExportStatus = { phase: 'idle' };
        void exportWith({ includeScreenshot: true, includeSource: true, ...options }, (status) => {
          last = status;
        }).then(() => resolve(last));
      }),
  };
}
