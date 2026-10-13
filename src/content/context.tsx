import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { SettingsResponse } from '../shared/messages';
import type { EditorState, EditorStore } from './store';

export interface ExportOptions {
  includeScreenshot: boolean;
  includeSource: boolean;
  /** One shareable .html (default), or a .zip with the pictures as files for AI agents. */
  format?: 'html' | 'zip';
}

export type ExportStatus =
  | { phase: 'idle' }
  | { phase: 'working'; label: string }
  | {
      phase: 'done';
      filename: string;
      bytes: number;
      warnings: { code: string; message: string; url?: string }[];
    }
  | { phase: 'error'; message: string };

export interface ToastAction {
  label: string;
  run: () => void;
  /** How long the toast stays (ms). Undo: 5 s; a decision to read first: longer. */
  duration?: number;
}

export interface EditorEnv {
  store: EditorStore;
  host: HTMLElement;
  shadow: ShadowRoot;
  close: () => void;
  runExport: (options: ExportOptions, onStatus: (status: ExportStatus) => void) => Promise<void>;
  toast: (message: string, action?: ToastAction) => void;
  /** Open the extension's full settings page in a tab; false without the extension. */
  openSettingsPage: () => Promise<boolean>;
  /** Current extension settings; null without the extension (demo page). */
  getSettings: () => Promise<SettingsResponse | null>;
  /** Running inside a shared handoff file (no extension; the page is a copy). */
  handoff?: boolean;
}

const EnvContext = createContext<EditorEnv | null>(null);

export const EnvProvider = EnvContext.Provider;

export function useEnv(): EditorEnv {
  const env = useContext(EnvContext);
  if (!env) throw new Error('EditorEnv missing');
  return env;
}

/** Subscribe to a slice of editor state. Selectors must return stable references or primitives. */
export function useEditor<T>(selector: (state: EditorState) => T): T {
  const { store } = useEnv();
  return useSyncExternalStore(store.subscribe, () => selector(store.getState()));
}

export interface Viewport {
  scrollX: number;
  scrollY: number;
  width: number;
  height: number;
}

function readViewport(): Viewport {
  return {
    scrollX: window.scrollX,
    scrollY: window.scrollY,
    width: document.documentElement.clientWidth || window.innerWidth,
    height: window.innerHeight,
  };
}

/** Scroll position + viewport size, updated at most once per frame. */
export function useViewport(): Viewport {
  const [vp, setVp] = useState(readViewport);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setVp(readViewport()));
    };
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, []);
  return vp;
}

/**
 * Bumps when page layout may have changed, so element-anchored pins follow their element:
 * resizes (debounced) and any scroll (per frame — covers inner scroll containers and
 * position: fixed/sticky elements, which move relative to the document as the page scrolls).
 */
export function useLayoutVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let frame = 0;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 120);
    };
    const onScroll = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setVersion((v) => v + 1);
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    const resize = new ResizeObserver(bump);
    resize.observe(document.documentElement);
    if (document.body) resize.observe(document.body);
    window.addEventListener('resize', bump);
    return () => {
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(frame);
      resize.disconnect();
      window.removeEventListener('resize', bump);
      window.removeEventListener('scroll', onScroll, { capture: true });
    };
  }, []);
  return version;
}
