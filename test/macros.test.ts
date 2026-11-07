import { describe, expect, it } from 'vitest';
import { BASIC_BY_CODE } from '../src/core/keycodes/basic';
import { HID_BY_EVENT_CODE, hidFromEventCode } from '../src/core/hid-codes';
import {
  actionLabel,
  encodeMacroBuffer,
  MacroError,
  MacroRecorder,
  macroUsage,
  parseMacroBuffer,
  parseMacroBytes,
  serializeAction,
  serializeEntry,
  validateEntry,
} from '../src/core/macros';
import type { MacroEntry } from '../src/core/macros';
import { decodeMatrix, encodeMatrix } from '../src/core/matrix';

const bytes = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const PIPE = 0x7c;

describe('serialisasi aksi makro', () => {
  it('ketuk, tahan, dan lepas memakai awalan 0x01', () => {
    expect(serializeAction({ kind: 'tap', keycode: 0x06 })).toEqual([1, 1, 6]);
    expect(serializeAction({ kind: 'down', keycode: 0xe0 })).toEqual([1, 2, 0xe0]);
    expect(serializeAction({ kind: 'up', keycode: 0xe0 })).toEqual([1, 3, 0xe0]);
  });

  it('menulis jeda sebagai angka desimal yang diakhiri garis tegak', () => {
    expect(serializeAction({ kind: 'delay', ms: 250 })).toEqual([1, 4, ...bytes('250'), PIPE]);
  });

  it('menulis teks ASCII apa adanya', () => {
    expect(serializeAction({ kind: 'text', text: 'Hi!' })).toEqual(bytes('Hi!'));
  });

  it('menolak nilai yang tidak valid', () => {
    expect(() => serializeAction({ kind: 'tap', keycode: 0 })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'tap', keycode: 1 })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'tap', keycode: 0x1ff })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'tap', keycode: 0xf0 })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'delay', ms: 0 })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'delay', ms: 65536 })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'delay', ms: 1.5 })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'text', text: 'é' })).toThrow(MacroError);
    expect(() => serializeAction({ kind: 'text', text: 'a\nb' })).toThrow(MacroError);
  });

  it('menerangkan aksi dalam kata-kata', () => {
    expect(actionLabel({ kind: 'tap', keycode: 0x06 })).toBe('Ketuk C');
    expect(actionLabel({ kind: 'delay', ms: 100 })).toBe('Jeda 100 ms');
    expect(actionLabel({ kind: 'text', text: 'ab' })).toBe('Ketik "ab"');
  });
});

describe('parseMacroBytes', () => {
  it('mengurai urutan campuran dan menggabungkan karakter berurutan menjadi satu teks', () => {
    const e = parseMacroBytes([1, 2, 0xe0, 1, 1, 6, 1, 3, 0xe0, ...bytes('ab'), 1, 4, ...bytes('100'), PIPE, ...bytes('c')]);
    expect(e).toEqual({
      kind: 'actions',
      actions: [
        { kind: 'down', keycode: 0xe0 },
        { kind: 'tap', keycode: 6 },
        { kind: 'up', keycode: 0xe0 },
        { kind: 'text', text: 'ab' },
        { kind: 'delay', ms: 100 },
        { kind: 'text', text: 'c' },
      ],
    });
  });

  it('menganggap makro kosong sebagai daftar aksi kosong', () => {
    expect(parseMacroBytes([])).toEqual({ kind: 'actions', actions: [] });
  });

  it('menjadikan urutan yang tidak dikenal sebagai makro mentah', () => {
    for (const raw of [
      [1, 5, 0x12, 0x34],
      [1, 1],
      [1, 1, 0xf0],
      [1, 4, ...bytes('12')],
      [1, 4, PIPE],
      [1, 4, ...bytes('70000'), PIPE],
      [0x0a],
      [0xc3, 0xa9],
    ]) {
      expect(parseMacroBytes(raw).kind).toBe('raw');
    }
  });
});

describe('buffer makro', () => {
  const sample = (): MacroEntry[] => [
    { kind: 'actions', actions: [{ kind: 'tap', keycode: 6 }] },
    { kind: 'actions', actions: [] },
    { kind: 'actions', actions: [{ kind: 'text', text: 'hi' }] },
  ];

  it('memisahkan makro dengan byte nol dan mengisi sisa dengan nol', () => {
    const expected = new Array<number>(16).fill(0);
    expected.splice(0, 7, 1, 1, 6, 0, 0, 0x68, 0x69);
    expect(Array.from(encodeMacroBuffer(sample(), 16))).toEqual(expected);
  });

  it('bolak-balik antara buffer dan entri', () => {
    const buf = encodeMacroBuffer(sample(), 16);
    const entries = parseMacroBuffer(buf, 3);
    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({ kind: 'actions', actions: [{ kind: 'tap', keycode: 6 }] });
    expect(entries[1]).toMatchObject({ kind: 'actions', actions: [] });
    expect(entries[2]).toMatchObject({ kind: 'actions', actions: [{ kind: 'text', text: 'hi' }] });
    expect(Array.from(encodeMacroBuffer(entries, 16))).toEqual(Array.from(buf));
  });

  it('menganggap buffer kosong sebagai makro-makro kosong', () => {
    const entries = parseMacroBuffer(new Uint8Array(32), 4);
    expect(entries).toHaveLength(4);
    expect(entries.every((e) => e.kind === 'actions' && e.actions.length === 0)).toBe(true);
  });

  it('mempertahankan byte asli makro yang tidak diubah', () => {
    const original = [1, 4, ...bytes('0250'), PIPE];
    const [entry] = parseMacroBuffer(Uint8Array.from([...original, 0, 0]), 1);
    expect(serializeEntry(entry!)).toEqual(original);
    if (entry?.kind !== 'actions') throw new Error('seharusnya makro biasa');
    expect(serializeEntry({ kind: 'actions', actions: entry.actions })).toEqual([1, 4, ...bytes('250'), PIPE]);
  });

  it('mempertahankan makro mentah apa adanya', () => {
    const raw: MacroEntry = { kind: 'raw', bytes: [1, 5, 0x12, 0x34] };
    const buf = encodeMacroBuffer([raw, { kind: 'actions', actions: [{ kind: 'text', text: 'x' }] }], 16);
    expect(Array.from(buf.subarray(0, 8))).toEqual([1, 5, 0x12, 0x34, 0, 0x78, 0, 0]);
  });

  it('menghitung pemakaian memori dan menolak yang tidak muat', () => {
    expect(macroUsage(sample(), 16)).toEqual({ used: 7, size: 16, fits: true });
    expect(macroUsage(sample(), 8).fits).toBe(true);
    expect(macroUsage(sample(), 7).fits).toBe(false);
    expect(() => encodeMacroBuffer(sample(), 7)).toThrow(/penuh/);
  });

  it('memvalidasi entri', () => {
    expect(validateEntry({ kind: 'actions', actions: [{ kind: 'tap', keycode: 6 }] })).toBeNull();
    expect(validateEntry({ kind: 'actions', actions: [{ kind: 'delay', ms: 0 }] })).toMatch(/jeda/);
  });
});

