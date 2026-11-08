// Membuat ikon aplikasi (PNG dan SVG) dari satu definisi geometri.
// Jalankan dari akar repo: node tools/icons/make-icons.mjs
// Hasil ditulis ke public/ dan ikut di-commit, jadi build tidak bergantung pada skrip ini.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

const COLORS = {
  bg: [14, 16, 21],
  key: [69, 77, 99],
  accent: [255, 122, 26],
};

const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;

/**
 * Bentuk dalam satuan lebar ikon = 1. Papan 5 kolom x 3 baris:
 * dua baris tombol, knob di pojok kanan atas, dan baris bawah dengan spasi lebar.
 */
function shapes({ width, corner }) {
  const cols = 5;
  const gapRatio = 0.2;
  const k = width / (cols + (cols - 1) * gapRatio);
  const g = k * gapRatio;
  const height = 3 * k + 2 * g;
  const x0 = (1 - width) / 2;
  const y0 = (1 - height) / 2;
  const r = k * 0.22;

  const out = [{ kind: 'rect', x: 0, y: 0, w: 1, h: 1, r: corner, color: 'bg' }];
  const key = (col, row, span = 1) => ({
    kind: 'rect',
    x: x0 + col * (k + g),
    y: y0 + row * (k + g),
    w: span * k + (span - 1) * g,
    h: k,
    r,
    color: 'key',
  });

  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (row === 0 && col === cols - 1) {
        out.push({ kind: 'circle', cx: x0 + col * (k + g) + k / 2, cy: y0 + k / 2, r: k / 2, color: 'accent' });
      } else {
        out.push(key(col, row));
      }
    }
  }
  out.push(key(0, 2), key(1, 2, 3), key(4, 2));
  return out;
}

function contains(s, px, py) {
  if (s.kind === 'circle') return Math.hypot(px - s.cx, py - s.cy) <= s.r;
  const qx = Math.abs(px - (s.x + s.w / 2)) - (s.w / 2 - s.r);
  const qy = Math.abs(py - (s.y + s.h / 2)) - (s.h / 2 - s.r);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - s.r <= 0;
}

const SAMPLES = 4;

/** Rasterisasi dengan supersampling 4x4; hasil RGBA 8 bit, alfa lurus. */
function raster(size, list) {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      let hit = 0;
      for (let sy = 0; sy < SAMPLES; sy += 1) {
        for (let sx = 0; sx < SAMPLES; sx += 1) {
          const px = (x + (sx + 0.5) / SAMPLES) / size;
          const py = (y + (sy + 0.5) / SAMPLES) / size;
          let top = null;
          for (const s of list) if (contains(s, px, py)) top = s;
          if (top) {
            const c = COLORS[top.color];
            r += c[0];
            g += c[1];
            b += c[2];
            hit += 1;
          }
        }
      }
      const at = (y * size + x) * 4;
      if (hit > 0) {
        data[at] = Math.round(r / hit);
        data[at + 1] = Math.round(g / hit);
        data[at + 2] = Math.round(b / hit);
      }
      data[at + 3] = Math.round((hit / (SAMPLES * SAMPLES)) * 255);
    }
  }
  return data;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, body) {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(body.length);
  const payload = Buffer.concat([Buffer.from(type, 'ascii'), body]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(payload));
  return Buffer.concat([head, payload, tail]);
}

function encodePng(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // kedalaman bit
  ihdr[9] = 6; // RGBA
  const stride = size * 4;
  const rows = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y += 1) {
    rows[y * (stride + 1)] = 0; // tanpa filter
    rgba.copy(rows, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function svg(list) {
  const n = (v) => Number((v * 512).toFixed(2));
  const body = list.map((s) => {
    const fill = hex(COLORS[s.color]);
    if (s.kind === 'circle') return `  <circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" fill="${fill}"/>`;
    const radius = s.r > 0 ? ` rx="${n(s.r)}"` : '';
    return `  <rect x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}"${radius} fill="${fill}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">\n${body.join('\n')}\n</svg>\n`;
}

// "any": sudut membulat, transparan di luar. "maskable" dan apple-touch: penuh, sistem yang memotong.
const rounded = shapes({ width: 0.68, corner: 0.22 });
const maskable = shapes({ width: 0.54, corner: 0 });
const apple = shapes({ width: 0.62, corner: 0 });

mkdirSync(OUT, { recursive: true });
const files = [
  ['icon-192.png', encodePng(192, raster(192, rounded))],
  ['icon-512.png', encodePng(512, raster(512, rounded))],
  ['icon-maskable-512.png', encodePng(512, raster(512, maskable))],
  ['apple-touch-icon.png', encodePng(180, raster(180, apple))],
  ['favicon.svg', Buffer.from(svg(rounded), 'utf8')],
];
for (const [name, bytes] of files) {
  writeFileSync(join(OUT, name), bytes);
  console.log(`${name}: ${bytes.length} byte`);
}
