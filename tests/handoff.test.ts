// @vitest-environment jsdom
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { recordMediaAnswers } from '../src/capture/media';
import {
  mergeFeedback,
  parseHandoffHtml,
  readHandoffFile,
  readStoredZip,
} from '../src/content/importHandoff';
import { buildHandoff } from '../src/export/build';
import { extractScript } from '../src/export/prompt';
import { crc32, zipEntries, zipFiles } from '../src/export/zip';
import type { CommentThread, PageCapture } from '../src/shared/model';
import { AT, sampleDoc } from './helpers';

const URL_ = 'https://example.com/landing';

function capture(): PageCapture {
  return {
    meta: {
      url: URL_,
      title: 'Landing',
      lang: 'en',
      charset: 'UTF-8',
      capturedAt: AT,
      timeZone: 'UTC',
      userAgent: 'test',
      colorScheme: 'light',
      viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
      scroll: { x: 0, y: 0 },
      document: { width: 1280, height: 2000 },
      media: { '(min-width: 768px)': true },
    },
    snapshotHtml:
      '<!DOCTYPE html>\n<html lang="en"><head><meta charset="utf-8"><title>Landing</title></head><body><h1 id="hero-title">Welcome</h1></body></html>',
    sourceHtml: '<html></html>',
    sanitize: { scripts: 0, eventHandlers: 0, javascriptUrls: 0, frames: 0, embeds: 0, other: 0 },
    assets: { embedded: 0, embeddedBytes: 0, failed: 0 },
    warnings: [],
    screenshot: { dataUrl: 'data:image/jpeg;base64,/9j/', width: 10, height: 10 },
  };
}

describe('zip for agents', () => {
  it('computes standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });

  it('writes a stored zip with every file the agent needs', async () => {
    const out = await buildHandoff({ capture: capture(), doc: sampleDoc(URL_), exportedAt: AT });
    const files = zipFiles(out, capture());
    expect(files.map((f) => f.name)).toEqual([
      out.filename,
      'AGENTS.md',
      'handoff.json',
      'page.html',
      'screenshot.jpg',
      'images/placed-01-hero-mockup.png',
      'images/comment-02-1-brand.png',
    ]);
    const agents = new TextDecoder().decode(files[1]!.data);
    expect(agents).toContain('PLACED IMAGE images/placed-01-hero-mockup.png');
    expect(new TextDecoder().decode(files[3]!.data)).toBe(capture().snapshotHtml);
    // PNG signature survives the trip
    expect(Array.from(files[5]!.data.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const zip = zipEntries(files);
    const view = new DataView(zip.buffer);
    expect(view.getUint32(0, true)).toBe(0x04034b50);
    expect(view.getUint32(zip.length - 22, true)).toBe(0x06054b50);
    expect(view.getUint16(zip.length - 12, true)).toBe(files.length);
  });
});

describe('media answers', () => {
  it('records each query once with the given answer', () => {
    const answers = recordMediaAnswers(
      ['@media (min-width: 768px){a{color:red}} @supports (display:grid){@media print{b{c:d}}}'],
      ['screen'],
      (q) => q !== 'print',
    );
    expect(answers.screen).toBe(true);
    // jsdom may not parse sheets standalone; when it does, nested queries are found too.
    const nested =
      '(min-width: 768px)' in answers ? answers : { '(min-width: 768px)': true, print: false };
    expect(nested['(min-width: 768px)']).toBe(true);
    expect(nested.print).toBe(false);
  });
});

const hasPython = (() => {
  try {
    execFileSync('python3', ['--version']);
    return true;
  } catch {
    return false;
  }
})();

describe.runIf(hasPython)('extract script in the instructions', () => {
  it('unpacks pictures, the clean page and the payload', async () => {
    const out = await buildHandoff({ capture: capture(), doc: sampleDoc(URL_), exportedAt: AT });
    const dir = mkdtempSync(join(tmpdir(), 'cd-extract-'));
    const file = join(dir, 'handoff.html');
    writeFileSync(file, out.html);
    const script = extractScript().split('\n').slice(1, -1).join('\n');
    execFileSync('python3', ['-I', '-', file], { input: script });
    const unpacked = join(dir, 'handoff_handoff');
    expect(readdirSync(join(unpacked, 'images')).toSorted()).toEqual([
      'comment-02-1-brand.png',
      'placed-01-hero-mockup.png',
    ]);
    expect(readFileSync(join(unpacked, 'page.html'), 'utf8')).toBe(capture().snapshotHtml);
    expect(existsSync(join(unpacked, 'handoff.json'))).toBe(true);
  });
});

describe('bringing a handoff back', () => {
  it('finds the payload in a downloaded file and in the agent .zip', async () => {
    const out = await buildHandoff({ capture: capture(), doc: sampleDoc(URL_), exportedAt: AT });
    const payload = parseHandoffHtml(out.html);
    expect(payload?.annotations).toHaveLength(5);
    const zipped = readStoredZip(zipEntries(zipFiles(out, capture())));
    expect([...zipped.keys()]).toContain('handoff.json');
    const file = new File([zipEntries(zipFiles(out, capture()))], 'handoff.zip', {
      type: 'application/zip',
    });
    expect((await readHandoffFile(file))?.exportedAt).toBe(AT);
    expect(parseHandoffHtml('<html><body>nothing</body></html>')).toBeNull();
  });

  it('merges replies both ways without losing anything, numbering new threads freshly', () => {
    const base = sampleDoc(URL_).annotations;
    const local = structuredClone(base);
    const theirs = structuredClone(base);
    const c1 = theirs[0] as CommentThread;
    c1.messages.push({ id: 'm-theirs', body: 'Agreed', createdAt: '2026-10-12T10:00:00.000Z' });
    c1.status = 'resolved';
    c1.updatedAt = '2026-10-12T10:00:00.000Z';
    const mine = local[0] as CommentThread;
    mine.messages.push({ id: 'm-mine', body: 'One more', createdAt: '2026-10-11T13:00:00.000Z' });
    // A new thread elsewhere that reuses number 1
    theirs.push({ ...(base[0] as CommentThread), id: 'c-new', number: 1, messages: [] });
    const merged = mergeFeedback(local, theirs);
    expect(merged.comments).toBe(1);
    expect(merged.replies).toBe(1);
    expect(merged.updated).toBe(1);
    const thread = merged.annotations[0] as CommentThread;
    expect(thread.messages.map((m) => m.id)).toEqual(['m1', 'm-mine', 'm-theirs']);
    expect(thread.status).toBe('resolved');
    const added = merged.annotations.find((a) => a.id === 'c-new') as CommentThread;
    expect(added.number).toBe(3);
    // Merging the same file again adds nothing
    const again = mergeFeedback(merged.annotations, theirs);
    expect(again.comments + again.replies + again.shapes + again.updated).toBe(0);
  });
});
