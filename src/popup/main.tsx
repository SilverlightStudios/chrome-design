import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { activeTab, restrictedReason, sendToTab } from '../background/inject';
import { APP_VERSION } from '../shared/model';
import './popup.css';

const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; tab: chrome.tabs.Tab; host: string }
  | { kind: 'blocked'; reason: string };

function Popup() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [allSites, setAllSites] = useState(false);

  useEffect(() => {
    void (async () => {
      const tab = await activeTab();
      const fileAccess = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
      const reason = restrictedReason(tab?.url, fileAccess);
      if (!tab || reason) {
        setState({ kind: 'blocked', reason: reason ?? 'No active tab.' });
      } else {
        let host = '';
        try {
          host = new URL(tab.url ?? '').host || 'this file';
        } catch {
          host = 'this page';
        }
        setState({ kind: 'ready', tab, host });
      }
      setAllSites(await chrome.permissions.contains(ALL_SITES));
    })();
  }, []);

  const run = async (type: 'cd:toggle' | 'cd:open') => {
    if (state.kind !== 'ready') return;
    const result = await sendToTab(state.tab, { type });
    if (result.ok) window.close();
    else setError(result.reason);
  };

  const toggleAllSites = async (next: boolean) => {
    try {
      const granted = next
        ? await chrome.permissions.request(ALL_SITES)
        : !(await chrome.permissions.remove(ALL_SITES));
      setAllSites(granted);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <main>
      <header>
        <span className="logo" aria-hidden="true" />
        <div>
          <h1>Chrome Design</h1>
          <p className="muted">Inspect · comment · draw · hand off to AI</p>
        </div>
      </header>

      {state.kind === 'loading' && <p className="muted">Checking this tab…</p>}
      {state.kind === 'blocked' && (
        <div className="notice" role="alert">
          <strong>Not available here</strong>
          <p>{state.reason}</p>
        </div>
      )}
      {state.kind === 'ready' && (
        <>
          <button type="button" className="primary" onClick={() => void run('cd:toggle')}>
            Toggle toolbar on {state.host}
            <kbd>⌥⇧D</kbd>
          </button>
          <p className="muted small">
            Annotate the live page, then use <b>Export for AI</b> in the toolbar to download one
            self-contained HTML file.
          </p>
        </>
      )}
      {error && (
        <div className="notice" role="alert">
          <p>{error}</p>
        </div>
      )}

      <label className="option">
        <input
          type="checkbox"
          checked={allSites}
          onChange={(e) => void toggleAllSites(e.target.checked)}
        />
        <span>
          <b>Embed assets from other sites</b>
          <span className="muted small">
            Optional. Lets exports inline images, fonts and stylesheets served from CDNs without
            CORS. Without it, those assets are listed as warnings in the export.
          </span>
        </span>
      </label>

      <footer className="muted small">
        v{APP_VERSION} · Everything stays on this device. No accounts, no uploads, no analytics.
      </footer>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
