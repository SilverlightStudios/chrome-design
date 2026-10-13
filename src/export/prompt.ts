import { shapeBounds } from '../shared/geometry';
import type {
  Annotation,
  AnnotationDoc,
  CommentThread,
  ElementAnchor,
  ImageIndexEntry,
  PageMeta,
  Shape,
} from '../shared/model';
import { BREAKPOINTS, INTENT_LABEL, isComment, isShape } from '../shared/model';
import { findShape, shapeLabel, storedTargetPoint } from '../shared/targets';

export const BLOCK_IDS = {
  payload: 'chrome-design-payload',
  schema: 'chrome-design-schema',
  source: 'chrome-design-source',
  screenshot: 'chrome-design-screenshot',
  fullPage: 'chrome-design-fullpage',
  runtime: 'chrome-design-runtime',
} as const;

/** Comment markers around every part of the file that is the handoff, not the page. */
export const MARKERS = {
  begin: '<!--chrome-design:begin-->',
  end: '<!--chrome-design:end-->',
} as const;
export const ROOT_ATTRIBUTE = 'data-chrome-design-handoff';

const round = (n: number) => Math.round(n);

function where(anchor: ElementAnchor | undefined): string {
  if (!anchor) return '';
  const ref = anchor.ref ? ` [data-cd-ref="${anchor.ref}"]` : '';
  const text = anchor.text ? ` "${anchor.text.slice(0, 60)}"` : '';
  return `\`${anchor.selector}\`${ref}${text}`;
}

function threadPointOf(
  thread: CommentThread,
  annotations: readonly Annotation[],
): { x: number; y: number } {
  return storedTargetPoint(thread.target, annotations);
}

/** Comments within ~120px of a box: what a drawing or image most likely belongs to. */
function nearbyComments(
  box: { x: number; y: number; width: number; height: number },
  comments: CommentThread[],
  annotations: readonly Annotation[],
): string[] {
  const pad = 120;
  return comments
    .filter((c) => {
      if (c.target.type === 'shape') return false;
      const p = threadPointOf(c, annotations);
      return (
        p.x >= box.x - pad &&
        p.x <= box.x + box.width + pad &&
        p.y >= box.y - pad &&
        p.y <= box.y + box.height + pad
      );
    })
    .map((c) => `#${c.number}`);
}

function describeTarget(
  thread: CommentThread,
  annotations: readonly Annotation[],
  images: ImageIndexEntry[],
): string {
  const t = thread.target;
  if (t.type === 'shape') {
    const shape = findShape(annotations, t.shapeId);
    if (shape?.kind === 'image') {
      const file = imageFileFor(images, (e) => e.annotationId === shape.id);
      return `placed image ${file || shape.name} ("${shape.name}")`;
    }
    const b = shape ? shapeBounds(shape) : null;
    return shape && b
      ? `the ${shapeLabel(shape).toLowerCase()} drawn at (${round(b.x)}, ${round(b.y)})`
      : `a spot at (${round(t.point.x)}, ${round(t.point.y)})`;
  }
  if (t.type === 'region') {
    const inside = t.anchors.length ? `, containing ${t.anchors.map(where).join(', ')}` : '';
    return `area ${round(t.rect.width)}×${round(t.rect.height)} at (${round(t.rect.x)}, ${round(t.rect.y)})${inside}`;
  }
  const anchor = t.type === 'element' ? t.anchor : t.anchor;
  return `${anchor ? where(anchor) : 'a spot'} at (${round(t.point.x)}, ${round(t.point.y)})`;
}

/** "; only on phone widths (< 640px); written at 1280px wide". */
function sizeNote(c: CommentThread): string {
  const parts: string[] = [];
  if (c.scope) {
    const b = BREAKPOINTS[c.scope];
    parts.push(
      `only at ${b.label.toLowerCase()} widths (${b.max === null ? `≥ ${b.min}px` : b.min === 0 ? `< ${b.max + 1}px` : `${b.min}–${b.max}px`})`,
    );
  }
  if (c.viewport) parts.push(`written at ${c.viewport.width}px wide`);
  return parts.length ? `; ${parts.join('; ')}` : '';
}

function imageFileFor(images: ImageIndexEntry[], test: (e: ImageIndexEntry) => boolean): string {
  const entry = images.find(test);
  return entry ? entry.file : '';
}

