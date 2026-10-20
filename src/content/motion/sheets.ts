import { type ReactNode, useCallback, useEffect, useState } from 'react';

/**
 * What the toolbar's sheets share: the desktop floating sheet (FloatingSheet.tsx) and the phone
 * bottom sheet (BottomSheet.tsx). Both never lose their content mid-animation.
 */

/** Where an opening sheet starts: 38% along the edge, 58% deep (Spark's StackableDrawer). */
export const START_ALONG = 0.38;
export const START_DEPTH = 0.58;
export const SWAP_FADE_MS = 180;

export type SheetPhase = 'open' | 'closing';

export interface Size {
  w: number;
  h: number;
}

export interface SheetProps {
  phase: SheetPhase;
  contentKey: string;
  render: (key: string) => ReactNode;
  label: string;
  className?: string;
  onClosed: () => void;
}

/**
 * Panel swaps: remembers the previous content key for a short crossfade, and which panel
 * arrived by a swap. That panel keeps its swap-in animation for as long as it is shown;
 * dropping back to the opening reveal would restart the reveal from blank mid-way.
 */
export function useSwap(
  contentKey: string,
  ms: number,
): { leaving: string | null; swappedIn: boolean } {
  const [prev, setPrev] = useState(contentKey);
  const [leaving, setLeaving] = useState<string | null>(null);
  const [swapped, setSwapped] = useState<string | null>(null);
  if (contentKey !== prev) {
    setLeaving(prev);
    setPrev(contentKey);
    setSwapped(contentKey);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = window.setTimeout(() => setLeaving(null), ms);
    return () => window.clearTimeout(t);
  }, [leaving, ms]);
  return { leaving, swappedIn: swapped === contentKey };
}

/** Keeps a closing sheet mounted until its exit animation reports done. */
export function useSheetPresence<T>(value: T | null): {
  shown: T | null;
  phase: SheetPhase;
  onClosed: () => void;
} {
  const [shown, setShown] = useState<T | null>(value);
  const [phase, setPhase] = useState<SheetPhase>('open');
  const [prev, setPrev] = useState<T | null>(value);
  if (value !== prev) {
    setPrev(value);
    if (value !== null) {
      setShown(value);
      setPhase('open');
    } else if (shown !== null) {
      setPhase('closing');
    }
  }
  const onClosed = useCallback(() => {
    setShown(null);
    setPhase('open');
  }, []);
  return { shown, phase, onClosed };
}

/** Small screens / touch: panels become bottom sheets. */
export function useCompact(): boolean {
  const query = '(max-width: 640px), (pointer: coarse) and (max-width: 900px)';
  const [compact, setCompact] = useState(
    () => typeof matchMedia === 'function' && matchMedia(query).matches,
  );
  useEffect(() => {
    const mq = matchMedia(query);
    const sync = () => setCompact(mq.matches);
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return compact;
}
