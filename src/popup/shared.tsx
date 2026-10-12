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
