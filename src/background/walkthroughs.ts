import type { BackgroundRequest, WtPageData, WtSessionInfo } from '../shared/messages';
import { sendToTab } from './inject';

/**
 * Walkthroughs that carry on when the tab loads another page. The page's script goes away
 * with the page, so the page sends what it has recorded here about once a second; when the tab
 * finishes loading the next page, the walkthrough is started again there on the same clock,
 * and on Stop the last page collects the earlier pages and puts it all together.
 *
 * Kept in memory: the page's messages keep this worker awake while it records. Pages Chrome
 * Design can't run on (chrome://, the Web Store, other sites without "Allow other websites")
 * are skipped; it carries on on the next page it can run on.
 */

interface Session {
  info: WtSessionInfo;
  pages: Map<string, WtPageData>;
  /** The voice recorder said stop while the next page was loading: stop once it's there. */
  stopAfterResume?: boolean;
}

const sessions = new Map<number, Session>();

export function beginWalkthrough(tabId: number, info: WtSessionInfo): null {
  sessions.set(tabId, { info, pages: new Map() });
  return null;
}

export function syncWalkthrough(tabId: number, message: BackgroundRequest<'cd:wt-sync'>): null {
  const s = sessions.get(tabId);
  if (!s) return null;
  s.info.pinCount = Math.max(s.info.pinCount, message.pinCount);
  const { cursorFrom, cursor, pictures, ...rest } = message.page;
  const page: WtPageData = s.pages.get(rest.pageId) ?? { ...rest, cursor: [], pictures: [] };
  Object.assign(page, rest);
  page.cursor = [...page.cursor.slice(0, cursorFrom), ...cursor];
  for (const p of pictures) {
    const at = page.pictures.findIndex((x) => x.key === p.key);
    if (at >= 0) page.pictures[at] = p;
    else page.pictures.push(p);
  }
  s.pages.set(rest.pageId, page);
  return null;
}

/** The pages recorded before this one, in order. */
export function collectWalkthrough(tabId: number, pageId: string): WtPageData[] {
  const s = sessions.get(tabId);
  if (!s) return [];
  return [...s.pages.values()]
    .filter((p) => p.pageId !== pageId)
    .toSorted((a, b) => (a.scrolls[0]?.[0] ?? 0) - (b.scrolls[0]?.[0] ?? 0));
}

export function endWalkthrough(tabId: number): null {
  sessions.delete(tabId);
  return null;
}

export function activeWalkthrough(tabId: number): WtSessionInfo | null {
  return sessions.get(tabId)?.info ?? null;
}

/** Stop as soon as the page that's loading has picked the walkthrough up. */
export function stopAfterResume(tabId: number): boolean {
  const s = sessions.get(tabId);
  if (!s) return false;
  s.stopAfterResume = true;
  return true;
}

export function initWalkthroughs(): void {
  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    const s = sessions.get(tabId);
    if (!s || change.status !== 'complete') return;
    void sendToTab(tab, { type: 'cd:walkthrough', action: 'resume', info: s.info }).then((r) => {
      if (!r.ok || !s.stopAfterResume) return;
      s.stopAfterResume = false;
      void chrome.tabs
        .sendMessage(tabId, { type: 'cd:walkthrough', action: 'stop', session: s.info.session.id })
        .catch(() => undefined);
    });
  });
  chrome.tabs.onRemoved.addListener((tabId) => sessions.delete(tabId));
}
