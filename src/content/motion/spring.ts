/**
 * Closed-form damped spring, ported from Spark (src/lib/spring.ts) together with the
 * stiffness/damping helpers from Spark's StackableDrawer (useDrawerMorph.ts), so sheets here
 * open and close on the same physics: exact for any timestep and velocity-preserving when
 * retargeted mid-flight.
 */

export interface Spring {
  value: number;
  velocity: number;
  target: number;
  /** Damping ratio: < 1 overshoots, 1 is critical. */
  damping: number;
  stiffness: number;
}

const REST_DISPLACEMENT = 0.01;
const REST_VELOCITY = 0.01;

export function createSpring(value: number, stiffness = stiffnessFor(0.384), damping = 1): Spring {
  return { value, velocity: 0, target: value, damping, stiffness };
}

export function isAtRest(s: Spring): boolean {
  return (
    Math.abs(s.value - s.target) < REST_DISPLACEMENT * Math.max(1, Math.abs(s.target)) &&
    Math.abs(s.velocity) < REST_VELOCITY
  );
}

export function advance(s: Spring, dt: number): void {
  const { stiffness, damping: zeta, target } = s;
  const omega = Math.sqrt(stiffness);
  const x0 = s.value - target;
  const v0 = s.velocity;
  let x: number;
  let v: number;
  if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    const decay = Math.exp(-zeta * omega * dt);
    const b = (v0 + zeta * omega * x0) / omegaD;
    const cos = Math.cos(omegaD * dt);
    const sin = Math.sin(omegaD * dt);
    x = decay * (x0 * cos + b * sin);
    v = decay * ((b * omegaD - zeta * omega * x0) * cos - (x0 * omegaD + zeta * omega * b) * sin);
  } else if (zeta === 1) {
    const decay = Math.exp(-omega * dt);
    const b = v0 + omega * x0;
    x = decay * (x0 + b * dt);
    v = decay * (b - omega * (x0 + b * dt));
  } else {
    const rate = omega * Math.sqrt(zeta * zeta - 1);
    const r1 = -zeta * omega + rate;
    const r2 = -zeta * omega - rate;
    const c2 = (v0 - r1 * x0) / (r2 - r1);
    const c1 = x0 - c2;
    x = c1 * Math.exp(r1 * dt) + c2 * Math.exp(r2 * dt);
    v = c1 * r1 * Math.exp(r1 * dt) + c2 * r2 * Math.exp(r2 * dt);
  }
  s.value = x + target;
  s.velocity = v;
  if (isAtRest(s)) {
    s.value = target;
    s.velocity = 0;
  }
}

/** Stiffness whose natural period is `seconds` (Spark: `(2π)² / s²`). */
export function stiffnessFor(seconds: number): number {
  return (2 * Math.PI) ** 2 / (seconds * seconds);
}

/** Damping ratio that overshoots a move of `distance` by roughly `overshoot` px. */
export function dampingFor(distance: number, overshoot: number): number {
  if (distance < 1 || overshoot <= 0 || overshoot >= distance * 0.6) return 1;
  const k = -Math.log(overshoot / distance) / Math.PI;
  return Math.min(1, Math.max(0.25, k / Math.sqrt(1 + k * k)));
}

export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
