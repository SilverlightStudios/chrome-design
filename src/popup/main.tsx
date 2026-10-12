import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_VERSION } from '../shared/model';
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
        <div>
          <h1>Chrome Design</h1>
          <p className="tagline">v{APP_VERSION}</p>
        </div>
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
          <b>Embed assets from other sites</b>
          <p className="muted">Lets exports inline CDN images, fonts and styles.</p>
        </div>
        <Switch
          label="Embed assets from other sites"
          on={allSites}
          onChange={(v) => void setAllSites(v)}
        />
      </div>
      {error ? <p className="error">{error}</p> : null}
      <button type="button" className="link" onClick={() => void chrome.runtime.openOptionsPage()}>
        Settings &amp; how to use
      </button>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Popup />
  </StrictMode>,
);
