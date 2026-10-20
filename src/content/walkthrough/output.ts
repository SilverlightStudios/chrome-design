import { type ZipEntry, zipEntries } from '../../export/zip';
import { escapeHtml } from '../../shared/escape';
import type { WtBundleRequest } from '../../shared/messages';
import { dataUrlOf } from '../../shared/pixels';
import { buildBundle } from '../../walkthrough/bundle';
import type { Walkthrough } from '../../walkthrough/model';
import { alignTranscript, buildSummary } from '../../walkthrough/summary';
import type { ParsedTranscript } from '../../walkthrough/transcript';
import { askBackground, hasExtensionRuntime } from '../ext';
import type { WalkthroughResult } from './assemble';

/**
 * What a finished walkthrough gives: its pictures cropped, its contact sheet, its files (the
 * .zip, the voice recorder's folder) and Copy for AI. With pictures, the service worker draws
 * them (it keeps the pictures: background/walkthroughFiles.ts); without (the demo page, a shared
 * file) the same drawing runs here, as a list.
 */

export interface Sheet {
  jpeg: Blob;
  png: Blob;
  /** For showing it (an object URL of the JPEG). */
  url: string;
  width: number;
  height: number;
}

/** The walkthrough for the service worker (null without one: the demo page, a shared file). */
export function bundleRequest(result: WalkthroughResult): WtBundleRequest | null {
  const session = result.walkthrough.session?.id;
  if (!session || !hasExtensionRuntime()) return null;
  const { walkthrough, summary, folder, shots } = result;
  return { session, walkthrough, summary, folder, shots };
}

/** Each picture cropped to where its moment happened (Scrawl's auto-crop). */
export async function withCrops(result: WalkthroughResult): Promise<WalkthroughResult> {
  const request = bundleRequest(result);
  if (!request) return result;
  const { session, shots, walkthrough } = request;
  const reply = await askBackground('cd:wt-crop', { session, shots, walkthrough });
  if (!reply || reply.walkthrough === walkthrough) return result;
  return { ...result, walkthrough: reply.walkthrough, summary: buildSummary(reply.walkthrough) };
}

const blobOf = async (dataUrl: string) => (await fetch(dataUrl)).blob();
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const sheets = new WeakMap<WalkthroughResult, Promise<Sheet | null>>();

/** The whole walkthrough as one picture (made once per result). */
export function sheetOf(result: WalkthroughResult): Promise<Sheet | null> {
  let job = sheets.get(result);
  if (!job) {
    job = (async () => {
      const request = bundleRequest(result);
      if (request) {
        const reply = await askBackground('cd:wt-sheet', request);
        if (!reply) return null;
        const jpeg = await blobOf(reply.jpeg);
        const png = await blobOf(reply.png);
        return {
          jpeg,
          png,
          url: URL.createObjectURL(jpeg),
          width: reply.width,
          height: reply.height,
        };
      }
      const { sheet } = await buildBundle(result.walkthrough, result.summary, async () => null);
      return { ...sheet, url: URL.createObjectURL(sheet.jpeg) };
    })();
    sheets.set(result, job);
  }
  return job;
}

/** Every file of the walkthrough (summary.md, walkthrough.json, the pictures). */
export async function filesOf(result: WalkthroughResult): Promise<ZipEntry[]> {
  const request = bundleRequest(result);
  if (!request)
    return (await buildBundle(result.walkthrough, result.summary, async () => null)).files;
  const files = (await askBackground('cd:wt-files', request)) ?? [];
  return files.map((f) => ({ name: f.name, data: fromBase64(f.base64) }));
}

export async function walkthroughZip(result: WalkthroughResult): Promise<Blob> {
  const entries = (await filesOf(result)).map((f) => ({
    ...f,
    name: `${result.folder}/${f.name}`,
  }));
  return new Blob([zipEntries(entries)], { type: 'application/zip' });
}

/** The summary and contact sheet on the clipboard, for an AI chat. */
export async function copyWalkthrough(result: WalkthroughResult): Promise<boolean> {
  const sheet = await sheetOf(result);
  const plain = new Blob([result.summary], { type: 'text/plain' });
  try {
    const items: Record<string, Blob> = { 'text/plain': plain };
    if (sheet) {
      const img = `<img src="${escapeHtml(await dataUrlOf(sheet.jpeg))}" alt="Walkthrough contact sheet">`;
      items['text/html'] = new Blob(
        [`<meta charset="utf-8">${img}<pre>${escapeHtml(result.summary)}</pre>`],
        { type: 'text/html' },
      );
      items['image/png'] = sheet.png;
    }
    await navigator.clipboard.write([new ClipboardItem(items)]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(result.summary);
      return true;
    } catch {
      return false;
    }
  }
}

/** Add what was said (or take it away with `null`): the summary is rebuilt. */
export function withTranscript(
  result: WalkthroughResult,
  parsed: ParsedTranscript | null,
  options: { offsetMs?: number; source?: string } = {},
): WalkthroughResult {
  const { transcript: _old, ...rest } = result.walkthrough;
  const { heard: _heard, ...kept } = result;
  const walkthrough: Walkthrough = parsed
    ? { ...rest, transcript: alignTranscript(rest, parsed, options) }
    : rest;
  return {
    ...kept,
    walkthrough,
    summary: buildSummary(walkthrough),
    ...(parsed ? { heard: { parsed, name: options.source ?? parsed.format } } : {}),
  };
}

/** Let the service worker drop a walkthrough's pictures (it was discarded or replaced). */
export function releasePictures(result: WalkthroughResult): void {
  const session = result.walkthrough.session?.id;
  if (session && hasExtensionRuntime()) void askBackground('cd:wt-discard', { session });
}
