import { buildAnchor, uniqueSelector } from '../../capture/anchor';
import { createId, nowIso } from '../../shared/ids';
import type { WtPageData, WtSessionInfo, WtSyncedPicture } from '../../shared/messages';
import { APP_NAME, APP_VERSION, type CommentThread, isComment } from '../../shared/model';
import {
  formatClock,
  INK_HOLD_MS,
  LASER_MS,
  MARK_GAP_MS,
  MAX_MARK_STROKES,
  WALKTHROUGH_KIND,
  WALKTHROUGH_VERSION,
  type Walkthrough,
  type WtEvent,
  type WtFrame,
  type WtFrameReason,
  type WtPoint,
  type WtStroke,
  type WtTarget,
} from '../../walkthrough/model';
import { type Look, look, regionDiff, SCENE_CHANGE, sceneDiff } from '../../walkthrough/scene';
import { marksOf, shapeOf, strokeBounds } from '../../walkthrough/shapes';
import { buildSummary, timeline } from '../../walkthrough/summary';
import type { ParsedTranscript } from '../../walkthrough/transcript';
import { friendlyLabel } from '../describe';
import { elementsInRect, isExtensionNode, isTypingEvent, pickElement } from '../dom';
import { captureVisibleTab, hasExtensionRuntime, sendToBackground } from '../ext';
import { type EditorStore, nextCommentNumber } from '../store';
import { applyAutocrop } from './crop';
import { appearedLabel, pageDetails, screenName } from './pageContext';

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
 * are taken at those moments (extension only: Chrome allows two a second), and on Stop it all
 * becomes a walkthrough (see src/walkthrough/model.ts).
 */

export interface WalkthroughSession {
  id: string;
  /** Who started it: the voice recorder (over the voice link) or the reviewer, in Chrome. */
  origin: 'recorder' | 'extension';
  app?: string;
  audioStartedAtMs?: number;
}

export interface LiveStroke {
  id: number;
  points: WtPoint[];
  fading: boolean;
}

export interface LivePin {
  n: number;
  x: number;
  y: number;
}

export interface LiveRipple {
  id: number;
  x: number;
  y: number;
}

