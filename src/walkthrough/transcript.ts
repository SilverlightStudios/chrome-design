/**
 * Transcripts from any speech-to-text tool: SubRip (.srt), WebVTT (.vtt), JSON (Chrome
 * Design's own `chrome-design.transcript`, Whisper / faster-whisper, NVIDIA NeMo / Parakeet
 * timestamps, or a plain list of segments) and plain text (no times).
 *
 * Times come back in ms from the start of the audio, plus `startedAtMs` (Unix epoch ms) when
 * the file says when the audio began, which lines it up with a walkthrough exactly.
 */
import type { WtSegment, WtWord } from './model.ts';

export interface ParsedTranscript {
  format: 'srt' | 'vtt' | 'json' | 'text';
  segments: WtSegment[];
  /** When the audio started (Unix epoch ms), if the file says. */
  startedAtMs?: number;
  /** No times at all (plain text). */
  untimed?: boolean;
  /** Times spread over a span rather than reported (e.g. one block of text). */
  estimated?: boolean;
}

/** `01:02:03,456`, `02:03.456`, `3.5` (seconds) → ms. */
export function parseClock(text: string): number | null {
  const t = text.trim().replace(',', '.');
  const m = /^(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/.exec(t);
  if (m) return Math.round((Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000);
  if (/^\d+(?:\.\d+)?$/.test(t)) return Math.round(Number(t) * 1000);
  return null;
}

const CUE_TIME = /^\s*([\d:.,]+)\s*-->\s*([\d:.,]+)/;

/** SRT and VTT share the cue shape: a time line, then text lines, blank line between cues. */
function parseCues(text: string): WtSegment[] {
  const out: WtSegment[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const m = CUE_TIME.exec(lines[i] ?? '');
    if (!m) continue;
    const t0 = parseClock(m[1]!);
    const t1 = parseClock(m[2]!);
    const body: string[] = [];
    while (i + 1 < lines.length && lines[i + 1]!.trim() !== '') body.push(lines[++i]!);
    const said = body
      .join(' ')
      .replace(/<[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (t0 !== null && t1 !== null && said) out.push({ t0, t1: Math.max(t0, t1), text: said });
  }
  return out;
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v)
    ? v
    : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))
      ? Number(v)
      : null;

/** A start time: epoch ms or seconds, or an ISO date. */
function epochOf(v: unknown): number | null {
  const n = num(v);
  if (n !== null) return n < 1e11 ? Math.round(n * 1000) : Math.round(n);
  if (typeof v === 'string') {
    const d = Date.parse(v);
    return Number.isNaN(d) ? null : d;
  }
  return null;
}

/**
 * One timed item, whatever it's called: `t0`/`t1` and `startMs`/`endMs` are ms; `start`/`end`,
 * `start_time`/`end_time` and `from`/`to` are seconds; NeMo's `start_offset`/`end_offset` are
 * frames, so only used when no seconds are given.
 */
function timesOf(item: Json): [number, number] | null {
  const ms = (a: string, b: string) => {
    const x = num(item[a]);
    const y = num(item[b]);
    return x !== null ? ([x, y ?? x] as [number, number]) : null;
  };
  const sec = (a: string, b: string) => {
    const x = num(item[a]);
    const y = num(item[b]);
    return x !== null ? ([x * 1000, (y ?? x) * 1000] as [number, number]) : null;
  };
  const pair =
    ms('t0', 't1') ??
    ms('startMs', 'endMs') ??
    ms('start_ms', 'end_ms') ??
    sec('start', 'end') ??
    sec('start_time', 'end_time') ??
    sec('from', 'to');
  if (pair) return [Math.round(pair[0]), Math.round(Math.max(pair[0], pair[1]))];
  if (typeof item.start === 'string' && parseClock(item.start) !== null) {
    const t0 = parseClock(item.start)!;
    const t1 = typeof item.end === 'string' ? (parseClock(item.end) ?? t0) : t0;
    return [t0, Math.max(t0, t1)];
  }
  return null;
}

const textOf = (item: Json): string => {
  const v = item.text ?? item.segment ?? item.word ?? item.transcript ?? item.char;
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '';
};

function wordsOf(item: Json): WtWord[] | undefined {
  const list = item.words;
  if (!Array.isArray(list)) return undefined;
  const words = list.flatMap((w): WtWord[] => {
    if (!isObj(w)) return [];
    const times = timesOf(w);
    const text = textOf(w);
    return times && text ? [{ t0: times[0], t1: times[1], text }] : [];
  });
  return words.length ? words : undefined;
}

function segmentsFrom(list: unknown[]): WtSegment[] {
  return list.flatMap((item): WtSegment[] => {
    if (!isObj(item)) return [];
    const text = textOf(item);
    const words = wordsOf(item);
    const times = timesOf(item) ?? (words ? [words[0]!.t0, words.at(-1)!.t1] : null);
    if (!times || !(text || words)) return [];
    const seg: WtSegment = {
      t0: times[0],
      t1: times[1],
      text: text || (words ?? []).map((w) => w.text).join(' '),
    };
    if (words) seg.words = words;
    return [seg];
  });
}

function parseJson(value: unknown): ParsedTranscript | null {
  const root = isObj(value) ? value : { segments: value };
  const startedAt =
    epochOf(root.startedAtMs) ??
    epochOf(root.startedAt) ??
    epochOf(root.started_at) ??
    epochOf(root.recordingStartedAt) ??
    epochOf(root.audioStartedAt);
  // NeMo puts segment timestamps under `timestamp.segment` (and words under `timestamp.word`).
  const stamp = isObj(root.timestamp) ? root.timestamp : null;
  const list =
    (Array.isArray(root.segments) && root.segments) ||
    (stamp && Array.isArray(stamp.segment) && stamp.segment) ||
    (Array.isArray(root.chunks) && root.chunks) ||
    (Array.isArray(root.results) && root.results) ||
    null;
  let segments = list ? segmentsFrom(list) : [];
  if (segments.length === 0) {
    const words = Array.isArray(root.words)
      ? root.words
      : stamp && Array.isArray(stamp.word)
        ? stamp.word
        : null;
    if (words) {
      const ws = wordsOf({ words });
      if (ws) segments = sentencesFromWords(ws);
    }
  }
  if (segments.length === 0) {
    const text = textOf(root);
    if (!text) return null;
    return {
      format: 'json',
      segments: [{ t0: 0, t1: 0, text }],
      untimed: true,
      ...(startedAt !== null ? { startedAtMs: startedAt } : {}),
    };
  }
  return {
    format: 'json',
    segments: segments.toSorted((a, b) => a.t0 - b.t0),
    ...(startedAt !== null ? { startedAtMs: startedAt } : {}),
  };
}

/** Words into sentences (at . ? ! or a pause over 700 ms). */
function sentencesFromWords(words: WtWord[]): WtSegment[] {
  const out: WtSegment[] = [];
  let current: WtWord[] = [];
  const flush = () => {
    if (!current.length) return;
    out.push({
      t0: current[0]!.t0,
      t1: current.at(-1)!.t1,
      text: current.map((w) => w.text).join(' '),
      words: current,
    });
    current = [];
  };
  for (const w of words) {
    const prev = current.at(-1);
    if (prev && w.t0 - prev.t1 > 700) flush();
    current.push(w);
    if (/[.?!]["”’)]?$/.test(w.text)) flush();
  }
  flush();
  return out;
}

export function parseTranscript(text: string, fileName = ''): ParsedTranscript | null {
  const body = text.replace(/^﻿/, '');
  const trimmed = body.trim();
  if (!trimmed) return null;
  const ext = fileName.toLowerCase().split('.').at(-1) ?? '';
  if (ext === 'json' || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = parseJson(JSON.parse(trimmed));
      if (parsed) return parsed;
    } catch {
      // not JSON after all: try the other formats
    }
  }
  if (trimmed.startsWith('WEBVTT') || ext === 'vtt') {
    const segments = parseCues(body);
    if (segments.length) return { format: 'vtt', segments };
  }
  if (CUE_TIME.test(body.split('\n').find((l) => l.includes('-->')) ?? '')) {
    const segments = parseCues(body);
    if (segments.length) return { format: 'srt', segments };
  }
  return {
    format: 'text',
    segments: [{ t0: 0, t1: 0, text: trimmed.replace(/\s+/g, ' ') }],
    untimed: true,
  };
}

/**
 * Split segments into clauses (at , ; : . ? !) with times spread by length, or by their own
 * word times. A picture then gets the clause that was in progress when its moment began.
 */
export function clausesOf(segment: WtSegment): WtSegment[] {
  if (segment.words?.length) {
    const out: WtSegment[] = [];
    let current: WtWord[] = [];
    for (const w of segment.words) {
      current.push(w);
      if (/[,;:.?!]["”’)]?$/.test(w.text)) {
        out.push({
          t0: current[0]!.t0,
          t1: w.t1,
          text: current.map((x) => x.text).join(' '),
        });
        current = [];
      }
    }
    if (current.length)
      out.push({
        t0: current[0]!.t0,
        t1: current.at(-1)!.t1,
        text: current.map((x) => x.text).join(' '),
      });
    return out;
  }
  const parts = segment.text.match(/[^,;:.?!]+[,;:.?!]*["”’)]?\s*/g) ?? [segment.text];
  const total = parts.reduce((n, p) => n + p.length, 0) || 1;
  const span = segment.t1 - segment.t0;
  let at = segment.t0;
  return parts
    .map((p) => {
      const t0 = at;
      at += (span * p.length) / total;
      return { t0: Math.round(t0), t1: Math.round(at), text: p.trim() };
    })
    .filter((c) => c.text);
}
