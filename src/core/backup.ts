import { controlsOf } from './definition/menus';
import type { DeviceDefinition } from './definition/types';
import { hex4, isKnownRange } from './keycodes';
import { encodeValue } from './session';
import type { LightingValue, LightingValues } from './session';

export interface Backup {
  schemaVersion: 1;
  app: string;
  createdAt: string;
  device: {
    name: string;
    vendorId: string;
    productId: string;
    matrix: { rows: number; cols: number };
    protocolVersion: number;
  };
  keymap: { layers: string[][] };
  lighting: LightingValues | null;
}

export interface KeyChange {
  layer: number;
  keyIndex: number;
  from: number;
  to: number;
}

export interface LightingChange {
  id: string;
  to: LightingValue;
}

export function createBackup(
  def: DeviceDefinition,
  state: { protocolVersion: number; keymap: readonly Uint16Array[]; lighting: LightingValues | null },
  now: Date = new Date(),
): Backup {
  return {
    schemaVersion: 1,
    app: 'gen75-studio',
    createdAt: now.toISOString(),
    device: {
      name: def.name,
      vendorId: hex4(def.vendorId),
      productId: hex4(def.productId),
      matrix: { ...def.matrix },
      protocolVersion: state.protocolVersion,
    },
    keymap: { layers: state.keymap.map((words) => Array.from(words, hex4)) },
    lighting: state.lighting ? JSON.parse(JSON.stringify(state.lighting)) : null,
  };
}

export type BackupParse = { ok: true; backup: Backup } | { ok: false; error: string };

const fail = (error: string): BackupParse => ({ ok: false, error });
const HEX = /^0x[0-9a-f]{4}$/i;

function sameId(text: unknown, expected: number): boolean {
  return typeof text === 'string' && /^0x[0-9a-f]{1,4}$/i.test(text) && Number.parseInt(text, 16) === expected;
}

export function parseBackup(text: string, def: DeviceDefinition, maxLayers: number): BackupParse {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('Berkas bukan JSON yang valid.');
  }
  if (!raw || typeof raw !== 'object') return fail('Isi backup tidak valid.');
  const b = raw as Record<string, unknown>;
  if (b.schemaVersion !== 1) return fail('Versi skema backup tidak dikenal.');

  const dev = b.device as Record<string, unknown> | undefined;
  if (!dev || !sameId(dev.vendorId, def.vendorId) || !sameId(dev.productId, def.productId)) {
    return fail(`Backup ini bukan untuk ${def.name} (VID/PID berbeda).`);
  }
  const matrix = dev.matrix as { rows?: unknown; cols?: unknown } | undefined;
  if (!matrix || matrix.rows !== def.matrix.rows || matrix.cols !== def.matrix.cols) {
    return fail(`Ukuran matriks backup berbeda dari ${def.matrix.rows}x${def.matrix.cols}.`);
  }

  const layers = (b.keymap as { layers?: unknown } | undefined)?.layers;
  if (!Array.isArray(layers) || layers.length < 1) return fail('Backup tidak berisi layer.');
  if (layers.length > maxLayers) return fail(`Backup berisi ${layers.length} layer, perangkat hanya punya ${maxLayers}.`);
  const slots = def.matrix.rows * def.matrix.cols;
  const used = new Set(def.keys.map((k) => k.row * def.matrix.cols + k.col));
  for (let l = 0; l < layers.length; l += 1) {
    const layer = layers[l];
    if (!Array.isArray(layer) || layer.length !== slots) return fail(`Layer ${l} harus berisi ${slots} keycode.`);
    for (let i = 0; i < slots; i += 1) {
      const v = layer[i];
      if (typeof v !== 'string' || !HEX.test(v)) return fail(`Layer ${l}, posisi ${i}: format keycode tidak valid.`);
      if (used.has(i) && !isKnownRange(Number.parseInt(v, 16))) return fail(`Layer ${l}, posisi ${i}: keycode ${v} di luar rentang yang dikenal.`);
    }
  }

  let lighting: LightingValues | null = null;
  if (b.lighting !== null && b.lighting !== undefined) {
    if (typeof b.lighting !== 'object' || Array.isArray(b.lighting)) return fail('Bagian lighting tidak valid.');
    const controls = controlsOf(def.menus);
    lighting = {};
    for (const [id, value] of Object.entries(b.lighting as Record<string, unknown>)) {
      const c = controls.find((x) => x.ref.id === id);
      if (!c) return fail(`Nilai lighting tidak dikenal: ${id}.`);
      try {
        encodeValue(c, value as LightingValue);
      } catch {
        return fail(`Nilai lighting "${id}" tidak valid.`);
      }
      lighting[id] = value as LightingValue;
    }
  }

  return {
    ok: true,
    backup: {
      schemaVersion: 1,
      app: typeof b.app === 'string' ? b.app : 'gen75-studio',
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : new Date(0).toISOString(),
      device: {
        name: def.name,
        vendorId: hex4(def.vendorId),
        productId: hex4(def.productId),
        matrix: { ...def.matrix },
        protocolVersion: typeof dev.protocolVersion === 'number' ? dev.protocolVersion : 0,
      },
      keymap: { layers: (layers as string[][]).map((l) => l.map((v) => hex4(Number.parseInt(v, 16)))) },
      lighting,
    },
  };
}

export function backupKeymap(backup: Backup): Uint16Array[] {
  return backup.keymap.layers.map((l) => Uint16Array.from(l, (v) => Number.parseInt(v, 16)));
}

/** Perbedaan keymap pada posisi tombol yang didefinisikan; slot matriks kosong tidak disentuh. */
export function diffKeymap(def: DeviceDefinition, current: readonly Uint16Array[], target: readonly Uint16Array[]): KeyChange[] {
  const changes: KeyChange[] = [];
  const cols = def.matrix.cols;
  target.forEach((words, layer) => {
    for (const key of def.keys) {
      const slot = key.row * cols + key.col;
      const from = current[layer]?.[slot] ?? 0;
      const to = words[slot] ?? 0;
      if (from !== to) changes.push({ layer, keyIndex: key.index, from, to });
    }
  });
  return changes;
}

const sameValue = (a: LightingValue | undefined, b: LightingValue): boolean => JSON.stringify(a) === JSON.stringify(b);

export function diffLighting(current: LightingValues | null, target: LightingValues | null): LightingChange[] {
  if (!target) return [];
  return Object.entries(target)
    .filter(([id, v]) => !sameValue(current?.[id], v))
    .map(([id, to]) => ({ id, to }));
}

export function sameContent(a: Backup, b: Backup): boolean {
  return JSON.stringify([a.keymap, a.lighting]) === JSON.stringify([b.keymap, b.lighting]);
}
