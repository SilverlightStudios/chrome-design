import {
  byteLength,
  escapeHtml,
  escapeHtmlComment,
  escapeInlineScript,
  jsonForScript,
} from '../shared/escape';
import {
  type Annotation,
  type AnnotationDoc,
  APP_NAME,
  APP_VERSION,
  type CommentThread,
  type ElementAnchor,
  type GridSettings,
  type HandoffPayload,
  type ImageIndexEntry,
  INTENT_LABEL,
  isComment,
  isShape,
  PAYLOAD_KIND,
  type PageCapture,
  SCHEMA_ID,
  SCHEMA_VERSION,
} from '../shared/model';
import { handoffSchema } from '../shared/schema';
import { pinColor, renderOverlaySvg } from './overlay';
import {
  BLOCK_IDS,
  buildAgentPrompt,
  describeAnnotations,
  MARKERS,
  ROOT_ATTRIBUTE,
} from './prompt';

export interface BuildInput {
  capture: PageCapture;
  doc: AnnotationDoc;
  /** anchor selector → data-cd-ref stamped in the snapshot */
  refs?: ReadonlyMap<string, string>;
  grid?: GridSettings;
  exportedAt?: string;
  /**
   * Source of the Chrome Design script, built into the file so it opens with the toolbar on.
   * Without it the file still shows the page with the feedback drawn on top (no tools).
   */
  runtime?: string;
}

export interface BuildOutput {
  html: string;
  payload: HandoffPayload;
  filename: string;
  bytes: number;
}

function withRef(anchor: ElementAnchor, refs: ReadonlyMap<string, string>): ElementAnchor {
  const ref = refs.get(anchor.selector);
  return ref ? { ...anchor, ref } : anchor;
}

/** Copy annotations, attaching snapshot refs to every anchor. */
export function linkAnnotations(
  annotations: Annotation[],
  refs: ReadonlyMap<string, string>,
): Annotation[] {
  return annotations.map((a) => {
    if (isShape(a)) {
      if (a.kind !== 'image' || !a.placement) return a;
      const { inside, covers } = a.placement;
      return {
        ...a,
        placement: {
          ...(inside ? { inside: withRef(inside, refs) } : {}),
          covers: covers.map((x) => withRef(x, refs)),
        },
      };
    }
    const t = a.target;
    if (t.type === 'shape') return a;
    if (t.type === 'region')
      return { ...a, target: { ...t, anchors: t.anchors.map((x) => withRef(x, refs)) } };
    if (t.type === 'element') return { ...a, target: { ...t, anchor: withRef(t.anchor, refs) } };
    return t.anchor ? { ...a, target: { ...t, anchor: withRef(t.anchor, refs) } } : a;
  });
}

export function summarize(annotations: Annotation[]): HandoffPayload['summary'] {
  const comments = annotations.filter(isComment);
  return {
    comments: comments.length,
    openComments: comments.filter((c) => c.status === 'open').length,
    changeRequests: comments.filter((c) => c.intent === 'change').length,
    decisions: comments.filter((c) => c.intent === 'decision').length,
    questions: comments.filter((c) => c.intent === 'question').length,
    shapes: annotations.filter(isShape).length,
    images:
      annotations.filter((a) => isShape(a) && a.kind === 'image').length +
      comments.reduce(
        (n, c) => n + c.messages.reduce((m, msg) => m + (msg.attachments?.length ?? 0), 0),
        0,
      ),
  };
}

const pad2 = (v: number) => String(v).padStart(2, '0');

function slug(name: string): string {
  const base = name.replace(/\.[a-z0-9]+$/i, '');
  return (
    base
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'image'
  );
}

const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'image/avif': 'avif',
};

