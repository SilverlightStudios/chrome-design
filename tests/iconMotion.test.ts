// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { installIconMotion } from '../src/content/iconMotion';

const svg = (name: string, hold = false) =>
  `<svg class="ai ai-${name}"${hold ? ' data-hold=""' : ''}><path/></svg>`;

function fire(
  type: string,
  target: Element,
  pointerType = 'mouse',
  relatedTarget: Element | null = null,
) {
  const e = new MouseEvent(type, { bubbles: true, relatedTarget }) as MouseEvent & {
    pointerType: string;
  };
  Object.defineProperty(e, 'pointerType', { value: pointerType });
  target.dispatchEvent(e);
}

function setup() {
  const root = document.createElement('div');
  root.innerHTML = `<button data-k="a">${svg('select')}<span>Select</span></button><button data-k="b">${svg('gear', true)}</button><button data-k="c" disabled>${svg('undo')}</button>`;
  document.body.appendChild(root);
  installIconMotion(root);
  const played = (id: string) =>
    root.querySelector(`[data-k="${id}"] svg`)!.hasAttribute('data-play');
  return { root, played };
}

describe('animated icons', () => {
  it('plays an icon when its control is pressed, by touch or mouse', () => {
    const { root, played } = setup();
    fire('pointerdown', root.querySelector('[data-k="a"] span')!, 'touch');
    expect(played('a')).toBe(true);
    fire('pointerdown', root.querySelector('[data-k="b"]')!);
    expect(played('b')).toBe(true);
    fire('pointerdown', root.querySelector('[data-k="c"]')!);
    expect(played('c')).toBe(false);
  });

  it('plays on mouse enter, except icons that hold a hover pose', () => {
    const { root, played } = setup();
    fire('pointerover', root.querySelector('[data-k="a"]')!, 'mouse');
    fire('pointerover', root.querySelector('[data-k="b"]')!, 'mouse');
    expect(played('a')).toBe(true);
    expect(played('b')).toBe(false);
  });

  it('ignores touch hover and moves inside the same control', () => {
    const { root, played } = setup();
    const a = root.querySelector('[data-k="a"]')!;
    fire('pointerover', a, 'touch');
    fire('pointerover', a.querySelector('span')!, 'mouse', a.querySelector('svg'));
    expect(played('a')).toBe(false);
  });
});
