import { encoderCount } from './definition/layout';
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
  /** Isi buffer makro dalam heksadesimal, tanpa byte nol di ujung. Opsional pada backup lama. */
  macros?: { count: number; bytes: string } | null;
  /** Keycode putaran encoder: [layer][indeks][0 = berlawanan, 1 = searah]. Opsional pada backup lama. */
  encoders?: string[][][] | null;
}

export interface KeyChange {
  layer: number;
  keyIndex: number;
  from: number;
  to: number;
}

export interface EncoderChange {
  layer: number;
  index: number;
  clockwise: boolean;
  from: number;
  to: number;
}

export interface LightingChange {
  id: string;
  to: LightingValue;
}

export interface BackupState {
  protocolVersion: number;
  keymap: readonly Uint16Array[];
  lighting: LightingValues | null;
  macroCount?: number;
  macroBuffer?: Uint8Array | null;
  encoders?: number[][][] | null;
}

export function macroBufferToHex(buffer: Uint8Array): string {
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) end -= 1;
  return Array.from(buffer.subarray(0, end), (b) => b.toString(16).padStart(2, '0')).join('');
}

export function macroBufferFromHex(hex: string, size: number): Uint8Array {
  const out = new Uint8Array(size);
  for (let i = 0; i < hex.length / 2; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function createBackup(def: DeviceDefinition, state: BackupState, now: Date = new Date()): Backup {
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
    macros: state.macroBuffer ? { count: state.macroCount ?? 0, bytes: macroBufferToHex(state.macroBuffer) } : null,
    encoders: state.encoders ? state.encoders.map((layer) => layer.map((pair) => pair.map(hex4))) : null,
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

  let macros: Backup['macros'] = null;
  if (b.macros !== null && b.macros !== undefined) {
    const m = b.macros as { count?: unknown; bytes?: unknown };
    if (typeof m !== 'object' || !Number.isInteger(m.count) || (m.count as number) < 1) return fail('Bagian makro tidak valid.');
    if (typeof m.bytes !== 'string' || !/^([0-9a-f]{2})*$/i.test(m.bytes)) return fail('Isi makro bukan heksadesimal yang valid.');
    macros = { count: m.count as number, bytes: m.bytes.toLowerCase() };
  }

  let encoders: string[][][] | null = null;
  if (b.encoders !== null && b.encoders !== undefined) {
    const n = encoderCount(def);
    const e = b.encoders;
    if (!Array.isArray(e) || e.length < 1 || e.length > maxLayers) return fail('Bagian encoder tidak valid.');
    for (let l = 0; l < e.length; l += 1) {
      const layer = e[l];
      if (!Array.isArray(layer) || layer.length !== n) return fail(`Encoder layer ${l} harus berisi ${n} encoder.`);
      for (const pair of layer) {
        if (!Array.isArray(pair) || pair.length !== 2 || !pair.every((v) => typeof v === 'string' && HEX.test(v) && isKnownRange(Number.parseInt(v, 16)))) {
          return fail(`Keycode encoder pada layer ${l} tidak valid.`);
        }
      }
    }
    encoders = (e as string[][][]).map((layer) => layer.map((pair) => pair.map((v) => hex4(Number.parseInt(v, 16)))));
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
      macros,
      encoders,
    },
  };
}

export function backupKeymap(backup: Backup): Uint16Array[] {
  return backup.keymap.layers.map((l) => Uint16Array.from(l, (v) => Number.parseInt(v, 16)));
}

export function backupEncoders(backup: Backup): number[][][] | null {
  return backup.encoders ? backup.encoders.map((layer) => layer.map((pair) => pair.map((v) => Number.parseInt(v, 16)))) : null;
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

export function diffEncoders(current: number[][][] | null, target: number[][][] | null): EncoderChange[] {
  if (!current || !target) return [];
  const changes: EncoderChange[] = [];
  target.forEach((layer, l) =>
    layer.forEach((pair, index) =>
      pair.forEach((to, dir) => {
        const from = current[l]?.[index]?.[dir];
        if (from !== undefined && from !== to) changes.push({ layer: l, index, clockwise: dir === 1, from, to });
      }),
    ),
  );
  return changes;
}

const sameValue = (a: LightingValue | undefined, b: LightingValue): boolean => JSON.stringify(a) === JSON.stringify(b);

export function diffLighting(current: LightingValues | null, target: LightingValues | null): LightingChange[] {
  if (!target) return [];
  return Object.entries(target)
    .filter(([id, v]) => !sameValue(current?.[id], v))
    .map(([id, to]) => ({ id, to }));
}

/** Urutan kunci lighting tidak berpengaruh pada kesamaan isi. */
const sortedLighting = (l: LightingValues | null): [string, LightingValue][] | null => (l ? Object.entries(l).sort(([x], [y]) => (x < y ? -1 : x > y ? 1 : 0)) : null);

export function sameContent(a: Backup, b: Backup): boolean {
  return (
    JSON.stringify([a.keymap, sortedLighting(a.lighting), a.macros ?? null, a.encoders ?? null]) ===
    JSON.stringify([b.keymap, sortedLighting(b.lighting), b.macros ?? null, b.encoders ?? null])
  );
}
