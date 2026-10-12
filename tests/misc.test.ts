// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { restrictedReason } from '../src/background/inject';
import { describePath, uniqueSelector } from '../src/capture/anchor';
import { isDangerousUrl } from '../src/capture/sanitize';
import { exportFilename } from '../src/export/build';
import { gridColumns, measureBetween } from '../src/shared/measure';

describe('restricted pages', () => {
  it('allows http(s) and explains blocked schemes', () => {
    expect(restrictedReason('https://example.com/a', false)).toBeNull();
    expect(restrictedReason('chrome://settings', false)).toMatch(/blocks extensions/);
    expect(restrictedReason('https://chromewebstore.google.com/detail/x', false)).toMatch(
      /Web Store/,
    );
    expect(restrictedReason('file:///tmp/a.html', false)).toMatch(/Allow access to file URLs/);
    expect(restrictedReason('file:///tmp/a.html', true)).toBeNull();
    expect(restrictedReason(undefined, false)).toMatch(/can’t read/);
  });
});

describe('dangerous urls', () => {
  it.each([
    ['javascript:alert(1)', true],
    [' JaVa\tScRiPt:alert(1)', true],
    ['vbscript:x', true],
    ['data:text/html,<script>1</script>', true],
    ['data:image/png;base64,AAAA', false],
    ['https://example.com', false],
    ['#top', false],
  ])('%s → %s', (url, expected) => {
    expect(isDangerousUrl(url)).toBe(expected);
  });
});

describe('measurement', () => {
  it('reports the gap between separate boxes', () => {
    const lines = measureBetween(
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 0, y: 70, width: 100, height: 50 },
    );
    expect(lines).toEqual([expect.objectContaining({ axis: 'y', value: 20 })]);
  });

  it('reports inner offsets when one box contains the other', () => {
    const lines = measureBetween(
      { x: 20, y: 10, width: 60, height: 30 },
      { x: 0, y: 0, width: 100, height: 50 },
    );
    expect(lines.map((l) => l.value).toSorted((a, b) => a - b)).toEqual([10, 10, 20, 20]);
  });

  it('lays out stretch and fixed grids', () => {
    const stretch = gridColumns(1000, {
      mode: 'stretch',
      count: 4,
      columnWidth: 0,
      margin: 20,
      gutter: 20,
    });
    expect(stretch[0]).toEqual({ x: 20, width: 225 });
    expect(stretch[3]!.x + stretch[3]!.width).toBe(980);
    const fixed = gridColumns(1000, {
      mode: 'fixed',
      count: 2,
      columnWidth: 100,
      margin: 0,
      gutter: 20,
    });
    expect(fixed).toEqual([
      { x: 390, width: 100 },
      { x: 510, width: 100 },
    ]);
  });
});

describe('selectors', () => {
  it('builds unique, readable selectors', () => {
    document.body.innerHTML = `<main><section class="hero css-1x9f2a"><h2>A</h2><h2 id="b">B</h2><p class="lede">x</p><p class="lede">y</p></section></main>`;
    const ps = document.querySelectorAll('p');
    const s0 = uniqueSelector(ps[0]!);
    const s1 = uniqueSelector(ps[1]!);
    expect(document.querySelector(s0)).toBe(ps[0]);
    expect(document.querySelector(s1)).toBe(ps[1]);
    expect(s0).not.toContain('css-1x9f2a');
    expect(uniqueSelector(document.getElementById('b')!)).toBe('#b');
    expect(describePath(ps[0]!)).toBe('main > section.hero > p.lede');
  });

  it('names export files by host and time', () => {
    expect(exportFilename('https://www.example.com/x', new Date(2026, 0, 2, 3, 4))).toBe(
      'chrome-design-example.com-20260102-0304.html',
    );
  });
});
