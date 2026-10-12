import { type RefObject, useEffect, useState } from 'react';

/*
 * Liquid Glass for the floating toolbar, rendered from the live page behind it.
 *
 * The Remote Desktop viewer (studio-hub assist/public/desk/decode-worker.js) owns the pixels
 * behind its toolbar and refracts them in a WebGL2 pass ported from Glass-HQ/liquid-glass
 * (MIT): edge displacement from optics.ts (samples pulled ~30px inward near the rim, with
 * `edge = 1 - sqrt((2 - depth) * depth)`, `depth = sat(-d * 0.05)`), the Regular material's
 * frost + saturation, and a rim light top/bottom with a soft side shade.
 *
 * An extension cannot read the page's pixels every frame, but Chromium can filter them for
 * us: `backdrop-filter: url(#svg)`. So the same displacement profile is baked into a
 * displacement map (feImage → feDisplacementMap) sized to the toolbar's capsule, followed by
 * frost (blur) and the material's saturation/brightness. The rim is the Remote's CSS rim
 * (inset highlights + side shade). Pages whose CSP blocks data: images fall back to the
 * Remote's CSS glass approximation automatically.
 */

export const GLASS_FILTER_ID = 'cd-liquid-glass';
export const GOO_ID = 'cd-goo';
const TRAVEL = 30;

/** Capsule displacement map (R = x, G = y, 128 = none) as a PNG data URL. */
export function displacementMap(width: number, height: number, travel = TRAVEL): string {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  const img = ctx.createImageData(w, h);
  const r = Math.min(w, h) / 2;
  const sdf = (px: number, py: number) => {
    const qx = Math.abs(px - w / 2) - (w / 2 - r);
    const qy = Math.abs(py - h / 2) - (h / 2 - r);
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x + 0.5;
      const py = y + 0.5;
      const d = sdf(px, py);
      const nx = sdf(px + 0.5, py) - sdf(px - 0.5, py);
      const ny = sdf(px, py + 0.5) - sdf(px, py - 0.5);
      const len = Math.hypot(nx, ny) || 1;
      const depth = Math.min(1, Math.max(0, -d * 0.05));
      const edge = 1 - Math.min(1, Math.sqrt((2 - depth) * depth));
      const i = (y * w + x) * 4;
      img.data[i] = 128 + ((-(nx / len) * edge * travel) / TRAVEL) * 127;
      img.data[i + 1] = 128 + ((-(ny / len) * edge * travel) / TRAVEL) * 127;
      img.data[i + 2] = 128;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}

/** SVG filter definitions; rendered once inside the shadow root. */
export function GlassFilters({ map }: { map: { url: string; w: number; h: number } | null }) {
  return (
    <svg className="filters" width="0" height="0" aria-hidden="true" focusable="false">
      <title>Chrome Design filters</title>
      {map ? (
        <filter
          id={GLASS_FILTER_ID}
          x="0"
          y="0"
          width="100%"
          height="100%"
          colorInterpolationFilters="sRGB"
        >
          <feImage
            href={map.url}
            x="0"
            y="0"
            width={map.w}
            height={map.h}
            preserveAspectRatio="none"
            result="map"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="map"
            scale={TRAVEL * 2}
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      ) : null}
      <filter id={GOO_ID} x="-75%" y="-150%" width="250%" height="400%">
        <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="spread" />
        <feColorMatrix
          in="spread"
          type="matrix"
          values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -11"
        />
      </filter>
    </svg>
  );
}

/** Keeps a displacement map in sync with the glass element's size. */
export function useGlassMap(ref: RefObject<HTMLElement | null>) {
  const [map, setMap] = useState<{ url: string; w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    const update = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const w = Math.round(el.offsetWidth);
        const h = Math.round(el.offsetHeight);
        if (!w || !h) return;
        setMap((prev) =>
          prev && prev.w === w && prev.h === h ? prev : { url: displacementMap(w, h), w, h },
        );
      }, 60);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [ref]);
  return map;
}

/** True once the page's CSP has blocked our data: displacement map (→ CSS glass fallback). */
export function useCspGlassFallback(): boolean {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    const onViolation = (e: SecurityPolicyViolationEvent) => {
      if (e.blockedURI === 'data' || e.blockedURI.startsWith('data:')) setBlocked(true);
    };
    document.addEventListener('securitypolicyviolation', onViolation);
    return () => document.removeEventListener('securitypolicyviolation', onViolation);
  }, []);
  return blocked;
}

function parseRgb(color: string): [number, number, number, number] | null {
  const m = color.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/i);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
}

/** Relative luminance of the page's painted background under a viewport point (0–1). */
export function backdropLuminance(x: number, y: number, skip: (el: Element) => boolean): number {
  let el: Element | null = null;
  for (const candidate of document.elementsFromPoint(x, y)) {
    if (!skip(candidate)) {
      el = candidate;
      break;
    }
  }
  while (el) {
    const rgb = parseRgb(getComputedStyle(el).backgroundColor);
    if (rgb && rgb[3] > 0.5) {
      const [r, g, b] = rgb.map((c) => {
        const v = c / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      }) as [number, number, number];
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    }
    el = el.parentElement;
  }
  return 1; // canvas default is white
}

/**
 * Liquid Glass adapts to what is behind it: dark ink over light pages, light ink over dark
 * ones. Sampled under the element's centre and ends, re-checked on scroll (throttled).
 */
export function useBackdropTone(
  ref: RefObject<HTMLElement | null>,
  skip: (el: Element) => boolean,
): 'light' | 'dark' {
  const [tone, setTone] = useState<'light' | 'dark'>('light');
  useEffect(() => {
    let frame = 0;
    let last = 0;
    const sample = () => {
      frame = 0;
      last = performance.now();
      const el = ref.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (!r.width) return;
      const y = r.top + r.height / 2;
      const xs = [r.left + 12, r.left + r.width / 2, r.right - 12];
      const lum = xs.reduce((sum, x) => sum + backdropLuminance(x, y, skip), 0) / xs.length;
      setTone(lum < 0.36 ? 'dark' : 'light');
    };
    const schedule = () => {
      if (frame) return;
      const wait = Math.max(0, 180 - (performance.now() - last));
      frame = window.setTimeout(() => requestAnimationFrame(sample), wait);
    };
    sample();
    window.addEventListener('scroll', schedule, { passive: true, capture: true });
    window.addEventListener('resize', schedule);
    const ro = new ResizeObserver(schedule);
    if (ref.current) ro.observe(ref.current);
    const mo = new MutationObserver(schedule);
    if (ref.current) mo.observe(ref.current, { attributes: true, attributeFilter: ['style'] });
    return () => {
      window.clearTimeout(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref, skip]);
  return tone;
}
