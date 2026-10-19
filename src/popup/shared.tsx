import { useEffect, useState } from 'react';

const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

/** The optional cross-origin asset permission (requested from an extension page, never the site). */
export function useAllSitesPermission(): [
  boolean,
  (next: boolean) => Promise<void>,
  string | null,
] {
  const [granted, setGranted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    void chrome.permissions.contains(ALL_SITES).then(setGranted);
    const sync = () => void chrome.permissions.contains(ALL_SITES).then(setGranted);
    chrome.permissions.onAdded.addListener(sync);
    chrome.permissions.onRemoved.addListener(sync);
    return () => {
      chrome.permissions.onAdded.removeListener(sync);
      chrome.permissions.onRemoved.removeListener(sync);
    };
  }, []);
  const toggle = async (next: boolean) => {
    setError(null);
    try {
      if (next) setGranted(await chrome.permissions.request(ALL_SITES));
      else if (await chrome.permissions.remove(ALL_SITES)) setGranted(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  return [granted, toggle, error];
}

const NATIVE = { permissions: ['nativeMessaging'] } as chrome.permissions.Permissions;
const VOICE_ENABLED_KEY = 'voice:enabled';
const VOICE_STATUS_KEY = 'voice:status';

export interface VoiceLinkView {
  on: boolean;
  state: 'off' | 'connecting' | 'connected' | 'no-bridge' | 'error';
  app?: string;
  error?: string;
}

async function setVoiceLink(next: boolean): Promise<void> {
  if (next && !(await chrome.permissions.request(NATIVE).catch(() => false))) return;
  await chrome.storage.local.set({ [VOICE_ENABLED_KEY]: next });
}

/**
 * The voice link setting: the optional native messaging permission plus a stored switch (the
 * service worker connects when both are on), and the link's live state.
 */
export function useVoiceLink(): [VoiceLinkView, (next: boolean) => Promise<void>] {
  const [view, setView] = useState<VoiceLinkView>({ on: false, state: 'off' });
  useEffect(() => {
    const read = async () => {
      const [granted, local, session] = await Promise.all([
        chrome.permissions.contains(NATIVE).catch(() => false),
        chrome.storage.local.get(VOICE_ENABLED_KEY),
        chrome.storage.session.get(VOICE_STATUS_KEY).catch(() => ({}) as Record<string, unknown>),
      ]);
      const status = (session[VOICE_STATUS_KEY] ?? { state: 'off' }) as Omit<VoiceLinkView, 'on'>;
      setView({ on: granted && local[VOICE_ENABLED_KEY] === true, ...status });
    };
    void read();
    const onChange = () => void read();
    chrome.storage.onChanged.addListener(onChange);
    chrome.permissions.onAdded.addListener(onChange);
    chrome.permissions.onRemoved.addListener(onChange);
    return () => {
      chrome.storage.onChanged.removeListener(onChange);
      chrome.permissions.onAdded.removeListener(onChange);
      chrome.permissions.onRemoved.removeListener(onChange);
    };
  }, []);
  return [view, setVoiceLink];
}

export function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      className="switch"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
    >
      <span />
    </button>
  );
}

export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <img src="icons/icon-128.png" alt="" width="32" height="32" />
    </span>
  );
}
