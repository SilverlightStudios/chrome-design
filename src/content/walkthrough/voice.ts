import type { ToRecorder } from '../../walkthrough/protocol';
import { parseTranscript } from '../../walkthrough/transcript';
import { askBackground } from '../ext';
import type { EditorStore } from '../store';
import { bundleRequest, withTranscript } from './output';
import { recorder, type WalkthroughResult, type WalkthroughSession } from './recorder';

/**
 * The page's side of the voice link: tells the voice recorder (through the service worker)
 * when a walkthrough starts and stops here, and sends it the finished walkthrough. Without the
 * link (or the extension) every call is a no-op and the walkthrough stays in Chrome.
 */

export function sendToRecorder(message: ToRecorder): Promise<{ ok: boolean } | null> {
  return askBackground('cd:voice-send', { message });
}

const page = () => ({ url: location.href, title: document.title });

/** Start following along and say so (the recorder may start recording too). */
export function startWalkthrough(
  env: { host: HTMLElement; store: EditorStore },
  session?: Partial<WalkthroughSession>,
): WalkthroughSession | null {
  const started = recorder.start(env, session);
  if (started)
    void sendToRecorder({
      type: 'walkthrough.started',
      session: started.id,
      startedAt: recorder.getState().startedAtMs,
      origin: started.origin,
      page: page(),
    });
  return started;
}

/** Send a finished walkthrough to the recorder (the service worker sends its files). */
export async function deliver(
  result: WalkthroughResult,
  session: string,
  update = false,
): Promise<boolean> {
  const request = bundleRequest(result);
  if (!request) return false;
  const sent = await askBackground('cd:wt-deliver', { ...request, session, update });
  if (!sent?.ok) return false;
  if (recorder.getState().result === result)
    recorder.update({ ...result, delivered: sent.app ? { app: sent.app } : {} });
  return true;
}

let wired = false;

/** Once per page: every stop is reported, and the walkthrough goes to the recorder. */
export function wireVoiceLink(): void {
  if (wired) return;
  wired = true;
  recorder.onFinish((result, session) => {
    if (!session) return;
    void sendToRecorder({
      type: 'walkthrough.stopped',
      session: session.id,
      stoppedAt: Date.now(),
      origin: stopOrigin ?? 'extension',
    }).then(() => deliver(result, session.id));
    stopOrigin = null;
  });
}

let stopOrigin: 'recorder' | 'extension' | null = null;

/** The recorder asked to stop (so the stop is reported as its own). */
export function stopFromRecorder(): Promise<WalkthroughResult | null> {
  stopOrigin = 'recorder';
  return recorder.stop();
}

/** A transcript sent by the recorder: shown in Send to AI and sent with the walkthrough. */
export function applyRecorderTranscript(
  session: string,
  transcript: unknown,
  app?: string,
): boolean {
  const result = recorder.getState().result;
  if (!result || result.walkthrough.session?.id !== session) return false;
  const text = typeof transcript === 'string' ? transcript : JSON.stringify(transcript);
  const parsed = parseTranscript(text);
  if (!parsed) return false;
  const next = withTranscript(result, parsed, app ? { source: app } : {});
  recorder.update(next);
  // The picture and summary now carry the words: send them back to the recorder too.
  void deliver(next, session, true);
  return true;
}
