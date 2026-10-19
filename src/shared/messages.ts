/**
 * Messages exchanged between extension contexts. Page content never leaves the browser, except
 * a walkthrough sent to the reviewer's own voice recorder over the voice link (on this computer).
 */
import type { ToRecorder } from '../walkthrough/protocol';

export type ToContentMessage =
  | { type: 'cd:toggle' }
  | { type: 'cd:open' }
  | { type: 'cd:close' }
  | { type: 'cd:export' }
  | { type: 'cd:ping' }
  /** From the voice recorder, through the service worker. */
  | {
      type: 'cd:walkthrough';
      action: 'start';
      session: string;
      audioStartedAtMs: number;
      app?: string;
    }
  | { type: 'cd:walkthrough'; action: 'stop' | 'cancel'; session: string }
  | { type: 'cd:walkthrough'; action: 'cue'; session: string; at: number; word: string }
  | {
      type: 'cd:walkthrough';
      action: 'transcript';
      session: string;
      transcript: unknown;
      app?: string;
    };

export type ToBackgroundMessage =
  | { type: 'cd:capture-visible-tab' }
  | { type: 'cd:fetch-asset'; url: string; maxBytes: number }
  | { type: 'cd:open-options' }
  | { type: 'cd:get-settings' }
  | { type: 'cd:get-runtime' }
  | { type: 'cd:resize-window'; width: number }
  | { type: 'cd:state'; open: boolean }
  /** To the voice recorder, if the voice link is on. */
  | { type: 'cd:voice-send'; message: ToRecorder }
  | { type: 'cd:voice-status' };

export type VoiceStatusResponse = { connected: boolean; app?: string };

export interface SettingsResponse {
  /** The optional all-sites permission (embeds images, fonts and styles from other websites). */
  allSites: boolean;
  /** The toolbar shortcut as Chrome reports it ('' when unset). */
  shortcut: string;
  /** The voice link: switched on, and whether a recorder is connected. */
  voice?: { on: boolean; connected: boolean; app?: string };
}

export type CaptureVisibleTabResponse =
  | { ok: true; dataUrl: string }
  | { ok: false; error: string };

export type FetchAssetResponse =
  | { ok: true; dataUrl: string; bytes: number; mime: string }
  | { ok: false; error: string };

export type PingResponse = { ok: true; open: boolean };

/** The content script's source, built into exported files. */
export type RuntimeResponse = { ok: true; source: string } | { ok: false; error: string };

export const CONTENT_SCRIPT_FILE = 'content.js';
