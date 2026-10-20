import { uniqueSelector } from '../../capture/anchor';
import type { WtTarget } from '../../walkthrough/model';
import { friendlyLabel } from '../describe';
import { pickElement } from '../dom';

/** Page elements as a person would name them, for the walkthrough's events and marks. */

const INTERACTIVE =
  'a,button,input,select,textarea,summary,label,[role="button"],[role="link"],[role="tab"],[role="menuitem"],[role="checkbox"],[role="switch"],[role="option"]';
const FIELD = 'input,textarea,select,[contenteditable=""],[contenteditable="true"]';

const clean = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
const short = (t: string) => (t.length > 30 ? `${t.slice(0, 29).trimEnd()}…` : t);

/** The page element at a page-space point. */
export function targetAt(x: number, y: number): WtTarget | undefined {
  const el = pickElement(x - window.scrollX, y - window.scrollY);
  return el ? targetOf(el) : undefined;
}

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
  const type = el.localName === 'input' ? input.type : '';
  if (['button', 'submit', 'reset'].includes(type)) return friendlyLabel(el);
  const noun =
    type === 'checkbox'
      ? 'Checkbox'
      : type === 'radio'
        ? 'Option'
        : type === 'search'
          ? 'Search field'
          : el.localName === 'select'
            ? 'Dropdown'
            : el.localName === 'textarea'
              ? 'Text box'
              : 'Field';
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
