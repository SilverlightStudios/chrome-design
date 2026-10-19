/**
 * Messages exchanged between extension contexts. Page content never leaves the browser, except
 * a walkthrough sent to the reviewer's own voice recorder over the voice link (on this computer).
 */
import type { WtEvent, WtFrameReason, WtPoint, WtStroke } from '../walkthrough/model';
import type { ToRecorder } from '../walkthrough/protocol';

/** A walkthrough that carries on across page loads: what the service worker keeps for it. */
export interface WtSessionInfo {
  session: {
    id: string;
    origin: 'recorder' | 'extension';
    app?: string;
    audioStartedAtMs?: number;
  };
  startedAtMs: number;
  pinCount: number;
  /** Page details where it started. */
  context: Record<string, string>;
  startPage: { url: string; title: string };
}

/** A picture as kept between pages (no pixels analysis; that's redone on Stop). */
export interface WtSyncedPicture {
  key: string;
  reason: WtFrameReason;
  t: number;
  takenAt: number;
  strokeIndex?: number;
  scroll: WtPoint;
  viewport: { width: number; height: number };
  url: string;
  dataUrl: string;
  width: number;
  height: number;
  scale: number;
  screen?: string;
}

/** One page's part of a walkthrough (stroke indexes are the page's own). */
export interface WtPageData {
  pageId: string;
  strokes: WtStroke[];
  events: WtEvent[];
  cursor: [number, number, number][];
  scrolls: [number, number, number][];
  contextChanges: { t: number; key: string; value: string }[];
  pictures: WtSyncedPicture[];
}

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
  /** The tab loaded a new page during a walkthrough: carry on here. */
  | { type: 'cd:walkthrough'; action: 'resume'; info: WtSessionInfo }
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
  | { type: 'cd:voice-status' }
  /** Walkthroughs across page loads (src/background/walkthroughs.ts). */
  | { type: 'cd:wt-begin'; info: WtSessionInfo }
  | {
      type: 'cd:wt-sync';
      pinCount: number;
      page: Omit<WtPageData, 'cursor' | 'pictures'> & {
        cursorFrom: number;
        cursor: [number, number, number][];
        pictures: WtSyncedPicture[];
      };
    }
  | { type: 'cd:wt-collect'; pageId: string }
  | { type: 'cd:wt-end' }
  | { type: 'cd:wt-active' };

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
