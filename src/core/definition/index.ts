import rawDefinition from '../../../GEN 75.JSON?raw';
import { parseKle } from './kle';
import { parseMenus } from './menus';
import type { CustomKeycode, DeviceDefinition, LayoutOption } from './types';

export type { DeviceDefinition, PhysicalKey, MenuControl, MenuGroup, MenuNode, CustomKeycode } from './types';

type Rec = Record<string, unknown>;

function rec(v: unknown, what: string): Rec {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`${what} harus berupa objek`);
  return v as Rec;
}

function parseId(v: unknown, what: string): number {
  const n = typeof v === 'string' ? Number.parseInt(v, v.toLowerCase().startsWith('0x') ? 16 : 10) : v;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error(`${what} tidak valid`);
  return n;
}

function parseCustomKeycodes(raw: unknown): CustomKeycode[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('customKeycodes harus array');
  return raw.map((c, i) => {
    const r = rec(c, `customKeycodes[${i}]`);
    if (typeof r.name !== 'string' || typeof r.title !== 'string') throw new Error(`customKeycodes[${i}] tidak lengkap`);
    return { name: r.name, title: r.title, shortName: typeof r.shortName === 'string' ? r.shortName : r.name };
  });
}

function parseLayoutOptions(raw: unknown): LayoutOption[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) throw new Error('layouts.labels harus array');
  return raw.map((l, group) => {
    if (typeof l === 'string') return { group, label: l, choices: 2 };
    if (Array.isArray(l) && typeof l[0] === 'string') return { group, label: l[0], choices: l.length - 1 };
    throw new Error(`layouts.labels[${group}] tidak valid`);
  });
}

export function parseDefinition(json: unknown): DeviceDefinition {
  const r = rec(json, 'definisi');
  if (typeof r.name !== 'string') throw new Error('definisi tanpa name');
  const matrix = rec(r.matrix, 'matrix');
  const rows = Number(matrix.rows);
  const cols = Number(matrix.cols);
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) throw new Error('ukuran matrix tidak valid');

  const layouts = rec(r.layouts, 'layouts');
  const raw = parseKle(layouts.keymap);
  const seen = new Set<string>();
  const keys = raw.map((k, index) => {
    if (k.row >= rows || k.col >= cols) throw new Error(`tombol ${k.row},${k.col} di luar matrix ${rows}x${cols}`);
    const id = `${k.row},${k.col}`;
    if (seen.has(id)) throw new Error(`posisi matriks ganda: ${id}`);
    seen.add(id);
    return { ...k, index };
  });

  return {
    name: r.name,
    vendorId: parseId(r.vendorId, 'vendorId'),
    productId: parseId(r.productId, 'productId'),
    matrix: { rows, cols },
    keys,
    width: Math.max(...keys.map((k) => k.x + k.w)),
    height: Math.max(...keys.map((k) => k.y + k.h)),
    menus: parseMenus(r.menus ?? []),
    customKeycodes: parseCustomKeycodes(r.customKeycodes),
    layoutOptions: parseLayoutOptions(layouts.labels),
  };
}

export const gen75: DeviceDefinition = parseDefinition(JSON.parse(rawDefinition));
