import { describe, expect, it, vi } from 'vitest';
import { gen75 } from '../src/core/definition';
import { MemorySnapshotStore } from '../src/core/storage/snapshots';
import { MockViaDevice } from '../src/core/transport/mock';
import type { MockOptions } from '../src/core/transport/mock';
import { MOCK_LAYER0 } from '../src/core/transport/mock-keymap';
import { createAppStore } from '../src/state/store';

function make(mock?: MockOptions, silent = false) {
  const holder: { dev: MockViaDevice | null } = { dev: null };
  const snapshots = new MemorySnapshotStore();
  const store = createAppStore({
    definition: gen75,
    snapshots,
    openWebHid: async () => null,
    findPaired: async () => null,
    openMock: async () => {
      holder.dev = new MockViaDevice(gen75, mock);
      if (silent) holder.dev.dropNext(1000);
      return holder.dev;
    },
    clientOptions: { timeoutMs: silent ? 15 : 100, retries: 0 },
    lightingWriteMs: 5,
    lightingCommitMs: 20,
  });
  return { store, holder, snapshots };
}

const keyIndex = (code: number): number => MOCK_LAYER0.indexOf(code);
const slot = (i: number): number => gen75.keys[i]!.row * 16 + gen75.keys[i]!.col;
const writes = (dev: MockViaDevice, cmd: number): number => dev.sent.filter((r) => r[0] === cmd).length;

describe('koneksi', () => {
  it('terhubung ke perangkat simulasi dan mengambil snapshot awal', async () => {
    const { store, snapshots } = make();
    await store.getState().connectMock();
    const s = store.getState();
    expect(s.status).toBe('ready');
    expect(s.simulated).toBe(true);
    expect(s.keymap).toHaveLength(4);
    expect(s.writable).toBe(true);
    expect(await snapshots.list()).toHaveLength(1);
    expect(s.snapshots).toHaveLength(1);
  });

  it('tidak menumpuk snapshot yang isinya sama saat sambung ulang', async () => {
    const { store, snapshots } = make();
    await store.getState().connectMock();
    await store.getState().disconnect();
    expect(store.getState().status).toBe('idle');
    await store.getState().connectMock();
    expect(await snapshots.list()).toHaveLength(1);
  });

  it('berstatus error bila perangkat tidak merespons', async () => {
    const { store } = make(undefined, true);
    await store.getState().connectMock();
    expect(store.getState().status).toBe('error');
    expect(store.getState().error).toMatch(/tidak merespons/);
  });

  it('berstatus disconnected saat perangkat dicabut', async () => {
    const { store, holder } = make();
    await store.getState().connectMock();
    holder.dev!.unplug();
    expect(store.getState().status).toBe('disconnected');
  });
});

