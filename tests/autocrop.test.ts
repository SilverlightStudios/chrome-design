import { describe, expect, it } from 'vitest';
import { Content, Ctx, changeRegions, computeCrops, type Rect } from '../src/walkthrough/autocrop';

/** Scrawl's own auto-crop tests (src/autocrop.rs), on the port. */

function solid(w: number, h: number, v: number) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = v;
    rgba[i + 1] = v;
    rgba[i + 2] = v;
    rgba[i + 3] = 255;
  }
  return { rgba, w, h };
}

function paint(f: ReturnType<typeof solid>, x: number, y: number, v: number) {
  const i = (y * f.w + x) * 4;
  f.rgba[i] = v;
  f.rgba[i + 1] = v;
  f.rgba[i + 2] = v;
}

const SCREEN: [number, number] = [1728, 1117];
const ctx = () => new Ctx({ screen: SCREEN, duration: 0, keyframes: [], items: [], content: [] });

describe('auto-crop (ported from Scrawl)', () => {
  it('compares pictures of different sizes by position', () => {
    const small = solid(640, 414, 30);
    const big = solid(2560, 1654, 30);
    for (let y = 400; y < 800; y++) for (let x = 1280; x < 1920; x++) paint(big, x, y, 230);
    const regions = changeRegions(small, big);
    expect(regions).toHaveLength(1);
    const r = regions[0]!;
    expect(r[0] <= 0.5 && r[2] >= 0.75 && r[1] <= 0.25 && r[3] >= 0.48).toBe(true);
    expect(r[0] >= 0.45 && r[2] <= 0.8).toBe(true);
    expect(changeRegions(small, solid(1280, 828, 30))).toEqual([]);
  });

  it('moves an edge out of a line of text', () => {
    const frame = solid(1728, 1117, 255);
    for (let y = 300; y < 600; y += 12)
      for (let x = 518; x < 1210; x++)
        if (x % 7 < 4) for (let dy = 0; dy < 4; dy++) paint(frame, x, y + dy, 20);
    const content = Content.fromPixels(frame.rgba, frame.w, frame.h, SCREEN);
    const r = ctx().snap([0.28, 0.25, 0.6, 0.55], content, [0.4, 0.3, 0.5, 0.4]);
    expect(r[2] >= 0.7 && r[2] < 0.76).toBe(true);
    expect(r[0] <= 0.3 && r[0] > 0.26).toBe(true);
  });

  it('finishes the lines of text its edges cross', () => {
    const frame = solid(1728, 1117, 30);
    const fill = (x0: number, x1: number, y0: number, h: number) => {
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x1; x++) if (x % 48 < 44) paint(frame, x, y, 220);
    };
    for (const [i, end] of [1300, 1250, 1290, 1180, 1300, 1270, 1240, 1300].entries())
      fill(646, end, 120 + i * 26, 12);
    fill(310, 1700, 400, 2);
    const content = Content.fromPixels(frame.rgba, frame.w, frame.h, SCREEN);
    const crop: Rect = [621 / 1728, 27 / 1117, 1248 / 1728, 832 / 1117];
    const window: Rect = [310 / 1728, 38 / 1117, 1990 / 1728, 1];
    const r = ctx().finishLines(crop, content, window);
    const right = r[2] * 1728;
    expect(right >= 1300 && right < 1330).toBe(true);
    expect(r[0]).toBe(crop[0]);
    expect([r[1], r[3]]).toEqual([crop[1], crop[3]]);
    const narrow: Rect = [310 / 1728, 0, 1270 / 1728, 1];
    const right2 = ctx().finishLines(crop, content, narrow)[2] * 1728;
    expect(right2 >= 1245 && right2 <= 1270).toBe(true);
  });

  it('crops each picture to its activity, reuses the last crop for talk, keeps big ones whole', () => {
    const crops = computeCrops({
      screen: [1280, 800],
      duration: 9000,
      keyframes: [0, 3000, 6000, 8000],
      items: [
        {
          kind: 'stroke',
          t0: 2800,
          t1: 3200,
          pts: [
            [0.1, 0.1, 2800],
            [0.2, 0.12, 3000],
            [0.15, 0.16, 3200],
          ],
          dwell: 0,
          keyframe: 1,
        },
        { kind: 'click', t0: 6000, t1: 6000, pts: [[0.8, 0.8, 6000]], dwell: 0 },
        // Ink right across the screen: not worth cropping.
        {
          kind: 'stroke',
          t0: 7900,
          t1: 8100,
          pts: [
            [0.02, 0.05, 7900],
            [0.98, 0.95, 8100],
          ],
          dwell: 0,
        },
      ],
      content: [null, null, null, null],
    });
    expect(crops.map((c) => c.kind)).toEqual(['fallback', 'activity', 'activity', 'full']);
    const ink = crops[1]!.rect;
    expect(ink[0]).toBe(0);
    expect(ink[2] * 1280).toBeGreaterThanOrEqual(320);
    expect(crops[0]!.rect).toEqual(ink);
    expect(crops[2]!.rect[0]).toBeGreaterThan(0.5);
  });
});
