import type { WtSessionInfo } from '../../shared/messages';
import type { WtPoint } from '../../walkthrough/model';
import { askBackground, hasExtensionRuntime } from '../ext';
import { Store, useStore } from '../state';
import type { EditorStore } from '../store';
import { Activity } from './activity';
import { assemble, type WalkthroughResult, type WalkthroughSession } from './assemble';
import { flag, syncFlags } from './flags';
import { Marks } from './marks';
import { releasePictures, withCrops } from './output';
import { pageDetails } from './pageContext';
import { PageSync, sessionInfo, withEarlierPages } from './pageSync';
import { PageWatch } from './pageWatch';
import { Pictures } from './pictures';
import { newId, Tape } from './tape';

export type { WalkthroughResult, WalkthroughSession } from './assemble';

/**
 * Walkthrough recording: while the reviewer talks (to a voice recorder, or not), the page
 * stays usable and Chrome Design notes what they do, on one clock:
 *
 *   ⇧ + move   laser pointer (a fading red trail)
 *   ⇧ + drag   red ink (circles, underlines, arrows are recognised), fades 1.5 s after the pen lifts
 *   ⇧ + click  a numbered pin
 *   clicks, scrolling, typing (never what was typed), page changes and the pointer itself
 *
 * On a touch screen the recording bar's Draw button does what ⇧ does. Pictures of the screen
 * are taken at those moments (extension only), and on Stop it all becomes a walkthrough (see
 * src/walkthrough/model.ts). The parts:
 *
 *   tape.ts       what's recorded, on one clock
 *   activity.ts   the reviewer's pointer, clicks, scrolling, typing and keys
 *   marks.ts      ink, pins and the laser
 *   pageWatch.ts  the page changing by itself (toasts, dialogs, new routes)
 *   pictures.ts   pictures of the screen, and which are kept
 *   pageSync.ts   carrying on when a link loads another page
 *   flags.ts      ⚑: a picture and a comment
 *   assemble.ts   the walkthrough, on Stop (then crop.ts crops its pictures)
 */

export interface LiveStroke {
  id: number;
  points: WtPoint[];
  fading: boolean;
}

export type RecorderPhase = 'idle' | 'recording' | 'finishing' | 'ready';

/** What the page shows of a walkthrough (overlay/WalkthroughLayer.tsx, the recording bar). */
export interface RecorderState {
  phase: RecorderPhase;
  startedAtMs: number;
  /** Draw without ⇧ (touch screens; also a mouse). */
  drawing: boolean;
  shift: boolean;
  ink: LiveStroke[];
  /** The laser's points `[x, y, epoch ms]`, page space. */
  laser: [number, number, number][];
  pins: { n: number; x: number; y: number }[];
  ripples: { id: number; x: number; y: number }[];
  session: WalkthroughSession | null;
  result: WalkthroughResult | null;
  /** Pictures can be taken here (the extension; not the demo page or a handoff file). */
  pictures: boolean;
}

interface Env {
  host: HTMLElement;
  store: EditorStore;
}

/** One recording's parts: a new set on each start (or page it carries on to). */
interface Run {
  tape: Tape;
  pictures: Pictures;
  marks: Marks;
  activity: Activity;
  watch: PageWatch;
  sync: PageSync | null;
  startPage: { url: string; title: string };
}

type FinishHook = (result: WalkthroughResult, session: WalkthroughSession | null) => void;

const LIVE_CLEARED = { ink: [], laser: [], pins: [], ripples: [], drawing: false, shift: false };

export class WalkthroughRecorder extends Store<RecorderState> {
  private env: Env | null = null;
  private run: Run | null = null;
  private finishHooks = new Set<FinishHook>();

  constructor() {
    super({
      phase: 'idle',
      startedAtMs: 0,
      session: null,
      result: null,
      pictures: false,
      ...LIVE_CLEARED,
    });
  }

  get recording(): boolean {
    return this.state.phase === 'recording';
  }

  /** Runs after every stop (from the bar, ⌥⇧W or the voice recorder). */
  onFinish(hook: FinishHook): () => void {
    this.finishHooks.add(hook);
    return () => this.finishHooks.delete(hook);
  }

  setDrawing(on: boolean): void {
    this.set({ drawing: on });
  }

  /** Start following along. */
  start(env: Env, session?: Partial<WalkthroughSession>): WalkthroughSession | null {
    if (this.run || this.state.phase === 'finishing') return null;
    const full: WalkthroughSession = {
      id: session?.id ?? newId(),
      origin: session?.origin ?? 'extension',
      ...(session?.app ? { app: session.app } : {}),
      ...(session?.audioStartedAtMs !== undefined
        ? { audioStartedAtMs: session.audioStartedAtMs }
        : {}),
    };
    const run = this.begin(env, new Tape(Date.now(), pageDetails()), full, {
      url: location.href,
      title: document.title,
    });
    run.tape.noteScroll(0);
    run.pictures.request('start', { t: 0 });
    if (hasExtensionRuntime())
      void askBackground('cd:wt-begin', { info: sessionInfo(run.tape, full, run.startPage) });
    return full;
  }