describe('penyuntingan keymap', () => {
  const connect = async (mock?: MockOptions) => {
    const ctx = make(mock);
    await ctx.store.getState().connectMock();
    return ctx;
  };

  it('menulis satu tombol lalu undo dan redo', async () => {
    const { store, holder } = await connect();
    const a = keyIndex(0x04);
    const key = gen75.keys[a]!;
    store.getState().select([a]);

    expect(await store.getState().assignKeycode(0x05)).toEqual({ ok: true });
    expect(store.getState().keymap[0]?.[slot(a)]).toBe(0x05);
    expect(holder.dev!.keycodeAt(0, key.row, key.col)).toBe(0x05);
    expect(store.getState().past).toHaveLength(1);

    await store.getState().undo();
    expect(store.getState().keymap[0]?.[slot(a)]).toBe(0x04);
    expect(holder.dev!.keycodeAt(0, key.row, key.col)).toBe(0x04);
    expect(store.getState().future).toHaveLength(1);

    await store.getState().redo();
    expect(holder.dev!.keycodeAt(0, key.row, key.col)).toBe(0x05);
    expect(store.getState().past).toHaveLength(1);
  });

  it('menulis beberapa tombol sekaligus dan membatalkannya dalam satu langkah', async () => {
    const { store, holder } = await connect();
    const a = keyIndex(0x04);
    const z = keyIndex(0x1d);
    store.getState().select([a, z]);
    expect(await store.getState().assignKeycode(0x1b)).toEqual({ ok: true });
    expect(store.getState().keymap[0]?.[slot(a)]).toBe(0x1b);
    expect(store.getState().keymap[0]?.[slot(z)]).toBe(0x1b);
    expect(store.getState().past).toHaveLength(1);

    await store.getState().undo();
    expect(store.getState().keymap[0]?.[slot(a)]).toBe(0x04);
    expect(store.getState().keymap[0]?.[slot(z)]).toBe(0x1d);
    expect(holder.dev!.keycodeAt(0, gen75.keys[z]!.row, gen75.keys[z]!.col)).toBe(0x1d);
  });

  it('menulis pada layer yang sedang dipilih', async () => {
    const { store, holder } = await connect();
    const a = keyIndex(0x04);
    store.getState().select([a]);
    store.getState().setLayer(2);
    await store.getState().assignKeycode(0x05);
    expect(holder.dev!.keycodeAt(2, gen75.keys[a]!.row, gen75.keys[a]!.col)).toBe(0x05);
    expect(holder.dev!.keycodeAt(0, gen75.keys[a]!.row, gen75.keys[a]!.col)).toBe(0x04);
  });

  it('tidak menulis dan tidak mencatat riwayat bila keycode sama', async () => {
    const { store, holder } = await connect();
    store.getState().select([keyIndex(0x04)]);
    expect(await store.getState().assignKeycode(0x04)).toEqual({ ok: true });
    expect(writes(holder.dev!, 0x05)).toBe(0);
    expect(store.getState().past).toHaveLength(0);
  });

  it('meminta konfirmasi untuk keycode berbahaya', async () => {
    const { store, holder } = await connect();
    store.getState().select([keyIndex(0x04)]);
    const refused = await store.getState().assignKeycode(0x7e0a);
    expect(refused).toMatchObject({ ok: false, reason: 'danger' });
    expect(writes(holder.dev!, 0x05)).toBe(0);
    expect(await store.getState().assignKeycode(0x7e0a, { confirmed: true })).toEqual({ ok: true });
    expect(writes(holder.dev!, 0x05)).toBe(1);
  });

  it('menolak keycode di luar rentang dan masukan tanpa tombol terpilih', async () => {
    const { store, holder } = await connect();
    store.getState().select([keyIndex(0x04)]);
    expect(await store.getState().assignKeycode(0x7c00, { confirmed: true })).toMatchObject({ ok: false, message: expect.stringMatching(/di luar rentang/) });
    store.getState().select([]);
    expect(await store.getState().assignKeycode(0x05)).toMatchObject({ ok: false, message: expect.stringMatching(/Pilih tombol/) });
    expect(writes(holder.dev!, 0x05)).toBe(0);
  });

  it('menolak semua penulisan pada mode baca saja', async () => {
    const { store, holder } = await connect({ protocol: 11 });
    expect(store.getState().writable).toBe(false);
    store.getState().select([keyIndex(0x04)]);
    expect(await store.getState().assignKeycode(0x05)).toMatchObject({ ok: false, reason: 'error' });
    expect(writes(holder.dev!, 0x05)).toBe(0);
  });

  it('mengatur pilihan tombol dan layer dengan batas yang aman', async () => {
    const { store } = await connect();
    store.getState().select([3, 3, 5, 9999]);
    expect(store.getState().selected).toEqual([3, 5]);
    store.getState().toggleSelect(3);
    expect(store.getState().selected).toEqual([5]);
    store.getState().setLayer(99);
    expect(store.getState().layer).toBe(3);
    store.getState().setLayer(-4);
    expect(store.getState().layer).toBe(0);
  });
});

