import { describe, expect, it } from 'vitest';
import { gen75 } from '../src/core/definition';
import {
  dangerOf,
  describeKeycode,
  isKnownRange,
  layerKeycode,
  layerTapKeycode,
  paletteCategories,
  parseKeycodeInput,
} from '../src/core/keycodes';
import type { KeycodeContext } from '../src/core/keycodes';

const ctx: KeycodeContext = { customKeycodes: gen75.customKeycodes, customBase: 0x7e00 };
const label = (code: number) => describeKeycode(code, ctx).label;

describe('describeKeycode', () => {
  it('mengenali keycode dasar', () => {
    expect(label(0x04)).toBe('A');
    expect(label(0x29)).toBe('Esc');
    expect(label(0x00)).toBe('NO');
    expect(label(0x01)).toBe('▽');
    expect(label(0xe0)).toBe('Ctrl');
    expect(label(0xa8)).toBe('Mute');
  });

  it('mengenali modifier, mod-tap, dan layer-tap', () => {
    expect(label(0x0204)).toBe('Shift+A');
    expect(label(0x1204)).toBe('RShift+A');
    expect(label(0x0304)).toBe('Ctrl+Shift+A');
    expect(label(0x2104)).toBe('MT(Ctrl,A)');
    expect(label(0x4204)).toBe('LT(2,A)');
  });

  it('mengenali fungsi layer', () => {
    expect(label(0x5200)).toBe('TO(0)');
    expect(label(0x5221)).toBe('MO(1)');
    expect(label(0x5241)).toBe('DF(1)');
    expect(label(0x5262)).toBe('TG(2)');
    expect(label(0x5281)).toBe('OSL(1)');
    expect(label(0x52a2)).toBe('OSM(Shift)');
    expect(label(0x52c3)).toBe('TT(3)');
  });

  it('mengenali makro, RGB, dan keycode kustom Gen 75', () => {
    expect(label(0x7705)).toBe('M5');
    expect(label(0x7822)).toBe('RM Tog');
    expect(label(0x7e00)).toBe('2.4G');
    expect(label(0x7e01)).toBe('BLE1');
    expect(label(0x7e0a)).toBe('U_EE_CLR');
  });

  it('menampilkan hex untuk kode yang tidak dikenal', () => {
    expect(describeKeycode(0x00f0, ctx)).toMatchObject({ label: '0x00F0', kind: 'unknown' });
    expect(describeKeycode(0x7e0b, ctx)).toMatchObject({ label: '0x7E0B', kind: 'unknown' });
  });
});

describe('rentang dan bahaya', () => {
  it('hanya menerima rentang yang dikenal', () => {
    expect(isKnownRange(0x0004)).toBe(true);
    expect(isKnownRange(0x7e01)).toBe(true);
    expect(isKnownRange(0x00f0)).toBe(false);
    expect(isKnownRange(0x5100)).toBe(false);
    expect(isKnownRange(0x7c00)).toBe(false);
    expect(isKnownRange(-1)).toBe(false);
    expect(isKnownRange(0x10000)).toBe(false);
    expect(isKnownRange(1.5)).toBe(false);
  });

  it('menandai bootloader dan reset EEPROM sebagai berbahaya', () => {
    expect(dangerOf(0x7c00, ctx)).not.toBeNull();
    expect(dangerOf(0x7c03, ctx)).not.toBeNull();
    expect(dangerOf(0x7e0a, ctx)).not.toBeNull();
    expect(dangerOf(0x7e01, ctx)).toBeNull();
    expect(dangerOf(0x0004, ctx)).toBeNull();
  });
});

describe('parseKeycodeInput', () => {
  const parse = (t: string, layers = 4) => parseKeycodeInput(t, ctx, layers);

  it('menerima hex, nama QMK, nama keycode Gen 75, dan fungsi layer', () => {
    expect(parse('0x0004')).toEqual({ ok: true, code: 0x04 });
    expect(parse('kc_a')).toEqual({ ok: true, code: 0x04 });
    expect(parse('BLE1')).toEqual({ ok: true, code: 0x7e01 });
    expect(parse('RM_TOGG')).toEqual({ ok: true, code: 0x7822 });
    expect(parse('MO(1)')).toEqual({ ok: true, code: 0x5221 });
    expect(parse('tg(2)')).toEqual({ ok: true, code: 0x5262 });
    expect(parse('LT(1, KC_A)')).toEqual({ ok: true, code: 0x4104 });
  });

  it('menolak masukan yang salah', () => {
    expect(parse('').ok).toBe(false);
    expect(parse('banana').ok).toBe(false);
    expect(parse('0x7C00').ok).toBe(false);
    expect(parse('0x12345').ok).toBe(false);
    expect(parse('MO(4)').ok).toBe(false);
    expect(parse('LT(1,KC_NOPE)').ok).toBe(false);
  });

  it('membangun kode layer dan layer-tap', () => {
    expect(layerKeycode('MO', 1)).toBe(0x5221);
    expect(layerKeycode('TG', 2)).toBe(0x5262);
    expect(layerTapKeycode(2, 0x04)).toBe(0x4204);
  });
});

describe('palet', () => {
  const cats = paletteCategories(ctx, 4);

  it('memuat kategori yang diharapkan', () => {
    expect(cats.map((c) => c.id)).toEqual(['basic', 'nav', 'fkeys', 'mods', 'keypad', 'media', 'layer', 'device', 'light']);
  });

  it('keycode Gen 75 berurutan dari basis kustom', () => {
    const device = cats.find((c) => c.id === 'device')!;
    expect(device.items).toHaveLength(11);
    expect(device.items.map((i) => i.code)).toEqual(Array.from({ length: 11 }, (_, i) => 0x7e00 + i));
  });

  it('item layer mengikuti jumlah layer', () => {
    const codes = cats.find((c) => c.id === 'layer')!.items.map((i) => i.code);
    expect(codes).toContain(0x5223);
    expect(codes).not.toContain(0x5224);
  });

  it('label tiap item sama dengan hasil describeKeycode dan semua kodenya boleh ditulis', () => {
    for (const cat of cats) {
      for (const item of cat.items) {
        expect(describeKeycode(item.code, ctx).label).toBe(item.label);
        expect(isKnownRange(item.code)).toBe(true);
      }
    }
  });

  it('item yang belum terverifikasi hanya pada kategori lampu', () => {
    for (const cat of cats) {
      const unverified = cat.items.some((i) => !i.verified);
      expect(unverified).toBe(cat.id === 'light');
    }
  });
});