/** A picture taken while recording (before the best ones are picked). */
export interface Candidate {
  key: string;
  reason: WtFrameReason;
  t: number;
  takenAt: number;
  /** The ink, pin or laser stroke it was taken for. */
  strokeIndex?: number;
  scroll: WtPoint;
  viewport: { width: number; height: number };
  url: string;
  dataUrl: string;
  width: number;
  height: number;
  scale: number;
  /** For "is this new?" (scene.ts). */
  look?: Look;
  /** What screen the page was on. */
  screen?: string;
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

export type RecorderPhase = 'idle' | 'recording' | 'finishing' | 'ready';

export interface RecorderState {
  phase: RecorderPhase;
  startedAtMs: number;
  /** Draw without ⇧ (touch screens; also a mouse). */
  drawing: boolean;
  shift: boolean;
  ink: LiveStroke[];
  /** The laser's points `[x, y, epoch ms]`, page space. */
  laser: [number, number, number][];
  pins: LivePin[];
  ripples: LiveRipple[];
  session: WalkthroughSession | null;
  result: WalkthroughResult | null;
  /** Pictures can be taken here (the extension; not the demo page or a handoff file). */
  pictures: boolean;
}

interface Env {
  host: HTMLElement;
  store: EditorStore;
}

interface Pending {
  key: string;
  reason: WtFrameReason;
  t: number;
  due: number;
  strokeIndex?: number;
  /** A page change: where it happened, and its event (dropped with the picture if not new). */
  region?: [number, number, number, number];
  event?: WtEvent;
}

/** Chrome allows two tab pictures a second. */
const CAPTURE_GAP_MS = 560;
const MAX_CANDIDATES = 60;
export const MAX_FRAMES = 20;
const CURSOR_EVERY_MS = 66;
const MAX_CURSOR = 30_000;
const PIN_MOVE_PX = 6;

const PRIORITY: Record<WtFrameReason, number> = {
  // A flag is a deliberate "picture this": never dropped.
  flag: 10,
  start: 9,
  mark: 8,
  pin: 8,
  laser: 8,
  click: 7,
  navigate: 6,
  result: 5,
  cue: 5,
  scroll: 4,
  end: 4,
  change: 5,
  idle: 1,
};

const INTERACTIVE =
  'a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="option"]';

/** The page element at a page-space point, as a person would name it. */
export function targetAt(x: number, y: number): WtTarget | undefined {
  const el = pickElement(x - window.scrollX, y - window.scrollY);
  return el ? targetOf(el) : undefined;
}

const FIELD = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';

const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
const short = (t: string) => (t.length > 30 ? `${t.slice(0, 29).trimEnd()}…` : t);

/**
 * A form field by what it's for (its label, aria-label, placeholder or name), never what's in
 * it: walkthroughs don't record what was typed.
 */
export function fieldName(el: Element): string {
  const input = el as HTMLInputElement;
  const fromLabel = Array.from(input.labels ?? [])
    .map((label) => {
      // The label's own words, without the field (and its value) inside it.
      const copy = label.cloneNode(true) as Element;
      for (const f of Array.from(copy.querySelectorAll(FIELD))) f.remove();
      return clean(copy.textContent);
    })
    .find(Boolean);
  const words =
    clean(el.getAttribute('aria-label')) ||
    fromLabel ||
    clean(el.getAttribute('placeholder')) ||
    clean(el.getAttribute('name')) ||
    clean(el.getAttribute('title'));
  const kind =
    el.localName === 'select' ? 'Dropdown' : el.localName === 'textarea' ? 'Text box' : 'Field';
  const type = el.localName === 'input' ? input.type : '';
  const noun =
    type === 'checkbox'
      ? 'Checkbox'
      : type === 'radio'
        ? 'Option'
        : type === 'search'
          ? 'Search field'
          : kind;
  if (['button', 'submit', 'reset'].includes(type)) return friendlyLabel(el);
  return words ? `${noun} “${short(words)}”` : noun;
}

export function targetOf(node: Element): WtTarget | undefined {
  if (node === document.documentElement || node === document.body) return undefined;
  const el = node.closest(INTERACTIVE) ?? node;
  const field = el.closest(FIELD);
  let selector: string | undefined;
  try {
    selector = uniqueSelector(field ?? el);
  } catch {
    // detached or odd element: the label is enough
  }
  return {
    label: field ? fieldName(field) : friendlyLabel(el),
    ...(selector ? { selector } : {}),
  };
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function shrink(
  dataUrl: string,
  // Full resolution up to 2560 px (Scrawl decodes Screen keyframes at 2560): crops stay sharp.
  maxWidth = 2560,
): Promise<{ dataUrl: string; width: number; height: number; look?: Look }> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  // A small copy for telling whether the screen changed (Scrawl's thumbnail and grid).
  let seen: Look | undefined;
  const small = document.createElement('canvas');
  small.width = 256;
  small.height = Math.max(1, Math.round((256 * img.naturalHeight) / img.naturalWidth));
  const sctx = small.getContext('2d', { willReadFrequently: true });
  if (sctx) {
    sctx.drawImage(img, 0, 0, small.width, small.height);
    seen = look(sctx.getImageData(0, 0, small.width, small.height).data, small.width, small.height);
  }
  const scale = Math.min(1, maxWidth / img.naturalWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx)
    return {
      dataUrl,
      width: img.naturalWidth,
      height: img.naturalHeight,
      ...(seen ? { look: seen } : {}),
    };
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return {
    dataUrl: canvas.toDataURL('image/jpeg', 0.86),
    width: canvas.width,
    height: canvas.height,
    ...(seen ? { look: seen } : {}),
  };
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `wt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const p2 = (n: number) => String(n).padStart(2, '0');

function folderName(startedAtMs: number): string {
  const d = new Date(startedAtMs);
  const p = p2;
  const host = (location.hostname || 'page').replace(/^www\./, '').replace(/[^a-z0-9.-]+/gi, '-');
  return `walkthrough-${host}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Keep the most telling pictures (≤ MAX_FRAMES), in time order. */
export function pickFrames<T extends { reason: WtFrameReason; t: number }>(
  candidates: readonly T[],
  max = MAX_FRAMES,
): T[] {
  const list = [...candidates].toSorted((a, b) => a.t - b.t);
  while (list.length > max) {
    let drop = -1;
    let worst = Infinity;
    for (let i = 0; i < list.length; i++) {
      const c = list[i]!;
      // Lower priority goes first; among equals, the one crowded closest by a neighbour.
      const gap = Math.min(
        i > 0 ? c.t - list[i - 1]!.t : Infinity,
        i < list.length - 1 ? list[i + 1]!.t - c.t : Infinity,
      );
      const score = PRIORITY[c.reason] * 1e7 + Math.min(gap, 9e6);
      if (score < worst) {
        worst = score;
        drop = i;
      }
    }
    list.splice(drop, 1);
  }
  return list;
}

export class WalkthroughRecorder {
  private state: RecorderState = {
    phase: 'idle',
    startedAtMs: 0,
    drawing: false,
    shift: false,
    ink: [],
    laser: [],
    pins: [],
    ripples: [],
    session: null,
    result: null,
    pictures: false,
  };
  private listeners = new Set<() => void>();
  private env: Env | null = null;
  private strokes: WtStroke[] = [];
  private events: WtEvent[] = [];
  private cursor: [number, number, number][] = [];
  private scrolls: [number, number, number][] = [];
  private context: Record<string, string> = {};
  private contextChanges: { t: number; key: string; value: string }[] = [];
  private appeared: { first: number; timer: number; els: Set<Element> } | null = null;
  /** Across page loads: where it began, and what's been handed to the service worker. */
  private startPage: { url: string; title: string } | null = null;
  private syncTimer = 0;
  private syncedCursor = 0;
  private syncedPictures = new Map<string, number>();
  private lastScrollSample = -Infinity;
  private candidates: Candidate[] = [];
  private pending = new Map<string, Pending>();
  private busy = false;
  private lastShot = 0;
  private queueTimer = 0;
  private drainWaiters: (() => void)[] = [];
  private seq = 0;
  private ink: { stroke: WtStroke; live: number; pointerId: number; start: WtPoint } | null = null;
  private laser: {
    stroke: WtStroke;
    dwell: { target: WtTarget; ms: number }[];
    lastSample: number;
  } | null = null;
  private group: { key: string; count: number; end: number } | null = null;
  private pinCount = 0;
  private fadeTimer = 0;
  private laserTimer = 0;
  private scrollRun: { el: Element; t: number; from: WtPoint; timer: number } | null = null;
  private lastFrameScroll: WtPoint = { x: 0, y: 0 };
  private lastType: { el: Element; t: number } | null = null;
  private click: {
    t: number;
    point: WtPoint;
    target?: WtTarget;
    button?: 'right' | 'middle';
    mutations: number;
  } | null = null;
  private mutations = 0;
  private observer: MutationObserver | null = null;
  private navTimer = 0;
  private idleTimer = 0;
  private resizeTimer = 0;
  private href = '';
  private lastCursorAt = -Infinity;
  private moved = false;
  private off: (() => void)[] = [];
  private finishHooks = new Set<
    (result: WalkthroughResult, session: WalkthroughSession | null) => void
  >();

  /** Runs after every stop (from the bar, ⌥⇧W or the voice recorder). */
  onFinish(
    hook: (result: WalkthroughResult, session: WalkthroughSession | null) => void,
  ): () => void {
    this.finishHooks.add(hook);
    return () => this.finishHooks.delete(hook);
  }

  /**
   * The voice recorder started while a walkthrough was already going: from now on it belongs to
   * that recording (its clock lines the words up).
   */
  adopt(session: WalkthroughSession): void {
    if (!this.recording) return;
    this.set({ session });
  }

  getState = (): RecorderState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l();
  }

  /** ms since the start. */
  private now(): number {
    return Date.now() - this.state.startedAtMs;
  }

  get recording(): boolean {
    return this.state.phase === 'recording';
  }

  setDrawing(on: boolean): void {
    this.set({ drawing: on });
  }

  /** Start following along. */
  start(env: Env, session?: Partial<WalkthroughSession>): WalkthroughSession | null {
    if (this.state.phase === 'recording' || this.state.phase === 'finishing') return null;
    this.reset();
    this.env = env;
    const full: WalkthroughSession = {
      id: session?.id ?? newId(),
      origin: session?.origin ?? 'extension',
      ...(session?.app ? { app: session.app } : {}),
      ...(session?.audioStartedAtMs !== undefined
        ? { audioStartedAtMs: session.audioStartedAtMs }
        : {}),
    };
    this.href = location.href;
    this.lastFrameScroll = { x: window.scrollX, y: window.scrollY };
    this.scrolls.push([0, Math.round(window.scrollX), Math.round(window.scrollY)]);
    this.context = pageDetails();
    // The last walkthrough stays until this one is finished (or this one is cancelled).
    this.set({
      phase: 'recording',
      startedAtMs: Date.now(),
      session: full,
      pictures: hasExtensionRuntime(),
      drawing: false,
      shift: false,
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
    this.listen();
    this.requestFrame('start', { t: 0 });
    this.startPage = { url: location.href, title: document.title };
    if (hasExtensionRuntime()) {
      void sendToBackground({ type: 'cd:wt-begin', info: this.info() });
      this.startSync();
    }
    return full;
  }

  /** What the service worker needs to carry the walkthrough onto the next page. */
  private info(): WtSessionInfo {
    const s = this.state.session!;
    return {
      session: {
        id: s.id,
        origin: s.origin,
        ...(s.app ? { app: s.app } : {}),
        ...(s.audioStartedAtMs !== undefined ? { audioStartedAtMs: s.audioStartedAtMs } : {}),
      },
      startedAtMs: this.state.startedAtMs,
      pinCount: this.pinCount,
      context: this.context,
      startPage: this.startPage ?? { url: location.href, title: document.title },
    };
  }

  /**
   * The tab loaded another page during a walkthrough: carry on here, on the same clock (the
   * earlier pages wait in the service worker until Stop).
   */
  resume(env: Env, info: WtSessionInfo): void {
    if (this.state.phase === 'recording' || this.state.phase === 'finishing') return;
    this.reset();
    this.env = env;
    this.pinCount = info.pinCount;
    this.context = info.context;
    this.startPage = info.startPage;
    this.href = location.href;
    this.lastFrameScroll = { x: window.scrollX, y: window.scrollY };
    this.set({
      phase: 'recording',
      startedAtMs: info.startedAtMs,
      session: info.session,
      pictures: hasExtensionRuntime(),
      drawing: false,
      shift: false,
    });
    const t = this.now();
    this.scrolls.push([t, Math.round(window.scrollX), Math.round(window.scrollY)]);
    env.store.set({
      tool: 'browse',
      panel: 'none',
      selectedIds: [],
      draft: null,
      hoverEl: null,
      openThreadId: null,
    });
    this.listen();
    this.events.push({ kind: 'navigate', t, url: location.href, title: document.title });
    this.contextChanges.push({
      t,
      key: 'route',
      value: `${location.pathname}${location.search.length < 80 ? location.search : ''}`,
    });
    this.requestFrame('navigate', { key: `nav-${t}`, t, delay: 600 });
    this.startSync();
  }

  private startSync(): void {
    window.clearInterval(this.syncTimer);
    this.syncTimer = window.setInterval(() => this.sync(), 1000);
  }

  /** Hand what's new to the service worker (pictures and pointer only once; the rest whole). */
  private sync(): void {
    if (!hasExtensionRuntime() || !this.recording) return;
    const pictures: WtSyncedPicture[] = [];
    for (const c of this.candidates) {
      if (this.syncedPictures.get(c.key) === c.takenAt) continue;
      const { look: _look, ...picture } = c;
      pictures.push(picture);
      this.syncedPictures.set(c.key, c.takenAt);
    }
    const cursorFrom = this.syncedCursor;
    this.syncedCursor = this.cursor.length;
    void sendToBackground({
      type: 'cd:wt-sync',
      pinCount: this.pinCount,
      page: {
        pageId: PAGE_ID,
        strokes: this.strokes,
        events: this.events,
        scrolls: this.scrolls,
        contextChanges: this.contextChanges,
        cursorFrom,
        cursor: this.cursor.slice(cursorFrom),
        pictures,
      },
    });
  }

  /** Put the earlier pages (from the service worker) in front of this one's. */
  private async withEarlierPages(): Promise<void> {
    if (!hasExtensionRuntime()) return;
    const answer = await sendToBackground<{ pages: WtPageData[] }>({
      type: 'cd:wt-collect',
      pageId: PAGE_ID,
    });
    const pages = answer?.pages ?? [];
    if (pages.length === 0) return;
    const strokes: WtStroke[] = [];
    const candidates: Candidate[] = [];
    const events: WtEvent[] = [];
    const cursor: [number, number, number][] = [];
    const scrolls: [number, number, number][] = [];
    const changes: { t: number; key: string; value: string }[] = [];
    const add = (p: Omit<WtPageData, 'pageId' | 'pictures'>, pictures: Candidate[]) => {
      const offset = strokes.length;
      strokes.push(...p.strokes);
      for (const c of pictures)
        candidates.push(
          c.strokeIndex === undefined ? c : { ...c, strokeIndex: c.strokeIndex + offset },
        );
      events.push(...p.events);
      cursor.push(...p.cursor);
      scrolls.push(...p.scrolls);
      changes.push(...p.contextChanges);
    };
    for (const p of pages) add(p, p.pictures);
    add(
      {
        strokes: this.strokes,
        events: this.events,
        cursor: this.cursor,
        scrolls: this.scrolls,
        contextChanges: this.contextChanges,
      },
      this.candidates,
    );
    this.strokes = strokes;
    this.candidates = candidates;
    this.events = events.toSorted((a, b) => a.t - b.t);
    this.cursor = cursor.toSorted((a, b) => a[0] - b[0]);
    this.scrolls = scrolls.toSorted((a, b) => a[0] - b[0]);
    this.contextChanges = changes.toSorted((a, b) => a.t - b.t);
  }

  /** Stop and keep nothing (the last finished walkthrough stays). */
  cancel(): void {
    if (this.state.phase !== 'recording') return;
    if (hasExtensionRuntime()) void sendToBackground({ type: 'cd:wt-end' });
    this.unlisten();
    this.reset();
    this.set({ phase: this.state.result ? 'ready' : 'idle', session: null });
  }

  /** Forget a finished walkthrough. */
  discard(): void {
    if (this.state.phase !== 'ready') return;
    this.reset();
    this.set({ phase: 'idle', session: null, result: null });
  }

  /** A spoken cue from the voice recorder (epoch ms): worth a picture. */
  cue(at: number, word: string): void {
    if (!this.recording) return;
    const t = Math.max(0, at - this.state.startedAtMs);
    this.events.push({ kind: 'cue', t, word });
    this.requestFrame('cue', { t });
  }

  /** Stop following and put the walkthrough together. */
  async stop(): Promise<WalkthroughResult | null> {
    if (!this.recording) return this.state.result;
    this.set({ phase: 'finishing' });
    this.endInk();
    this.endLaser();
    this.flushScroll();
    this.unlisten();
    const durationMs = this.now();
    const lastTaken = this.candidates.reduce((n, c) => Math.max(n, c.takenAt), -Infinity);
    if (durationMs - lastTaken > 2500) this.requestFrame('end', { t: durationMs });
    await this.drain();
    window.clearInterval(this.syncTimer);
    await this.withEarlierPages();
    if (hasExtensionRuntime()) void sendToBackground({ type: 'cd:wt-end' });
    // Each picture cropped to where its moment happened (Scrawl's auto-crop).
    const result = await applyAutocrop(this.build(durationMs));
    this.set({
      phase: 'ready',
      result,
      ink: [],
      laser: [],
      pins: [],
      ripples: [],
      drawing: false,
      shift: false,
    });
    this.env?.store.set({ tool: 'select', panel: 'walkthrough', panelBack: 'more' });
    for (const hook of this.finishHooks) hook(result, this.state.session);
    return result;
  }

  /** Replace the result (a transcript was added, or it was sent). */
  update(result: WalkthroughResult): void {
    this.set({ result });
    this.syncFlags(result);
  }

  private reset(): void {
    window.clearTimeout(this.queueTimer);
    window.clearTimeout(this.fadeTimer);
    window.clearTimeout(this.laserTimer);
    window.clearTimeout(this.resizeTimer);
    if (this.scrollRun) window.clearTimeout(this.scrollRun.timer);
    this.strokes = [];
    this.events = [];
    this.cursor = [];
    this.scrolls = [];
    this.lastScrollSample = -Infinity;
    this.context = {};
    this.contextChanges = [];
    window.clearInterval(this.syncTimer);
    this.syncedCursor = 0;
    this.syncedPictures.clear();
    this.startPage = null;
    if (this.appeared) window.clearTimeout(this.appeared.timer);
    this.appeared = null;
    this.candidates = [];
    this.pending.clear();
    this.busy = false;
    this.lastShot = 0;
    this.ink = null;
    this.laser = null;
    this.group = null;
    this.pinCount = 0;
    this.scrollRun = null;
    this.lastType = null;
    this.click = null;
    this.mutations = 0;
    this.lastCursorAt = -Infinity;
    this.moved = false;
    for (const w of this.drainWaiters.splice(0)) w();
    this.set({ ink: [], laser: [], pins: [], ripples: [], shift: false, drawing: false });
  }

  // ---- listening --------------------------------------------------------------------------

  private listen(): void {
    const on = <K extends keyof WindowEventMap>(
      type: K,
      fn: (e: WindowEventMap[K]) => void,
      options: AddEventListenerOptions = { capture: true },
    ) => {
      window.addEventListener(type, fn as EventListener, options);
      this.off.push(() => window.removeEventListener(type, fn as EventListener, options));
    };
    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e), { capture: true, passive: true });
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', (e) => this.onPointerUp(e));
    on('keydown', (e) => this.onKey(e, true));
    on('keyup', (e) => this.onKey(e, false));
    // Leaving the page (a link, a reload): hand over the last second too.
    on('pagehide', () => this.sync());
    on('blur', () => {
      this.setShift(false);
      this.endInk();
    });
    on('scroll', (e) => this.onScroll(e), { capture: true, passive: true });
    on('input', (e) => this.onInput(e));
    on('resize', () => {
      window.clearTimeout(this.resizeTimer);
      this.resizeTimer = window.setTimeout(() => {
        this.events.push({
          kind: 'resize',
          t: this.now(),
          width: document.documentElement.clientWidth || window.innerWidth,
          height: window.innerHeight,
        });
      }, 400);
    });
    // Did the page change after a click? (Its own changes only, not this UI.)
    this.observer = new MutationObserver((records) => this.onMutations(records));
    if (document.body)
      this.observer.observe(document.body, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['open', 'hidden', 'aria-hidden'],
      });
    this.navTimer = window.setInterval(() => this.checkNavigation(), 500);
    this.idleTimer = window.setInterval(() => {
      const lastTaken = this.candidates.reduce((n, c) => Math.max(n, c.takenAt), 0);
      if (this.moved && this.now() - lastTaken > 20_000 && this.pending.size === 0) {
        this.moved = false;
        this.requestFrame('idle');
      }
    }, 2000);
  }

