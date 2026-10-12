import { escapeHtml } from '../shared/escape';
import { arrowHead, pointsToPath } from '../shared/geometry';
import type { Annotation, CommentThread, Point, Shape } from '../shared/model';
import { isComment, isShape } from '../shared/model';

const PIN_COLORS: Record<CommentThread['intent'], string> = {
  change: '#2563EB',
  decision: '#7C3AED',
  question: '#D97706',
  note: '#475569',
};

export function pinColor(thread: CommentThread): string {
  return thread.status === 'resolved' ? '#16A34A' : PIN_COLORS[thread.intent];
}

/** Where a thread's pin sits in page space. */
export function threadPoint(thread: CommentThread): Point {
  const t = thread.target;
  return t.type === 'region' ? { x: t.rect.x, y: t.rect.y } : t.point;
}

const n = (v: number) => Math.round(v * 10) / 10;

export function shapeToSvg(shape: Shape): string {
  const { color, width, dashed } = shape.style;
  const stroke = `stroke="${escapeHtml(color)}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" fill="none"${dashed ? ` stroke-dasharray="${width * 3} ${width * 2}"` : ''}`;
  const id = `data-annotation-id="${escapeHtml(shape.id)}"`;
  switch (shape.kind) {
    case 'pen':
      return `<path class="cd-shape" ${id} d="${pointsToPath(shape.points)}" ${stroke}/>`;
    case 'line':
      return `<line class="cd-shape" ${id} x1="${n(shape.from.x)}" y1="${n(shape.from.y)}" x2="${n(shape.to.x)}" y2="${n(shape.to.y)}" ${stroke}/>`;
    case 'arrow': {
      const [a, b] = arrowHead(shape.from, shape.to, Math.max(10, width * 4));
      return `<g class="cd-shape" ${id}><line x1="${n(shape.from.x)}" y1="${n(shape.from.y)}" x2="${n(shape.to.x)}" y2="${n(shape.to.y)}" ${stroke}/><polyline points="${n(a.x)},${n(a.y)} ${n(shape.to.x)},${n(shape.to.y)} ${n(b.x)},${n(b.y)}" ${stroke.replace(/ stroke-dasharray="[^"]*"/, '')}/></g>`;
    }
    case 'rect':
      return `<rect class="cd-shape" ${id} x="${n(shape.rect.x)}" y="${n(shape.rect.y)}" width="${n(shape.rect.width)}" height="${n(shape.rect.height)}" rx="2" ${stroke}/>`;
    case 'ellipse': {
      const { x, y, width: w, height: h } = shape.rect;
      return `<ellipse class="cd-shape" ${id} cx="${n(x + w / 2)}" cy="${n(y + h / 2)}" rx="${n(w / 2)}" ry="${n(h / 2)}" ${stroke}/>`;
    }
    case 'text': {
      const lines = shape.text.split('\n');
      const tspans = lines
        .map(
          (line, i) =>
            `<tspan x="${n(shape.point.x)}" dy="${i === 0 ? 0 : n(shape.fontSize * 1.25)}">${escapeHtml(line) || ' '}</tspan>`,
        )
        .join('');
      return `<text class="cd-shape" ${id} x="${n(shape.point.x)}" y="${n(shape.point.y + shape.fontSize)}" fill="${escapeHtml(color)}" font-size="${shape.fontSize}" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-weight="600" paint-order="stroke" stroke="#ffffff" stroke-width="3" stroke-linejoin="round">${tspans}</text>`;
    }
  }
}

function targetMarkup(thread: CommentThread): string {
  const color = pinColor(thread);
  const t = thread.target;
  if (t.type === 'region') {
    const r = t.rect;
    return `<rect class="cd-target" data-annotation-id="${escapeHtml(thread.id)}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" fill="${color}" fill-opacity="0.08" stroke="${color}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  }
  if (t.type === 'element' || t.anchor) {
    const r = (t.type === 'element' ? t.anchor : t.anchor)!.rect;
    return `<rect class="cd-target" data-annotation-id="${escapeHtml(thread.id)}" x="${n(r.x)}" y="${n(r.y)}" width="${n(r.width)}" height="${n(r.height)}" fill="none" stroke="${color}" stroke-width="1.5" stroke-dasharray="4 3" opacity="0.8"/>`;
  }
  return '';
}

function pinMarkup(thread: CommentThread): string {
  const p = threadPoint(thread);
  const color = pinColor(thread);
  const label = String(thread.number);
  return `<g class="cd-pin" data-annotation-id="${escapeHtml(thread.id)}" data-number="${thread.number}" transform="translate(${n(p.x)} ${n(p.y)})" tabindex="0" role="button" aria-label="Comment ${thread.number}"><path d="M0 0 L0 -18 A12 12 0 1 1 12 -6 Z" transform="translate(0 0)" fill="${color}" stroke="#fff" stroke-width="2"/><text x="12" y="-17.5" text-anchor="middle" dominant-baseline="middle" fill="#fff" font-size="${label.length > 2 ? 9 : 11}" font-weight="700" font-family="system-ui, -apple-system, Segoe UI, sans-serif">${label}</text></g>`;
}

/** Static SVG overlay (page coordinates) shown above the snapshot in the exported viewer. */
export function renderOverlaySvg(annotations: Annotation[], width: number, height: number): string {
  const shapes = annotations.filter(isShape).map(shapeToSvg).join('');
  const comments = annotations.filter(isComment).toSorted((a, b) => a.number - b.number);
  const targets = comments.map(targetMarkup).join('');
  const pins = comments.map(pinMarkup).join('');
  return `<svg class="cd-overlay" xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-label="Annotation overlay"><g class="cd-layer-targets">${targets}</g><g class="cd-layer-shapes">${shapes}</g><g class="cd-layer-pins">${pins}</g></svg>`;
}
