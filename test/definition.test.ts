import { describe, expect, it } from 'vitest';
import { gen75 } from '../src/core/definition';
import { parseKle } from '../src/core/definition/kle';
import { adjustableOptions, defaultChoices, selectableChoices, visibleKeys } from '../src/core/definition/layout';
import { controlsOf, isVisible, valueByteLength } from '../src/core/definition/menus';
import { compileShowIf } from '../src/core/definition/showIf';

describe('definisi Gen 75', () => {
  it('membaca identitas dan matriks', () => {
    expect(gen75.name).toBe('GEN 75');
    expect(gen75.vendorId).toBe(0x36b0);
    expect(gen75.productId).toBe(0x3077);
    expect(gen75.matrix).toEqual({ rows: 6, cols: 16 });
  });

  it('punya 83 posisi tombol yang unik dan berada di dalam matriks', () => {
    expect(gen75.keys).toHaveLength(83);
    const ids = new Set(gen75.keys.map((k) => `${k.row},${k.col}`));
    expect(ids.size).toBe(83);
    for (const k of gen75.keys) {
      expect(k.row).toBeLessThan(6);
      expect(k.col).toBeLessThan(16);
    }
  });

  it('menghitung ukuran kanvas', () => {
    expect(gen75.width).toBeCloseTo(16.5, 5);
    expect(gen75.height).toBeCloseTo(6.5, 5);
  });

  it('menandai knob sebagai encoder 0 pada 0,15', () => {
    const knob = gen75.keys.filter((k) => k.encoder !== null);
    expect(knob).toHaveLength(1);
    expect(knob[0]).toMatchObject({ row: 0, col: 15, encoder: 0 });
  });

  it('hanya satu tombol punya opsi layout, yaitu pilihan 0', () => {
    const withOption = gen75.keys.filter((k) => k.option !== null);
    expect(withOption).toHaveLength(1);
    expect(withOption[0]).toMatchObject({ row: 3, col: 0, option: { group: 0, choice: 0 } });
  });

  it('memuat 11 keycode kustom berurutan', () => {
    expect(gen75.customKeycodes.map((c) => c.name)).toEqual([
      '2.4G', 'BLE1', 'BLE2', 'BLE3', 'USB', 'BAT', 'WLO', 'SIX_N', 'FN_ALT', 'RTOG', 'U_EE_CLR',
    ]);
  });
});

describe('parseKle', () => {
  it('menerapkan offset x dan y serta ukuran tombol', () => {
    const keys = parseKle([[{ w: 2 }, '0,0', { x: 0.5 }, '0,1'], [{ y: 0.25 }, '1,0']]);
    expect(keys).toHaveLength(3);
    expect(keys[0]).toMatchObject({ x: 0, y: 0, w: 2 });
    expect(keys[1]).toMatchObject({ x: 2.5, y: 0, w: 1 });
    expect(keys[2]).toMatchObject({ x: 0, y: 1.25 });
  });

  it('membaca opsi layout dan encoder dari legenda', () => {
    const [a, b] = parseKle([['0,0\n\n\n1,2', '0,1\n\n\n\n\n\n\n\n\n e1 ']]);
    expect(a?.option).toEqual({ group: 1, choice: 2 });
    expect(b?.encoder).toBe(1);
  });

  it('menolak rotasi dan label yang salah', () => {
    expect(() => parseKle([[{ r: 15 }, '0,0']])).toThrow(/rotasi/);
    expect(() => parseKle([['A']])).toThrow(/label matriks/);
    expect(() => parseKle('x')).toThrow();
  });
});

