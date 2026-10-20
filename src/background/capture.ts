import type { CaptureVisibleTabResponse } from '../shared/messages';
import type { FullPageShot } from '../shared/model';
import {
  type Canvas,
  type Context,
  canvasOf,
  dataUrlOf,
  decode,
  encode,
  scaled,
} from '../shared/pixels';

/**
 * Pictures of tabs. Chrome allows an extension two a second, so every picture (a walkthrough's,
 * an export's screenshot, each screen of a full-page picture, from any tab) waits its turn
 * here. A tab first asks for a turn (`captureTurn`), then hides its toolbar and asks for the
 * picture: so the toolbar is only hidden for the picture itself, never while it waits. Pictures
 * are resized and stitched here too, off the page.
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

/** The tab's window as it is now, decoded. */
export async function shoot(windowId: number): Promise<ImageBitmap> {
  // Without a turn (nothing else waiting), still never two within the limit.
  await sleep(lastShot + GAP_MS - Date.now());
  try {
    return await decode(await chrome.tabs.captureVisibleTab(windowId, { format: 'png' }));
  } finally {
    lastShot = Date.now();
    endTurn?.();
    endTurn = null;
  }
}

const failed = (error: unknown) => ({
  ok: false as const,
  error: error instanceof Error ? error.message : String(error),
});

/** A picture of the tab, as a JPEG at most `maxWidth` wide. */
export async function captureTab(
  windowId: number,
  maxWidth: number,
): Promise<CaptureVisibleTabResponse> {
  try {
    const shot = await shoot(windowId);
    const picture = scaled(shot, maxWidth);
    const blob = await encode(picture, 'image/jpeg', 0.86);
    shot.close();
    return {
      ok: true,
      dataUrl: await dataUrlOf(blob),
      width: picture.width,
      height: picture.height,
    };
  } catch (error) {
    return failed(error);
  }
}

/** Full-page pictures being stitched, one per tab: a screen at a time, top to bottom. */
const pages = new Map<number, { canvas: Canvas; ctx: Context; scale: number }>();

export function startFullPage(tabId: number, width: number, height: number, scale: number): null {
  const [canvas, ctx] = canvasOf(width, height);
  pages.set(tabId, { canvas, ctx, scale });
  return null;
}

/** One screen of it: the viewport (`view`, CSS px) as it is now, scrolled to `y`. */
export async function addFullPageScreen(
  tab: { id: number; windowId: number },
  y: number,
  view: { width: number; height: number; innerWidth: number },
): Promise<{ ok: boolean }> {
  const page = pages.get(tab.id);
  if (!page) return { ok: false };
  try {
    const shot = await shoot(tab.windowId);
    const dpr = shot.width / view.innerWidth;
    // Leave out a classic scrollbar on the right.
    page.ctx.drawImage(
      shot,
      0,
      0,
      view.width * dpr,
      view.height * dpr,
      0,
      Math.round(y * page.scale),
      page.canvas.width,
      Math.round(view.height * page.scale),
    );
    shot.close();
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/** The stitched picture, cut to `height` CSS px (what the screens covered). */
export async function finishFullPage(tabId: number, height: number): Promise<FullPageShot | null> {
  const page = pages.get(tabId);
  pages.delete(tabId);
  if (!page) return null;
  const h = Math.min(page.canvas.height, Math.round(height * page.scale));
  const [canvas, ctx] = canvasOf(page.canvas.width, h);
  ctx.drawImage(page.canvas, 0, 0);
  return {
    dataUrl: await dataUrlOf(await encode(canvas, 'image/jpeg', 0.8)),
    width: canvas.width,
    height: canvas.height,
    scale: page.scale,
  };
}