  private unlisten(): void {
    for (const off of this.off.splice(0)) off();
    this.observer?.disconnect();
    this.observer = null;
    window.clearInterval(this.navTimer);
    window.clearInterval(this.idleTimer);
  }

  private isSurface(e: Event): boolean {
    return e.composedPath().some((n) => n instanceof Element && n.hasAttribute('data-wt-surface'));
  }

  private isOurUi(e: Event): boolean {
    return e.composedPath().some((n) => n instanceof Element && isExtensionNode(n));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (down && e.altKey && e.shiftKey && e.code === 'KeyW') {
      e.preventDefault();
      e.stopImmediatePropagation();
      void this.stop();
      return;
    }
    if (down && e.altKey && e.shiftKey && e.code === 'KeyF') {
      e.preventDefault();
      e.stopImmediatePropagation();
      this.flag();
      return;
    }
    if (e.key !== 'Shift') return;
    if (down && (e.repeat || isTypingEvent(e))) return;
    this.setShift(down);
  }

  private setShift(on: boolean): void {
    if (this.state.shift === on) return;
    this.set({ shift: on });
    if (!on) this.endLaser();
  }

  private page(e: PointerEvent): WtPoint {
    return { x: e.clientX + window.scrollX, y: e.clientY + window.scrollY };
  }

