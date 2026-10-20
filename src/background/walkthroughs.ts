import type { BackgroundRequest, WtPageData, WtSessionInfo } from '../shared/messages';
import { sendToTab } from './inject';
import { forgetTab } from './walkthroughFiles';

/**
 * Walkthroughs that carry on when the tab loads another page. The page's script goes away
 * with the page, so the page sends what it has recorded here about once a second; when the tab
 * finishes loading the next page, the walkthrough is started again there on the same clock,
 * and on Stop the last page collects the earlier pages and puts it all together. (The pictures
 * are already here: walkthroughFiles.ts takes and keeps them.)
 *
 * Kept in chrome.storage.session, so a walkthrough survives this worker being stopped. Pages
 * Chrome Design can't run on (chrome://, the Web Store, other sites without "Allow other
 * websites") are skipped; it carries on on the next page it can run on.
 */

interface Session {
  info: WtSessionInfo;
  pages: Record<string, WtPageData>;
  /** The voice recorder said stop while the next page was loading: stop once it's there. */
  stopAfterResume?: boolean;
}

const keyOf = (tabId: number) => `wt:${tabId}`;
/** Read once per tab after the worker starts, then kept here too. */
const cache = new Map<number, Session | null>();

async function load(tabId: number): Promise<Session | null> {
  if (!cache.has(tabId)) {
    const stored = await chrome.storage.session.get(keyOf(tabId)).catch(() => ({}));
    cache.set(tabId, (stored as Record<string, Session>)[keyOf(tabId)] ?? null);
  }
  return cache.get(tabId) ?? null;
}

function save(tabId: number, s: Session | null): null {
  cache.set(tabId, s);
  void (
    s
      ? chrome.storage.session.set({ [keyOf(tabId)]: s })
      : chrome.storage.session.remove(keyOf(tabId))
  ).catch(() => undefined);
  return null;
}

export function beginWalkthrough(tabId: number, info: WtSessionInfo): null {
  return save(tabId, { info, pages: {} });
}

export async function syncWalkthrough(
  tabId: number,
  message: BackgroundRequest<'cd:wt-sync'>,
): Promise<null> {
  const s = await load(tabId);
  if (!s) return null;
  s.info.pinCount = Math.max(s.info.pinCount, message.pinCount);
  const { cursorFrom, cursor, pictures, ...rest } = message.page;
  const page = s.pages[rest.pageId] ?? { ...rest, cursor: [], pictures: [] };
  Object.assign(page, rest);
  page.cursor = [...page.cursor.slice(0, cursorFrom), ...cursor];
  for (const p of pictures) {
    const at = page.pictures.findIndex((x) => x.key === p.key);
    if (at >= 0) page.pictures[at] = p;
    else page.pictures.push(p);
  }
  s.pages[rest.pageId] = page;
  return save(tabId, s);
}

/** The pages recorded before this one, in order. */
export async function collectWalkthrough(tabId: number, pageId: string): Promise<WtPageData[]> {
  const s = await load(tabId);
  return Object.values(s?.pages ?? {})
    .filter((p) => p.pageId !== pageId)
    .toSorted((a, b) => (a.scrolls[0]?.[0] ?? 0) - (b.scrolls[0]?.[0] ?? 0));
}

export function endWalkthrough(tabId: number): null {
  return save(tabId, null);
}

export async function activeWalkthrough(tabId: number): Promise<WtSessionInfo | null> {
  return (await load(tabId))?.info ?? null;
}

/** Stop as soon as the page that's loading has picked the walkthrough up. */
export async function stopAfterResume(tabId: number): Promise<boolean> {
  const s = await load(tabId);
  if (!s) return false;
  save(tabId, { ...s, stopAfterResume: true });
  return true;
}

export function initWalkthroughs(): void {
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== 'complete') return;
    void load(tabId).then(async (s) => {
      if (!s) return;
      const r = await sendToTab(tab, { type: 'cd:walkthrough', action: 'resume', info: s.info });
      if (!r.ok || !s.stopAfterResume) return;
      save(tabId, { ...s, stopAfterResume: false });
      await chrome.tabs
        .sendMessage(tabId, { type: 'cd:walkthrough', action: 'stop', session: s.info.session.id })
        .catch(() => undefined);
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => {
    save(tabId, null);
    forgetTab(tabId);
  });
}
