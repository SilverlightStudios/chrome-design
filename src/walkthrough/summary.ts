/**
 * The walkthrough as text for an AI agent (`summary.md`): one line per picture with what
 * happened and what was said then, Scrawl's format (github.com/kitlangton/scrawl), e.g.
 *
 *   - #3 (0:08) [clicked Button “Back”] “Go back.”
 *     · 0:09 scrolled down 600 px
 *
 * Pure: the extension, the merge CLI and voice recorders all build the same text from
 * `walkthrough.json` plus a transcript.
 */
import {
  formatClock,
  type Walkthrough,
  type WtEvent,
  type WtFrame,
  type WtMark,
  type WtTranscript,
} from './model.ts';
import { clausesOf, type ParsedTranscript } from './transcript.ts';

export interface AttachOptions {
  /** Shift (ms) when neither side knows when the audio started. */
  offsetMs?: number;
  source?: string;
}

/**
 * Put a transcript on the walkthrough's clock. The audio's own start time (from the file, or
 * the voice link's session) lines it up exactly; otherwise it's assumed to have started with
 * the walkthrough, moved by `offsetMs`.
 */
export function alignTranscript(
  wt: Pick<Walkthrough, 'startedAtMs' | 'session'>,
  parsed: ParsedTranscript,
  options: AttachOptions = {},
): WtTranscript {
  const audioStart = parsed.startedAtMs ?? wt.session?.audioStartedAtMs;
  const offsetMs =
    audioStart !== undefined ? audioStart - wt.startedAtMs : Math.round(options.offsetMs ?? 0);
  const shift = (t: number) => t + offsetMs;
  const transcript: WtTranscript = {
    source: options.source ?? parsed.format,
    offsetMs,
    alignment: audioStart !== undefined ? 'clock' : 'assumed',
    segments: parsed.segments.map((s) => ({
      ...s,
      t0: shift(s.t0),
      t1: shift(s.t1),
      ...(s.words
        ? { words: s.words.map((w) => ({ ...w, t0: shift(w.t0), t1: shift(w.t1) })) }
        : {}),
    })),
  };
  if (parsed.untimed) transcript.untimed = true;
  if (parsed.estimated) transcript.estimated = true;
  return transcript;
}

export function describeEvent(event: WtEvent): string {
  switch (event.kind) {
    case 'click':
      return `${event.button === 'right' ? 'right-clicked' : 'clicked'} ${event.target.label}`;
    case 'scroll': {
      const dy = Math.round(event.to.y - event.from.y);
      const dx = Math.round(event.to.x - event.from.x);
      const way =
        Math.abs(dy) >= Math.abs(dx)
          ? `${dy >= 0 ? 'down' : 'up'} ${Math.abs(dy)} px`
          : `${dx >= 0 ? 'right' : 'left'} ${Math.abs(dx)} px`;
      return `scrolled ${way}${event.target ? ` in ${event.target.label}` : ''}`;
    }
    case 'type':
      return `typed in ${event.target.label}`;
    case 'navigate':
      return `went to “${event.title || event.url}” (${event.url})`;
    case 'resize':
      return `resized the window to ${event.width}×${event.height}`;
    case 'cue':
      return `said “${event.word}”`;
  }
}

/** A moment the text is organised by: a picture, or (with no pictures) a mark or event. */
interface Moment {
  t: number;
  frame?: WtFrame;
  mark?: WtMark;
  event?: WtEvent;
}

function moments(wt: Walkthrough): Moment[] {
  if (wt.frames.length)
    return wt.frames
      .map((frame): Moment => {
        const mark = frame.mark ? wt.marks.find((m) => m.id === frame.mark) : undefined;
        const event =
          frame.reason === 'click' || frame.reason === 'navigate'
            ? wt.events.find(
                (e) =>
                  e.kind === (frame.reason === 'click' ? 'click' : 'navigate') &&
                  Math.abs(e.t - frame.t) < 50,
              )
            : undefined;
        return { t: frame.t, frame, ...(mark ? { mark } : {}), ...(event ? { event } : {}) };
      })
      .toSorted((a, b) => a.t - b.t);
  const out: Moment[] = [
    ...wt.marks.map((mark) => ({ t: mark.t0, mark })),
    ...wt.events
      .filter((e) => e.kind === 'click' || e.kind === 'navigate')
      .map((event) => ({ t: event.t, event })),
  ].toSorted((a, b) => a.t - b.t);
  return out.length ? out : [{ t: 0 }];
}