  private onPointerDown(e: PointerEvent): void {
    const p = this.page(e);
    if (this.isSurface(e)) {
      if (e.button !== 0) return;
      e.preventDefault();
      this.endLaser();
      this.beginInk(e, p);
      return;
    }
    if (this.isOurUi(e)) return;
    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : undefined;
    const el = e.composedPath()[0];
    const target = el instanceof Element ? targetOf(el) : targetAt(p.x, p.y);
    const t = this.now();
    this.click = {
      t,
      point: p,
      ...(target ? { target } : {}),
      ...(button ? { button } : {}),
      mutations: this.mutations,
    };
    // Before the page reacts: what was clicked, as it was.
    this.requestFrame('click', { key: `click-${t}`, t });
    const id = ++this.seq;
    this.set({ ripples: [...this.state.ripples, { id, x: p.x, y: p.y }] });
    window.setTimeout(
      () => this.set({ ripples: this.state.ripples.filter((r) => r.id !== id) }),
      600,
    );
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.page(e);
    const t = this.now();
    if (t - this.lastCursorAt >= CURSOR_EVERY_MS && this.cursor.length < MAX_CURSOR) {
      this.cursor.push([t, Math.round(p.x), Math.round(p.y)]);
      this.lastCursorAt = t;
      this.moved = true;
    }
    if (this.ink && e.pointerId === this.ink.pointerId) {
      const last = this.ink.stroke.points.at(-1)!;
      if (Math.hypot(p.x - last[0], p.y - last[1]) < 1.5) return;
      this.ink.stroke.points.push([p.x, p.y, t - this.ink.stroke.t0]);
      const live = this.ink.live;
      this.set({
        ink: this.state.ink.map((s) => (s.id === live ? { ...s, points: [...s.points, p] } : s)),
      });
      return;
    }
    if (this.state.shift && e.pointerType !== 'touch' && e.buttons === 0) this.laserTo(p, t);
  }