function describeShape(
  shape: Shape,
  comments: CommentThread[],
  annotations: readonly Annotation[],
  images: ImageIndexEntry[],
): string {
  const b = shapeBounds(shape);
  const box = `${round(b.width)}×${round(b.height)} at (${round(b.x)}, ${round(b.y)})`;
  const own = comments
    .filter((c) => c.target.type === 'shape' && c.target.shapeId === shape.id)
    .map((c) => `#${c.number}`);
  const near = nearbyComments(b, comments, annotations);
  const nearText = `${own.length ? `; comment ${own.join(', ')} ${own.length === 1 ? 'is' : 'are'} on it` : ''}${near.length ? `; near comment ${near.join(', ')}` : ''}`;
  if (shape.kind === 'redact') {
    return `- HIDDEN AREA ${box}: the designer hid this for privacy (text under it is replaced with •, pictures with grey boxes). Not a design change; leave that content as it is.`;
  }
  if (shape.kind === 'image') {
    const file = imageFileFor(images, (e) => e.annotationId === shape.id);
    const lines = [`- PLACED IMAGE ${file || shape.name} ("${shape.name}"), ${box}${nearText}`];
    const p = shape.placement;
    if (p?.inside) lines.push(`    sits inside ${where(p.inside)}`);
    if (p?.covers.length) lines.push(`    covers ${p.covers.map(where).join(', ')}`);
    return lines.join('\n');
  }
  const label =
    shape.kind === 'text'
      ? `text label "${shape.text}"`
      : shape.kind === 'pen'
        ? 'freehand mark'
        : shape.kind;
  return `- ${label} (${shape.style.color}), ${box}${nearText}`;
}

/** Plain-text list of everything the designer left, for the top of the file and AGENTS.md. */
export function describeAnnotations(annotations: Annotation[], images: ImageIndexEntry[]): string {
  const comments = annotations.filter(isComment).toSorted((a, b) => a.number - b.number);
  const shapes = annotations.filter(isShape);
  const lines: string[] = [];
  if (comments.length) {
    lines.push('COMMENTS');
    for (const c of comments) {
      lines.push(
        `#${c.number} ${INTENT_LABEL[c.intent]} (${c.status}) on ${describeTarget(c, annotations, images)}${sizeNote(c)}`,
      );
      for (const [i, m] of c.messages.entries()) {
        const who = i === 0 ? '' : 'reply: ';
        if (m.body) lines.push(`    ${who}${m.body.replace(/\n/g, '\n    ')}`);
        for (const att of m.attachments ?? []) {
          const file = imageFileFor(images, (e) => e.attachmentId === att.id);
          lines.push(`    ${who}[attached image ${file || att.name} ("${att.name}")]`);
        }
      }
    }
  }
  if (shapes.length) {
    if (lines.length) lines.push('');
    lines.push('DRAWINGS AND PLACED IMAGES');
    for (const s of shapes) lines.push(describeShape(s, comments, annotations, images));
  }
  return lines.join('\n');
}

/**
 * A self-contained script that unpacks this file: images/ (every picture as a real image file),
 * page.html (the clean page) and handoff.json. Coding agents can then look at the pictures.
 * Written without double hyphens so it survives inside an HTML comment.
 */
