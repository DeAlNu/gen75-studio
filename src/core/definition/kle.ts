import type { PhysicalKey } from './types';

export type RawKey = Omit<PhysicalKey, 'index'>;

const PAIR = /^\s*(\d+)\s*,\s*(\d+)\s*$/;
const ENCODER = /^\s*e(\d+)\s*$/;

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
}

function parseLegend(text: string, g: Geometry): RawKey {
  const parts = text.split('\n');
  const pos = PAIR.exec(parts[0] ?? '');
  if (!pos) throw new Error(`label matriks tidak valid: "${parts[0] ?? ''}"`);
  const opt = PAIR.exec(parts[3] ?? '');
  const enc = ENCODER.exec(parts[9] ?? '');
  return {
    row: Number(pos[1]),
    col: Number(pos[2]),
    x: g.x,
    y: g.y,
    w: g.w,
    h: g.h,
    color: g.color,
    option: opt ? { group: Number(opt[1]), choice: Number(opt[2]) } : null,
    encoder: enc ? Number(enc[1]) : null,
  };
}

/**
 * Membaca layout KLE: setiap string adalah satu tombol, setiap objek
 * mengubah posisi (x, y), ukuran (w, h), atau warna (c) untuk tombol berikutnya.
 */
export function parseKle(rows: unknown): RawKey[] {
  if (!Array.isArray(rows)) throw new Error('layouts.keymap harus berupa array');
  const out: RawKey[] = [];
  let y = 0;
  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) throw new Error(`baris KLE ${rowIndex} bukan array`);
    let x = 0;
    let w = 1;
    let h = 1;
    let color = '#cccccc';
    for (const item of row) {
      if (typeof item === 'string') {
        out.push(parseLegend(item, { x, y, w, h, color }));
        x += w;
        w = 1;
        h = 1;
      } else if (item && typeof item === 'object') {
        const p = item as Record<string, unknown>;
        if ('r' in p || 'rx' in p || 'ry' in p) throw new Error('rotasi KLE belum didukung');
        if (typeof p.x === 'number') x += p.x;
        if (typeof p.y === 'number') y += p.y;
        if (typeof p.w === 'number') w = p.w;
        if (typeof p.h === 'number') h = p.h;
        if (typeof p.c === 'string') color = p.c;
      }
    }
    y += 1;
  });
  return out;
}
