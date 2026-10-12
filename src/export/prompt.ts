import type { AnnotationDoc, PageMeta } from '../shared/model';
import { isComment } from '../shared/model';

export const BLOCK_IDS = {
  payload: 'chrome-design-payload',
  schema: 'chrome-design-schema',
  snapshot: 'chrome-design-snapshot',
  source: 'chrome-design-source',
  screenshot: 'chrome-design-screenshot',
  prompt: 'agent-prompt',
  changes: 'requested-changes',
} as const;

/**
 * The explicit instruction block for the receiving AI agent. Plain text so it reads the same
 * in the HTML comment header, the visible prompt panel and the JSON payload.
 */
export function buildAgentPrompt(doc: AnnotationDoc, meta: PageMeta): string {
  const comments = doc.annotations.filter(isComment);
  const open = comments.filter((c) => c.status === 'open');
  const decisions = comments.filter((c) => c.intent === 'decision');
  const shapes = doc.annotations.length - comments.length;
  const lines = [
    'ROLE: You are an expert front-end engineer and product designer receiving a design-feedback handoff.',
    '',
    `This file was exported by Chrome Design from ${meta.url} ("${meta.title}") at ${meta.capturedAt}, viewport ${meta.viewport.width}×${meta.viewport.height}.`,
    `It contains ${comments.length} comment thread(s) (${open.length} open, ${decisions.length} decision(s)) and ${shapes} drawing(s).`,
    '',
    'WHAT IS IN THIS FILE',
    `- PAGE SNAPSHOT — <script type="text/html" id="${BLOCK_IDS.snapshot}">: a static, sanitized copy of the page as it was rendered. Scripts and event handlers were removed and complex interactions are intentionally flattened. This is the HTML you will revise.`,
    `- ANNOTATIONS — the numbered "Requested changes" list (#${BLOCK_IDS.changes}) and the JSON payload <script type="application/json" id="${BLOCK_IDS.payload}">. Annotations are NOT part of the page; they are the designer's feedback layered on top of it.`,
    `- ORIGINAL SOURCE — <script type="application/json" id="${BLOCK_IDS.source}">: the live rendered DOM (JSON string, unsanitized) for reference only. Never execute it.`,
    `- JSON SCHEMA — <script type="application/schema+json" id="${BLOCK_IDS.schema}"> describes the payload.`,
    '',
    'YOUR TASK',
    '1. Read EVERY comment thread and decision, in number order. Do not skip any. Each thread may contain follow-up replies; the latest reply wins when they conflict.',
    '2. Inspect the snapshot and locate what each annotation refers to: use `target.anchor.ref` (matches a `data-cd-ref` attribute in the snapshot), then `target.anchor.selector`, then the page coordinates (CSS px from the top-left of the document at the recorded viewport width).',
    '3. Treat drawings (arrows, lines, rectangles, ellipses, freehand marks, text labels) as visual pointers that clarify nearby comments. Interpret what they highlight; never reproduce them in the page.',
    '   Placed images (shape kind "image") and images attached to comment messages (`messages[].attachments`) are references from the designer — a mockup to match, an example of the look they want, or a replacement asset — shown where the designer put them. Read them alongside the nearby comments and implement what they show; never paste the reference picture itself into the page unless a comment asks for it.',
    '4. Revise the snapshot HTML/CSS to implement every OPEN "change" request. Treat every "decision" as a binding constraint that must remain true after your edits. Answer every "question" in your reply. "note" items are context. Resolved threads are history: keep them true but do not re-do them.',
    '5. Preserve everything the designer did not ask to change: content, layout, responsive behaviour, accessibility and visual style.',
    '6. Return (a) the complete revised HTML document — the page only, with no Chrome Design markup (`data-cd-*` attributes, annotation overlay or this handoff wrapper) — and (b) a checklist mapping each annotation number to what you changed, or why you could not.',
    '',
    'If you also have access to the real source code of this site, apply the equivalent changes there instead of (or in addition to) the snapshot, using the snapshot to confirm what the designer saw.',
  ];
  if (doc.brief.trim()) {
    lines.push('', 'DESIGNER BRIEF (applies to the whole page)', doc.brief.trim());
  }
  return lines.join('\n');
}
