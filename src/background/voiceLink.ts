import { arrayBufferToBase64 } from '../shared/base64';
import type { VoiceStatusResponse, WtBundleRequest } from '../shared/messages';
import { APP_NAME, APP_VERSION } from '../shared/model';
import {
  type FromRecorder,
  type ToRecorder,
  VOICE_HOST,
  VOICE_PROTOCOL,
} from '../walkthrough/protocol';
import { restrictedReason, sendToTab } from './inject';
import { bundleFor } from './walkthroughFiles';
import { stopAfterResume } from './walkthroughs';

/**
 * The voice link: a native messaging port to the bridge (bridge/host.mjs), which relays to the
 * reviewer's voice recorder. Off unless turned on in Settings (it needs the optional
 * `nativeMessaging` permission). While the port is open Chrome keeps this worker running.
 *
 * Recorder says recording.start → the focused window's tab starts a walkthrough (when Chrome
 * Design can run there: it's open on that tab, or "Allow other websites" is on); recording.stop
 * → that tab stops and sends the walkthrough back through here.
 */

export const VOICE_ENABLED_KEY = 'voice:enabled';
export const VOICE_STATUS_KEY = 'voice:status';

export type VoiceLinkState = 'off' | 'connecting' | 'connected' | 'no-bridge' | 'error';
export interface VoiceLinkStatus {
  state: VoiceLinkState;
  /** The recorder on the other end, once it said hello. */
  app?: string;
  error?: string;
}

const NATIVE = { permissions: ['nativeMessaging'] } as chrome.permissions.Permissions;

let port: chrome.runtime.Port | null = null;
let status: VoiceLinkStatus = { state: 'off' };
let retry = 0;
/** Which tab each recording session follows. */
const sessions = new Map<string, number>();

function setStatus(next: VoiceLinkStatus): void {
  status = next;
  void chrome.storage.session?.set({ [VOICE_STATUS_KEY]: next }).catch(() => undefined);
}

/** For Settings: is the link switched on (setting + permission), and is a recorder there. */
export async function voiceSetting(): Promise<{ on: boolean; connected: boolean; app?: string }> {
  return { on: await wanted(), ...voiceStatus() };
}

export function voiceStatus(): VoiceStatusResponse {
  return {
    connected: status.state === 'connected',
    ...(status.app ? { app: status.app } : {}),
  };
}

async function wanted(): Promise<boolean> {
  const [stored, granted] = await Promise.all([
    chrome.storage.local.get(VOICE_ENABLED_KEY).catch(() => ({}) as Record<string, unknown>),
    chrome.permissions.contains(NATIVE).catch(() => false),
  ]);
  return granted && stored[VOICE_ENABLED_KEY] === true;
}

