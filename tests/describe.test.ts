// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { friendlyAnchorLabel, friendlyLabel, friendlyName } from '../src/content/describe';
import { timeAgo } from '../src/content/overlay/CommentPopover';
import type { ElementAnchor } from '../src/shared/model';

function el(html: string): Element {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host.firstElementChild!;
}

function anchor(over: Partial<ElementAnchor>): ElementAnchor {
  return {
    selector: 'x',
    path: 'x',
    tagName: 'div',
    classList: [],
    rect: { x: 0, y: 0, width: 1, height: 1 },
    styles: {},
    ...over,
  };
}

describe('friendly names', () => {
  it('names elements the way a designer would', () => {
    expect(friendlyName(el('<button>Go</button>'))).toBe('Button');
    expect(friendlyName(el('<h2>Title</h2>'))).toBe('Heading');
    expect(friendlyName(el('<a href="#">Docs</a>'))).toBe('Link');
    expect(friendlyName(el('<input type="submit">'))).toBe('Button');
    expect(friendlyName(el('<input type="checkbox">'))).toBe('Checkbox');
    expect(friendlyName(el('<input type="email">'))).toBe('Field');
    expect(friendlyName(el('<div role="button">x</div>'))).toBe('Button');
    expect(friendlyName(el('<div>Plain words</div>'))).toBe('Text');
    expect(friendlyName(el('<div><span>a</span><span>b</span></div>'))).toBe('Group');
    expect(friendlyName(el('<div></div>'))).toBe('Box');
    expect(friendlyName(el('<my-widget><b>x</b></my-widget>'))).toBe('Component');
    expect(friendlyName(el('<svg width="16" height="16"></svg>'))).toBe('Icon');
  });

  it('adds what the element says, shortened', () => {
    expect(friendlyLabel(el('<button>Start free</button>'))).toBe('Button “Start free”');
    expect(friendlyLabel(el('<button aria-label="Close dialog">×</button>'))).toBe(
      'Button “Close dialog”',
    );
    expect(friendlyLabel(el('<img alt="Team photo">'))).toBe('Image “Team photo”');
    expect(friendlyLabel(el('<input placeholder="you@studio.com">'))).toBe(
      'Field “you@studio.com”',
    );
    const long = friendlyLabel(el('<h1>Notes that stay calm when your day isn’t.</h1>'));
    expect(long).toBe('Heading “Notes that stay calm when you…”');
    expect(friendlyLabel(el('<div><i></i></div>'))).toBe('Group');
  });

  it('names stored anchors without the element', () => {
    expect(friendlyAnchorLabel(anchor({ tagName: 'button', text: 'Start free' }))).toBe(
      'Button “Start free”',
    );
    expect(friendlyAnchorLabel(anchor({ tagName: 'div', role: 'dialog' }))).toBe('Dialog');
    expect(friendlyAnchorLabel(anchor({ tagName: 'div' }))).toBe('Group');
    expect(friendlyAnchorLabel(anchor({ tagName: 'body', text: 'everything' }))).toBe('Page');
  });
});

describe('timeAgo', () => {
  const now = Date.parse('2026-10-12T12:00:00.000Z');
  const ago = (ms: number) => new Date(now - ms).toISOString();
  it('uses short relative times', () => {
    expect(timeAgo(ago(20_000), now)).toBe('now');
    expect(timeAgo(ago(5 * 60_000), now)).toBe('5m');
    expect(timeAgo(ago(3 * 3_600_000), now)).toBe('3h');
    expect(timeAgo(ago(30 * 3_600_000), now)).toBe('Yesterday');
    expect(timeAgo(ago(5 * 86_400_000), now)).toMatch(/7/);
    // Clock skew never shows a negative time.
    expect(timeAgo(ago(-60_000), now)).toBe('now');
  });
});
