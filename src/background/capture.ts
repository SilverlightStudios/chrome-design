import type { CaptureVisibleTabResponse } from '../shared/messages';

/**
 * Pictures of tabs. Chrome allows an extension two a second, so every picture (a walkthrough's,
 * an export's screenshot, each screen of a full-page picture, from any tab) waits its turn
 * here. A tab first asks for a turn (`captureTurn`), then hides its toolbar and asks for the
 * picture: so the toolbar is only hidden for the picture itself, never while it waits.
 */

/** A little over half a second: Chrome counts two per second. */
const GAP_MS = 560;
/** A turn not used within this long is given up (the tab went away). */
const TURN_MS = 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, Math.max(0, ms)));

let lastShot = 0;
let turns: Promise<void> = Promise.resolve();
let endTurn: (() => void) | null = null;

/** Resolves when it's this tab's turn; the turn lasts until its picture is taken. */
export function captureTurn(): Promise<null> {
  const turn = turns.then(() => sleep(lastShot + GAP_MS - Date.now()));
  turns = turn.then(
    () =>
      new Promise<void>((done) => {
        endTurn = done;
        setTimeout(done, TURN_MS);
      }),
  );
  return turn.then(() => null);
}

export async function captureTab(windowId: number): Promise<CaptureVisibleTabResponse> {
  // Without a turn (nothing else waiting), still never two within the limit.
  await sleep(lastShot + GAP_MS - Date.now());
  try {
    return { ok: true, dataUrl: await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    lastShot = Date.now();
    endTurn?.();
    endTurn = null;
  }
}
