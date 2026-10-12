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
  const { getSettings, openSettingsPage } = useEnv();
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
  const openPage = () => void openSettingsPage();

  return (
    <div className="panel settings-panel">
      <PanelHead title="Settings" />
      <div className="set-list">
        <div className="set-row">
          <span className="set-title">Images from other websites</span>
          {demo ? (
            <span className="set-value">Extension only</span>
          ) : (
            <button
              type="button"
              className="set-action"
              data-on={settings?.allSites ? '' : undefined}
              onClick={openPage}
            >
              {settings === undefined ? '' : settings.allSites ? 'On' : 'Off'}
            </button>
          )}
        </div>
        {touch() ? null : (
          <div className="set-row">
            <span className="set-title">Shortcut</span>
            <kbd className="set-kbd">{settings?.shortcut || '⌥⇧D'}</kbd>
          </div>
        )}
      </div>
      <p className="set-foot">
        <span>Version {APP_VERSION}</span>
        {demo ? null : (
          <button type="button" className="inline-link" onClick={openPage}>
            All settings
          </button>
        )}
      </p>
    </div>
  );
}
