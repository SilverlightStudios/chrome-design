import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { APP_VERSION } from '../shared/model';
import { Mark, Switch, useAllSitesPermission, useVoiceLink, type VoiceLinkView } from './shared';
import './popup.css';

const STEPS = [
  'Pin Chrome Design from Chrome’s puzzle icon',
  'Click the icon or press ⌥⇧D on any page',
  'Comment on anything, sketch over it',
  'Send to AI saves one file for any assistant',
];

function voiceLine(v: VoiceLinkView): string {
  if (!v.on) return 'Your voice recorder starts and stops walkthroughs';
  switch (v.state) {
    case 'connected':
      return `Connected${v.app ? ` to ${v.app}` : ''}`;
    case 'no-bridge':
      return 'The bridge isn’t installed (bridge/install.sh)';
    case 'error':
      return v.error ? `Not connected: ${v.error}` : 'Not connected';
    default:
      return 'Waiting for the recorder';
  }
}

function Options() {
  const [voice, setVoice] = useVoiceLink();
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
        <h1>Chrome Design</h1>
      </header>

      <section className="card">
        <h2>Get started</h2>
        <ol className="steps">
          {STEPS.map((step, i) => (
            <li key={step} style={{ animationDelay: `${i * 40}ms` }}>
              <span className="num">{i + 1}</span>
              <span>{step}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="card">
        <h2>Settings</h2>
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
        <div className="row">
          <div>
            <b>Voice recorder</b>
            <p className="muted" data-testid="cd-voice-status">
              {voiceLine(voice)}
            </p>
          </div>
          <Switch label="Voice recorder" on={voice.on} onChange={(v) => void setVoice(v)} />
        </div>
        <div className="row">
          <div>
            <b>Shortcut</b>
            <p className="muted">
              Change it at <code>chrome://extensions/shortcuts</code>
            </p>
          </div>
          <kbd>{shortcut}</kbd>
        </div>
        <div className="row">
          <div>
            <b>Local files</b>
            {fileAccess ? null : (
              <p className="muted">
                Turn on “Allow access to file URLs” in the extension’s details
              </p>
            )}
          </div>
          <span className={`dot ${fileAccess ? 'ok' : 'warn'}`} aria-hidden="true" />
        </div>
      </section>

      <p className="foot muted">
        v{APP_VERSION} · Notes stay in this browser. Nothing is uploaded; a walkthrough goes only to
        your own voice recorder, on this computer.
      </p>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Options />
  </StrictMode>,
);