export function postToRecorder(message: ToRecorder): boolean {
  if (!port) return false;
  try {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- a runtime port, not a window
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

function disconnect(state: VoiceLinkState = 'off', error?: string): void {
  const p = port;
  port = null;
  try {
    p?.disconnect();
  } catch {
    // already gone
  }
  setStatus({ state, ...(error ? { error } : {}) });
}

/** Connect (or disconnect) to match the setting. Safe to call any time. */
export async function syncVoiceLink(): Promise<void> {
  if (!(await wanted())) {
    if (port || status.state !== 'off') disconnect('off');
    return;
  }
  if (port || typeof chrome.runtime.connectNative !== 'function') return;
  setStatus({ state: 'connecting' });
  let next: chrome.runtime.Port;
  try {
    next = chrome.runtime.connectNative(VOICE_HOST);
  } catch (error) {
    setStatus({ state: 'error', error: String(error) });
    return;
  }
  port = next;
  next.onMessage.addListener((message: FromRecorder) => void onRecorderMessage(message));
  next.onDisconnect.addListener(() => {
    if (port !== next) return;
    port = null;
    const text = chrome.runtime.lastError?.message ?? '';
    const missing = /not found|forbidden|access to the specified native messaging host/i.test(text);
    setStatus(missing ? { state: 'no-bridge', error: text } : { state: 'error', error: text });
    // The bridge stays up while Chrome keeps the port; if it went away, try again a few times.
    if (!missing && retry < 5) {
      retry++;
      setTimeout(() => void syncVoiceLink(), 2000 * retry);
    }
  });
  postToRecorder({
    type: 'hello',
    extension: APP_NAME,
    version: APP_VERSION,
    protocol: VOICE_PROTOCOL,
  });
}

async function focusedTab(): Promise<
  { tab: chrome.tabs.Tab; focused: boolean } | { error: string }
> {
  const win = await chrome.windows
    .getLastFocused({ populate: true, windowTypes: ['normal'] })
    .catch(() => null);
  const tab = win?.tabs?.find((t) => t.active);
  if (!win || !tab) return { error: 'No Chrome window is open.' };
  return { tab, focused: win.focused };
}

async function onRecorderMessage(message: FromRecorder): Promise<void> {
  switch (message?.type) {
    case 'hello':
      retry = 0;
      setStatus({ state: 'connected', app: message.app });
      return;
    case 'bridge':
      if (!message.recorder) setStatus({ state: 'connecting' });
      return;
    case 'recording.start': {
      const found = await focusedTab();
      if ('error' in found) {
        postToRecorder({
          type: 'walkthrough.unavailable',
          session: message.session,
          reason: found.error,
        });
        return;
      }
      if (message.onlyIfChromeInFront !== false && !found.focused) {
        postToRecorder({
          type: 'walkthrough.unavailable',
          session: message.session,
          reason: 'Chrome isn’t in front.',
        });
        return;
      }
      const fileAccess = await chrome.extension.isAllowedFileSchemeAccess().catch(() => false);
      const blocked = restrictedReason(found.tab.url ?? found.tab.pendingUrl, fileAccess);
      if (blocked) {
        postToRecorder({
          type: 'walkthrough.unavailable',
          session: message.session,
          reason: blocked,
        });
        return;
      }
      const result = await sendToTab(found.tab, {
        type: 'cd:walkthrough',
        action: 'start',
        session: message.session,
        audioStartedAtMs: message.startedAt,
        ...(message.app || status.app ? { app: message.app ?? status.app } : {}),
      });
      if (!result.ok) {
        postToRecorder({
          type: 'walkthrough.unavailable',
          session: message.session,
          reason: result.reason,
        });
        return;
      }
      if (found.tab.id !== undefined) sessions.set(message.session, found.tab.id);
      return;
    }
    case 'recording.stop':
    case 'recording.cancel':
    case 'cue':
    case 'transcript': {
      const tabId = sessions.get(message.session);
      if (tabId === undefined) {
        if (message.type === 'recording.stop')
          postToRecorder({
            type: 'walkthrough.unavailable',
            session: message.session,
            reason: 'Chrome Design isn’t following this recording.',
          });
        return;
      }
      const forward =
        message.type === 'recording.stop'
          ? ({ type: 'cd:walkthrough', action: 'stop', session: message.session } as const)
          : message.type === 'recording.cancel'
            ? ({ type: 'cd:walkthrough', action: 'cancel', session: message.session } as const)
            : message.type === 'cue'
              ? ({
                  type: 'cd:walkthrough',
                  action: 'cue',
                  session: message.session,
                  at: message.at,
                  word: message.word,
                } as const)
              : ({
                  type: 'cd:walkthrough',
                  action: 'transcript',
                  session: message.session,
                  transcript: message.transcript,
                  ...(message.app ? { app: message.app } : {}),
                } as const);
      await chrome.tabs.sendMessage(tabId, forward).catch(async () => {
        // Between pages of a walkthrough: stop once the next page has it.
        if (message.type === 'recording.stop' && (await stopAfterResume(tabId))) return;
        postToRecorder({
          type: 'walkthrough.unavailable',
          session: message.session,
          reason: 'The tab was closed or reloaded.',
        });
      });
      if (message.type === 'recording.cancel') sessions.delete(message.session);
      return;
    }
    case 'status': {
      const ids = [...sessions.keys()];
      postToRecorder({
        type: 'status',
        recording: ids.length > 0,
        ...(ids.length ? { session: ids.at(-1)! } : {}),
      });
      return;
    }
    default:
      return;
  }
}

const MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  md: 'text/markdown',
  json: 'application/json',
};

/**
 * A finished walkthrough to the recorder: the bundle (the walkthrough and summary), then each
 * picture, then done. The bridge writes them to the walkthrough's folder.
 */
export async function deliverWalkthrough(
  request: WtBundleRequest & { update?: boolean },
): Promise<{ ok: boolean; app?: string }> {
  if (status.state !== 'connected') return { ok: false };
  const { files } = await bundleFor(request);
  const pictures = files.filter((f) => f.name !== 'summary.md' && f.name !== 'walkthrough.json');
  const { session } = request;
  const sent = postToRecorder({
    type: 'walkthrough.bundle',
    session,
    folder: request.folder,
    walkthrough: request.walkthrough,
    summary: request.summary,
    files: pictures.map((f) => f.name),
    ...(request.update ? { update: true } : {}),
  });
  if (!sent) return { ok: false };
  for (const f of pictures)
    postToRecorder({
      type: 'walkthrough.file',
      session,
      name: f.name,
      mime: MIME[f.name.split('.').at(-1) ?? ''] ?? 'application/octet-stream',
      base64: arrayBufferToBase64(f.data),
    });
  postToRecorder({ type: 'walkthrough.done', session });
  return { ok: true, ...(status.app ? { app: status.app } : {}) };
}

/** A message from a tab for the recorder. Remembers which tab a session lives in. */
export function fromTab(message: ToRecorder, tabId: number | undefined): boolean {
  if ('session' in message && tabId !== undefined) {
    if (message.type === 'walkthrough.started') sessions.set(message.session, tabId);
    // Kept after it's done: the recorder may still send the transcript for the review panel.
    if (message.type === 'walkthrough.discarded') sessions.delete(message.session);
  }
  return postToRecorder(message);
}

export function initVoiceLink(): void {
  chrome.tabs.onRemoved.addListener((tabId) => {
    for (const [session, id] of sessions) if (id === tabId) sessions.delete(session);
  });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && VOICE_ENABLED_KEY in changes) {
      retry = 0;
      void syncVoiceLink();
    }
  });
  chrome.permissions.onAdded.addListener(() => void syncVoiceLink());
  chrome.permissions.onRemoved.addListener(() => void syncVoiceLink());
  chrome.runtime.onStartup.addListener(() => void syncVoiceLink());
  void syncVoiceLink();
}
