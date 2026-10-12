import { freezeMediaQueries } from '../capture/media';
import { BLOCK_IDS, ROOT_ATTRIBUTE } from '../export/prompt';
import type { AnnotationDoc, HandoffPayload } from '../shared/model';

/**
 * A shared handoff file opened in a browser: the page copy with Chrome Design built in. The
 * same script that runs as the extension's content script finds the feedback in the file's
 * data blocks and starts the toolbar on top, so whoever opens it can read, reply, draw and
 * download an updated file — no extension needed.
 */
export interface HandoffData {
  payload: HandoffPayload;
  /** This script's own source, so a re-download can build it in again. */
  runtime: string;
  /** The original page's rendered DOM (reference block), carried over unchanged. */
  source: string;
  screenshot?: { dataUrl: string; width: number; height: number };
  /** Where edits made in this copy are remembered (per file, in this browser). */
  storageKey: string;
}

export function isHandoffDocument(doc: Document = document): boolean {
  return (
    doc.documentElement.hasAttribute(ROOT_ATTRIBUTE) && !!doc.getElementById(BLOCK_IDS.payload)
  );
}

function blockText(id: string): string | null {
  return document.getElementById(id)?.textContent ?? null;
}

export function readHandoff(runtime: string): HandoffData | null {
  try {
    const payload = JSON.parse(blockText(BLOCK_IDS.payload) ?? '') as HandoffPayload;
    if (!payload || !Array.isArray(payload.annotations)) return null;
    const sourceText = blockText(BLOCK_IDS.source);
    const source = sourceText ? (JSON.parse(sourceText) as string) : '';
    const shot = document.getElementById(BLOCK_IDS.screenshot);
    const data: HandoffData = {
      payload,
      runtime,
      source,
      storageKey: `handoff:${payload.exportedAt}:${payload.page.url}`,
    };
    const dataUrl = shot?.textContent?.trim();
    if (shot && dataUrl?.startsWith('data:image/'))
      data.screenshot = {
        dataUrl,
        width: Number(shot.getAttribute('data-width')) || 0,
        height: Number(shot.getAttribute('data-height')) || 0,
      };
    return data;
  } catch (error) {
    console.warn('[Chrome Design] This handoff file could not be read', error);
    return null;
  }
}

/** The feedback as it was exported (edits made in this copy are loaded over it). */
export function handoffDoc(payload: HandoffPayload): AnnotationDoc {
  return {
    url: payload.page.url,
    title: payload.page.title,
    brief: payload.brief ?? '',
    annotations: payload.annotations,
    guides: payload.guides ?? [],
    updatedAt: payload.exportedAt,
  };
}

/**
 * Make the copy behave like the page did: drop the no-JavaScript fallback layer, answer every
 * media query the way the designer's screen did (the width is already held by CSS), and put
 * inner scrollers back where they were.
 */
export function prepareHandoffPage(data: HandoffData): void {
  for (const el of Array.from(document.querySelectorAll('chrome-design-static'))) el.remove();
  if (data.payload.page.media) freezeMediaQueries(document, data.payload.page.media);
  for (const el of Array.from(document.querySelectorAll<HTMLElement>('[data-cd-scroll]'))) {
    const [top = 0, left = 0] = (el.getAttribute('data-cd-scroll') ?? '').split(',').map(Number);
    el.scrollTop = top;
    el.scrollLeft = left;
  }
}
