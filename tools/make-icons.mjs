// Genereert de app-iconen (PNG) zonder externe packages: node tools/make-icons.mjs
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = buf => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
}
function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const mix = (a, b, t) => a + (b - a) * t;
const segDist = (px, py, ax, ay, bx, by) => {
  const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
};
const roundRect = (x, y, x0, y0, x1, y1, r) => {
  const cx = Math.max(x0 + r, Math.min(x, x1 - r)), cy = Math.max(y0 + r, Math.min(y, y1 - r));
  return Math.hypot(x - cx, y - cy) <= r && x >= x0 && x <= x1 && y >= y0 && y <= y1;
};
// handgeschreven "kronkel" op de pagina
const wave = Array.from({ length: 60 }, (_, i) => { const t = i / 59; return [0.33 + t * 0.36, 0.64 + Math.sin(t * Math.PI * 3) * 0.035 - t * 0.02]; });

// Kleur van één punt (u,v in 0..1), full-bleed (iOS maakt zelf de ronde hoeken)
function sample(u, v) {
  let r = mix(79, 122, u * 0.6 + v * 0.4), g = mix(107, 79, u * 0.6 + v * 0.4), b = mix(237, 214, u * 0.6 + v * 0.4);
  // pagina (licht gedraaid gevoel door schaduw)
  if (roundRect(u, v, 0.27, 0.22, 0.75, 0.82, 0.04) || roundRect(u, v, 0.25, 0.19, 0.73, 0.79, 0.04)) {
    const shadow = !roundRect(u, v, 0.25, 0.19, 0.73, 0.79, 0.04);
    if (shadow) { r *= 0.75; g *= 0.75; b *= 0.8; }
    else {
      [r, g, b] = [255, 255, 255];
      for (const ly of [0.33, 0.42, 0.51]) if (Math.abs(v - ly) < 0.007 && u > 0.31 && u < 0.67) [r, g, b] = [205, 215, 232];
      for (let i = 0; i < wave.length - 1; i++) {
        if (segDist(u, v, ...wave[i], ...wave[i + 1]) < 0.018) { [r, g, b] = [79, 107, 237]; break; }
      }
    }
  }
  // pen
  const pd = segDist(u, v, 0.80, 0.18, 0.60, 0.60);
  if (pd < 0.045 && v < 0.58) [r, g, b] = v < 0.25 ? [255, 214, 92] : [255, 179, 64];
  if (v >= 0.56 && pd < 0.045 * (1 - (v - 0.56) / 0.09) + 0.004 && v < 0.66) [r, g, b] = [40, 40, 52];
  return [r, g, b];
}

function render(size) {
  const buf = Buffer.alloc(size * size * 4), SS = 4;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let R = 0, G = 0, B = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const [r, g, b] = sample((x + (sx + 0.5) / SS) / size, (y + (sy + 0.5) / SS) / size);
      R += r; G += g; B += b;
    }
    const i = (y * size + x) * 4, n = SS * SS;
    buf[i] = R / n; buf[i + 1] = G / n; buf[i + 2] = B / n; buf[i + 3] = 255;
  }
  return png(size, buf);
}

const out = new URL('../icons/', import.meta.url);
mkdirSync(out, { recursive: true });
for (const s of [180, 192, 512]) writeFileSync(new URL(`icon-${s}.png`, out), render(s));
console.log('Iconen gemaakt in', out.pathname);
