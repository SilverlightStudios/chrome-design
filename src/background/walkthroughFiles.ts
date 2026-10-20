import { arrayBufferToBase64 } from '../shared/base64';
import type { WtBundleRequest, WtFile, WtPictureTaken, WtSheet } from '../shared/messages';
import { dataUrlOf, decode, encode, pixelsOf, scaled } from '../shared/pixels';
import { type Bundle, buildBundle, cropWithPictures, type PictureOf } from '../walkthrough/bundle';
import type { Walkthrough } from '../walkthrough/model';
import { look, lookToWire } from '../walkthrough/scene';
import { shoot } from './capture';
import { getPicture, putPicture, removeOld, removeSession } from './pictureStore';

/**
 * A walkthrough's pictures and files, made here rather than on the page: each picture is taken,
 * resized and kept here as it's asked for (the page gets back its size and a small "look" for
 * telling whether the screen changed), and on Stop the crops, the annotated pictures and the
 * contact sheet are worked out here too. The page only ever holds the walkthrough itself.
 */

/** Full resolution up to 2560 px (Scrawl decodes Screen keyframes at 2560): crops stay sharp. */
const KEEP_WIDTH = 2560;
/** The small copy that's compared (scene.ts). */
const LOOK_WIDTH = 256;

/** The sessions each tab has pictures for (to clean up when it closes). */
const tabSessions = new Map<number, Set<string>>();
/** The walkthrough each tab last finished: the one before it is no longer needed. */
const finished = new Map<number, string>();

export async function takePicture(
  tab: { id: number; windowId: number },
  session: string,
  key: string,
): Promise<WtPictureTaken | null> {
  try {
    const shot = await shoot(tab.windowId);
    const kept = scaled(shot, KEEP_WIDTH);
    const { width, height } = kept;
    await putPicture(session, key, await encode(kept, 'image/jpeg', 0.86));
    const px = pixelsOf(scaled(shot, LOOK_WIDTH));
    shot.close();
    tabSessions.set(tab.id, (tabSessions.get(tab.id) ?? new Set()).add(session));
    return { width, height, look: lookToWire(look(px.rgba, px.w, px.h)) };
  } catch (error) {
    console.warn('[Chrome Design] picture', error);
    return null;
  }
}

function pictureOf(request: Pick<WtBundleRequest, 'session' | 'shots'>): PictureOf {
  return async (frame) => {
    const key = request.shots[frame.file];
    const blob = key ? await getPicture(request.session, key) : null;
    return blob ? decode(blob) : null;
  };
}

/** The picked pictures cropped (Scrawl's auto-crop); the ones that weren't picked are let go. */
export async function cropWalkthrough(
  tabId: number,
  request: Pick<WtBundleRequest, 'session' | 'shots' | 'walkthrough'>,
): Promise<{ walkthrough: Walkthrough }> {
  const before = finished.get(tabId);
  if (before && before !== request.session) void removeSession(before);
  finished.set(tabId, request.session);
  void removeSession(request.session, new Set(Object.values(request.shots)));
  return { walkthrough: await cropWithPictures(request.walkthrough, pictureOf(request)) };
}

/** The last bundle made for each session (a transcript changes the captions: made again). */
const bundles = new Map<string, { key: string; bundle: Promise<Bundle> }>();

export function bundleFor(request: WtBundleRequest): Promise<Bundle> {
  const key = `${request.summary}\n${JSON.stringify(request.walkthrough.frames)}`;
  const known = bundles.get(request.session);
  if (known?.key === key) return known.bundle;
  const bundle = buildBundle(request.walkthrough, request.summary, pictureOf(request));
  bundles.set(request.session, { key, bundle });
  bundle.catch(() => bundles.delete(request.session));
  return bundle;
}

export async function sheetOf(request: WtBundleRequest): Promise<WtSheet> {
  const { sheet } = await bundleFor(request);
  return {
    jpeg: await dataUrlOf(sheet.jpeg),
    png: await dataUrlOf(sheet.png),
    width: sheet.width,
    height: sheet.height,
  };
}

export async function filesOf(request: WtBundleRequest): Promise<WtFile[]> {
  const { files } = await bundleFor(request);
  return files.map((f) => ({ name: f.name, base64: arrayBufferToBase64(f.data) }));
}

/** A closed tab's walkthroughs: their pictures and files go. */
export function forgetTab(tabId: number): void {
  for (const session of tabSessions.get(tabId) ?? []) {
    bundles.delete(session);
    void removeSession(session);
  }
  tabSessions.delete(tabId);
  finished.delete(tabId);
}

export function initWalkthroughFiles(): void {
  void removeOld().catch(() => undefined);
}
