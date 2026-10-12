import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Mark, Switch, useAllSitesPermission } from './shared';
import './popup.css';

/**
 * Shown by the toolbar icon only on pages where Chrome Design can't run (the icon toggles the
 * in-page toolbar everywhere else). Explains why, and offers settings.
 */
function Popup() {
  const reason = new URLSearchParams(location.search).get('reason');
  const [allSites, setAllSites, error] = useAllSitesPermission();
  return (
    <main className="shell compact">
      <header className="wordmark">
        <Mark />
        <h1>Chrome Design</h1>
      </header>
      <section className="notice" role="alert">
        <span className="dot warn" aria-hidden="true" />
        <div>
          <strong>Not available on this page</strong>
          <p>{reason ?? 'Open a regular website (http or https) and click the icon again.'}</p>
        </div>
      </section>
      <div className="row">
        <div>
          <b>Images from other websites</b>
        </div>
        <Switch
          label="Images from other websites"
          on={allSites}
          onChange={(v) => void setAllSites(v)}
        />
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button type="button" className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
        Settings
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
