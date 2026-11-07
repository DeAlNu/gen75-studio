import { describe, expect, it } from 'vitest';
import { controlsOf } from '../src/core/definition/menus';
import { gen75 } from '../src/core/definition';
import { DeviceSession, decodeValue, encodeValue } from '../src/core/session';
import { MockViaDevice } from '../src/core/transport/mock';
import type { MockOptions } from '../src/core/transport/mock';
import { ViaReadOnly } from '../src/core/via/errors';

const open = async (mock: MockOptions = {}) => {
  const dev = new MockViaDevice(gen75, mock);
  const session = new DeviceSession(dev, gen75, { timeoutMs: 50, retries: 0 });
  const state = await session.open();
  return { dev, session, state };
};

describe('DeviceSession.open', () => {
  it('membuka perangkat protokol 12 dalam mode tulis', async () => {
    const { state } = await open();
    expect(state.protocolVersion).toBe(12);
    expect(state.layerCount).toBe(4);
    expect(state.keymap).toHaveLength(4);
    expect(state.writable).toBe(true);
    expect(state.warnings).toEqual([]);
    expect(state.customBase).toBe(0x7e00);
    expect(state.lighting).toEqual({
      id_qmk_rgb_matrix_brightness: 128,
      id_qmk_rgb_matrix_effect: 12,
      id_qmk_rgb_matrix_effect_speed: 128,
      id_qmk_rgb_matrix_color: [10, 255],
    });
  });

  it('membuka protokol di bawah 12 dalam mode baca saja', async () => {
    const { state, session } = await open({ protocol: 11 });
    expect(state.writable).toBe(false);
    expect(state.warnings.join(' ')).toMatch(/mode baca saja/);
    expect(state.customBase).toBe(0x5f80);
    await expect(session.setKeycode(0, 0, 0x04)).rejects.toBeInstanceOf(ViaReadOnly);
  });

  it('tidak membaca keymap bila jumlah layer tidak wajar', async () => {
    const { state } = await open({ layers: 9 });
    expect(state.keymap).toHaveLength(0);
    expect(state.writable).toBe(false);
    expect(state.warnings.join(' ')).toMatch(/jumlah layer/i);
  });

  it('tetap bisa dipakai bila lighting tidak tersedia', async () => {
    const { state } = await open({ lighting: false });
    expect(state.lighting).toBeNull();
    expect(state.writable).toBe(true);
    expect(state.warnings.join(' ')).toMatch(/Lighting tidak tersedia/);
  });
});

describe('DeviceSession: penulisan', () => {
  it('menulis keycode ke perangkat dan memperbarui salinan lokal', async () => {
    const { session, dev, state } = await open();
    await session.setKeycode(0, 1, 0x0005);
    expect(dev.keycodeAt(0, 0, 1)).toBe(0x0005);
    expect(state.keymap[0]?.[1]).toBe(0x0005);
  });

  it('menolak layer dan tombol yang tidak ada', async () => {
    const { session } = await open();
    await expect(session.setKeycode(4, 0, 0x04)).rejects.toBeInstanceOf(RangeError);
    await expect(session.setKeycode(0, 999, 0x04)).rejects.toBeInstanceOf(RangeError);
  });

  it('memvalidasi nilai lighting terhadap definisi', async () => {
    const { session } = await open();
    await expect(session.setLighting('id_qmk_rgb_matrix_brightness', 161)).rejects.toBeInstanceOf(RangeError);
    await expect(session.setLighting('id_qmk_rgb_matrix_effect', 99)).rejects.toBeInstanceOf(RangeError);
    await expect(session.setLighting('id_qmk_rgb_matrix_color', [256, 0])).rejects.toBeInstanceOf(RangeError);
    await expect(session.setLighting('tidak_ada', 1)).rejects.toThrow(/tidak dikenal/);
  });

  it('menyimpan lighting sekali per channel dan membaca nilai sebenarnya', async () => {
    const { session, dev } = await open();
    await session.setLighting('id_qmk_rgb_matrix_brightness', 90);
    await session.setLighting('id_qmk_rgb_matrix_color', [100, 50]);
    const values = await session.commitLighting();
    expect(dev.saves).toEqual([3]);
    expect(values.id_qmk_rgb_matrix_brightness).toBe(90);
    expect(values.id_qmk_rgb_matrix_color).toEqual([100, 50]);
  });
});

describe('encodeValue dan decodeValue', () => {
  const controls = controlsOf(gen75.menus);
  const color = controls.find((c) => c.kind === 'color')!;
  const range = controls.find((c) => c.kind === 'range')!;

  it('mengubah warna bolak-balik', () => {
    expect(encodeValue(color, [12, 200])).toEqual([12, 200]);
    expect(decodeValue(color, [12, 200])).toEqual([12, 200]);
  });

  it('mengubah rentang 1 byte dan 2 byte', () => {
    expect(encodeValue(range, 160)).toEqual([160]);
    const wide = { ...range, kind: 'range' as const, min: 0, max: 1000 };
    expect(encodeValue(wide, 1000)).toEqual([3, 232]);
    expect(decodeValue(wide, [3, 232])).toBe(1000);
  });

  it('menolak nilai tidak bulat atau di luar rentang', () => {
    expect(() => encodeValue(range, 1.5)).toThrow(RangeError);
    expect(() => encodeValue(range, -1)).toThrow(RangeError);
  });
});
