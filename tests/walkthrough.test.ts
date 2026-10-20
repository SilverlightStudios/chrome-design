import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pickFrames } from '../src/content/walkthrough/pictures';
import {
  formatClock,
  WALKTHROUGH_KIND,
  type Walkthrough,
  type WtStroke,
} from '../src/walkthrough/model';
import { marksOf, shapeOf } from '../src/walkthrough/shapes';
import { alignTranscript, buildSummary, speechByMoment } from '../src/walkthrough/summary';
import { clausesOf, parseClock, parseTranscript } from '../src/walkthrough/transcript';

const T = (label: string) => ({ label, selector: `#${label.split(' ')[0]!.toLowerCase()}` });

function ellipse(cx: number, cy: number, rx: number, ry: number, t0 = 0, n = 40): WtStroke {
  const points: [number, number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    points.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a), i * 10]);
  }
  return { t0, t1: t0 + n * 10, points };
}

function line(x0: number, y0: number, x1: number, y1: number, t0 = 0, n = 10): WtStroke {
  const points: [number, number, number][] = [];
  for (let i = 0; i <= n; i++)
    points.push([x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, i * 20]);
  return { t0, t1: t0 + n * 20, points };
}

function walkthrough(over: Partial<Walkthrough> = {}): Walkthrough {
  return {
    kind: WALKTHROUGH_KIND,
    version: 1,
    generator: { name: 'Chrome Design', version: '0.1.0' },
    startedAt: new Date(1_800_000_000_000).toISOString(),
    startedAtMs: 1_800_000_000_000,
    durationMs: 12_000,
    page: { url: 'https://acme.test/pricing', title: 'Pricing' },
    viewport: { width: 1280, height: 800, devicePixelRatio: 2 },
    frames: [],
    marks: [],
    events: [],
    strokes: [],
    cursor: [],
    ...over,
  };
}

describe('reading ink as gestures (Scrawl’s rules)', () => {
  it('tells circles, underlines, lines and taps apart', () => {
    expect(shapeOf(ellipse(200, 200, 80, 50))).toBe('circle');
    expect(shapeOf(line(100, 300, 400, 304))).toBe('underline');
    expect(shapeOf(line(100, 100, 220, 260))).toBe('line');
    expect(shapeOf(line(100, 100, 104, 103))).toBe('tap');
  });

  it('names what was circled, using the elements inside it', () => {
    const stroke = { ...ellipse(200, 200, 80, 50), hits: { inside: [T('Heading “Pricing”')] } };
    const [mark] = marksOf([stroke]);
    expect(mark?.shape).toBe('circle');
    expect(mark?.description).toBe('circled Heading “Pricing”');
    expect(mark?.on?.selector).toBe('#heading');
  });

  it('reads a line with a short stroke at one end as an arrow pointing there', () => {
    const shaft = {
      ...line(100, 100, 400, 100, 0),
      hits: { start: T('Text “Plans”'), end: T('Button “Start free”') },
    };
    const head = line(385, 88, 400, 100, 500, 3);
    const [mark, ...rest] = marksOf([shaft, head]);
    expect(rest).toHaveLength(0);
    expect(mark?.shape).toBe('arrow');
    expect(mark?.to).toEqual({ x: 400, y: 100 });
    expect(mark?.description).toBe('drew an arrow from Text “Plans” to Button “Start free”');
  });

  it('keeps strokes apart when they are more than 1.2 s apart, and pins and laser always', () => {
    const a = ellipse(100, 100, 40, 30, 0);
    const b = ellipse(300, 100, 40, 30, a.t1 + 1300);
    const pin: WtStroke = { t0: b.t1 + 100, t1: b.t1 + 100, points: [[50, 60, 0]], pin: 1 };
    const laser: WtStroke = {
      t0: pin.t1 + 100,
      t1: pin.t1 + 900,
      points: [
        [0, 0, 0],
        [50, 50, 400],
        [90, 90, 800],
      ],
      laser: true,
      hits: { path: [T('Card “Pro”'), T('Button “Buy”')] },
    };
    const marks = marksOf([a, b, pin, laser]);
    expect(marks.map((m) => m.shape)).toEqual(['circle', 'circle', 'pin', 'laser']);
    expect(marks[2]?.description).toBe('pin 1 on an area');
    expect(marks[3]?.description).toBe('pointed at Card “Pro”, then Button “Buy”');
  });
});

