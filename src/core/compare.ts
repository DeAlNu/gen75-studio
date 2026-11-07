import { backupEncoders, backupKeymap, diffEncoders, diffKeymap } from './backup';
import type { Backup, EncoderChange, KeyChange } from './backup';
import { hsToHex } from './color';
import { controlsOf } from './definition/menus';
import type { DeviceDefinition, MenuControl } from './definition/types';
import { actionLabel, parseMacroBytes } from './macros';
import type { LightingValue } from './session';

export interface LightingDiff {
  id: string;
  label: string;
  from: string;
  to: string;
}

export interface MacroDiff {
  slot: number;
  from: string;
  to: string;
}

export interface Comparison {
  layerCounts: [number, number];
  /** Perubahan dari sisi A ke sisi B, hanya pada layer yang ada di keduanya. */
  keys: KeyChange[];
  /** null bila salah satu sisi tidak memuat bagian ini. */
  encoders: EncoderChange[] | null;
  lighting: LightingDiff[] | null;
  macros: MacroDiff[] | null;
  notes: string[];
  total: number;
}

const MAX_TEXT = 90;

/** Data lama atau rusak di penyimpanan browser tidak boleh membuat perbandingan gagal. */
export function isUsableBackup(b: unknown): b is Backup {
  const layers = (b as { keymap?: { layers?: unknown } } | null)?.keymap?.layers;
  return Array.isArray(layers) && layers.length > 0 && layers.every((l) => Array.isArray(l) && l.every((v) => typeof v === 'string'));
}

function clip(text: string): string {
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 3)}...` : text;
}

/** Memecah isi buffer makro (heksadesimal) menjadi byte per slot; slot yang tidak ada dianggap kosong. */
export function macroSlots(macros: { count: number; bytes: string }): number[][] {
  const bytes = Array.from({ length: macros.bytes.length / 2 }, (_, i) => Number.parseInt(macros.bytes.slice(i * 2, i * 2 + 2), 16));
  const slots: number[][] = [];
  let current: number[] = [];
  for (const b of bytes) {
    if (b === 0) {
      slots.push(current);
      current = [];
    } else {
      current.push(b);
    }
  }
  slots.push(current);
  while (slots.length < macros.count) slots.push([]);
  return slots.slice(0, macros.count);
}

export function describeMacroBytes(bytes: number[]): string {
  if (bytes.length === 0) return 'kosong';
  try {
    const entry = parseMacroBytes(bytes);
    if (entry.kind === 'raw') return `format tidak dikenal (${bytes.length} byte)`;
    return clip(entry.actions.map(actionLabel).join(', '));
  } catch {
    return `tidak terbaca (${bytes.length} byte)`;
  }
}

export function describeLightingValue(control: MenuControl | undefined, value: LightingValue | undefined): string {
  if (value === undefined) return 'tidak ada';
  if (!control) return JSON.stringify(value);
  switch (control.kind) {
    case 'dropdown':
      return control.options.find((o) => o.value === value)?.label ?? String(value);
    case 'color':
      return Array.isArray(value) && value.length >= 2 ? hsToHex(value[0] as number, value[1] as number) : JSON.stringify(value);
    case 'toggle':
      return value ? 'hidup' : 'mati';
    case 'range':
      return String(value);
  }
}

const sameValue = (a: LightingValue | undefined, b: LightingValue | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Membandingkan dua backup (keadaan keyboard, profil, atau snapshot) dari A ke B. */
export function compareBackups(def: DeviceDefinition, a: Backup, b: Backup): Comparison {
  const notes: string[] = [];
  const la = a.keymap.layers.length;
  const lb = b.keymap.layers.length;
  const common = Math.min(la, lb);
  if (la !== lb) notes.push(`Jumlah layer berbeda (${la} dan ${lb}); hanya layer 0 sampai ${common - 1} yang dibandingkan.`);
  const keys = diffKeymap(def, backupKeymap(a).slice(0, common), backupKeymap(b).slice(0, common));

  let encoders: EncoderChange[] | null = null;
  const ea = backupEncoders(a);
  const eb = backupEncoders(b);
  if (ea && eb) encoders = diffEncoders(ea, eb);
  else if (ea || eb) notes.push('Putaran knob hanya ada di salah satu sisi, jadi tidak dibandingkan.');

  const controls = controlsOf(def.menus);
  let lighting: LightingDiff[] | null = null;
  if (a.lighting && b.lighting) {
    const ids = [...new Set([...controls.map((c) => c.ref.id), ...Object.keys(a.lighting), ...Object.keys(b.lighting)])];
    lighting = ids
      .filter((id) => !sameValue(a.lighting?.[id], b.lighting?.[id]))
      .map((id) => {
        const control = controls.find((c) => c.ref.id === id);
        return {
          id,
          label: control?.label ?? id,
          from: describeLightingValue(control, a.lighting?.[id]),
          to: describeLightingValue(control, b.lighting?.[id]),
        };
      });
  } else if (a.lighting || b.lighting) {
    notes.push('Lighting hanya ada di salah satu sisi, jadi tidak dibandingkan.');
  }

  let macros: MacroDiff[] | null = null;
  if (a.macros && b.macros) {
    if (a.macros.count !== b.macros.count) notes.push(`Jumlah slot makro berbeda (${a.macros.count} dan ${b.macros.count}).`);
    const sa = macroSlots(a.macros);
    const sb = macroSlots(b.macros);
    macros = [];
    for (let slot = 0; slot < Math.min(sa.length, sb.length); slot += 1) {
      const x = sa[slot] as number[];
      const y = sb[slot] as number[];
      if (x.length === y.length && x.every((v, i) => v === y[i])) continue;
      macros.push({ slot, from: describeMacroBytes(x), to: describeMacroBytes(y) });
    }
  } else if (a.macros || b.macros) {
    notes.push('Makro hanya ada di salah satu sisi, jadi tidak dibandingkan.');
  }

  const total = keys.length + (encoders?.length ?? 0) + (lighting?.length ?? 0) + (macros?.length ?? 0);
  return { layerCounts: [la, lb], keys, encoders, lighting, macros, notes, total };
}
