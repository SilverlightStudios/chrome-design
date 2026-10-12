import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_VERSION } from '../shared/model';
import { Mark, Switch, useAllSitesPermission } from './shared';
import './popup.css';

const STEPS = [
  ['Pin it', 'Click the puzzle icon in Chrome’s toolbar and pin Chrome Design.'],
  ['Open it on any page', 'Click the icon or press ⌥⇧D. Click again (or ⌥⇧D) to close.'],
  ['Review', 'Inspect (V), comment (C) and draw (D) right on the live page.'],
  ['Hand off', 'Export (⇧E) downloads one HTML file with the page, your notes and an AI prompt.'],
];

function Options() {
  const [allSites, setAllSites, error] = useAllSitesPermission();
  const [shortcut, setShortcut] = useState('⌥⇧D');
  const [fileAccess, setFileAccess] = useState(false);
  useEffect(() => {
    void chrome.commands.getAll().then((cmds) => {
      const c = cmds.find((x) => x.name === 'toggle-chrome-design');
      setShortcut(c?.shortcut || 'not set');
    });
    void chrome.extension.isAllowedFileSchemeAccess().then(setFileAccess);
  }, []);

  return (
    <main className="shell wide">
      <header className="wordmark">
        <Mark />
        <div>
          <h1>Chrome Design</h1>
          <p className="tagline">Inspect · comment · draw · hand off to AI — v{APP_VERSION}</p>
        </div>
      </header>

      <section className="card">
        <h2>Get started</h2>
        <ol className="steps">
          {STEPS.map(([title, body], i) => (
            <li key={title} style={{ animationDelay: `${i * 40}ms` }}>
              <span className="num">{i + 1}</span>
              <div>
                <b>{title}</b>
                <p className="muted">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Settings</h2>
        <div className="row">
          <div>
            <b>Embed assets from other sites</b>
            <p className="muted">
              Optional. Lets exports inline images, fonts and stylesheets served from CDNs that
              don’t send CORS headers. Chrome asks once. Without it, those assets are listed as
              warnings in the export.
            </p>
          </div>
          <Switch
            label="Embed assets from other sites"
            on={allSites}
            onChange={(v) => void setAllSites(v)}
          />
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className="row">
          <div>
            <b>Keyboard shortcut</b>
            <p className="muted">
              Currently <kbd>{shortcut}</kbd>. Change it at{' '}
              <code>chrome://extensions/shortcuts</code>.
            </p>
          </div>
        </div>
        <div className="row">
          <div>
            <b>Local files</b>
            <p className="muted">
              {fileAccess
                ? 'Allowed — Chrome Design works on file:// pages.'
                : 'To review file:// pages, turn on “Allow access to file URLs” on this extension’s details page.'}
            </p>
          </div>
          <span className={`dot ${fileAccess ? 'ok' : 'warn'}`} aria-hidden="true" />
        </div>
      </section>

      <section className="card">
        <h2>Privacy</h2>
        <p className="muted">
          Annotations stay in this browser (extension storage, per page). Nothing is uploaded: the
          only network requests are fetching the page’s own images, fonts and styles when you
          export, so they can be embedded in the file. No accounts, no analytics.
        </p>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
