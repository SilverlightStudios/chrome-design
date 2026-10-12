import { useEffect, useState } from 'react';

interface Item<P> {
  key: string;
  payload: P;
}

/**
 * Keeps the last item mounted for `exitMs` after `key` goes null, flagging it as exiting so
 * CSS can play the exit (popovers, cards, flyouts) — nothing pops out of existence. `payload`
 * is the data to keep rendering while it leaves; it must be referentially stable per key.
 */
export function usePresence<P>(
  key: string | null,
  payload: P,
  exitMs: number,
): { key: string | null; payload: P | null; exiting: boolean } {
  const [item, setItem] = useState<Item<P> | null>(key === null ? null : { key, payload });
  const [exiting, setExiting] = useState(false);
  const [prevKey, setPrevKey] = useState<string | null>(key);
  if (key !== prevKey) {
    setPrevKey(key);
    if (key !== null) {
      setItem({ key, payload });
      setExiting(false);
    } else if (item !== null) {
      setExiting(true);
    }
  } else if (key !== null && item !== null && item.payload !== payload) {
    setItem({ key, payload });
  }
  useEffect(() => {
    if (!exiting) return;
    const t = window.setTimeout(() => {
      setItem(null);
      setExiting(false);
    }, exitMs);
    return () => window.clearTimeout(t);
  }, [exiting, exitMs]);
  return { key: item?.key ?? null, payload: item?.payload ?? null, exiting };
}
