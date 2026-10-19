import { HOST_TAG } from './dom';
import type { EditorStore } from './store';

/*
 * Stepping out of and into the selected element (the selection bar's ↑ / ↓ and the arrow
 * keys). Going up remembers where it came from, so going down returns there; otherwise down is
 * the first visible element inside.
 */

const cameFrom = new WeakMap<Element, Element>();

const shown = (el: Element) => {
  if (el.localName === HOST_TAG) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

export function parentOf(el: Element): Element | null {
  const p = el.parentElement;
  return p && p !== document.documentElement ? p : null;
}

export function childOf(el: Element): Element | null {
  const back = cameFrom.get(el);
  if (back && back !== el && back.isConnected && back.parentElement === el && shown(back))
    return back;
  return Array.from(el.children).find(shown) ?? null;
}

export function selectParent(store: EditorStore): boolean {
  const el = store.getState().pickedEl;
  const parent = el && parentOf(el);
  if (!el || !parent) return false;
  cameFrom.set(parent, el);
  store.set({ pickedEl: parent });
  return true;
}

export function selectChild(store: EditorStore): boolean {
  const el = store.getState().pickedEl;
  const child = el && childOf(el);
  if (!child) return false;
  store.set({ pickedEl: child });
  return true;
}
