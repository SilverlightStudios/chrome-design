import type { WtEvent } from '../../walkthrough/model';
import { isExtensionNode } from '../dom';
import { appearedLabel } from './pageContext';
import type { Pictures, Region } from './pictures';
import type { Tape } from './tape';
import { targetOf } from './targets';

/**
 * The page changing by itself while recording: something appearing (a toast, a dialog, a
 * popover, a live message) gets an event and a picture once it settles, and a new address (a
 * single-page app's route) gets a navigate event and a picture. Changes to this UI don't count.
 */

const LIVE = '[role="alert"], [role="status"], [aria-live]';
const SETTLE_MS = 400;
const SETTLE_MAX_MS = 1500;

function onScreen(el: Element): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 8 || r.height < 8) return false;
  if (r.bottom <= 0 || r.top >= window.innerHeight || r.right <= 0 || r.left >= window.innerWidth)
    return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

/** Where the elements are, as a fraction of the viewport, all in one box. */
function regionOf(els: Element[]): Region {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  return els
    .map((el) => el.getBoundingClientRect())
    .map(
      (r): Region => [
        Math.max(0, r.left / vw),
        Math.max(0, r.top / vh),
        Math.min(1, r.right / vw),
        Math.min(1, r.bottom / vh),
      ],
    )
    .reduce((a, b) => [
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.max(a[2], b[2]),
      Math.max(a[3], b[3]),
    ]);
}

const area = (el: Element) => {
  const r = el.getBoundingClientRect();
  return r.width * r.height;
};

export class PageWatch {
  /** How many times the page has changed (a click's "did it do something?"). */
  mutations = 0;
  private tape: Tape;
  private pictures: Pictures;
  private recording: () => boolean;
  private observer: MutationObserver;
  private appeared: { first: number; timer: number; els: Set<Element> } | null = null;
  private href = location.href;
  private navTimer: number;

  constructor(tape: Tape, pictures: Pictures, recording: () => boolean) {
    this.tape = tape;
    this.pictures = pictures;
    this.recording = recording;
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
  }

  dispose(): void {
    this.observer.disconnect();
    window.clearInterval(this.navTimer);
    if (this.appeared) window.clearTimeout(this.appeared.timer);
    this.appeared = null;
  }

  private onMutations(records: MutationRecord[]): void {
    let seen = false;
    const add = (node: Node | null) => {
      const el = node instanceof Element ? node : node?.parentElement;
      if (
        !el ||
        isExtensionNode(el) ||
        /^(script|style|link|meta|template|noscript)$/.test(el.localName)
      )
        return;
      // A live region's words changing counts as the region appearing again.
      this.appeared ??= { first: Date.now(), timer: 0, els: new Set() };
      this.appeared.els.add(el.closest(LIVE) ?? el);
      seen = true;
    };
    for (const r of records) {
      if (isExtensionNode(r.target)) continue;
      this.mutations++;
      if (r.type === 'childList') for (const n of Array.from(r.addedNodes)) add(n);
      else if (r.type === 'attributes') add(r.target);
      else if (r.type === 'characterData' && r.target.parentElement?.closest(LIVE)) add(r.target);
    }
    const a = this.appeared;
    if (!seen || !a) return;
    // Wait for it to settle (quiet for a moment, but not forever after the first change).
    window.clearTimeout(a.timer);
    a.timer = window.setTimeout(
      () => this.pageChanged(),
      Math.max(0, Math.min(SETTLE_MS, SETTLE_MAX_MS - (Date.now() - a.first))),
    );
  }

  private pageChanged(): void {
    const a = this.appeared;
    this.appeared = null;
    if (!a || !this.recording()) return;
    const shown = [...a.els].filter(onScreen);
    // Outermost only: a toast and its text are one thing.
    const outer = shown.filter((el) => !shown.some((o) => o !== el && o.contains(el)));
    if (outer.length === 0) return;
    const main = outer.toSorted((x, y) => area(y) - area(x))[0]!;
    const target = targetOf(main);
    const t = this.tape.now();
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
    if (event) this.tape.events.push(event);
    this.pictures.request('change', {
      key: `change-${t}`,
      t,
      region: regionOf(outer),
      ...(event ? { event } : {}),
    });
  }

  private checkNavigation(): void {
    if (location.href === this.href) return;
    this.href = location.href;
    const event: WtEvent = {
      kind: 'navigate',
      t: this.tape.now(),
      url: location.href,
      title: document.title,
    };
    this.tape.events.push(event);
    this.tape.noteRoute(event.t);
    this.pictures.request('navigate', { key: `nav-${event.t}`, delay: 800 });
    // Single-page apps often set the title a moment later.
    window.setTimeout(() => {
      event.title = document.title;
    }, 800);
  }
}