  private onPointerUp(e: PointerEvent): void {
    if (this.ink && e.pointerId === this.ink.pointerId) {
      this.endInk();
      return;
    }
    const c = this.click;
    if (!c || e.type === 'pointercancel') {
      this.click = null;
      return;
    }
    this.click = null;
    const p = this.page(e);
    if (Math.hypot(p.x - c.point.x, p.y - c.point.y) > 10 || !c.target) return;
    this.events.push({
      kind: 'click',
      t: c.t,
      point: { x: Math.round(c.point.x), y: Math.round(c.point.y) },
      target: c.target,
      ...(c.button ? { button: c.button } : {}),
    });
    // And after, if the page changed (or went somewhere): what the click did.
    const before = c.mutations;
    const href = location.href;
    window.setTimeout(() => {
      if (!this.recording) return;
      if (this.mutations - before > 0 || location.href !== href)
        this.requestFrame('result', { key: `result-${c.t}` });
    }, 900);
  }

  // ---- ink, pins, laser -------------------------------------------------------------------

  private beginInk(e: PointerEvent, p: WtPoint): void {
    const surface = e
      .composedPath()
      .find((n): n is Element => n instanceof Element && n.hasAttribute('data-wt-surface'));
    try {
      surface?.setPointerCapture(e.pointerId);
    } catch {
      // synthetic pointer
    }
    window.clearTimeout(this.fadeTimer);
    const t = this.now();
    const live = ++this.seq;
    this.ink = {
      stroke: { t0: t, t1: t, points: [[p.x, p.y, 0]] },
      live,
      pointerId: e.pointerId,
      start: p,
    };
    // Pen down again before the fade: everything on screen stays.
    this.set({
      ink: [
        ...this.state.ink.map((s) => ({ ...s, fading: false })),
        { id: live, points: [p], fading: false },
      ],
    });
  }

  private endInk(): void {
    const ink = this.ink;
    if (!ink) return;
    this.ink = null;
    const stroke = ink.stroke;
    stroke.t1 = this.now();
    const b = strokeBounds(stroke);
    const index = this.strokes.length;
    if (Math.max(b.width, b.height) < PIN_MOVE_PX) {
      // A click (or tap) while drawing: a numbered pin.
      const n = ++this.pinCount;
      const at = ink.start;
      stroke.points = [[at.x, at.y, 0]];
      stroke.pin = n;
      const center = targetAt(at.x, at.y);
      if (center) stroke.hits = { center };
      this.strokes.push(stroke);
      this.group = null;
      this.set({
        ink: this.state.ink.filter((s) => s.id !== ink.live),
        pins: [...this.state.pins, { n, x: at.x, y: at.y }],
      });
      this.requestFrame('pin', { key: `pin-${n}`, t: stroke.t0, strokeIndex: index });
      this.scheduleFade();
      return;
    }
    const shape = shapeOf(stroke);
    const first = stroke.points[0]!;
    const last = stroke.points.at(-1)!;
    const cx = b.x + b.width / 2;
    // An underline is about the words above it.
    const cy = shape === 'underline' ? b.y - 8 : b.y + b.height / 2;
    const center = targetAt(cx, cy);
    const start = targetAt(first[0], first[1]);
    const end = targetAt(last[0], last[1]);
    const inside = elementsInRect(b, 3)
      .map((el) => targetOf(el))
      .filter((t): t is WtTarget => !!t);
    stroke.hits = {
      ...(center ? { center } : {}),
      ...(start ? { start } : {}),
      ...(end ? { end } : {}),
      ...(inside.length ? { inside } : {}),
    };
    this.strokes.push(stroke);
    // Strokes close together are one mark (and one picture, retaken as the mark grows).
    const g = this.group;
    if (g && stroke.t0 - g.end <= MARK_GAP_MS && g.count < MAX_MARK_STROKES) {
      g.count++;
      g.end = stroke.t1;
    } else {
      this.group = { key: `mark-${index}`, count: 1, end: stroke.t1 };
    }
    this.requestFrame('mark', { key: this.group!.key, t: stroke.t0, strokeIndex: index });
    this.scheduleFade();
  }

  private scheduleFade(): void {
    window.clearTimeout(this.fadeTimer);
    this.fadeTimer = window.setTimeout(() => {
      this.set({ ink: this.state.ink.map((s) => ({ ...s, fading: true })) });
      this.fadeTimer = window.setTimeout(() => {
        if (!this.ink) this.set({ ink: [] });
      }, 320);
    }, INK_HOLD_MS);
  }

