import { StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { App } from './App';
import type { ExportOptions, ExportStatus } from './context';
import { HOST_TAG } from './dom';
import { runExport } from './exporter';
import { debounce, loadDoc, loadGrid, saveDoc, saveGrid } from './persistence';
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
export async function mountEditor(onClose: () => void): Promise<Mounted> {
  const href = location.href;
  const [savedDoc, grid] = await Promise.all([loadDoc(href), loadGrid(href)]);
  const doc = savedDoc ?? emptyDoc(href, document.title);
  const store = new EditorStore(createInitialState({ ...doc, title: document.title }, grid));

  const host = document.createElement(HOST_TAG);
  host.setAttribute('data-chrome-design', '');
  host.style.cssText =
    'all: initial; position: absolute; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const container = document.createElement('div');
  shadow.appendChild(container);
  document.documentElement.appendChild(host);

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

  const exportWith = (options: ExportOptions, onStatus: (s: ExportStatus) => void) =>
    runExport(host, store, options, onStatus);

  const root: Root = createRoot(container);
  root.render(
    <StrictMode>
      <App env={{ store, host, shadow, close: onClose, runExport: exportWith }} />
    </StrictMode>,
  );

  return {
    store,
    host,
    unmount: () => {
      offDoc();
      offState();
      void saveDoc(href, store.getState().doc);
      root.unmount();
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
