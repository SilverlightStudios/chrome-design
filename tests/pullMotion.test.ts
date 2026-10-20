// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { PullMotion } from '../src/content/motion/BottomSheet';

function setup() {
  const motion = new PullMotion();
  const surface = document.createElement('div');
  const root = document.createElement('div');
  motion.surface = surface;
  motion.root = root;
  motion.dragging = true; // keep the opening spring out of the way
  motion.measured({ w: 400, h: 200 });
  const px = (name: string) => Number.parseFloat(surface.style.getPropertyValue(name));
  return { motion, px, root, surface };
}

describe('phone sheet morph (Spark scrub drawer)', () => {
  it('opens to the full box with the content and scrim fully in', () => {
    const { motion, px, root, surface } = setup();
    motion.drag(0);
    expect(px('--h')).toBe(200);
    expect(px('--w')).toBe(400);
    expect(px('--oy')).toBe(0);
    expect(surface.style.getPropertyValue('--reveal')).toBe('1.0000');
    expect(root.style.getPropertyValue('--progress')).toBe('1.0000');
  });

  it('narrows on an exponential curve as the top edge comes down', () => {
    const { motion, px } = setup();
    motion.drag(100); // halfway down
    expect(px('--h')).toBe(100);
    // 38% start + (expm1(1.5) / expm1(3)) of the rest
    expect(px('--w')).toBeCloseTo(152 + 248 * (Math.expm1(1.5) / Math.expm1(3)), 1);
  });

  it('gives at most 36px when pulled past open, and drops below the edge past closed', () => {
    const { motion, px } = setup();
    motion.drag(-2000);
    expect(px('--h') - 200).toBeGreaterThan(30);
    expect(px('--h') - 200).toBeLessThan(36);
    expect(px('--rb')).toBeCloseTo(px('--h') - 200, 1);
    motion.drag(260); // 60px below closed
    expect(px('--h')).toBe(0);
    expect(px('--oy')).toBe(60);
  });

  it('decides open or closed from where the release is heading', () => {
    const { motion } = setup();
    motion.drag(90);
    expect(motion.release(0)).toBe(true); // still above halfway
    motion.drag(120);
    expect(motion.release(0)).toBe(false); // below halfway
    motion.drag(60);
    expect(motion.release(-900)).toBe(false); // a downward flick closes it from high up
    motion.stop();
  });
});
