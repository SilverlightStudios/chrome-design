import type { ZipEntry } from '../export/zip';
import type { SentWalkthrough } from '../shared/model';
import { dataUrlOf } from '../shared/pixels';
import type { HandoffData } from './handoff';
import { filesOf, sheetOf } from './walkthrough/output';
import { recorder } from './walkthrough/recorder';

/**
 * What Send to AI sends: the page's feedback (comments, drawings, pictures) and, when there is
 * one, the walkthrough. Every way out (the .html file, the .zip, Copy for AI) carries both, and
 * the panel previews exactly that.
 */

export interface PackedWalkthrough extends SentWalkthrough {
  /** The contact sheet as PNG, for the clipboard. */
  png?: Blob;
  /** Its files for the .zip (walkthrough/…). */
  files: () => Promise<ZipEntry[]>;
}

const text = (s: string) => new TextEncoder().encode(s);
const bytesOfDataUrl = async (url: string) =>
  new Uint8Array(await (await fetch(url)).arrayBuffer());

/** The walkthrough to send: the one finished here, else the one a shared file came with. */
export async function walkthroughToSend(handoff?: HandoffData): Promise<PackedWalkthrough | null> {
  const result = recorder.getState().result;
  if (result) {
    const sheet = await sheetOf(result);
    if (!sheet) return null;
    return {
      summary: result.summary,
      sheet: { dataUrl: await dataUrlOf(sheet.jpeg), width: sheet.width, height: sheet.height },
      png: sheet.png,
      files: () => filesOf(result),
    };
  }
  const sent = handoff?.walkthrough;
  if (!sent) return null;
  return {
    ...sent,
    files: async () => [
      { name: 'summary.md', data: text(sent.summary) },
      { name: 'contact-sheet.jpg', data: await bytesOfDataUrl(sent.sheet.dataUrl) },
    ],
  };
}