  private laserTo(p: WtPoint, t: number): void {
    const wall = Date.now();
    if (!this.laser) {
      window.clearTimeout(this.laserTimer);
      this.laser = {
        stroke: { t0: t, t1: t, points: [], laser: true },
        dwell: [],
        lastSample: -Infinity,
      };
    }
    const l = this.laser;
    l.stroke.points.push([p.x, p.y, t - l.stroke.t0]);
    l.stroke.t1 = t;
    // What it rests on: sampled every 120 ms.
    if (t - l.lastSample >= 120) {
      const target = targetAt(p.x, p.y);
      const spent = l.lastSample === -Infinity ? 0 : t - l.lastSample;
      l.lastSample = t;
      const prev = l.dwell.at(-1);
      if (prev) prev.ms += spent;
      if (target && target.label !== prev?.target.label) l.dwell.push({ target, ms: 0 });
    }
    const keep = wall - LASER_MS - 80;
    this.set({ laser: [...this.state.laser.filter((q) => q[2] >= keep), [p.x, p.y, wall]] });
  }

  private endLaser(): void {
    const l = this.laser;
    if (!l) return;
    this.laser = null;
    // Let the tail fade on screen.
    window.clearTimeout(this.laserTimer);
    this.laserTimer = window.setTimeout(() => this.set({ laser: [] }), LASER_MS + 80);
    if (l.stroke.points.length < 3) return;
    const last = l.dwell.at(-1);
    if (last) last.ms += Math.max(0, l.stroke.t1 - l.lastSample);
    const rested = l.dwell.filter((d) => d.ms >= 250);
    const path = (rested.length ? rested : last ? [last] : []).slice(-3).map((d) => d.target);
    if (path.length) l.stroke.hits = { path };
    const index = this.strokes.length;
    this.strokes.push(l.stroke);
    this.group = null;
    // Right away, before anything else is drawn: the live trail is left out of the picture and
    // the whole path is drawn on it instead.
    this.requestFrame('laser', { key: `laser-${index}`, t: l.stroke.t0, strokeIndex: index });
  }

  // ---- scrolling, typing, navigation ------------------------------------------------------

  private scrollPos(el: Element): WtPoint {
    return el === document.scrollingElement || el === document.documentElement
      ? { x: window.scrollX, y: window.scrollY }
      : { x: el.scrollLeft, y: el.scrollTop };
  }

  private onScroll(e: Event): void {
    const target = e.target;
    const el =
      target === document || target === window
        ? (document.scrollingElement ?? document.documentElement)
        : target instanceof Element
          ? target
          : null;
    if (!el || isExtensionNode(el)) return;
    const t = this.now();
    if (
      (el === document.scrollingElement || el === document.documentElement) &&
      t - this.lastScrollSample >= 100
    ) {
      this.scrolls.push([t, Math.round(window.scrollX), Math.round(window.scrollY)]);
      this.lastScrollSample = t;
    }
    if (this.scrollRun && this.scrollRun.el !== el) this.flushScroll();
    if (!this.scrollRun) this.scrollRun = { el, t: this.now(), from: this.scrollPos(el), timer: 0 };
    window.clearTimeout(this.scrollRun.timer);
    this.scrollRun.timer = window.setTimeout(() => this.flushScroll(), 400);
  }

  private flushScroll(): void {
    const run = this.scrollRun;
    if (!run) return;
    this.scrollRun = null;
    window.clearTimeout(run.timer);
    const to = this.scrollPos(run.el);
    if (Math.hypot(to.x - run.from.x, to.y - run.from.y) < 40) return;
    const page = run.el === document.scrollingElement || run.el === document.documentElement;
    if (page) this.scrolls.push([this.now(), Math.round(to.x), Math.round(to.y)]);
    const target = page ? undefined : targetOf(run.el);
    this.events.push({
      kind: 'scroll',
      t: run.t,
      t1: this.now(),
      from: run.from,
      to,
      ...(target ? { target } : {}),
    });
    if (!this.recording) return;
    const far = page
      ? Math.abs(window.scrollY - this.lastFrameScroll.y) > window.innerHeight * 0.4 ||
        Math.abs(window.scrollX - this.lastFrameScroll.x) > window.innerWidth * 0.4
      : Math.abs(to.y - run.from.y) > run.el.clientHeight * 0.4;
    if (far) this.requestFrame('scroll');
  }

  private onInput(e: Event): void {
    const el = e.composedPath()[0];
    if (!(el instanceof HTMLElement) || isExtensionNode(el)) return;
    const editable =
      el.isContentEditable || el.localName === 'textarea' || el.localName === 'input';
    if (!editable) return;
    const t = this.now();
    if (this.lastType?.el === el && t - this.lastType.t < 4000) {
      this.lastType.t = t;
      return;
    }
    this.lastType = { el, t };
    const target = targetOf(el);
    if (target) this.events.push({ kind: 'type', t, target });
  }

  private checkNavigation(): void {
    if (location.href === this.href) return;
    this.href = location.href;
    const event: WtEvent = {
      kind: 'navigate',
      t: this.now(),
      url: location.href,
      title: document.title,
    };
    this.events.push(event);
    this.contextChanges.push({
      t: event.t,
      key: 'route',
      value: `${location.pathname}${location.search.length < 80 ? location.search : ''}`,
    });
    this.requestFrame('navigate', { key: `nav-${event.t}`, delay: 800 });
    // Single-page apps often set the title a moment later.
    window.setTimeout(() => {
      event.title = document.title;
    }, 800);
  }

  // ---- the page changing by itself ---------------------------------------------------------