describe('MacroRecorder', () => {
  it('menggabungkan tekan dan lepas berurutan menjadi ketukan', () => {
    const r = new MacroRecorder();
    r.down(6, 0);
    r.up(6, 50);
    r.down(7, 100);
    r.up(7, 150);
    expect(r.finish(200, { delays: false })).toEqual([
      { kind: 'tap', keycode: 6 },
      { kind: 'tap', keycode: 7 },
    ]);
  });

  it('mempertahankan tahan dan lepas untuk kombinasi dengan modifier', () => {
    const r = new MacroRecorder();
    r.down(0xe0, 0);
    r.down(6, 20);
    r.up(6, 60);
    r.up(0xe0, 100);
    expect(r.finish(200, { delays: false })).toEqual([
      { kind: 'down', keycode: 0xe0 },
      { kind: 'tap', keycode: 6 },
      { kind: 'up', keycode: 0xe0 },
    ]);
  });

  it('menyisipkan jeda hanya bila diminta dan cukup besar', () => {
    const make = (): MacroRecorder => {
      const r = new MacroRecorder();
      r.down(6, 0);
      r.up(6, 30);
      r.down(7, 330);
      r.up(7, 360);
      r.down(8, 380);
      r.up(8, 400);
      return r;
    };
    expect(make().finish(500, { delays: true })).toEqual([
      { kind: 'tap', keycode: 6 },
      { kind: 'delay', ms: 300 },
      { kind: 'tap', keycode: 7 },
      { kind: 'tap', keycode: 8 },
    ]);
    expect(make().finish(500, { delays: false })).toHaveLength(3);
  });

  it('melepas tombol yang masih tertahan saat selesai dan mengabaikan pengulangan', () => {
    const r = new MacroRecorder();
    r.down(6, 0);
    r.down(6, 10);
    r.up(9, 20);
    expect(r.size).toBe(1);
    expect(r.finish(100, { delays: false })).toEqual([{ kind: 'tap', keycode: 6 }]);
  });
});

describe('kode HID dari event browser', () => {
  it('memetakan tombol umum', () => {
    expect(hidFromEventCode('KeyA')).toBe(0x04);
    expect(hidFromEventCode('Digit1')).toBe(0x1e);
    expect(hidFromEventCode('Enter')).toBe(0x28);
    expect(hidFromEventCode('ArrowUp')).toBe(0x52);
    expect(hidFromEventCode('ControlLeft')).toBe(0xe0);
    expect(hidFromEventCode('F13')).toBe(0x68);
    expect(hidFromEventCode('Unidentified')).toBeNull();
  });

  it('semua hasil pemetaan ada di katalog keycode dan tidak ganda', () => {
    const values = [...HID_BY_EVENT_CODE.values()];
    for (const v of values) expect(BASIC_BY_CODE.has(v)).toBe(true);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('matriks', () => {
  it('mengubah posisi tertekan menjadi byte dan kembali', () => {
    const pressed = new Set(['0,1', '3,15', '5,0']);
    const bytes16 = encodeMatrix(pressed, 6, 16);
    expect(bytes16).toHaveLength(12);
    expect(decodeMatrix(bytes16, 6, 16)).toEqual(pressed);
  });

  it('memakai byte tertinggi lebih dulu dan bit 0 untuk kolom 0', () => {
    expect(Array.from(encodeMatrix(new Set(['0,15']), 1, 16))).toEqual([0x80, 0x00]);
    expect(Array.from(encodeMatrix(new Set(['0,0']), 1, 16))).toEqual([0x00, 0x01]);
    expect(Array.from(encodeMatrix(new Set(['1,7']), 2, 8))).toEqual([0x00, 0x80]);
  });

  it('mengabaikan posisi di luar ukuran matriks', () => {
    expect(encodeMatrix(new Set(['9,9']), 6, 16).every((b) => b === 0)).toBe(true);
    expect(decodeMatrix(new Uint8Array(12), 6, 16).size).toBe(0);
  });
});