describe('transcripts from any tool', () => {
  it('reads clock strings', () => {
    expect(parseClock('00:01:02,500')).toBe(62_500);
    expect(parseClock('01:02.25')).toBe(62_250);
    expect(parseClock('3.5')).toBe(3500);
  });

  it('reads SubRip and WebVTT', () => {
    const srt = parseTranscript(
      '1\n00:00:01,000 --> 00:00:03,000\nThis heading\nis too big.\n\n2\n00:00:04,000 --> 00:00:05,500\nFix it.\n',
      'a.srt',
    );
    expect(srt?.format).toBe('srt');
    expect(srt?.segments).toEqual([
      { t0: 1000, t1: 3000, text: 'This heading is too big.' },
      { t0: 4000, t1: 5500, text: 'Fix it.' },
    ]);
    const vtt = parseTranscript(
      'WEBVTT\n\n00:01.000 --> 00:02.000 align:start\n<v Nick>Hello there</v>\n',
    );
    expect(vtt?.format).toBe('vtt');
    expect(vtt?.segments[0]).toEqual({ t0: 1000, t1: 2000, text: 'Hello there' });
  });

  it('reads Whisper, NeMo / Parakeet and Chrome Design JSON (with the audio’s start)', () => {
    const whisper = parseTranscript(
      JSON.stringify({ text: 'a b', segments: [{ start: 0.5, end: 1.25, text: ' Look here.' }] }),
    );
    expect(whisper?.segments).toEqual([{ t0: 500, t1: 1250, text: 'Look here.' }]);
    const nemo = parseTranscript(
      JSON.stringify({
        text: 'look here',
        timestamp: {
          segment: [{ start: 1.0, end: 2.0, segment: 'look here', start_offset: 12 }],
        },
      }),
    );
    expect(nemo?.segments).toEqual([{ t0: 1000, t1: 2000, text: 'look here' }]);
    const words = parseTranscript(
      JSON.stringify({
        words: [
          { start: 0, end: 0.4, word: 'Too' },
          { start: 0.4, end: 0.8, word: 'big.' },
          { start: 2, end: 2.4, word: 'Move' },
          { start: 2.4, end: 2.8, word: 'it' },
        ],
      }),
    );
    expect(words?.segments.map((s) => s.text)).toEqual(['Too big.', 'Move it']);
    const own = parseTranscript(
      JSON.stringify({
        kind: 'chrome-design.transcript',
        startedAt: '2027-01-15T08:00:00.000Z',
        segments: [{ t0: 0, t1: 900, text: 'Hi' }],
      }),
    );
    expect(own?.startedAtMs).toBe(Date.parse('2027-01-15T08:00:00.000Z'));
  });

  it('keeps plain text whole, without times', () => {
    const plain = parseTranscript('The header is too tall.\nAnd the button is grey.', 'notes.txt');
    expect(plain?.untimed).toBe(true);
    expect(plain?.segments[0]?.text).toBe('The header is too tall. And the button is grey.');
  });

  it('splits a segment into clauses with times spread by length', () => {
    const clauses = clausesOf({ t0: 0, t1: 1000, text: 'Look here, this is wrong.' });
    expect(clauses.map((c) => c.text)).toEqual(['Look here,', 'this is wrong.']);
    expect(clauses[0]!.t1).toBeGreaterThan(300);
    expect(clauses.at(-1)!.t1).toBe(1000);
  });
});

