import {
  type Annotation,
  type AnnotationDoc,
  type CommentThread,
  type HandoffPayload,
  isComment,
  PAYLOAD_KIND,
  type Shape,
} from '../shared/model';
import type { ToastAction } from './context';
import { pageKey } from './persistence';
import { type EditorStore, nextCommentNumber } from './store';

/**
 * Bringing a handoff back: open (or drop) a downloaded .html or .zip on the live page and its
 * comments, replies, drawings and pictures join the notes already here. The round trip is
 * designer → teammate (replies in the shared file) → back on the real site, where each comment
 * can be checked against what shipped and resolved.
 */

export function isHandoffFile(file: File): boolean {
  return /\.(html?|zip)$/i.test(file.name) || file.type === 'text/html';
}

/** The payload inside a handoff file's HTML (the last payload block; the header mentions it). */
export function parseHandoffHtml(html: string): HandoffPayload | null {
  const blocks = [
    ...html.matchAll(/<script\b[^>]*\bid="chrome-design-payload"[^>]*>([\s\S]*?)<\/script>/gi),
  ];
  for (let i = blocks.length - 1; i >= 0; i--) {
    try {
      const payload = JSON.parse(blocks[i]![1]!.trim()) as HandoffPayload;
      if (payload?.kind === PAYLOAD_KIND && Array.isArray(payload.annotations)) return payload;
    } catch {
      // the header's mention of the block, or a damaged copy
    }
  }
  return null;
}

/** Files in a stored (uncompressed) zip, which is what the .zip download writes. */
export function readStoredZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const files = new Map<string, Uint8Array>();
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  let at = 0;
  while (at + 30 <= bytes.length && view.getUint32(at, true) === 0x04034b50) {
    const method = view.getUint16(at + 8, true);
    const size = view.getUint32(at + 18, true);
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength));
    const start = at + 30 + nameLength + extraLength;
    if (method === 0) files.set(name, bytes.subarray(start, start + size));
    at = start + size;
  }
  return files;
}

export async function readHandoffFile(file: File): Promise<HandoffPayload | null> {
  if (/\.zip$/i.test(file.name) || file.type === 'application/zip') {
    const files = readStoredZip(new Uint8Array(await file.arrayBuffer()));
    const decoder = new TextDecoder();
    for (const [name, data] of files) {
      if (!name.endsWith('handoff.json')) continue;
      try {
        const payload = JSON.parse(decoder.decode(data)) as HandoffPayload;
        if (payload?.kind === PAYLOAD_KIND) return payload;
      } catch {
        // fall through to the .html inside
      }
    }
    for (const [name, data] of files) {
      if (/\.html$/i.test(name) && !name.endsWith('page.html')) {
        const payload = parseHandoffHtml(decoder.decode(data));
        if (payload) return payload;
      }
    }
    return null;
  }
  return parseHandoffHtml(await file.text());
}

export interface MergeResult {
  annotations: Annotation[];
  comments: number;
  replies: number;
  shapes: number;
  /** Threads whose state (resolved, kind, place) came over from the file. */
  updated: number;
}

function laterOf(a: CommentThread, b: CommentThread): CommentThread {
  return new Date(b.updatedAt).getTime() > new Date(a.updatedAt).getTime() ? b : a;
}

/** Placement is worked out fresh at every export; it isn't part of the drawing. */
function cleanShape(shape: Shape): Shape {
  if (shape.kind !== 'image' || !shape.placement) return shape;
  const { placement: _placement, ...rest } = shape;
  return rest;
}

/**
 * Join a file's feedback with the notes already here. Nothing here is lost: threads present in
 * both get every reply from either side (the more recently changed copy decides resolved / kind
 * / place); drawings already here stay as they are and new ones are added; new threads get a
 * fresh number if theirs is taken.
 */