describe('lighting', () => {
  it('menunda penulisan, hanya mengirim nilai terakhir, lalu menyimpan sekali', async () => {
    vi.useFakeTimers();
    try {
      const { store, holder } = make();
      await store.getState().connectMock();
      const dev = holder.dev!;
      const set = store.getState().setLightingValue;
      set('id_qmk_rgb_matrix_brightness', 10);
      set('id_qmk_rgb_matrix_brightness', 20);
      set('id_qmk_rgb_matrix_brightness', 30);
      expect(store.getState().lighting?.id_qmk_rgb_matrix_brightness).toBe(30);
      expect(dev.lighting.get(1)).toEqual([128]);

      await vi.advanceTimersByTimeAsync(10);
      expect(dev.lighting.get(1)).toEqual([30]);
      expect(writes(dev, 0x07)).toBe(1);
      expect(dev.saves).toEqual([]);

      await vi.advanceTimersByTimeAsync(30);
      expect(dev.saves).toEqual([3]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushLighting menulis dan menyimpan seketika', async () => {
    const { store, holder } = make();
    await store.getState().connectMock();
    store.getState().setLightingValue('id_qmk_rgb_matrix_effect', 5);
    await store.getState().flushLighting();
    expect(holder.dev!.lighting.get(2)).toEqual([5]);
    expect(holder.dev!.saves).toEqual([3]);
  });

  it('mengabaikan nilai lighting yang tidak dikenal', async () => {
    const { store, holder } = make();
    await store.getState().connectMock();
    store.getState().setLightingValue('id_tidak_ada', 1);
    await store.getState().flushLighting();
    expect(writes(holder.dev!, 0x07)).toBe(0);
  });
});

describe('backup dan pemulihan', () => {
  async function prepared(edit: (layer0: string[], a: number) => void, lighting?: Record<string, unknown>) {
    const ctx = make();
    await ctx.store.getState().connectMock();
    const backup = ctx.store.getState().exportBackup()!;
    const a = keyIndex(0x04);
    const layers = backup.keymap.layers.map((l) => [...l]);
    edit(layers[0]!, slot(a));
    const text = JSON.stringify({ ...backup, keymap: { layers }, ...(lighting ? { lighting } : {}) });
    const prep = ctx.store.getState().prepareRestore(text);
    if (!prep.ok) throw new Error(prep.error);
    return { ...ctx, prep, a };
  }

  it('mengekspor keadaan perangkat', async () => {
    const { store } = make();
    expect(store.getState().exportBackup()).toBeNull();
    await store.getState().connectMock();
    const b = store.getState().exportBackup()!;
    expect(b.keymap.layers).toHaveLength(4);
    expect(b.lighting).not.toBeNull();
  });

  it('memulihkan perubahan satu tombol dan mencatat snapshot sebelum pulih', async () => {
    const { store, holder, snapshots, prep, a } = await prepared((l, s) => {
      l[s] = '0x0005';
    });
    expect(prep.keyChanges).toHaveLength(1);
    expect(prep.dangerous).toBe(0);
    expect(prep.layers).toEqual([0]);

    expect(await store.getState().applyRestore(prep)).toEqual({ ok: true, applied: 1, mismatches: 0 });
    expect(holder.dev!.keycodeAt(0, gen75.keys[a]!.row, gen75.keys[a]!.col)).toBe(0x05);
    expect(store.getState().past).toHaveLength(0);
    expect((await snapshots.list()).map((s) => s.reason).sort()).toEqual(['before-restore', 'connect']);
  });

  it('memulihkan nilai lighting dan menyimpannya', async () => {
    const { store, holder, prep } = await prepared(() => undefined, {
      id_qmk_rgb_matrix_brightness: 64,
      id_qmk_rgb_matrix_effect: 12,
      id_qmk_rgb_matrix_effect_speed: 128,
      id_qmk_rgb_matrix_color: [10, 255],
    });
    expect(prep.keyChanges).toHaveLength(0);
    expect(prep.lightingChanges).toEqual([{ id: 'id_qmk_rgb_matrix_brightness', to: 64 }]);
    expect(await store.getState().applyRestore(prep)).toMatchObject({ ok: true });
    expect(holder.dev!.lighting.get(1)).toEqual([64]);
    expect(holder.dev!.saves).toEqual([3]);
  });

  it('menahan pemulihan yang berisi keycode berisiko sampai dikonfirmasi', async () => {
    const { store, holder, prep } = await prepared((l, s) => {
      l[s] = '0x7E0A';
    });
    expect(prep.dangerous).toBe(1);
    expect(await store.getState().applyRestore(prep)).toMatchObject({ ok: false, reason: 'danger' });
    expect(writes(holder.dev!, 0x05)).toBe(0);
    expect(await store.getState().applyRestore(prep, { confirmedDanger: true })).toMatchObject({ ok: true, applied: 1 });
  });

  it('menolak berkas yang tidak valid dengan alasan yang jelas', async () => {
    const { store } = make();
    await store.getState().connectMock();
    const r = store.getState().prepareRestore('{"schemaVersion":1}');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/VID\/PID/);
  });
});
