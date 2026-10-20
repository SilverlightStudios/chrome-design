import { APP_NAME, APP_VERSION } from '../../shared/model';
import {
  WALKTHROUGH_KIND,
  WALKTHROUGH_VERSION,
  type Walkthrough,
  type WtFrame,
} from '../../walkthrough/model';
import { marksOf } from '../../walkthrough/shapes';
import { buildSummary } from '../../walkthrough/summary';
import type { ParsedTranscript } from '../../walkthrough/transcript';
import { type Candidate, pickFrames } from './pictures';
import type { Tape } from './tape';

/** Who started a walkthrough: the voice recorder (over the voice link) or the reviewer. */
export interface WalkthroughSession {
  id: string;
  origin: 'recorder' | 'extension';
  app?: string;
  audioStartedAtMs?: number;
}

export interface WalkthroughResult {
  walkthrough: Walkthrough;
  /** The pictures as taken, by frame file name (annotated when the bundle is built). */
  shots: Map<string, Candidate>;
  summary: string;
  folder: string;
  /** Sent to the voice recorder (its name, when it said). */
  delivered?: { app?: string };
  /** The transcript as read, so it can be lined up again (the Voice starts dial). */
  heard?: { parsed: ParsedTranscript; name: string };
}

const p2 = (n: number) => String(n).padStart(2, '0');

function folderName(startedAtMs: number): string {
  const d = new Date(startedAtMs);
  const host = (location.hostname || 'page').replace(/^www\./, '').replace(/[^a-z0-9.-]+/gi, '-');
  const day = `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
  return `walkthrough-${host}-${day}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`;
}

/** The tape and the best pictures as a walkthrough (src/walkthrough/model.ts). */
export function assemble(
  tape: Tape,
  candidates: readonly Candidate[],
  session: WalkthroughSession | null,
  page: { url: string; title: string },
  durationMs: number,
): WalkthroughResult {
  const marks = marksOf(tape.strokes);
  const markOf = (i: number | undefined) =>
    i === undefined ? undefined : marks.find((m) => m.strokes.includes(i));
  // A mark's picture is placed when the mark began (it's retaken as the mark grows).
  const picked = pickFrames(candidates.map((c) => ({ ...c, t: markOf(c.strokeIndex)?.t0 ?? c.t })));
  const shots = new Map<string, Candidate>();
  const frames: WtFrame[] = picked.map((c, i) => {
    const file = `frames/frame-${p2(i + 1)}.jpg`;
    shots.set(file, c);
    const mark = markOf(c.strokeIndex);
    if (mark) mark.frame = file;
    return {
      index: i + 1,
      file,
      t: c.t,
      takenAt: c.takenAt,
      reason: c.reason,
      ...(mark ? { mark: mark.id } : {}),
      scroll: c.scroll,
      viewport: c.viewport,
      url: c.url,
      width: c.width,
      height: c.height,
      scale: Math.round(c.scale * 1000) / 1000,
      ...(c.screen ? { screen: c.screen } : {}),
    };
  });
  const startedAtMs = tape.startedAtMs;
  const walkthrough: Walkthrough = {
    kind: WALKTHROUGH_KIND,
    version: WALKTHROUGH_VERSION,
    generator: { name: APP_NAME, version: APP_VERSION },
    startedAt: new Date(startedAtMs).toISOString(),
    startedAtMs,
    durationMs,
    page,
    viewport: {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
    },
    ...(session
      ? {
          session: {
            id: session.id,
            ...(session.app ? { app: session.app } : {}),
            ...(session.audioStartedAtMs !== undefined
              ? { audioStartedAtMs: session.audioStartedAtMs }
              : {}),
          },
        }
      : {}),
    frames,
    marks,
    events: tape.events.toSorted((a, b) => a.t - b.t),
    strokes: tape.strokes.map((s) => ({
      ...s,
      points: s.points.map(([x, y, dt]) => [Math.round(x), Math.round(y), Math.round(dt)]),
    })),
    cursor: tape.cursor,
    scrolls: tape.scrolls,
    context: tape.context,
    ...(tape.contextChanges.length ? { contextChanges: tape.contextChanges } : {}),
  };
  return {
    walkthrough,
    shots,
    summary: buildSummary(walkthrough),
    folder: folderName(startedAtMs),
  };
}
