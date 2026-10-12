import { useEffect, useState } from 'react';
import type { SettingsResponse } from '../../shared/messages';
import { APP_VERSION } from '../../shared/model';
import { useEnv } from '../context';
import { PanelHead } from './PanelHead';

const touch = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;

/**
 * Settings, inside the toolbar like every other panel. Chrome only lets an extension page ask
 * for the all-sites permission, so changing it opens the full settings page in a tab.
 */
export function SettingsPanel() {
  const { getSettings, openSettingsPage, toast } = useEnv();
  // undefined = loading, null = no extension (demo page)
  const [settings, setSettings] = useState<SettingsResponse | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    const load = () => void getSettings().then((s) => live && setSettings(s));
    load();
    // Coming back from the settings tab: show what changed there.
    const onVisible = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [getSettings]);
  const demo = settings === null;
  const openPage = async () => {
    if (!(await openSettingsPage()))
      toast('Settings open in a tab when Chrome Design is installed');
  };

  return (
    <div className="panel settings-panel">
      <PanelHead title="Settings" />
      <div className="set-card">
        <div className="set-row">
          <span className="set-title">Images from other websites</span>
          <span className="set-value" data-on={settings?.allSites ? '' : undefined}>
            {settings === undefined ? '' : demo ? 'Off' : settings.allSites ? 'On' : 'Off'}
          </span>
        </div>
        <p className="set-desc">
          Lets the file for AI include pictures, fonts and styles this page loads from elsewhere.
          Without it they show as placeholders.
        </p>
        {demo ? (
          <p className="set-desc faint">Available once Chrome Design is installed.</p>
        ) : (
          <button type="button" className="btn wide" onClick={() => void openPage()}>
            {settings?.allSites ? 'Turn off' : 'Turn on'} in Chrome
          </button>
        )}
      </div>
      {touch() ? null : (
        <div className="set-card">
          <div className="set-row">
            <span className="set-title">Open or close the toolbar</span>
            <kbd className="set-kbd">{settings?.shortcut || '⌥⇧D'}</kbd>
          </div>
          <p className="set-desc">
            {demo
              ? 'Change it in Chrome’s extension shortcuts.'
              : 'Change it at chrome://extensions/shortcuts.'}
          </p>
        </div>
      )}
      <div className="set-card">
        <div className="set-row">
          <span className="set-title">Privacy</span>
        </div>
        <p className="set-desc">
          Your comments and drawings stay in this browser. Nothing is uploaded and there are no
          accounts.
        </p>
      </div>
      <p className="set-foot">
        Chrome Design {APP_VERSION}
        {demo ? null : (
          <>
            {' · '}
            <button type="button" className="inline-link" onClick={() => void openPage()}>
              All settings
            </button>
          </>
        )}
      </p>
    </div>
  );
}