describe('the summary', () => {
  const marks = marksOf([
    { ...ellipse(200, 200, 80, 50, 3000), hits: { inside: [T('Heading “Pricing”')] } },
  ]);
  const wt = walkthrough({
    strokes: [ellipse(200, 200, 80, 50, 3000)],
    marks: marks.map((m) => ({ ...m, frame: 'frames/frame-02.jpg' })),
    frames: [
      {
        index: 1,
        file: 'frames/frame-01.jpg',
        t: 0,
        takenAt: 100,
        reason: 'start',
        scroll: { x: 0, y: 0 },
        viewport: { width: 1280, height: 800 },
        url: 'https://acme.test/pricing',
        width: 1280,
        height: 800,
        scale: 1,
      },
      {
        index: 2,
        file: 'frames/frame-02.jpg',
        t: 3000,
        takenAt: 3500,
        reason: 'mark',
        mark: 'm1',
        scroll: { x: 0, y: 0 },
        viewport: { width: 1280, height: 800 },
        url: 'https://acme.test/pricing',
        width: 1280,
        height: 800,
        scale: 1,
      },
      {
        index: 3,
        file: 'frames/frame-03.jpg',
        t: 7000,
        takenAt: 7000,
        reason: 'click',
        scroll: { x: 0, y: 0 },
        viewport: { width: 1280, height: 800 },
        url: 'https://acme.test/pricing',
        width: 1280,
        height: 800,
        scale: 1,
      },
    ],
    events: [
      { kind: 'click', t: 7000, point: { x: 600, y: 400 }, target: T('Button “Start free”') },
      { kind: 'scroll', t: 9000, t1: 9500, from: { x: 0, y: 0 }, to: { x: 0, y: 640 } },
    ],
  });

  it('lists each picture with what happened, and nests the rest under it', () => {
    const text = buildSummary(wt);
    expect(text).toContain('[walkthrough 0:12 · Pricing · https://acme.test/pricing]');
    expect(text).toContain('- #1 (0:00) start');
    expect(text).toContain('- #2 (0:03) circled Heading “Pricing”');
    expect(text).toContain('- #3 (0:07) [clicked Button “Start free”]');
    expect(text).toContain('  · 0:09 scrolled down 640 px');
  });

  it('puts each clause under the picture that was on when it ended', () => {
    const transcript = alignTranscript(
      wt,
      parseTranscript(
        '1\n00:00:00,500 --> 00:00:02,500\nThis is the pricing page.\n\n2\n00:00:02,600 --> 00:00:05,000\nThis heading is huge.\n\n3\n00:00:06,500 --> 00:00:08,000\nAnd this does nothing.\n',
      )!,
    );
    expect(transcript.alignment).toBe('assumed');
    const said = speechByMoment(transcript, [0, 3000, 7000]);
    expect(said).toEqual([
      'This is the pricing page.',
      'This heading is huge.',
      'And this does nothing.',
    ]);
    const text = buildSummary({ ...wt, transcript });
    expect(text).toContain('- #2 (0:03) circled Heading “Pricing” “This heading is huge.”');
    expect(text).toContain('lined up by hand (+0.0 s)');
  });

  it('lines up by clock when the audio’s start is known', () => {
    const parsed = parseTranscript(
      JSON.stringify({
        startedAtMs: wt.startedAtMs - 2000,
        segments: [{ t0: 2500, t1: 4000, text: 'Two seconds early.' }],
      }),
    )!;
    const transcript = alignTranscript(wt, parsed);
    expect(transcript.alignment).toBe('clock');
    expect(transcript.offsetMs).toBe(-2000);
    expect(transcript.segments[0]).toMatchObject({ t0: 500, t1: 2000 });
  });

  it('without pictures, follows the marks and clicks', () => {
    const text = buildSummary({ ...wt, frames: [] });
    expect(text).toContain('- 0:03 circled Heading “Pricing”');
    expect(text).toContain('- 0:07 [clicked Button “Start free”]');
  });
});

describe('picking pictures', () => {
  it('keeps the telling ones, in time order', () => {
    const many = [
      { reason: 'start' as const, t: 0 },
      ...Array.from({ length: 30 }, (_, i) => ({ reason: 'idle' as const, t: 100 + i * 10 })),
      { reason: 'mark' as const, t: 5000 },
      { reason: 'click' as const, t: 6000 },
    ];
    const kept = pickFrames(many, 5);
    expect(kept).toHaveLength(5);
    expect(kept.map((k) => k.reason)).toEqual(['start', 'idle', 'idle', 'mark', 'click']);
  });

  it('formats times as m:ss', () => {
    expect(formatClock(0)).toBe('0:00');
    expect(formatClock(65_400)).toBe('1:05');
  });
});

describe('the merge command', () => {
  it('writes summary.md for a walkthrough folder and a transcript', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cd-wt-'));
    const marks = marksOf([
      { ...ellipse(200, 200, 80, 50, 1000), hits: { inside: [T('Heading “Pricing”')] } },
    ]);
    writeFileSync(join(dir, 'walkthrough.json'), JSON.stringify(walkthrough({ marks })));
    writeFileSync(join(dir, 'said.srt'), '1\n00:00:01,000 --> 00:00:02,000\nToo big.\n');
    execFileSync(
      process.execPath,
      [
        resolve(import.meta.dirname, '../tools/walkthrough-merge.ts'),
        dir,
        join(dir, 'said.srt'),
        '--source',
        'Parakeet',
      ],
      { stdio: 'pipe' },
    );
    const text = readFileSync(join(dir, 'summary.md'), 'utf8');
    expect(text).toContain('Voice: Parakeet · lined up by hand');
    expect(text).toContain('- 0:01 circled Heading “Pricing” “Too big.”');
  });
});
