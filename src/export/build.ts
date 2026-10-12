import {
  byteLength,
  escapeHtml,
  escapeHtmlComment,
  escapeScriptText,
  jsonForScript,
  SCRIPT_TEXT_ESCAPING,
} from '../shared/escape';
import { rectsIntersect, shapeBounds } from '../shared/geometry';
import {
  type Annotation,
  type AnnotationDoc,
  APP_NAME,
  APP_VERSION,
  type CommentMessage,
  type CommentThread,
  type ElementAnchor,
  type GridSettings,
  type HandoffPayload,
  INTENT_LABEL,
  isComment,
  isShape,
  PAYLOAD_KIND,
  type PageCapture,
  SCHEMA_ID,
  SCHEMA_VERSION,
  type Shape,
} from '../shared/model';
import { handoffSchema } from '../shared/schema';
import { renderOverlaySvg, threadPoint } from './overlay';
import { BLOCK_IDS, buildAgentPrompt } from './prompt';
import { VIEWER_CSS } from './viewer-css';
import { viewerRuntime } from './viewer-runtime';

export interface BuildInput {
  capture: PageCapture;
  doc: AnnotationDoc;
  /** anchor selector → data-cd-ref stamped in the snapshot */
  refs?: ReadonlyMap<string, string>;
  grid?: GridSettings;
  exportedAt?: string;
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
    if (!isComment(a)) return a;
    const t = a.target;
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
const at = (x: number, y: number) => `at (${Math.round(x)}, ${Math.round(y)})`;

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

function targetDescription(thread: CommentThread): string {
  const t = thread.target;
  if (t.type === 'region') {
    const r = t.rect;
    const inside = t.anchors.length
      ? ` containing ${t.anchors.map((a) => `<code>${escapeHtml(a.selector)}</code>`).join(', ')}`
      : '';
    return `Region ${Math.round(r.width)}×${Math.round(r.height)} ${at(r.x, r.y)}${inside}`;
  }
  const anchor = t.type === 'element' ? t.anchor : t.anchor;
  const where = at(t.point.x, t.point.y);
  if (!anchor) return `Point ${where}`;
  const ref = anchor.ref ? ` · <code>[data-cd-ref="${escapeHtml(anchor.ref)}"]</code>` : '';
  const text = anchor.text ? ` — “${escapeHtml(anchor.text)}”` : '';
  return `${t.type === 'element' ? 'Element' : 'Point on'} <code>${escapeHtml(anchor.selector)}</code>${ref}${text} ${where}`;
}

function anchorDetails(thread: CommentThread): string {
  const t = thread.target;
  const anchor = t.type === 'region' ? t.anchors[0] : t.anchor;
  if (!anchor) return '';
  const rows = [
    ['path', anchor.path],
    [
      'box',
      `${Math.round(anchor.rect.width)}×${Math.round(anchor.rect.height)} at (${Math.round(anchor.rect.x)}, ${Math.round(anchor.rect.y)})`,
    ],
    ...Object.entries(anchor.styles),
  ]
    .map(([k, v]) => `<dt>${escapeHtml(k ?? '')}</dt><dd>${escapeHtml(v ?? '')}</dd>`)
    .join('');
  return `<details><summary>Element details</summary><dl class="kv">${rows}</dl></details>`;
}

/** Pictures attached to a message. (No links: browsers won't open data: URLs in a tab.) */
function attachmentsMarkup(message: CommentMessage): string {
  const images = message.attachments ?? [];
  if (images.length === 0) return '';
  return `<div class="msg-images">${images
    .map(
      (img) =>
        `<img src="${escapeHtml(img.src)}" alt="${escapeHtml(img.name)}" title="${escapeHtml(img.name)}" width="${img.width}" height="${img.height}" loading="lazy">`,
    )
    .join('')}</div>`;
}

function changeItem(thread: CommentThread): string {
  const messages = thread.messages
    .map(
      (m, i) =>
        `<div class="msg"><time datetime="${escapeHtml(m.createdAt)}">${i === 0 ? 'Designer' : 'Reply'} · ${escapeHtml(m.createdAt.replace('T', ' ').slice(0, 16))}</time>${m.body ? `<p>${escapeHtml(m.body)}</p>` : ''}${attachmentsMarkup(m)}</div>`,
    )
    .join('');
  const status =
    thread.status === 'resolved'
      ? '<span class="chip status-chip-resolved">Resolved</span>'
      : '<span class="chip">Open</span>';
  return `<li class="change intent-${thread.intent} status-${thread.status}" id="change-${thread.number}" data-cd-change data-annotation-id="${escapeHtml(thread.id)}" tabindex="0">
<div class="change-head"><span class="num">${thread.number}</span><span class="chip intent-chip-${thread.intent}">${INTENT_LABEL[thread.intent]}</span>${status}</div>
<p class="target">${targetDescription(thread)}</p>
${messages}
${anchorDetails(thread)}
</li>`;
}

function describeShape(shape: Shape, comments: CommentThread[]): string {
  const b = shapeBounds(shape);
  const pad = 80;
  const near = comments
    .filter((c) => {
      const p = threadPoint(c);
      return rectsIntersect(
        { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 },
        { x: p.x, y: p.y, width: 1, height: 1 },
      );
    })
    .map((c) => `#${c.number}`);
  const label =
    shape.kind === 'text'
      ? `text “${escapeHtml(shape.text)}”`
      : shape.kind === 'pen'
        ? 'freehand mark'
        : shape.kind === 'image'
          ? `placed image “${escapeHtml(shape.name)}”`
          : shape.kind;
  const colour = shape.kind === 'image' ? '' : ` (${escapeHtml(shape.style.color)})`;
  return `<li>${label}${colour} around ${Math.round(b.width)}×${Math.round(b.height)} at (${Math.round(b.x)}, ${Math.round(b.y)})${near.length ? ` — near comment ${near.join(', ')}` : ''}</li>`;
}

export async function buildHandoff(input: BuildInput): Promise<BuildOutput> {
  const { capture, doc } = input;
  const meta = capture.meta;
  const refs = input.refs ?? new Map<string, string>();
  const exportedAt = input.exportedAt ?? new Date().toISOString();
  const annotations = linkAnnotations(doc.annotations, refs);
  const comments = annotations.filter(isComment).toSorted((a, b) => a.number - b.number);
  const shapes = annotations.filter(isShape);
  const agentPrompt = buildAgentPrompt(doc, meta);

  const snapshotText = escapeScriptText(capture.snapshotHtml);
  const sourceJson = jsonForScript(capture.sourceHtml);

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
    guides: doc.guides,
    sanitize: capture.sanitize,
    assets: capture.assets,
    warnings: capture.warnings,
    blocks: {
      snapshot: {
        elementId: BLOCK_IDS.snapshot,
        mediaType: 'text/html',
        escaping: SCRIPT_TEXT_ESCAPING,
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

  const viewerScript = `(${viewerRuntime.toString()})();`;
  const scriptHash = await sha256Base64(viewerScript);
  const csp = [
    "default-src 'none'",
    'img-src data: blob:',
    'media-src data:',
    'font-src data:',
    "style-src 'unsafe-inline'",
    `script-src 'sha256-${scriptHash}'`,
    "frame-src 'self' about:",
    "connect-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');

  const s = payload.summary;
  const pageW = meta.viewport.width;
  const pageH = meta.document.height;
  const warnings = capture.warnings;
  const assetWarnings = warnings.filter(
    (w) => w.code === 'asset-not-embedded' || w.code === 'asset-too-large',
  );

  const warningsSection = warnings.length
    ? `<section class="card warnings" id="capture-warnings" aria-labelledby="warnings-title">
<h2 id="warnings-title">⚠ ${warnings.length} capture warning${warnings.length === 1 ? '' : 's'}${assetWarnings.length ? ` — ${assetWarnings.length} asset${assetWarnings.length === 1 ? '' : 's'} could not be embedded` : ''}</h2>
<p>The snapshot is still usable, but these parts of the page may be missing or unstyled offline. Use the viewport screenshot to see how they looked.</p>
<ul>${warnings.map((w) => `<li><b>${escapeHtml(w.code)}</b>: ${escapeHtml(w.message)}${w.url ? ` <code>${escapeHtml(w.url)}</code>` : ''}</li>`).join('')}</ul>
</section>`
    : '';

  const changes = comments.length
    ? `<ol>${comments.map(changeItem).join('\n')}</ol>`
    : '<p class="empty">No comments were added. Use the drawings and the brief.</p>';
  const drawings = shapes.length
    ? `<h2 style="margin-top:18px">Drawings (${shapes.length})</h2><ul class="drawings">${shapes.map((sh) => describeShape(sh, comments)).join('')}</ul>`
    : '';

  const metaRows: [string, string][] = [
    ['URL', meta.url],
    ['Title', meta.title],
    ['Captured', meta.capturedAt],
    ['Exported', exportedAt],
    ['Time zone', meta.timeZone],
    [
      'Viewport',
      `${meta.viewport.width}×${meta.viewport.height} @${meta.viewport.devicePixelRatio}x`,
    ],
    ['Document', `${meta.document.width}×${meta.document.height}`],
    ['Scroll position', `${meta.scroll.x}, ${meta.scroll.y}`],
    ['Color scheme', meta.colorScheme],
    ['Language', meta.lang || '—'],
    ['User agent', meta.userAgent],
    [
      'Embedded assets',
      `${capture.assets.embedded} (${(capture.assets.embeddedBytes / 1024).toFixed(0)} KB), ${capture.assets.failed} failed`,
    ],
    [
      'Removed for safety',
      `${capture.sanitize.scripts} scripts, ${capture.sanitize.eventHandlers} event handlers, ${capture.sanitize.javascriptUrls} javascript: URLs, ${capture.sanitize.frames} frames, ${capture.sanitize.embeds} embeds, ${capture.sanitize.other} other`,
    ],
    ['Schema', `${SCHEMA_ID}`],
    ['Generator', `${APP_NAME} ${APP_VERSION}`],
  ];

  const html = `<!DOCTYPE html>
<!--
${escapeHtmlComment(`CHROME DESIGN HANDOFF · schema ${SCHEMA_VERSION}

AGENT INSTRUCTIONS
${agentPrompt}

FILE MAP
- #${BLOCK_IDS.prompt}: this prompt (visible)
- #${BLOCK_IDS.changes}: numbered requested changes, comments and decisions (visible)
- #${BLOCK_IDS.payload}: machine-readable annotations + metadata (application/json)
- #${BLOCK_IDS.schema}: JSON Schema for the payload
- #${BLOCK_IDS.snapshot}: sanitized page snapshot, raw HTML (escaping: ${SCRIPT_TEXT_ESCAPING})
- #${BLOCK_IDS.source}: original rendered DOM as a JSON string (reference only)
- #${BLOCK_IDS.screenshot}: viewport screenshot (if captured)`)}
-->
<html lang="en" data-chrome-design-schema="${SCHEMA_VERSION}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">
<meta name="generator" content="${APP_NAME} ${APP_VERSION}">
<meta name="robots" content="noindex">
<title>Design feedback — ${escapeHtml(meta.title || meta.url)}</title>
<style>${VIEWER_CSS}</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <div>
    <div class="eyebrow">Design feedback handoff · ${APP_NAME}</div>
    <h1>${escapeHtml(meta.title || 'Untitled page')}</h1>
    <div class="page-url">${escapeHtml(meta.url)}</div>
  </div>
  <div class="stats" aria-label="Summary">
    <span class="stat"><b>${s.comments}</b> comment${s.comments === 1 ? '' : 's'}</span>
    <span class="stat"><b>${s.openComments}</b> open</span>
    <span class="stat"><b>${s.decisions}</b> decision${s.decisions === 1 ? '' : 's'}</span>
    <span class="stat"><b>${s.shapes}</b> drawing${s.shapes === 1 ? '' : 's'}</span>
    <span class="stat">${meta.viewport.width}×${meta.viewport.height}</span>
  </div>
</header>

<section class="card prompt" id="${BLOCK_IDS.prompt}" aria-labelledby="prompt-title" data-cd-section="agent-prompt">
  <h2 id="prompt-title">Instructions for the AI agent</h2>
  <div class="actions"><button class="btn" type="button" data-cd-copy-prompt>Copy prompt</button></div>
  <pre id="agent-prompt-text">${escapeHtml(agentPrompt)}</pre>
</section>

${warningsSection}

<div class="layout">
  <section class="card changes" id="${BLOCK_IDS.changes}" aria-labelledby="changes-title" data-cd-section="annotations">
    <h2 id="changes-title">Requested changes (${comments.length})</h2>
    ${changes}
    ${drawings}
  </section>

  <section class="card viewer" aria-labelledby="viewer-title" data-cd-section="snapshot">
    <div class="viewer-bar">
      <h2 id="viewer-title">Page snapshot + annotations</h2>
      <label><input type="checkbox" data-cd-toggle="annotations" checked> Annotations</label>
      <label><input type="checkbox" data-cd-toggle="drawings" checked> Drawings</label>
      <span class="zoom">
        <button class="btn" type="button" data-cd-action="zoom-out" aria-label="Zoom out">−</button>
        <output data-cd-zoom-label>100%</output>
        <button class="btn" type="button" data-cd-action="zoom-in" aria-label="Zoom in">+</button>
        <button class="btn" type="button" data-cd-action="fit">Fit</button>
        <button class="btn" type="button" data-cd-action="actual">1:1</button>
      </span>
    </div>
    <div class="stage" data-cd-stage tabindex="0" aria-label="Snapshot canvas. Drag or scroll to pan, Ctrl/⌘ + scroll or pinch to zoom, + and − keys to zoom, 0 to fit.">
      <div class="canvas" data-cd-canvas style="width:${pageW}px;height:${pageH}px">
        <iframe data-cd-frame title="Static snapshot of ${escapeHtml(meta.title || meta.url)}" sandbox="allow-same-origin" referrerpolicy="no-referrer" loading="eager" style="width:${pageW}px;height:${pageH}px"></iframe>
        ${renderOverlaySvg(annotations, pageW, pageH)}
      </div>
    </div>
    <noscript><p class="noscript-note">The interactive snapshot needs JavaScript. The snapshot HTML is stored in <code>#${BLOCK_IDS.snapshot}</code>; the screenshot below shows the captured viewport.</p></noscript>
  </section>
</div>

${
  capture.screenshot
    ? `<section class="card screenshot" aria-labelledby="shot-title">
  <h2 id="shot-title">Viewport screenshot (as the designer saw it, annotations visible)</h2>
  <img id="${BLOCK_IDS.screenshot}" alt="Screenshot of the annotated viewport" width="${capture.screenshot.width}" height="${capture.screenshot.height}" src="${escapeHtml(capture.screenshot.dataUrl)}">
</section>`
    : ''
}

<section class="card meta" aria-labelledby="meta-title" data-cd-section="metadata">
  <h2 id="meta-title">Capture metadata</h2>
  <dl>${metaRows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join('')}</dl>
</section>

<section class="card blocks" aria-labelledby="blocks-title">
  <h2 id="blocks-title">Embedded data</h2>
  <ul>
    <li><code>#${BLOCK_IDS.payload}</code> — annotations, decisions and metadata as JSON (schema <code>${SCHEMA_ID}</code>). <button class="btn" type="button" data-cd-download="payload">Save JSON</button></li>
    <li><code>#${BLOCK_IDS.snapshot}</code> — sanitized snapshot HTML (${(payload.blocks.snapshot.bytes / 1024).toFixed(0)} KB). <button class="btn" type="button" data-cd-download="snapshot">Save snapshot.html</button></li>
    <li><code>#${BLOCK_IDS.source}</code> — original rendered DOM, JSON string (${(payload.blocks.source.bytes / 1024).toFixed(0)} KB). Reference only; never execute.</li>
    <li><code>#${BLOCK_IDS.schema}</code> — JSON Schema (draft 2020-12).</li>
  </ul>
</section>
<footer>Generated by ${APP_NAME} ${APP_VERSION}. Everything in this file stays local; it makes no network requests.</footer>
</div>

<script type="application/json" id="${BLOCK_IDS.payload}">
${jsonForScript(payload, 2)}
</script>
<script type="application/schema+json" id="${BLOCK_IDS.schema}">
${jsonForScript(handoffSchema, 2)}
</script>
<script type="text/html" id="${BLOCK_IDS.snapshot}" data-escaping="chrome-design/script-text-v1">${snapshotText}</script>
<script type="application/json" id="${BLOCK_IDS.source}">${sourceJson}</script>
<script>${viewerScript}</script>
</body>
</html>
`;

  return {
    html,
    payload,
    filename: exportFilename(meta.url, new Date(exportedAt)),
    bytes: byteLength(html),
  };
}
