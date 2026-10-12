import { describe, expect, it } from 'vitest';
import {
  arrowHead,
  distanceToSegment,
  hitTestShape,
  rectFromPoints,
  simplifyPath,
  snapAngle,
  translateShape,
} from '../src/shared/geometry';
import type { Shape } from '../src/shared/model';

const style = { color: '#000', width: 2, dashed: false };
const at = '2026-01-01T00:00:00.000Z';

describe('geometry', () => {
  it('normalises rects from any drag direction', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({
      x: 0,
      y: 5,
      width: 10,
      height: 15,
    });
  });

  it('measures distance to a segment', () => {
    expect(distanceToSegment({ x: 5, y: 5 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
    expect(distanceToSegment({ x: -3, y: 4 }, { x: 0, y: 0 }, { x: 10, y: 0 })).toBe(5);
  });

  it('snaps to 45° increments', () => {
    const p = snapAngle({ x: 0, y: 0 }, { x: 10, y: 1 });
    expect(p.y).toBeCloseTo(0);
    expect(p.x).toBeCloseTo(Math.hypot(10, 1));
  });

  it('simplifies collinear points', () => {
    const pts = Array.from({ length: 20 }, (_, i) => ({ x: i, y: 0 }));
    expect(simplifyPath(pts)).toEqual([
      { x: 0, y: 0 },
      { x: 19, y: 0 },
    ]);
  });

  it('builds a symmetric arrow head behind the tip', () => {
    const [a, b] = arrowHead({ x: 0, y: 0 }, { x: 100, y: 0 }, 10);
    expect(a.x).toBeLessThan(100);
    expect(a.y).toBeCloseTo(-b.y);
  });

  it('hit-tests strokes, not fills', () => {
    const rect: Shape = {
      id: 'r',
      type: 'shape',
      kind: 'rect',
      rect: { x: 0, y: 0, width: 100, height: 100 },
      style,
      createdAt: at,
    };
    expect(hitTestShape(rect, { x: 0, y: 50 }, 4)).toBe(true);
    expect(hitTestShape(rect, { x: 50, y: 50 }, 4)).toBe(false);
    const ellipse: Shape = { ...rect, id: 'e', kind: 'ellipse' } as Shape;
    expect(hitTestShape(ellipse, { x: 50, y: 0 }, 4)).toBe(true);
    expect(hitTestShape(ellipse, { x: 50, y: 50 }, 4)).toBe(false);
    const pen: Shape = {
      id: 'p',
      type: 'shape',
      kind: 'pen',
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      style,
      createdAt: at,
    };
    expect(hitTestShape(pen, { x: 5, y: 6 }, 2)).toBe(true);
  });

  it('translates shapes immutably', () => {
    const line: Shape = {
      id: 'l',
      type: 'shape',
      kind: 'arrow',
      from: { x: 0, y: 0 },
      to: { x: 5, y: 5 },
      style,
      createdAt: at,
    };
    const moved = translateShape(line, 10, -5);
    expect(moved).toMatchObject({ from: { x: 10, y: -5 }, to: { x: 15, y: 0 } });
    expect(line).toMatchObject({ from: { x: 0, y: 0 } });
  });
});
