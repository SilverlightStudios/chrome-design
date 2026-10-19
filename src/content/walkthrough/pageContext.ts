import { BREAKPOINTS, breakpointOf } from '../../shared/model';
import { friendlyLabel } from '../describe';
import { HOST_TAG } from '../dom';

/*
 * Page details read straight from Chrome, so an agent doesn't have to guess from pictures
 * (Scrawl gets these from its iOS kit; a web page already says most of it):
 *
 *   screen   what's in front: an open dialog, the selected tab, the current page's name
 *   route    the address's path (and query)
 *   next     a Next.js page's route pattern (`/products/[id]`), from its __NEXT_DATA__
 *   lang · theme · size
 */

const clean = (t: string | null | undefined, max = 40) => {
  const s = (t ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};

function visible(el: Element): boolean {
  if (el.closest(HOST_TAG)) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  if (r.bottom < 0 || r.top > window.innerHeight || r.right < 0 || r.left > window.innerWidth)
    return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
}

/** An element's accessible name, roughly: aria-label, aria-labelledby, then its first heading. */
function nameOf(el: Element): string {
  const label = el.getAttribute('aria-label');
  if (label) return clean(label);
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const text = by
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? '')
      .join(' ');
    if (clean(text)) return clean(text);
  }
  const heading = el.querySelector('h1, h2, h3, [role="heading"]');
  return clean(heading?.textContent);
}

/** What's in front, from the page itself: `Pricing › Annual tab › Dialog “Checkout”`. */
export function screenName(): string {
  const parts: string[] = [];
  const current = Array.from(
    document.querySelectorAll('[aria-current="page"], [aria-current="true"]'),
  ).find(visible);
  const h1 = Array.from(document.querySelectorAll('h1')).find(visible);
  const page = clean(current?.textContent) || clean(h1?.textContent) || clean(document.title);
  if (page) parts.push(page);
  const tab = Array.from(document.querySelectorAll('[role="tab"][aria-selected="true"]')).find(
    visible,
  );
  if (tab && clean(tab.textContent)) parts.push(`${clean(tab.textContent, 30)} tab`);
  const dialogs = Array.from(
    document.querySelectorAll(
      'dialog[open], [role="dialog"][aria-modal="true"], [role="alertdialog"]',
    ),
  ).filter(visible);
  const dialog = dialogs.at(-1);
  if (dialog) {
    const name = nameOf(dialog);
    parts.push(name ? `Dialog “${name}”` : 'Dialog');
  }
  return parts.join(' › ');
}

/** A Next.js page's route pattern (its JSON is in the page, readable from here). */
function nextRoute(): string | null {
  const el = document.getElementById('__NEXT_DATA__');
  if (!el?.textContent) return null;
  try {
    const data = JSON.parse(el.textContent) as { page?: unknown };
    return typeof data.page === 'string' ? data.page : null;
  } catch {
    return null;
  }
}

/** The page details now. */
export function pageDetails(): Record<string, string> {
  const width = document.documentElement.clientWidth || window.innerWidth;
  const route = `${location.pathname}${location.search.length > 1 && location.search.length < 80 ? location.search : ''}`;
  const details: Record<string, string> = { screen: screenName(), route };
  const next = nextRoute();
  if (next && next !== location.pathname) details.next = next;
  const lang = document.documentElement.lang;
  if (lang) details.lang = lang;
  details.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  details.size = `${width}×${window.innerHeight} (${BREAKPOINTS[breakpointOf(width)].label.toLowerCase()})`;
  return details;
}

/** What something that just appeared is: a toast's text, a dialog's name, or its plain name. */
export function appearedLabel(el: Element): string {
  const role = el.getAttribute('role');
  if (role === 'alert' || role === 'status' || el.hasAttribute('aria-live')) {
    const text = clean(el.textContent, 50);
    return text ? `Message “${text}”` : 'Message';
  }
  if (el.localName === 'dialog' || role === 'dialog' || role === 'alertdialog') {
    const name = nameOf(el);
    return name ? `Dialog “${name}”` : 'Dialog';
  }
  return friendlyLabel(el);
}