describe('showIf', () => {
  const get = (v: Record<string, number>) => (id: string) => v[id] ?? 0;

  it('mengevaluasi perbandingan dan operator logika', () => {
    expect(compileShowIf('{a} != 0')(get({ a: 3 }))).toBe(true);
    expect(compileShowIf('{a} != 0')(get({ a: 0 }))).toBe(false);
    expect(compileShowIf('{a} == 1 && {b} == 2')(get({ a: 1, b: 2 }))).toBe(true);
    expect(compileShowIf('{a} == 1 && {b} == 2')(get({ a: 1, b: 3 }))).toBe(false);
    expect(compileShowIf('{a} == 1 || {b} == 2')(get({ a: 0, b: 2 }))).toBe(true);
    expect(compileShowIf('{a} >= 2')(get({ a: 2 }))).toBe(true);
    expect(compileShowIf('{a} < 2')(get({ a: 2 }))).toBe(false);
  });

  it('menghormati urutan operator dan tanda kurung', () => {
    const f = compileShowIf('{a} == 1 || {b} == 1 && {c} == 1');
    expect(f(get({ a: 1, b: 0, c: 0 }))).toBe(true);
    expect(f(get({ a: 0, b: 1, c: 0 }))).toBe(false);
    expect(compileShowIf('({a} == 1 || {b} == 1) && {c} == 1')(get({ a: 1, b: 0, c: 0 }))).toBe(false);
    expect(compileShowIf('!({a} == 1)')(get({ a: 0 }))).toBe(true);
  });

  it('menolak ekspresi yang salah dan tidak menjalankan kode', () => {
    expect(() => compileShowIf('{a} ==')).toThrow();
    expect(() => compileShowIf('{a} != 0 )')).toThrow();
    expect(() => compileShowIf('{a')).toThrow();
    expect(() => compileShowIf('alert(1)')).toThrow();
    expect(() => compileShowIf('{a.b} == 1')).toThrow();
  });
});

describe('menu lighting', () => {
  const controls = controlsOf(gen75.menus);
  const byId = (id: string) => controls.find((c) => c.ref.id === id);

  it('menurunkan empat kontrol dari channel 3', () => {
    expect(controls.map((c) => [c.ref.id, c.ref.channel, c.ref.valueId])).toEqual([
      ['id_qmk_rgb_matrix_brightness', 3, 1],
      ['id_qmk_rgb_matrix_effect', 3, 2],
      ['id_qmk_rgb_matrix_effect_speed', 3, 3],
      ['id_qmk_rgb_matrix_color', 3, 4],
    ]);
  });

  it('membaca batas dari definisi, bukan angka tetap', () => {
    const b = byId('id_qmk_rgb_matrix_brightness');
    expect(b).toMatchObject({ kind: 'range', min: 0, max: 160 });
    const effect = byId('id_qmk_rgb_matrix_effect');
    expect(effect?.kind).toBe('dropdown');
    if (effect?.kind === 'dropdown') {
      expect(effect.options).toHaveLength(46);
      expect(effect.options[0]).toEqual({ label: 'none', value: 0 });
      expect(effect.options[45]).toEqual({ label: 'riverflow', value: 45 });
    }
  });

  it('menentukan panjang byte nilai', () => {
    expect(valueByteLength(byId('id_qmk_rgb_matrix_color')!)).toBe(2);
    expect(valueByteLength(byId('id_qmk_rgb_matrix_brightness')!)).toBe(1);
  });

  it('menyembunyikan speed dan warna sesuai efek', () => {
    const speed = byId('id_qmk_rgb_matrix_effect_speed')!;
    const color = byId('id_qmk_rgb_matrix_color')!;
    const at = (effect: number) => (id: string) => (id === 'id_qmk_rgb_matrix_effect' ? effect : 0);
    expect(isVisible(speed, at(0))).toBe(false);
    expect(isVisible(color, at(0))).toBe(false);
    expect(isVisible(speed, at(12))).toBe(true);
    expect(isVisible(color, at(12))).toBe(true);
    expect(isVisible(speed, at(24))).toBe(true);
    expect(isVisible(color, at(24))).toBe(false);
    expect(isVisible(color, at(32))).toBe(false);
  });
});

describe('opsi layout', () => {
  it('tidak menampilkan opsi Caps Lock karena pilihan 1 tidak punya tombol', () => {
    expect(defaultChoices(gen75)).toEqual([0]);
    expect(selectableChoices(gen75, 0)).toEqual([0]);
    expect(adjustableOptions(gen75)).toEqual([]);
    expect(visibleKeys(gen75, [0])).toHaveLength(83);
  });

  it('menyembunyikan tombol bila pilihannya tidak cocok', () => {
    expect(visibleKeys(gen75, [1])).toHaveLength(82);
  });
});
