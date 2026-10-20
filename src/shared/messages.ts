/**
 * Messages exchanged between extension contexts. Page content never leaves the browser, except
 * a walkthrough sent to the reviewer's own voice recorder over the voice link (on this computer).
 */
import type { Walkthrough, WtEvent, WtFrameReason, WtPoint, WtStroke } from '../walkthrough/model';
import type { ToRecorder } from '../walkthrough/protocol';
import type { LookWire } from '../walkthrough/scene';
import type { FullPageShot } from './model';

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

/** A walkthrough picture's facts (its pixels are kept by the service worker, by `key`). */
export interface WtPicture {
  key: string;
  reason: WtFrameReason;
  t: number;
  takenAt: number;
  strokeIndex?: number;
  scroll: WtPoint;
  viewport: { width: number; height: number };
  url: string;
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
  pictures: WtPicture[];
}

/** A picture the service worker has just taken and kept (background/walkthroughFiles.ts). */
export interface WtPictureTaken {
  width: number;
  height: number;
  look: LookWire;
}

/** A finished walkthrough, for the service worker to draw (it has the pictures). */
export interface WtBundleRequest {
  session: string;
  walkthrough: Walkthrough;
  summary: string;
  folder: string;
  /** Each frame's file → the key its picture was kept under. */
  shots: Record<string, string>;
}

/** The contact sheet, as data URLs. */
export interface WtSheet {
  jpeg: string;
  png: string;
  width: number;
  height: number;
}

export interface WtFile {
  name: string;
  base64: string;
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

/**
 * Everything a tab can ask the service worker: what it sends (`body`) and what comes back
 * (`reply`). Content code asks with `askBackground` (content/ext.ts); the worker answers from
 * one handler per request (background/service-worker.ts).
 */
export interface BackgroundApi {
  /** Wait for a turn to take a picture (background/capture.ts), then take it. */
  'cd:capture-turn': { body: object; reply: null };
  'cd:capture-visible-tab': { body: { maxWidth: number }; reply: CaptureVisibleTabResponse };
  /** The whole page, a screen at a time, stitched in the service worker. */
  'cd:full-page-start': { body: { width: number; height: number; scale: number }; reply: null };
  'cd:full-page-screen': {
    body: { y: number; view: { width: number; height: number; innerWidth: number } };
    reply: { ok: boolean };
  };
  'cd:full-page-finish': { body: { height: number }; reply: FullPageShot | null };
  'cd:fetch-asset': { body: { url: string; maxBytes: number }; reply: FetchAssetResponse };
  'cd:open-options': { body: object; reply: { ok: boolean } };
  'cd:get-settings': { body: object; reply: SettingsResponse };
  'cd:get-runtime': { body: object; reply: RuntimeResponse };
  'cd:resize-window': { body: { width: number }; reply: { ok: boolean } };
  /** The toolbar opened or closed (the icon's badge follows). */
  'cd:state': { body: { open: boolean }; reply: null };
  /** To the voice recorder, if the voice link is on. */
  'cd:voice-send': { body: { message: ToRecorder }; reply: { ok: boolean } };
  /** Walkthroughs across page loads (src/background/walkthroughs.ts). */
  'cd:wt-begin': { body: { info: WtSessionInfo }; reply: null };
  'cd:wt-sync': {
    body: {
      pinCount: number;
      page: Omit<WtPageData, 'cursor'> & { cursorFrom: number; cursor: [number, number, number][] };
    };
    reply: null;
  };
  'cd:wt-collect': { body: { pageId: string }; reply: { pages: WtPageData[] } };
  'cd:wt-end': { body: object; reply: null };
  'cd:wt-active': { body: object; reply: WtSessionInfo | null };
  /** A walkthrough's pictures and files (background/walkthroughFiles.ts). */
  'cd:wt-picture': { body: { session: string; key: string }; reply: WtPictureTaken | null };
  'cd:wt-crop': {
    body: Pick<WtBundleRequest, 'session' | 'shots' | 'walkthrough'>;
    reply: { walkthrough: Walkthrough };
  };
  'cd:wt-sheet': { body: WtBundleRequest; reply: WtSheet };
  'cd:wt-files': { body: WtBundleRequest; reply: WtFile[] };
  /** To the voice recorder: the bundle, then each file, then done. */
  'cd:wt-deliver': {
    body: WtBundleRequest & { update?: boolean };
    reply: { ok: boolean; app?: string };
  };
  'cd:wt-discard': { body: { session: string }; reply: null };
}

export type BackgroundRequest<K extends keyof BackgroundApi = keyof BackgroundApi> = {
  [T in K]: { type: T } & BackgroundApi[T]['body'];
}[K];

export type BackgroundReply<K extends keyof BackgroundApi> = BackgroundApi[K]['reply'];

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
  | { ok: true; dataUrl: string; width: number; height: number }
  | { ok: false; error: string };

export type FetchAssetResponse =
  | { ok: true; dataUrl: string; bytes: number; mime: string }
  | { ok: false; error: string };

export type PingResponse = { ok: true; open: boolean };

/** The content script's source, built into exported files. */
export type RuntimeResponse = { ok: true; source: string } | { ok: false; error: string };

export const CONTENT_SCRIPT_FILE = 'content.js';