function extensionOf(src: string): string {
  const mime = /^data:([^;,]+)/.exec(src)?.[1]?.toLowerCase();
  if (mime) return EXTENSIONS[mime] ?? 'img';
  const ext = /\.([a-z0-9]{2,5})(?:[?#]|$)/i.exec(src)?.[1]?.toLowerCase();
  return ext === 'jpeg' ? 'jpg' : (ext ?? 'img');
}

/** Every picture in the handoff, with the file name it gets when unpacked. */
export function imageIndex(annotations: Annotation[]): ImageIndexEntry[] {
  const entries: ImageIndexEntry[] = [];
  let placed = 0;
  for (const a of annotations) {
    if (!isShape(a) || a.kind !== 'image') continue;
    placed++;
    entries.push({
      file: `images/placed-${pad2(placed)}-${slug(a.name)}.${extensionOf(a.src)}`,
      kind: 'placed',
      name: a.name,
      annotationId: a.id,
      rect: a.rect,
      embedded: a.src.startsWith('data:'),
    });
  }
  const comments = annotations.filter(isComment).toSorted((x, y) => x.number - y.number);
  for (const c of comments) {
    let n = 0;
    for (const m of c.messages) {
      for (const att of m.attachments ?? []) {
        n++;
        entries.push({
          file: `images/comment-${pad2(c.number)}-${n}-${slug(att.name)}.${extensionOf(att.src)}`,
          kind: 'attachment',
          name: att.name,
          annotationId: c.id,
          messageId: m.id,
          attachmentId: att.id,
          comment: c.number,
          width: att.width,
          height: att.height,
          embedded: att.src.startsWith('data:'),
        });
      }
    }
  }
  return entries;
}

export function exportFilename(url: string, date: Date): string {
  let host = 'page';
  try {
    host = new URL(url).hostname.replace(/^www\./, '') || 'page';
  } catch {
    // keep default
  }
  const stamp = `${date.getFullYear()}${pad2(date.getMonth() + 1)}${pad2(date.getDate())}-${pad2(date.getHours())}${pad2(date.getMinutes())}`;
  return `chrome-design-${host.replace(/[^a-z0-9.-]+/gi, '-')}-${stamp}.html`;
}

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

const STATIC_CSS = `
:host{all:initial}
.ov{position:absolute;left:0;top:0;pointer-events:none}
.ov svg{display:block;overflow:visible}
.list{position:fixed;right:12px;bottom:12px;width:min(360px,calc(100vw - 24px));max-height:min(70vh,560px);overflow:auto;box-sizing:border-box;background:#fff;color:#1f1f1f;border:1px solid #d6d6d6;border-radius:16px;box-shadow:0 18px 40px -16px rgba(0,0,0,.35);font:13px/1.4 -apple-system,system-ui,"Segoe UI",sans-serif;pointer-events:auto}
.list summary{cursor:pointer;padding:12px 14px;font-weight:600;list-style:none}
.list summary::-webkit-details-marker{display:none}
.list ol{margin:0;padding:0 14px 12px;list-style:none;display:grid;gap:12px}
.num{display:inline-grid;place-items:center;min-width:22px;height:22px;padding:0 6px;border-radius:11px 11px 11px 3px;color:#fff;font-weight:700;font-size:11px;margin-right:6px}
.kind{color:#6b6b6b;font-size:12px}
.msg{margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.reply{margin:6px 0 0 10px;padding-left:8px;border-left:2px solid #e3e3e3}
.imgs{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}
.imgs img{display:block;max-height:140px;max-width:100%;border-radius:8px;border:1px solid #e3e3e3}
@media (prefers-color-scheme:dark){.list{background:#1c1c1c;color:#f2f2f2;border-color:#333}.kind{color:#9a9a9a}.reply{border-color:#333}}
`;

function staticThread(thread: CommentThread): string {
  const messages = thread.messages
    .map((m, i) => {
      const imgs = (m.attachments ?? [])
        .filter((a) => a.src.startsWith('data:image/'))
        .map(
          (a) =>
            `<img src="${escapeHtml(a.src)}" alt="${escapeHtml(a.name)}" width="${a.width}" height="${a.height}">`,
        )
        .join('');
      const body = m.body ? `<p class="msg">${escapeHtml(m.body)}</p>` : '';
      const inner = `${body}${imgs ? `<div class="imgs">${imgs}</div>` : ''}`;
      return i === 0 ? inner : `<div class="reply">${inner}</div>`;
    })
    .join('');
  const status = thread.status === 'resolved' ? ' · Resolved' : '';
  return `<li><span class="num" style="background:${pinColor(thread)}">${thread.number}</span><span class="kind">${INTENT_LABEL[thread.intent]}${status}</span>${messages}</li>`;
}

/**
 * What shows without JavaScript (file previews, mail apps, agents rendering the page): the
 * drawings and pins drawn over the page, and the comments in a corner list. Declarative shadow
 * DOM keeps the page's CSS away from it. The built-in toolbar replaces it when it starts.
 */
function staticLayer(annotations: Annotation[], width: number, height: number): string {
  const comments = annotations.filter(isComment).toSorted((a, b) => a.number - b.number);
  const list = comments.length
    ? `<details class="list"><summary>${comments.length} comment${comments.length === 1 ? '' : 's'}</summary><ol>${comments.map(staticThread).join('')}</ol></details>`
    : '';
  return `<chrome-design-static data-chrome-design style="display:block;position:absolute;left:0;top:0;width:0;height:0;margin:0;padding:0;border:0;z-index:2147483647"><template shadowrootmode="open"><style>${STATIC_CSS}</style><div class="ov">${renderOverlaySvg(annotations, width, height)}</div>${list}</template></chrome-design-static>`;
}

const wrap = (html: string) => `${MARKERS.begin}${html}${MARKERS.end}`;

/** Index of `needle` in `haystack` ignoring ASCII case, searching from the end. */
function lastIndexOfCi(haystack: string, needle: string): number {
  return haystack.toLowerCase().lastIndexOf(needle.toLowerCase());
}

export async function buildHandoff(input: BuildInput): Promise<BuildOutput> {
  const { capture, doc } = input;
  const meta = capture.meta;
  const refs = input.refs ?? new Map<string, string>();
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const annotations = linkAnnotations(doc.annotations, refs);
  const images = imageIndex(annotations);
  const agentPrompt = buildAgentPrompt(doc, meta, images);
  const runtime = input.runtime ? escapeInlineScript(input.runtime) : '';

  const payload: HandoffPayload = {
    $schema: SCHEMA_ID,
    schemaVersion: SCHEMA_VERSION,
    kind: PAYLOAD_KIND,
    generator: { name: APP_NAME, version: APP_VERSION },
    exportedAt,
    page: meta,
    brief: doc.brief,
    agentPrompt,
    summary: summarize(annotations),
    annotations,
    images,
    guides: doc.guides,
    sanitize: capture.sanitize,
    assets: capture.assets,
    warnings: capture.warnings,
    blocks: {
      snapshot: {
        location: 'document',
        markers: { begin: MARKERS.begin, end: MARKERS.end },
        rootAttribute: ROOT_ATTRIBUTE,
        bytes: byteLength(capture.snapshotHtml),
      },
      source: {
        elementId: BLOCK_IDS.source,
        mediaType: 'application/json',
        bytes: byteLength(capture.sourceHtml),
      },
      schema: { elementId: BLOCK_IDS.schema },
    },
  };
  if (input.grid) payload.grid = input.grid;
  if (capture.screenshot) {
    payload.blocks.screenshot = {
      elementId: BLOCK_IDS.screenshot,
      width: capture.screenshot.width,
      height: capture.screenshot.height,
    };
  }
  if (capture.fullPage) {
    const { width, height, scale } = capture.fullPage;
    payload.blocks.fullPage = { elementId: BLOCK_IDS.fullPage, width, height, scale };
  }
  if (runtime)
    payload.blocks.runtime = { elementId: BLOCK_IDS.runtime, bytes: byteLength(runtime) };

  const csp = [
    "default-src 'none'",
    'img-src data: blob:',
    'media-src data: blob:',
    'font-src data:',
    "style-src 'unsafe-inline'",
    runtime ? `script-src 'sha256-${await sha256Base64(runtime)}'` : "script-src 'none'",
    "connect-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const width = Math.max(1, meta.viewport.width);
  const height = Math.max(1, meta.document.height);

  const header = wrap(`\n<!--
${escapeHtmlComment(`CHROME DESIGN HANDOFF · schema ${SCHEMA_VERSION}

AGENT INSTRUCTIONS
${agentPrompt}

THE FEEDBACK
${describeAnnotations(annotations, images) || '(no comments or drawings; see the brief)'}`)}
-->\n`);

  // Before anything can load: the policy, a phone-friendly viewport, and the page held at the
  // width it was reviewed at (so everything drawn lines up in any window).
  const head = wrap(
    `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}" data-chrome-design><meta name="viewport" content="width=device-width, initial-scale=1" data-chrome-design><meta name="generator" content="${APP_NAME} ${APP_VERSION}" data-chrome-design><style data-chrome-design>html{width:${width}px!important;min-width:${width}px!important;max-width:none!important}</style>`,
  );

  const tail = wrap(
    [
      staticLayer(annotations, width, height),
      `<script type="application/json" id="${BLOCK_IDS.payload}" data-chrome-design>${jsonForScript(payload)}</script>`,
      `<script type="application/schema+json" id="${BLOCK_IDS.schema}" data-chrome-design>${jsonForScript(handoffSchema)}</script>`,
      `<script type="application/json" id="${BLOCK_IDS.source}" data-chrome-design>${jsonForScript(capture.sourceHtml)}</script>`,
      capture.screenshot
        ? `<script type="text/plain" id="${BLOCK_IDS.screenshot}" data-chrome-design data-width="${capture.screenshot.width}" data-height="${capture.screenshot.height}">${escapeHtml(capture.screenshot.dataUrl)}</script>`
        : '',
      capture.fullPage
        ? `<script type="text/plain" id="${BLOCK_IDS.fullPage}" data-chrome-design data-width="${capture.fullPage.width}" data-height="${capture.fullPage.height}" data-scale="${capture.fullPage.scale}">${escapeHtml(capture.fullPage.dataUrl)}</script>`
        : '',
      runtime ? `<script id="${BLOCK_IDS.runtime}" data-chrome-design>${runtime}</script>` : '',
    ].join('\n'),
  );

  const snap = capture.snapshotHtml;
  const doctype = /^\s*<!DOCTYPE[^>]*>\s*/i.exec(snap);
  let page = doctype ? snap.slice(doctype[0].length) : snap;
  page = /<html\b/i.test(page)
    ? page.replace(/<html\b/i, `<html ${ROOT_ATTRIBUTE}="${SCHEMA_VERSION}"`)
    : `<html ${ROOT_ATTRIBUTE}="${SCHEMA_VERSION}">${page}</html>`;
  const headOpen = /<head\b[^>]*>/i.exec(page);
  page = headOpen
    ? page.slice(0, headOpen.index + headOpen[0].length) +
      head +
      page.slice(headOpen.index + headOpen[0].length)
    : page.replace(/<html\b[^>]*>/i, (tag) => `${tag}<head>${head}</head>`);
  let end = lastIndexOfCi(page, '</body>');
  if (end === -1) end = lastIndexOfCi(page, '</html>');
  page = end === -1 ? page + tail : page.slice(0, end) + tail + page.slice(end);

  // Strip every marked part and the root attribute and the page is back byte for byte.
  const html = `${doctype ? doctype[0] : ''}${header}${page}`;
  return {
    html,
    payload,
    filename: exportFilename(meta.url, new Date(exportedAt)),
    bytes: byteLength(html),
  };
}
