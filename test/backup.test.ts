import { describe, expect, it } from 'vitest';
import { backupKeymap, createBackup, diffKeymap, diffLighting, parseBackup, sameContent } from '../src/core/backup';
import type { Backup } from '../src/core/backup';
import { gen75 } from '../src/core/definition';
import { DeviceSession } from '../src/core/session';
import { MockViaDevice } from '../src/core/transport/mock';

async function sample(): Promise<{ backup: Backup; keymap: Uint16Array[] }> {
  const session = new DeviceSession(new MockViaDevice(gen75), gen75, { timeoutMs: 50, retries: 0 });
  const state = await session.open();
  return { backup: createBackup(gen75, state, new Date('2026-11-08T00:00:00Z')), keymap: state.keymap };
}

const parse = (b: unknown, maxLayers = 4) => parseBackup(JSON.stringify(b), gen75, maxLayers);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe('createBackup dan parseBackup', () => {
  it('menulis identitas perangkat dan keymap heksadesimal', async () => {
    const { backup } = await sample();
    expect(backup.schemaVersion).toBe(1);
    expect(backup.device).toMatchObject({ vendorId: '0x36B0', productId: '0x3077', matrix: { rows: 6, cols: 16 }, protocolVersion: 12 });
    expect(backup.keymap.layers).toHaveLength(4);
    expect(backup.keymap.layers[0]).toHaveLength(96);
    expect(backup.keymap.layers[0]?.[0]).toBe('0x0029');
    expect(backup.createdAt).toBe('2026-11-08T00:00:00.000Z');
  });

  it('bolak-balik tanpa perubahan isi', async () => {
    const { backup, keymap } = await sample();
    const r = parse(backup);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(sameContent(r.backup, backup)).toBe(true);
      expect(backupKeymap(r.backup).map((w) => Array.from(w))).toEqual(keymap.map((w) => Array.from(w)));
    }
  });

  it('menolak berkas yang bukan JSON atau skema berbeda', async () => {
    const { backup } = await sample();
    expect(parseBackup('bukan json', gen75, 4)).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(parse({ ...backup, schemaVersion: 2 })).toMatchObject({ ok: false, error: expect.stringMatching(/skema/) });
    expect(parse(null).ok).toBe(false);
  });

  it('menolak backup dari perangkat lain', async () => {
    const { backup } = await sample();
    const wrongId = clone(backup);
    wrongId.device.vendorId = '0x1234';
    expect(parse(wrongId)).toMatchObject({ ok: false, error: expect.stringMatching(/VID\/PID/) });
    const wrongMatrix = clone(backup);
    wrongMatrix.device.matrix = { rows: 5, cols: 15 };
    expect(parse(wrongMatrix)).toMatchObject({ ok: false, error: expect.stringMatching(/matriks/) });
  });

  it('menolak layer berlebih, panjang salah, dan keycode tidak valid', async () => {
    const { backup } = await sample();
    expect(parse(backup, 3)).toMatchObject({ ok: false, error: expect.stringMatching(/4 layer/) });

    const short = clone(backup);
    short.keymap.layers[0]!.pop();
    expect(parse(short)).toMatchObject({ ok: false, error: expect.stringMatching(/96 keycode/) });

    const badHex = clone(backup);
    badHex.keymap.layers[0]![0] = 'ESC';
    expect(parse(badHex)).toMatchObject({ ok: false, error: expect.stringMatching(/format keycode/) });

    const bootloader = clone(backup);
    bootloader.keymap.layers[0]![0] = '0x7C00';
    expect(parse(bootloader)).toMatchObject({ ok: false, error: expect.stringMatching(/di luar rentang/) });
  });

  it('memeriksa nilai lighting terhadap definisi', async () => {
    const { backup } = await sample();
    const unknown = clone(backup);
    unknown.lighting = { id_tidak_ada: 1 };
    expect(parse(unknown)).toMatchObject({ ok: false, error: expect.stringMatching(/tidak dikenal/) });

    const outOfRange = clone(backup);
    outOfRange.lighting = { id_qmk_rgb_matrix_brightness: 999 };
    expect(parse(outOfRange)).toMatchObject({ ok: false, error: expect.stringMatching(/tidak valid/) });

    const none = clone(backup);
    none.lighting = null;
    expect(parse(none).ok).toBe(true);
  });
});

describe('diffKeymap dan diffLighting', () => {
  it('tidak menghasilkan perubahan untuk isi yang sama', async () => {
    const { backup, keymap } = await sample();
    expect(diffKeymap(gen75, keymap, backupKeymap(backup))).toEqual([]);
  });

  it('melaporkan satu perubahan beserta nilai lama dan baru', async () => {
    const { backup, keymap } = await sample();
    const edited = clone(backup);
    edited.keymap.layers[1]![1 * 16 + 1] = '0x0004';
    const changes = diffKeymap(gen75, keymap, backupKeymap(edited));
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ layer: 1, from: 0x7e01, to: 0x0004 });
    expect(gen75.keys[changes[0]!.keyIndex]).toMatchObject({ row: 1, col: 1 });
  });

  it('mengabaikan slot matriks yang tidak punya tombol', async () => {
    const { backup, keymap } = await sample();
    const edited = clone(backup);
    edited.keymap.layers[0]![0 * 16 + 13] = '0x0004';
    expect(diffKeymap(gen75, keymap, backupKeymap(edited))).toEqual([]);
  });

  it('membandingkan nilai lighting', () => {
    const a = { id_qmk_rgb_matrix_brightness: 10, id_qmk_rgb_matrix_color: [1, 2] };
    expect(diffLighting(a, { ...a })).toEqual([]);
    expect(diffLighting(a, { ...a, id_qmk_rgb_matrix_brightness: 20 })).toEqual([{ id: 'id_qmk_rgb_matrix_brightness', to: 20 }]);
    expect(diffLighting(a, { id_qmk_rgb_matrix_color: [1, 3] })).toEqual([{ id: 'id_qmk_rgb_matrix_color', to: [1, 3] }]);
    expect(diffLighting(a, null)).toEqual([]);
  });
});
