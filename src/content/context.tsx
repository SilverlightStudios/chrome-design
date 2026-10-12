import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import type { EditorState, EditorStore } from './store';

export interface ExportOptions {
  includeScreenshot: boolean;
  includeSource: boolean;
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

export interface EditorEnv {
  store: EditorStore;
  host: HTMLElement;
  shadow: ShadowRoot;
  close: () => void;
  runExport: (options: ExportOptions, onStatus: (status: ExportStatus) => void) => Promise<void>;
  toast: (message: string) => void;
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

/** Bumps when page layout may have changed (resize, DOM mutations), so anchored pins can follow. */
export function useLayoutVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setVersion((v) => v + 1), 120);
    };
    const resize = new ResizeObserver(bump);
    resize.observe(document.documentElement);
    if (document.body) resize.observe(document.body);
    window.addEventListener('resize', bump);
    return () => {
      if (timer) clearTimeout(timer);
      resize.disconnect();
      window.removeEventListener('resize', bump);
    };
  }, []);
  return version;
}