export function extractScript(): string {
  return [
    `python3 - "FILE.html" <<'PY'`,
    'import base64, json, os, re, sys',
    'path = sys.argv[1]',
    "src = open(path, encoding='utf-8').read()",
    `data = json.loads(re.findall(r'<script[^>]*id="${BLOCK_IDS.payload}" data-chrome-design>(.*?)</script>', src, re.S)[-1])`,
    "out = os.path.splitext(path)[0] + '_handoff'",
    "os.makedirs(os.path.join(out, 'images'), exist_ok=True)",
    'srcs = {}',
    "for a in data['annotations']:",
    "    if a.get('kind') == 'image': srcs[a['id']] = a['src']",
    "    for m in a.get('messages', []):",
    "        for f in m.get('attachments', []): srcs[f['id']] = f['src']",
    "for img in data['images']:",
    "    s = srcs.get(img.get('attachmentId') or img['annotationId'], '')",
    "    if s.startswith('data:'):",
    "        head, body = s.split(',', 1)",
    "        raw = base64.b64decode(body) if head.endswith(';base64') else body.encode()",
    "        open(os.path.join(out, img['file']), 'wb').write(raw)",
    // The markers are spelled out piecewise: "<!" and double hyphens can't appear in a comment.
    "dash = '-' * 2",
    "begin, end = '<' + '!' + dash + 'chrome-design:begin' + dash + '>', '<' + '!' + dash + 'chrome-design:end' + dash + '>'",
    "page = re.sub(re.escape(begin) + '.*?' + re.escape(end), '', src, flags=re.S)",
    `page = re.sub(r' ${ROOT_ATTRIBUTE}="[^"]*"', '', page)`,
    "open(os.path.join(out, 'page.html'), 'w', encoding='utf-8').write(page)",
    `full = re.findall(r'<script[^>]*id="${BLOCK_IDS.fullPage}"[^>]*>data:image/[a-z]+;base64,([^<]+)</script>', src)`,
    "if full: open(os.path.join(out, 'page-annotated.jpg'), 'wb').write(base64.b64decode(full[-1]))",
    "json.dump(data, open(os.path.join(out, 'handoff.json'), 'w'), indent=2)",
    'print(out)',
    'PY',
  ].join('\n');
}

/**
 * The instruction block for the receiving AI agent. Plain text so it reads the same in the
 * HTML comment at the top of the file, the JSON payload and the .zip's AGENTS.md.
 */
export function buildAgentPrompt(
  doc: AnnotationDoc,
  meta: PageMeta,
  images: ImageIndexEntry[] = [],
): string {
  const comments = doc.annotations.filter(isComment);
  const open = comments.filter((c) => c.status === 'open');
  const decisions = comments.filter((c) => c.intent === 'decision');
  const shapes = doc.annotations.length - comments.length;
  const placed = images.filter((i) => i.kind === 'placed').length;
  const attached = images.length - placed;
  const lines = [
    'ROLE: You are an expert front-end engineer and product designer receiving a design-feedback handoff.',
    '',
    `Exported by Chrome Design from ${meta.url} ("${meta.title}") at ${meta.capturedAt}, viewport ${meta.viewport.width}×${meta.viewport.height}.`,
    `It holds ${comments.length} comment thread(s) (${open.length} open, ${decisions.length} decision(s)), ${shapes} drawing(s) and image(s) on the page, and ${images.length} image(s) in all (${placed} placed on the page, ${attached} attached to comments).`,
    '',
    'WHAT THIS FILE IS',
    '- This HTML file IS a static copy of the page (scripts removed, assets embedded), with the designer’s feedback layered on top. Opened in a browser it shows the page at the reviewed width with the Chrome Design toolbar built in, so a person can read, reply and draw.',
    `- The handoff wrapper is every part between the "chrome-design:begin" and "chrome-design:end" HTML comments, plus the ${ROOT_ATTRIBUTE} attribute on <html>. Remove those and you have the page you will revise. \`data-cd-ref\` attributes mark the elements comments point at.`,
    `- ANNOTATIONS: <script type="application/json" id="${BLOCK_IDS.payload}"> (schema in #${BLOCK_IDS.schema}). Coordinates are CSS px from the top-left of the document at the recorded viewport width. \`images\` lists every picture with a file name.`,
    `- ORIGINAL SOURCE: #${BLOCK_IDS.source} holds the live DOM as a JSON string, for reference only. Never execute it.`,
    `- PICTURE OF THE PAGE: when present, #${BLOCK_IDS.fullPage} is the whole page top to bottom with every drawing, placed image and comment pin drawn on (payload \`blocks.fullPage.scale\` = image px per CSS px). Look at it to see where things go.`,
    '- To get the pictures as real image files (plus page-annotated.jpg, page.html and handoff.json), run this with FILE.html replaced by this file’s path:',
    extractScript(),
    '',
    'HOW TO READ THE FEEDBACK',
    '1. Read EVERY comment thread and decision, in number order. The latest reply wins when replies conflict.',
    '2. Find what each comment points at: `target.anchor.ref` (a `data-cd-ref` attribute in the page), then `target.anchor.selector`, then the coordinates.',
    '3. The canvas is a scratch board. Drawings (arrows, boxes, circles, freehand marks, text labels) point at things and clarify nearby comments; never reproduce them. Nothing placed on the board is pixel-perfect: positions, sizes and spacing of drawings and images are approximate unless a comment asks for exact values.',
    '4. PLACED IMAGES (shape kind "image") are usually a screenshot of the intended design — often a component copied from Figma — or a reference to match. Treat each one as a brief:',
    '   - WHAT to build: the component or change the picture shows (read it with the comments near it; `placement` and the list below give those).',
    '   - HOW it should look: layout, content, hierarchy, colours, type and states visible in the picture. Match the page’s existing design system (fonts, colours, spacing, components) rather than copying the screenshot’s pixels, unless told to.',
    '   - WHERE it goes: where it was dropped. `placement.inside` is the page element that contains it (the section or container it belongs in) and `placement.covers` are the elements under it, most covered first (what it may replace or sit next to). Use those, the coordinates and nearby comments to decide whether it replaces, goes next to, or is inserted between existing content.',
    '   - Never paste the screenshot itself into the page as an <img> unless a comment asks for that; build it in HTML/CSS.',
    '   Grey HIDDEN AREAS (shape kind "redact") are privacy blurs, not design feedback: the content under them is masked in this copy; keep the real content as it is.',
    '5. IMAGES ATTACHED TO COMMENTS (`messages[].attachments`) illustrate that comment: an example, a mockup or the asset to use. A comment can also be ON a placed image or drawing (`target.type: "shape"`, `target.shapeId`): it is about that picture or mark specifically.',
    '   A comment may be limited to a screen size (`scope`: phone < 640px, tablet 640–1023px, desktop ≥ 1024px); implement it with media queries for that range only. `viewport` is the window size it was written at.',
    '6. Revise the page to implement every OPEN "change" request. Every "decision" is a binding constraint that must stay true. Answer every "question" in your reply. "note" items are context. Resolved threads are history: keep them true but do not redo them.',
    '7. Preserve everything the designer did not ask to change: content, layout, responsive behaviour, accessibility and visual style.',
    '8. Return (a) the revised page (without the handoff wrapper) and (b) a checklist mapping each comment number and each placed image to what you changed, or why you could not.',
    '',
    'If you have the real source code of this site, apply the equivalent changes there instead (or as well), using this page to confirm what the designer saw.',
  ];
  if (doc.brief.trim())
    lines.push('', 'DESIGNER BRIEF (applies to the whole page)', doc.brief.trim());
  return lines.join('\n');
}