function whatHappened(m: Moment): string {
  if (m.mark) return m.mark.description;
  if (m.event?.kind === 'click') return `[${describeEvent(m.event)}]`;
  if (m.event) return describeEvent(m.event);
  switch (m.frame?.reason) {
    case 'start':
      return 'start';
    case 'end':
      return 'end';
    case 'result':
      return 'after the click';
    case 'scroll':
      return 'after scrolling';
    case 'navigate':
      return 'new page';
    default:
      return '';
  }
}

/** Index of the moment a time belongs to (the last one at or before it; the first if none). */
function momentAt(list: Moment[], t: number): number {
  let found = 0;
  for (let i = 0; i < list.length; i++) if (list[i]!.t <= t) found = i;
  return found;
}

/** What was said during each moment: clauses go to the moment that was on when they ended. */
export function speechByMoment(transcript: WtTranscript | undefined, times: number[]): string[] {
  const out = times.map(() => [] as string[]);
  if (!transcript || transcript.untimed || times.length === 0) return out.map(() => '');
  const list = times.map((t) => ({ t }));
  for (const seg of transcript.segments)
    for (const clause of clausesOf(seg)) out[momentAt(list, clause.t1 - 1)]!.push(clause.text);
  return out.map((parts) => parts.join(' ').replace(/\s+/g, ' ').trim());
}

const p2 = (n: number) => String(n).padStart(2, '0');

function localStamp(ms: number): string {
  const d = new Date(ms);
  const p = p2;
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function buildSummary(wt: Walkthrough): string {
  const list = moments(wt);
  const said = speechByMoment(
    wt.transcript,
    list.map((m) => m.t),
  );
  const lines: string[] = [];
  lines.push(
    `[walkthrough ${formatClock(wt.durationMs)} · ${wt.page.title || 'Untitled page'} · ${wt.page.url}]`,
  );
  lines.push(
    `Recorded ${localStamp(wt.startedAtMs)} · window ${wt.viewport.width}×${wt.viewport.height}`,
  );
  if (wt.frames.length)
    lines.push(
      `Pictures: contact-sheet.jpg (numbered #1–#${wt.frames.length}), full size in frames/. Red ink, numbered red pins and the red laser trail are the reviewer’s marks; blue rings are clicks.`,
    );
  if (wt.transcript) {
    const how = wt.transcript.untimed
      ? 'no times'
      : wt.transcript.alignment === 'clock'
        ? 'lined up by clock'
        : `lined up by hand (${wt.transcript.offsetMs >= 0 ? '+' : ''}${(wt.transcript.offsetMs / 1000).toFixed(1)} s)`;
    lines.push(`Voice: ${wt.transcript.source} · ${how}. Quotes are what was said at that moment.`);
  }
  if (wt.transcript?.untimed) {
    const text = wt.transcript.segments.map((s) => s.text).join(' ');
    if (text) lines.push('', `Said: “${text}”`);
  }
  lines.push('');

  const listed = new Set<object>();
  for (const m of list) {
    if (m.mark) listed.add(m.mark);
    if (m.event) listed.add(m.event);
  }
  // Everything else (other marks and events) nests under the moment it happened in.
  const extras: { t: number; text: string }[] = [
    ...wt.marks.filter((mk) => !listed.has(mk)).map((mk) => ({ t: mk.t0, text: mk.description })),
    ...wt.events
      .filter((e) => !listed.has(e) && e.kind !== 'cue')
      .map((e) => ({ t: e.t, text: describeEvent(e) })),
  ].toSorted((a, b) => a.t - b.t);
  const nested = list.map(() => [] as { t: number; text: string }[]);
  for (const x of extras) nested[momentAt(list, x.t)]!.push(x);

  list.forEach((m, i) => {
    const head = m.frame ? `- #${m.frame.index} (${formatClock(m.t)})` : `- ${formatClock(m.t)}`;
    const what = whatHappened(m);
    const quote = said[i] ? ` “${said[i]}”` : '';
    lines.push(`${head}${what ? ` ${what}` : ''}${quote}`);
    for (const x of nested[i]!) lines.push(`  · ${formatClock(x.t)} ${x.text}`);
  });
  return `${lines.join('\n')}\n`;
}
