import type { DeviceDefinition, LayoutOption, PhysicalKey } from './types';

/** Jumlah encoder yang dideklarasikan definisi (indeks terbesar + 1). */
export function encoderCount(def: DeviceDefinition): number {
  return Math.max(-1, ...def.keys.map((k) => k.encoder ?? -1)) + 1;
}

/** Pilihan awal tiap opsi layout: selalu pilihan 0. */
export function defaultChoices(def: DeviceDefinition): number[] {
  return def.layoutOptions.map(() => 0);
}

/** Pilihan yang benar-benar punya tombol. Pilihan tanpa tombol akan membuat tombol hilang dari kanvas. */
export function selectableChoices(def: DeviceDefinition, group: number): number[] {
  const set = new Set<number>();
  for (const k of def.keys) {
    if (k.option && k.option.group === group) set.add(k.option.choice);
  }
  return [...set].sort((a, b) => a - b);
}

/** Opsi layout yang masuk akal ditampilkan: punya lebih dari satu pilihan bertombol. */
export function adjustableOptions(def: DeviceDefinition): LayoutOption[] {
  return def.layoutOptions.filter((o) => selectableChoices(def, o.group).length > 1);
}

export function visibleKeys(def: DeviceDefinition, choices: readonly number[]): PhysicalKey[] {
  return def.keys.filter((k) => k.option === null || choices[k.option.group] === k.option.choice);
}
