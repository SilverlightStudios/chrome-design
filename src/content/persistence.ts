import { type AnnotationDoc, DEFAULT_GRID, type GridSettings } from '../shared/model';

/**
 * Annotations are stored in extension storage (never on the site) keyed by page URL
 * without the hash. Grid settings are remembered per origin.
 */

export function pageKey(href: string): string {
  try {
    const url = new URL(href);
    url.hash = '';
    return `doc:${url.href}`;
  } catch {
    return `doc:${href}`;
  }
}

export function gridKey(href: string): string {
  try {
    return `grid:${new URL(href).origin}`;
  } catch {
    return 'grid:default';
  }
}

export const UI_KEY = 'ui:toolbar';

export interface UiPrefs {
  toolbarOffset: { x: number; y: number };
}

function area(): chrome.storage.StorageArea | null {
  return typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null;
}

/** Demo page fallback (no extension runtime): per-origin localStorage. */
function demoStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

async function read<T>(key: string): Promise<T | undefined> {
  const store = area();
  if (!store) {
    const raw = demoStorage()?.getItem(`chrome-design:${key}`);
    return raw ? (JSON.parse(raw) as T) : undefined;
  }
  try {
    const result = await store.get(key);
    return result[key] as T | undefined;
  } catch {
    return undefined;
  }
}

async function write(key: string, value: unknown): Promise<void> {
  const store = area();
  if (!store) {
    try {
      demoStorage()?.setItem(`chrome-design:${key}`, JSON.stringify(value));
    } catch {
      // storage full or blocked; the demo simply won't persist
    }
    return;
  }
  try {
    await store.set({ [key]: value });
  } catch (error) {
    console.warn('[Chrome Design] Could not save to extension storage', error);
  }
}

export async function loadDoc(href: string): Promise<AnnotationDoc | undefined> {
  const doc = await read<AnnotationDoc>(pageKey(href));
  if (!doc || !Array.isArray(doc.annotations)) return undefined;
  return { ...doc, guides: Array.isArray(doc.guides) ? doc.guides : [], brief: doc.brief ?? '' };
}

export function saveDoc(href: string, doc: AnnotationDoc): Promise<void> {
  return write(pageKey(href), doc);
}

export async function loadGrid(href: string): Promise<GridSettings> {
  const grid = await read<Partial<GridSettings>>(gridKey(href));
  return { ...DEFAULT_GRID, ...grid, visible: false };
}

export function saveGrid(href: string, grid: GridSettings): Promise<void> {
  return write(gridKey(href), grid);
}

export async function loadUiPrefs(): Promise<UiPrefs> {
  const prefs = await read<UiPrefs>(UI_KEY);
  return prefs ?? { toolbarOffset: { x: 0, y: 0 } };
}

export function saveUiPrefs(prefs: UiPrefs): Promise<void> {
  return write(UI_KEY, prefs);
}

export function debounce<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): (...args: A) => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: A) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
