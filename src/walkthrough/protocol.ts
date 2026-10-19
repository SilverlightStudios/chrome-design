/**
 * The voice link: messages between Chrome Design and a local voice recorder, through Chrome's
 * native messaging (the extension talks to a small bridge program Chrome starts; the bridge
 * talks to the recorder over a Unix socket, one JSON object per line). See docs/WALKTHROUGH.md.
 *
 * Every time is Unix epoch ms, so both sides line up on the one clock they share.
 */

export const VOICE_PROTOCOL = 1;
/** The native messaging host name the bridge registers. */
export const VOICE_HOST = 'com.silverlightstudios.chrome_design.voice';

/** Recorder → Chrome Design. */
export type FromRecorder =
  | { type: 'hello'; app: string; version?: string; protocol: number }
  /** Recording began. Chrome Design follows along in the focused window's tab. */
  | {
      type: 'recording.start';
      session: string;
      startedAt: number;
      app?: string;
      /** Only follow along if a Chrome window is the frontmost window (default true). */
      onlyIfChromeInFront?: boolean;
    }
  /** Recording ended: Chrome Design finishes and sends the walkthrough back. */
  | { type: 'recording.stop'; session: string; stoppedAt: number }
  /** Thrown away: Chrome Design stops and keeps nothing. */
  | { type: 'recording.cancel'; session: string }
  /** Optional, live: a spoken cue ("here", "look", "this") — Chrome Design takes a picture. */
  | { type: 'cue'; session: string; at: number; word: string }
  /** Optional: the transcript, for the review panel (Copy for AI then includes the words). */
  | { type: 'transcript'; session: string; transcript: unknown; app?: string }
  | { type: 'status' }
  /** From the bridge itself: whether a recorder is connected to it right now. */
  | { type: 'bridge'; recorder: boolean };

/** Chrome Design → recorder (and the bridge, which saves bundles to disk). */
export type ToRecorder =
  | { type: 'hello'; extension: string; version: string; protocol: number }
  | {
      type: 'walkthrough.started';
      session: string;
      startedAt: number;
      /** `recorder`: in answer to recording.start; `extension`: started in Chrome (record too?). */
      origin: 'recorder' | 'extension';
      page: { url: string; title: string };
    }
  | { type: 'walkthrough.unavailable'; session: string; reason: string }
  | {
      type: 'walkthrough.stopped';
      session: string;
      stoppedAt: number;
      origin: 'recorder' | 'extension';
    }
  /** The finished walkthrough: `files` follow one message each, then `walkthrough.done`. */
  | {
      type: 'walkthrough.bundle';
      session: string;
      folder: string;
      walkthrough: unknown;
      summary: string;
      files: string[];
    }
  | { type: 'walkthrough.file'; session: string; name: string; mime: string; base64: string }
  | { type: 'walkthrough.done'; session: string }
  | { type: 'walkthrough.discarded'; session: string }
  | { type: 'status'; recording: boolean; session?: string; page?: { url: string; title: string } };

/** Bridge → recorder only: where it saved a finished walkthrough. */
export interface BridgeSaved {
  type: 'walkthrough.saved';
  session: string;
  dir: string;
  files: string[];
}
