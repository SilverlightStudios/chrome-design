// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { restrictedReason } from '../src/background/inject';
import { describePath, uniqueSelector } from '../src/capture/anchor';
import { isDangerousUrl } from '../src/capture/sanitize';
import { chooseLayout } from '../src/content/ui/GridPanel';
import { exportFilename } from '../src/export/build';
import { gridColumns, measureBetween } from '../src/shared/measure';
import { DEFAULT_GRID, type GridSpacing } from '../src/shared/model';

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

  it('spreads fixed columns like flexbox justify-content', () => {
    const base = { mode: 'fixed' as const, count: 3, columnWidth: 100, margin: 50, gutter: 10 };
    const xs = (spacing: GridSpacing) => gridColumns(1000, { ...base, spacing }).map((c) => c.x);
    expect(xs('start')).toEqual([50, 160, 270]);
    expect(xs('end')).toEqual([630, 740, 850]);
    expect(xs('center')).toEqual([340, 450, 560]);
    // 900px inside the margins, 300 of columns, 600 free.
    expect(xs('between')).toEqual([50, 450, 850]);
    expect(xs('around')).toEqual([150, 450, 750]);
    expect(xs('evenly')).toEqual([200, 450, 700]);
    // A single column centres; columns wider than the room lose their gaps and centre.
    expect(gridColumns(1000, { ...base, count: 1, spacing: 'between' })[0]!.x).toBe(450);
    const tight = gridColumns(300, { ...base, spacing: 'evenly' });
    expect(tight.map((c) => c.x)).toEqual([0, 100, 200]);
  });

  it('narrows fixed columns that would not fit when switching layout', () => {
    // 12 × 72px + 11 × 24px gutters is far wider than a 393px phone.
    expect(chooseLayout(DEFAULT_GRID, 'center', 393)).toEqual({
      mode: 'fixed',
      spacing: 'center',
      columnWidth: 8,
    });
    const four = { ...DEFAULT_GRID, count: 4 };
    expect(chooseLayout(four, 'start', 393).columnWidth).toBe(68);
    // Spread layouts ignore the gutter, so four columns still fit; six don't and get gaps.
    expect(chooseLayout(four, 'between', 393).columnWidth).toBeUndefined();
    expect(chooseLayout({ ...DEFAULT_GRID, count: 6 }, 'between', 393).columnWidth).toBe(28);
    // Plenty of room: the width is left alone.
    expect(chooseLayout(DEFAULT_GRID, 'evenly', 1440)).toEqual({
      mode: 'fixed',
      spacing: 'evenly',
    });
    expect(chooseLayout(DEFAULT_GRID, 'stretch', 393)).toEqual({ mode: 'stretch' });
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
