/** Messages exchanged between extension contexts. Page content never leaves the browser. */

export type ToContentMessage =
  | { type: 'cd:toggle' }
  | { type: 'cd:open' }
  | { type: 'cd:close' }
  | { type: 'cd:export' }
  | { type: 'cd:ping' };

export type ToBackgroundMessage =
  | { type: 'cd:capture-visible-tab' }
  | { type: 'cd:fetch-asset'; url: string; maxBytes: number }
  | { type: 'cd:open-options' }
  | { type: 'cd:get-settings' }
  | { type: 'cd:get-runtime' }
  | { type: 'cd:resize-window'; width: number }
  | { type: 'cd:state'; open: boolean };

export interface SettingsResponse {
  /** The optional all-sites permission (embeds images, fonts and styles from other websites). */
  allSites: boolean;
  /** The toolbar shortcut as Chrome reports it ('' when unset). */
  shortcut: string;
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
