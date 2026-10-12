// Generates the extension icons (original artwork) as PNGs without any dependencies.
// Dark rounded tile, white pointer, blue comment bubble.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/icons');
mkdirSync(outDir, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, pixels) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Signed distance helpers in a 0..1 unit square.
const roundRect = (x, y, cx, cy, hw, hh, r) => {
  const qx = Math.abs(x - cx) - hw + r;
  const qy = Math.abs(y - cy) - hh + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};
const inTriangle = (px, py, a, b, c) => {
  const s = (p1, p2, p3) => (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1]);
  const d1 = s([px, py], a, b);
  const d2 = s([px, py], b, c);
  const d3 = s([px, py], c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
};

const inPolygon = (x, y, pts) => {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
};
// Classic arrow cursor, tip at top-left.
const CURSOR = [
  [0.2, 0.18],
  [0.2, 0.76],
  [0.33, 0.64],
  [0.43, 0.84],
  [0.51, 0.8],
  [0.41, 0.6],
  [0.58, 0.6],
];
const OUTLINE = 0.045;
const RING = Array.from({ length: 12 }, (_, i) => [
  Math.cos((i / 12) * Math.PI * 2) * OUTLINE,
  Math.sin((i / 12) * Math.PI * 2) * OUTLINE,
]);

function sample(x, y) {
  if (roundRect(x, y, 0.5, 0.5, 0.5, 0.5, 0.22) > 0) return [0, 0, 0, 0];
  let color = [24, 25, 28, 255];
  // Comment bubble with a tail pointing down-left.
  const bubble = roundRect(x, y, 0.63, 0.4, 0.21, 0.17, 0.17);
  const tail = inTriangle(x, y, [0.47, 0.48], [0.6, 0.55], [0.44, 0.66]);
  if (bubble < 0 || tail) color = [59, 130, 246, 255];
  if (RING.some(([dx, dy]) => inPolygon(x + dx, y + dy, CURSOR))) color = [24, 25, 28, 255];
  if (inPolygon(x, y, CURSOR)) color = [255, 255, 255, 255];
  return color;
}

for (const size of [16, 32, 48, 128]) {
  const ss = 4;
  const pixels = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const [r, g, b, a] = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size);
          acc[0] += r * a;
          acc[1] += g * a;
          acc[2] += b * a;
          acc[3] += a;
        }
      }
      const i = (py * size + px) * 4;
      const alpha = acc[3] / (ss * ss);
      pixels[i] = acc[3] ? acc[0] / acc[3] : 0;
      pixels[i + 1] = acc[3] ? acc[1] / acc[3] : 0;
      pixels[i + 2] = acc[3] ? acc[2] / acc[3] : 0;
      pixels[i + 3] = alpha;
    }
  }
  writeFileSync(resolve(outDir, `icon-${size}.png`), png(size, pixels));
}
console.log('icons written to public/icons');