/**
 * The feedback as one message for an AI chat (pasted, not a file): what the page is, how to
 * read a scratch board, then every comment, drawing and picture with where it is.
 */
export function buildChatPrompt(
  doc: AnnotationDoc,
  meta: Pick<PageMeta, 'url' | 'title' | 'viewport'>,
  images: ImageIndexEntry[] = [],
): string {
  const feedback = describeAnnotations(doc.annotations, images);
  const lines = [
    `Design feedback on ${meta.url}${meta.title ? ` ("${meta.title}")` : ''}, reviewed at ${meta.viewport.width}×${meta.viewport.height}.`,
    '',
    'How to read it:',
    '- Comments are numbered; read them all in order. "Change" = do it, "Decision" = must stay true, "Question" = answer it, "Note" = context. The latest reply wins.',
    '- Elements are given as CSS selectors with their text, and positions as CSS px from the top-left of the page at the width above.',
    '- It\u2019s a scratch board: drawings point at things and positions/sizes are approximate, unless a comment asks for exact values.',
    '- A placed image is usually a screenshot of the intended design (often a component from Figma): build what it shows, in the site\u2019s own styles, roughly where it was placed ("sits inside" = the section it belongs in, "covers" = what it sits on).',
    '- "only at phone/tablet/desktop widths" means just that screen range; grey hidden areas are privacy blurs, not changes.',
  ];
  if (images.length)
    lines.push(
      `- The pictures (${images.map((i) => i.file.replace(/^images\//, '')).join(', ')}) aren\u2019t in this message; ask for them if you need to see them.`,
    );
  if (doc.brief.trim()) lines.push('', 'Brief:', doc.brief.trim());
  lines.push(
    '',
    feedback || '(no comments or drawings yet)',
    '',
    'Please reply with the changes, then a checklist of every comment number and placed image: done, or why not.',
  );
  return lines.join('\n');
}