  private onMutations(records: MutationRecord[]): void {
    let seen = false;
    for (const r of records) {
      if (isExtensionNode(r.target)) continue;
      this.mutations++;
      const add = (node: Node | null) => {
        const el = node instanceof Element ? node : node?.parentElement;
        if (
          !el ||
          isExtensionNode(el) ||
          /^(script|style|link|meta|template|noscript)$/.test(el.localName)
        )
          return;
        // A live region's words changing counts as the region appearing again.
        const live = el.closest('[role="alert"], [role="status"], [aria-live]');
        if (!this.appeared) this.appeared = { first: Date.now(), timer: 0, els: new Set() };
        this.appeared.els.add(live ?? el);
        seen = true;
      };
      if (r.type === 'childList') for (const n of Array.from(r.addedNodes)) add(n);
      else if (r.type === 'attributes') add(r.target);
      else if (
        r.type === 'characterData' &&
        r.target.parentElement?.closest('[role="alert"], [role="status"], [aria-live]')
      )
        add(r.target);
    }
    if (!seen || !this.appeared) return;
    // Wait for it to settle (400 ms quiet, at most 1.5 s from the first change).
    const a = this.appeared;
    window.clearTimeout(a.timer);
    a.timer = window.setTimeout(
      () => this.pageChanged(),
      Math.max(0, Math.min(400, 1500 - (Date.now() - a.first))),
    );
  }

  private pageChanged(): void {
    const a = this.appeared;
    this.appeared = null;
    if (!a || !this.recording) return;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const shown = [...a.els].filter((el) => {
      if (!el.isConnected) return false;
      const r = el.getBoundingClientRect();
      if (
        r.width < 8 ||
        r.height < 8 ||
        r.bottom <= 0 ||
        r.top >= vh ||
        r.right <= 0 ||
        r.left >= vw
      )
        return false;
      const cs = getComputedStyle(el);
      return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
    });
    // Outermost only: a toast and its text are one thing.
    const outer = shown.filter((el) => !shown.some((o) => o !== el && o.contains(el)));
    if (outer.length === 0) return;
    let region: [number, number, number, number] | null = null;
    for (const el of outer) {
      const r = el.getBoundingClientRect();
      const b: [number, number, number, number] = [
        Math.max(0, r.left / vw),
        Math.max(0, r.top / vh),
        Math.min(1, r.right / vw),
        Math.min(1, r.bottom / vh),
      ];
      region = region
        ? [
            Math.min(region[0], b[0]),
            Math.min(region[1], b[1]),
            Math.max(region[2], b[2]),
            Math.max(region[3], b[3]),
          ]
        : b;
    }
    const main = outer.toSorted((x, y) => {
      const rx = x.getBoundingClientRect();
      const ry = y.getBoundingClientRect();
      return ry.width * ry.height - rx.width * rx.height;
    })[0]!;
    const target = targetOf(main);
    const t = this.now();
    const box = main.getBoundingClientRect();
    const event: WtEvent | undefined = target
      ? {
          kind: 'appear',
          t,
          target: { ...target, label: appearedLabel(main) },
          rect: {
            x: Math.round(box.left + window.scrollX),
            y: Math.round(box.top + window.scrollY),
            width: Math.round(box.width),
            height: Math.round(box.height),
          },
        }
      : undefined;
    if (event) this.events.push(event);
    this.requestFrame('change', {
      key: `change-${t}`,
      t,
      ...(region ? { region } : {}),
      ...(event ? { event } : {}),
    });
  }

  // ---- flags --------------------------------------------------------------------------------

  /** "Look here": a picture now, and a comment on the page where the pointer is. */
  flag(): void {
    if (!this.recording) return;
    const t = this.now();
    const last = this.cursor.at(-1);
    const point = last
      ? { x: last[1], y: last[2] }
      : { x: window.scrollX + window.innerWidth / 2, y: window.scrollY + window.innerHeight / 2 };
    const el = pickElement(point.x - window.scrollX, point.y - window.scrollY);
    const target = el ? targetOf(el) : undefined;
    let number: number | undefined;
    const store = this.env?.store;
    if (store) {
      const doc = store.getState().doc;
      number = nextCommentNumber(doc.annotations);
      const at = nowIso();
      const anchor =
        el && el !== document.body && el !== document.documentElement ? buildAnchor(el) : null;
      const thread: CommentThread = {
        id: createId('c'),
        type: 'comment',
        number,
        intent: 'note',
        status: 'open',
        target: anchor ? { type: 'element', point, anchor } : { type: 'point', point },
        messages: [{ id: createId('m'), body: flagBody(t), createdAt: at }],
        createdAt: at,
        updatedAt: at,
        viewport: {
          width: document.documentElement.clientWidth || window.innerWidth,
          height: window.innerHeight,
        },
      };
      store.addAnnotation(thread);
    }
    this.events.push({
      kind: 'flag',
      t,
      point: { x: Math.round(point.x), y: Math.round(point.y) },
      ...(target ? { target } : {}),
      ...(number !== undefined ? { comment: number } : {}),
    });
    this.requestFrame('flag', { key: `flag-${t}`, t });
  }

  /** Flag comments say what was said then, once there's a transcript (their text untouched). */
  private syncFlags(result: WalkthroughResult): void {
    const store = this.env?.store;
    const wt = result.walkthrough;
    if (!store || !wt.transcript) return;
    const entries = timeline(wt);
    for (const e of wt.events) {
      if (e.kind !== 'flag' || e.comment === undefined) continue;
      const entry =
        entries.find((x) => Math.abs(x.t - e.t) < 50) ?? entries.findLast((x) => x.t <= e.t);
      const said = entry?.said;
      if (!said) continue;
      const thread = store
        .getState()
        .doc.annotations.find((a): a is CommentThread => isComment(a) && a.number === e.comment);
      const first = thread?.messages[0];
      if (!thread || !first?.body.startsWith(flagBody(e.t))) continue;
      const body = `“${said}”\n\n${flagBody(e.t)}`;
      if (first.body === body) continue;
      store.updateAnnotation(thread.id, (a) =>
        isComment(a)
          ? { ...a, messages: [{ ...first, body }, ...a.messages.slice(1)], updatedAt: nowIso() }
          : a,
      );
    }
  }

  // ---- pictures ---------------------------------------------------------------------------

  private requestFrame(
    reason: WtFrameReason,
    options: {
      key?: string;
      t?: number;
      delay?: number;
      strokeIndex?: number;
      region?: [number, number, number, number];
      event?: WtEvent;
    } = {},
  ): void {
    if (!this.state.pictures) return;
    const key = options.key ?? `${reason}-${++this.seq}`;
    const existing = this.pending.get(key);
    if (
      !existing &&
      !this.candidates.some((c) => c.key === key) &&
      this.candidates.length >= MAX_CANDIDATES
    )
      return;
    const due = Date.now() + (options.delay ?? 0);
    this.pending.set(key, {
      key,
      reason,
      t: existing?.t ?? this.candidates.find((c) => c.key === key)?.t ?? options.t ?? this.now(),
      due: Math.max(existing?.due ?? 0, due),
      ...(options.strokeIndex !== undefined ? { strokeIndex: options.strokeIndex } : {}),
      ...(options.region ? { region: options.region } : {}),
      ...(options.event ? { event: options.event } : {}),
    });
    this.schedule();
  }