export function mergeFeedback(local: Annotation[], incoming: Annotation[]): MergeResult {
  const result: MergeResult = {
    annotations: [...local],
    comments: 0,
    replies: 0,
    shapes: 0,
    updated: 0,
  };
  const index = new Map(local.map((a, i) => [a.id, i]));
  for (const item of incoming) {
    const at = index.get(item.id);
    if (at === undefined) {
      if (isComment(item)) {
        const taken = result.annotations.some((a) => isComment(a) && a.number === item.number);
        result.annotations.push(
          taken ? { ...item, number: nextCommentNumber(result.annotations) } : item,
        );
        result.comments++;
      } else {
        result.annotations.push(cleanShape(item));
        result.shapes++;
      }
      index.set(item.id, result.annotations.length - 1);
      continue;
    }
    const mine = result.annotations[at]!;
    if (!isComment(mine) || !isComment(item)) continue;
    const known = new Set(mine.messages.map((m) => m.id));
    const added = item.messages.filter((m) => !known.has(m.id));
    const newer = laterOf(mine, item);
    const changed =
      newer === item &&
      (item.status !== mine.status ||
        item.intent !== mine.intent ||
        item.scope !== mine.scope ||
        JSON.stringify(item.target) !== JSON.stringify(mine.target));
    if (added.length === 0 && !changed) continue;
    result.replies += added.length;
    if (changed) result.updated++;
    const { scope: _scope, ...base } = mine;
    result.annotations[at] = {
      ...base,
      ...(newer.scope ? { scope: newer.scope } : {}),
      status: newer.status,
      intent: newer.intent,
      target: newer.target,
      messages: [...mine.messages, ...added].toSorted(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      ),
      updatedAt: newer.updatedAt,
    };
  }
  return result;
}

function summary(r: MergeResult): string {
  const parts = [
    r.comments ? `${r.comments} comment${r.comments === 1 ? '' : 's'}` : '',
    r.replies ? `${r.replies} repl${r.replies === 1 ? 'y' : 'ies'}` : '',
    r.shapes ? `${r.shapes} drawing${r.shapes === 1 ? '' : 's'}` : '',
    r.updated ? `${r.updated} update${r.updated === 1 ? '' : 's'}` : '',
  ].filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? '';
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function hostAndPath(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace(/^www\./, '')}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return url;
  }
}

/** Add a payload's feedback to the open page as one undoable step. */
export function applyHandoff(
  store: EditorStore,
  payload: HandoffPayload,
  toast: (message: string, action?: ToastAction) => void,
): void {
  const doc = store.getState().doc;
  const merged = mergeFeedback(doc.annotations, payload.annotations);
  const text = summary(merged);
  if (!text) {
    toast('Everything in that file is already here');
    return;
  }
  store.commit(
    (d): AnnotationDoc => ({
      ...d,
      annotations: merged.annotations,
      brief: d.brief.trim() ? d.brief : (payload.brief ?? ''),
      guides: [
        ...d.guides,
        ...(payload.guides ?? []).filter((g) => !d.guides.some((x) => x.id === g.id)),
      ],
    }),
  );
  store.set({ tool: 'select', panel: 'none', draft: null, openThreadId: null });
  toast(`Added ${text}`, { label: 'Undo', run: store.undo });
}

/** Open handoff files (drop or picker). A file for another page asks before adding. */
export async function importHandoffFiles(
  store: EditorStore,
  files: File[],
  toast: (message: string, action?: ToastAction) => void,
): Promise<void> {
  for (const file of files.filter(isHandoffFile)) {
    const payload = await readHandoffFile(file).catch(() => null);
    if (!payload) {
      toast('That file isn’t a Chrome Design handoff');
      continue;
    }
    const here = store.getState().doc.url;
    if (pageKey(payload.page.url) !== pageKey(here)) {
      toast(`That feedback is for ${hostAndPath(payload.page.url)}`, {
        label: 'Add anyway',
        run: () => applyHandoff(store, payload, toast),
        duration: 10_000,
      });
      continue;
    }
    applyHandoff(store, payload, toast);
  }
}

/** The system picker for handoff files. */
export function pickHandoffFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.html,.htm,.zip,text/html,application/zip';
    input.multiple = true;
    input.addEventListener('change', () => resolve(Array.from(input.files ?? [])), { once: true });
    input.addEventListener('cancel', () => resolve([]), { once: true });
    input.click();
  });
}