  /**
   * The tab loaded another page during a walkthrough: carry on here, on the same clock (the
   * earlier pages wait in the service worker until Stop).
   */
  resume(env: Env, info: WtSessionInfo): void {
    if (this.run || this.state.phase === 'finishing') return;
    const tape = new Tape(info.startedAtMs, info.context, info.pinCount);
    const run = this.begin(env, tape, info.session, info.startPage);
    const t = tape.now();
    tape.noteScroll(t);
    tape.events.push({ kind: 'navigate', t, url: location.href, title: document.title });
    tape.noteRoute(t);
    run.pictures.request('navigate', { key: `nav-${t}`, t, delay: 600 });
  }

  /**
   * The voice recorder started while a walkthrough was already going: from now on it belongs to
   * that recording (its clock lines the words up).
   */
  adopt(session: WalkthroughSession): void {
    if (this.recording) this.set({ session });
  }

  private begin(
    env: Env,
    tape: Tape,
    session: WalkthroughSession,
    startPage: Run['startPage'],
  ): Run {
    this.env = env;
    // The last walkthrough stays until this one is finished (or this one is cancelled).
    this.set({
      phase: 'recording',
      startedAtMs: tape.startedAtMs,
      session,
      pictures: hasExtensionRuntime(),
      ...LIVE_CLEARED,
    });
    // The page is the reviewer's to use: no tool, no panel, nothing selected.
    env.store.set({
      tool: 'browse',
      panel: 'none',
      selectedIds: [],
      draft: null,
      hoverEl: null,
      openThreadId: null,
    });
    const recording = () => this.recording;
    const pictures = new Pictures(tape, env.host, hasExtensionRuntime() ? session.id : null);
    const marks = new Marks(tape, pictures, this);
    const sync = hasExtensionRuntime() ? new PageSync(tape, pictures) : null;
    const watch = new PageWatch(tape, pictures, recording);
    const activity = new Activity(tape, pictures, marks, this, {
      stop: () => void this.stop(),
      flag: () => this.flag(),
      sync: () => sync?.send(),
      mutations: () => watch.mutations,
      recording,
    });
    this.run = { tape, pictures, marks, activity, watch, sync, startPage };
    return this.run;
  }

  /** Stop listening and forget this run. */
  private end(): void {
    const run = this.run;
    if (!run) return;
    this.run = null;
    run.activity.dispose();
    run.watch.dispose();
    run.sync?.dispose();
    run.marks.dispose();
    run.pictures.dispose();
  }

  /** Stop and keep nothing (the last finished walkthrough stays). */
  cancel(): void {
    if (!this.recording) return;
    if (hasExtensionRuntime()) void askBackground('cd:wt-end');
    this.end();
    this.set({ phase: this.state.result ? 'ready' : 'idle', session: null, ...LIVE_CLEARED });
  }

  /** Forget a finished walkthrough. */
  discard(): void {
    const { phase, result } = this.state;
    if (phase !== 'ready' || !result) return;
    releasePictures(result);
    this.set({ phase: 'idle', session: null, result: null });
  }

  /** A spoken cue from the voice recorder (epoch ms): worth a picture. */
  cue(at: number, word: string): void {
    const run = this.recording ? this.run : null;
    if (!run) return;
    const t = Math.max(0, at - run.tape.startedAtMs);
    run.tape.events.push({ kind: 'cue', t, word });
    run.pictures.request('cue', { t });
  }

  /** "Look here": a picture now, and a comment on the page where the pointer is. */
  flag(): void {
    const run = this.recording ? this.run : null;
    if (run) flag(run.tape, run.pictures, this.env?.store ?? null);
  }

  /** Stop following and put the walkthrough together. */
  async stop(): Promise<WalkthroughResult | null> {
    const run = this.recording ? this.run : null;
    if (!run) return this.state.result;
    const { tape, pictures } = run;
    this.set({ phase: 'finishing' });
    run.marks.endInk();
    run.marks.endLaser();
    run.activity.dispose();
    run.watch.dispose();
    const durationMs = tape.now();
    if (durationMs - pictures.lastTaken > 2500) pictures.request('end', { t: durationMs });
    await pictures.drain();
    run.sync?.dispose();
    if (hasExtensionRuntime()) {
      await withEarlierPages(tape, pictures);
      void askBackground('cd:wt-end');
    }
    // Each picture cropped to where its moment happened (Scrawl's auto-crop).
    const result = await withCrops(
      assemble(tape, pictures.candidates, this.state.session, run.startPage, durationMs),
    );
    this.end();
    this.set({ phase: 'ready', result, ...LIVE_CLEARED });
    this.env?.store.set({ tool: 'select', panel: 'walkthrough', panelBack: 'more' });
    for (const hook of this.finishHooks) hook(result, this.state.session);
    return result;
  }

  /** Replace the result (a transcript was added, or it was sent). */
  update(result: WalkthroughResult): void {
    this.set({ result });
    if (this.env) syncFlags(this.env.store, result.walkthrough);
  }
}

/** One recorder per page: it outlives the toolbar being closed and opened again. */
export const recorder = new WalkthroughRecorder();

/** A slice of the recorder's state (see useStore). */
export function useRecorder<T>(selector: (state: RecorderState) => T): T {
  return useStore(recorder, selector);
}