  private schedule(): void {
    window.clearTimeout(this.queueTimer);
    if (this.busy) return;
    if (this.pending.size === 0) {
      for (const w of this.drainWaiters.splice(0)) w();
      return;
    }
    const next = Math.min(...[...this.pending.values()].map((p) => p.due));
    const wait = Math.max(0, next - Date.now(), this.lastShot + CAPTURE_GAP_MS - Date.now());
    this.queueTimer = window.setTimeout(() => void this.run(), wait);
  }

  private async run(): Promise<void> {
    const due = [...this.pending.values()]
      .filter((p) => p.due <= Date.now() + 5)
      .toSorted((a, b) => a.due - b.due)[0];
    if (!due || !this.env) {
      this.schedule();
      return;
    }
    this.pending.delete(due.key);
    this.busy = true;
    try {
      const shot = await this.capture();
      // A page change is kept only if it shows something new (Scrawl's measures): the screen
      // moved by more than 8 %, or a quarter of where it happened changed.
      const before = this.candidates.reduce<Candidate | null>(
        (best, c) => (!best || c.takenAt > best.takenAt ? c : best),
        null,
      );
      const fresh =
        due.reason !== 'change' ||
        !shot?.look ||
        !before?.look ||
        sceneDiff(before.look, shot.look) > SCENE_CHANGE ||
        (due.region ? regionDiff(before.look, shot.look, due.region) > 0.25 : false);
      if (shot && !fresh && due.event) this.events = this.events.filter((e) => e !== due.event);
      if (shot && fresh) {
        const screen = screenName();
        const last =
          this.contextChanges.findLast((c) => c.key === 'screen')?.value ?? this.context.screen;
        if (screen && screen !== last)
          this.contextChanges.push({ t: this.now(), key: 'screen', value: screen });
        const candidate: Candidate = {
          key: due.key,
          reason: due.reason,
          t: due.t,
          takenAt: this.now(),
          ...(due.strokeIndex !== undefined ? { strokeIndex: due.strokeIndex } : {}),
          ...shot,
          ...(screen ? { screen } : {}),
        };
        const at = this.candidates.findIndex((c) => c.key === due.key);
        if (at >= 0) this.candidates[at] = candidate;
        else this.candidates.push(candidate);
        this.lastFrameScroll = shot.scroll;
      }
    } finally {
      this.busy = false;
      this.lastShot = Date.now();
      this.schedule();
    }
  }

  private async capture(): Promise<Omit<Candidate, 'key' | 'reason' | 't' | 'takenAt'> | null> {
    const host = this.env?.host;
    if (!host) return null;
    const scroll = { x: window.scrollX, y: window.scrollY };
    const viewport = {
      width: document.documentElement.clientWidth || window.innerWidth,
      height: window.innerHeight,
    };
    const url = location.href;
    host.setAttribute('data-capturing', '');
    let raw: string | null;
    try {
      await nextFrame();
      await nextFrame();
      raw = await captureVisibleTab();
    } finally {
      host.removeAttribute('data-capturing');
    }
    if (!raw) return null;
    const small = await shrink(raw).catch(() => null);
    if (!small) return null;
    return {
      scroll,
      viewport,
      url,
      ...small,
      scale: small.width / (window.innerWidth || viewport.width),
    };
  }

  /** Take what's still waiting (now), then resolve. */
  private drain(): Promise<void> {
    if (this.pending.size === 0 && !this.busy) return Promise.resolve();
    for (const p of this.pending.values()) p.due = Math.min(p.due, Date.now());
    return new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 8000);
      this.drainWaiters.push(() => {
        window.clearTimeout(timeout);
        resolve();
      });
      this.schedule();
    });
  }

  // ---- the walkthrough --------------------------------------------------------------------

  private build(durationMs: number): WalkthroughResult {
    const startedAtMs = this.state.startedAtMs;
    const marks = marksOf(this.strokes);
    const markOfStroke = (i: number | undefined) =>
      i === undefined ? undefined : marks.find((m) => m.strokes.includes(i));
    const picked = pickFrames(
      this.candidates.map((c) => ({ ...c, t: markOfStroke(c.strokeIndex)?.t0 ?? c.t })),
    );
    const shots = new Map<string, Candidate>();
    const frames: WtFrame[] = picked.map((c, i) => {
      const file = `frames/frame-${String(i + 1).padStart(2, '0')}.jpg`;
      shots.set(file, c);
      const mark = markOfStroke(c.strokeIndex);
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
    const session = this.state.session;
    const walkthrough: Walkthrough = {
      kind: WALKTHROUGH_KIND,
      version: WALKTHROUGH_VERSION,
      generator: { name: APP_NAME, version: APP_VERSION },
      startedAt: new Date(startedAtMs).toISOString(),
      startedAtMs,
      durationMs,
      page: this.startPage ?? { url: this.href || location.href, title: document.title },
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
      events: this.events.toSorted((a, b) => a.t - b.t),
      strokes: this.strokes.map((s) => ({
        ...s,
        points: s.points.map(([x, y, dt]) => [Math.round(x), Math.round(y), Math.round(dt)]),
      })),
      cursor: this.cursor,
      scrolls: this.scrolls,
      context: this.context,
      ...(this.contextChanges.length ? { contextChanges: this.contextChanges } : {}),
    };
    return {
      walkthrough,
      shots,
      summary: buildSummary(walkthrough),
      folder: folderName(startedAtMs),
    };
  }
}

/** This page load (a walkthrough can span several). */
const PAGE_ID = newId();

/** One recorder per page: it outlives the toolbar being closed and opened again. */
export const recorder = new WalkthroughRecorder();

/** A flag comment's own words (kept at the end when what was said is added). */
function flagBody(t: number): string {
  return `⚑ Walkthrough ${formatClock(t)}`;
}
