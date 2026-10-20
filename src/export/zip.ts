import type { PageCapture } from '../shared/model';
import { isComment, isShape } from '../shared/model';
import type { BuildOutput } from './build';
import { describeAnnotations } from './prompt';

/**
 * The handoff as a folder, for AI agents and chat uploads that work better with real files:
 *   <name>.html   the shareable file (opens with the toolbar)
 *   AGENTS.md     instructions + every comment, drawing and picture with its place on the page
 *   handoff.json  the machine-readable payload
 *   page.html     the clean page copy (no handoff wrapper)
 *   images/…      every placed or attached picture as an image file
 *   screenshot.jpg the designer's viewport, feedback visible
 * Written as a plain (stored, uncompressed) zip: pictures are already compressed.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC_TABLE[(crc ^ b) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function dosTime(date: Date): { time: number; day: number } {
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** A stored (no compression) zip archive with UTF-8 names. */
export function zipEntries(entries: ZipEntry[], date = new Date()): Uint8Array<ArrayBuffer> {
  const encoder = new TextEncoder();
  const { time, day } = dosTime(date);
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;
    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true); // UTF-8 names
    lv.setUint16(8, 0, true); // stored
    lv.setUint16(10, time, true);
    lv.setUint16(12, day, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, day, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    central.set(name, 46);
    locals.push(local, entry.data);
    centrals.push(central);
    offset += local.length + size;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  const total = new Uint8Array(offset + centralSize + 22);
  let at = 0;
  for (const part of [...locals, ...centrals, end]) {
    total.set(part, at);
    at += part.length;
  }
  return total;
}

function dataUrlBytes(src: string): Uint8Array | null {
  const match = /^data:[^,]*?(;base64)?,(.*)$/s.exec(src);
  if (!match) return null;
  try {
    if (match[1]) return Uint8Array.from(atob(match[2] ?? ''), (c) => c.charCodeAt(0));
    return new TextEncoder().encode(decodeURIComponent(match[2] ?? ''));
  } catch {
    return null;
  }
}

/** The files in the agent folder (exported for tests). */
const text = (s: string) => new TextEncoder().encode(s);

/**
 * `extra`: more pictures in images/ (each placed image in context); `walkthrough`: a recorded
 * walkthrough's files, put in walkthrough/.
 */
export function zipFiles(
  out: BuildOutput,
  capture: PageCapture,
  extra: ZipEntry[] = [],
  walkthrough: ZipEntry[] = [],
): ZipEntry[] {
  const { payload } = out;
  const srcs = new Map<string, string>();
  for (const a of payload.annotations) {
    if (isShape(a) && a.kind === 'image') srcs.set(a.id, a.src);
    if (isComment(a))
      for (const m of a.messages) for (const att of m.attachments ?? []) srcs.set(att.id, att.src);
  }
  const images: ZipEntry[] = [];
  for (const img of payload.images) {
    const bytes = dataUrlBytes(srcs.get(img.attachmentId ?? img.annotationId) ?? '');
    if (bytes) images.push({ name: img.file, data: bytes });
  }
  const shot = capture.screenshot ? dataUrlBytes(capture.screenshot.dataUrl) : null;
  const full = capture.fullPage ? dataUrlBytes(capture.fullPage.dataUrl) : null;
  const agents = [
    '# Design feedback handoff',
    '',
    'Files in this folder:',
    `- \`${out.filename}\`: the shareable file. Open it in a browser to see the page with the feedback on top (the Chrome Design toolbar is built in).`,
    '- `page.html`: the clean page copy to revise (no handoff wrapper).',
    '- `handoff.json`: every comment, drawing and picture, machine-readable.',
    '- `images/`: every picture placed on the page (`placed-…`) or attached to a comment (`comment-NN-…`). Look at them.',
    shot ? '- `screenshot.jpg`: the designer’s screen with the feedback visible.' : '',
    full
      ? `- \`page-annotated.jpg\`: the whole page top to bottom with every drawing, placed image and comment pin on it (page coordinates × ${capture.fullPage?.scale.toFixed(3)} = image pixels).`
      : '',
    extra.length
      ? '- `images/placed-…-in-context.jpg`: each placed image in its place on the page, with the content around it.'
      : '',
    walkthrough.length
      ? '- `walkthrough/`: a recorded walkthrough of the page. `summary.md` is what the reviewer did, pointed at and said, moment by moment; `contact-sheet.jpg` is every picture, numbered; `frames/` the pictures themselves; `walkthrough.json` everything on one clock. Read it with the comments.'
      : '',
    '',
    '## Instructions',
    '',
    payload.agentPrompt,
    '',
    '## The feedback',
    '',
    '```text',
    describeAnnotations(payload.annotations, payload.images) || '(no comments or drawings)',
    '```',
    '',
  ]
    .filter((line, i, all) => line !== '' || all[i - 1] !== '')
    .join('\n');
  return [
    { name: out.filename, data: text(out.html) },
    { name: 'AGENTS.md', data: text(agents) },
    { name: 'handoff.json', data: text(JSON.stringify(payload, null, 2)) },
    { name: 'page.html', data: text(capture.snapshotHtml) },
    ...(shot ? [{ name: 'screenshot.jpg', data: shot }] : []),
    ...(full ? [{ name: 'page-annotated.jpg', data: full }] : []),
    ...images,
    ...extra,
    ...walkthrough.map((f) => ({ ...f, name: `walkthrough/${f.name}` })),
  ];
}

export function buildZip(
  out: BuildOutput,
  capture: PageCapture,
  extra: ZipEntry[] = [],
  walkthrough: ZipEntry[] = [],
): Blob {
  const folder = out.filename.replace(/\.html$/, '');
  const entries = zipFiles(out, capture, extra, walkthrough).map((e) => ({
    ...e,
    name: `${folder}/${e.name}`,
  }));
  return new Blob([zipEntries(entries)], { type: 'application/zip' });
}
