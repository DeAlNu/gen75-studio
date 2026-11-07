import { describe, expect, it } from 'vitest';
import { backupKeymap, createBackup, diffEncoders, parseBackup, sameContent } from '../src/core/backup';
import type { Backup } from '../src/core/backup';
import { gen75 } from '../src/core/definition';
import { parseMacroBuffer, serializeEntry } from '../src/core/macros';
import type { MacroEntry } from '../src/core/macros';
import { decodeMatrix } from '../src/core/matrix';
import { DeviceSession } from '../src/core/session';
import { MemorySnapshotStore } from '../src/core/storage/snapshots';
import { MockViaDevice } from '../src/core/transport/mock';
import type { MockOptions } from '../src/core/transport/mock';
import { ViaClient } from '../src/core/via/client';
import { ViaReadOnly, ViaUnhandled } from '../src/core/via/errors';
import { createAppStore } from '../src/state/store';

const fastClient = { timeoutMs: 50, retries: 0 };

function client(mock: MockOptions = {}, writes = false) {
  const dev = new MockViaDevice(gen75, mock);
  const c = new ViaClient(dev, fastClient);
  c.writesEnabled = writes;
  return { dev, c };
}

async function session(mock: MockOptions = {}) {
  const dev = new MockViaDevice(gen75, mock);
  const s = new DeviceSession(dev, gen75, fastClient);
  const state = await s.open();
  return { dev, s, state };
}

function makeStore(mock?: MockOptions) {
  const holder: { dev: MockViaDevice | null } = { dev: null };
  const snapshots = new MemorySnapshotStore();
  const store = createAppStore({
    definition: gen75,
    snapshots,
    openWebHid: async () => null,
    findPaired: async () => null,
    openMock: async () => {
      holder.dev = new MockViaDevice(gen75, mock);
      return holder.dev;
    },
    clientOptions: fastClient,
    lightingWriteMs: 5,
    lightingCommitMs: 20,
  });
  return { store, holder, snapshots };
}

async function connected(mock?: MockOptions) {
  const ctx = makeStore(mock);
  await ctx.store.getState().connectMock();
  return { ...ctx, dev: ctx.holder.dev! };
}

const writes = (dev: MockViaDevice, cmd: number): number => dev.sent.filter((r) => r[0] === cmd).length;

describe('ViaClient: makro, encoder, dan matriks', () => {
  it('membaca jumlah slot, ukuran, dan isi buffer makro', async () => {
    const { c, dev } = client();
    expect(await c.getMacroCount()).toBe(16);
    expect(await c.getMacroBufferSize()).toBe(1024);
    expect(Array.from(await c.readMacroBuffer(1024))).toEqual(Array.from(dev.macro));
  });

  it('menulis buffer makro dalam potongan 28 byte', async () => {
    const { c, dev } = client({}, true);
    const data = Uint8Array.from({ length: 60 }, (_, i) => 0x41 + (i % 26));
    await c.writeMacroBuffer(10, data);
    expect(dev.macroWrites).toEqual([
      { offset: 10, size: 28 },
      { offset: 38, size: 28 },
      { offset: 66, size: 4 },
    ]);
    expect(Array.from(dev.macro.subarray(10, 70))).toEqual(Array.from(data));
  });

  it('menolak penulisan makro dan encoder saat mode baca saja', async () => {
    const { c, dev } = client();
    await expect(c.writeMacroBuffer(0, Uint8Array.of(1, 2, 3))).rejects.toBeInstanceOf(ViaReadOnly);
    await expect(c.writeEncoder(0, 0, true, 0x04)).rejects.toBeInstanceOf(ViaReadOnly);
    expect(dev.sent).toHaveLength(0);
  });

  it('membaca dan menulis keycode encoder dengan verifikasi', async () => {
    const { c, dev } = client({}, true);
    expect(await c.readEncoder(0, 0, false)).toBe(0xaa);
    expect(await c.readEncoder(0, 0, true)).toBe(0xa9);
    await c.writeEncoder(0, 0, true, 0x04);
    expect(dev.encoderMap.get('0,0,1')).toBe(0x04);
    expect(await c.readEncoder(0, 0, true)).toBe(0x04);
  });

  it('melaporkan encoder yang tidak didukung firmware', async () => {
    const { c } = client({ encoders: false });
    await expect(c.readEncoder(0, 0, false)).rejects.toBeInstanceOf(ViaUnhandled);
  });

  it('membaca keadaan matriks', async () => {
    const { c, dev } = client();
    dev.press(0, 1);
    dev.press(3, 15);
    const pressed = decodeMatrix(await c.readMatrixState(6, 16), 6, 16);
    expect(pressed).toEqual(new Set(['0,1', '3,15']));
    dev.release(0, 1);
    expect(decodeMatrix(await c.readMatrixState(6, 16), 6, 16)).toEqual(new Set(['3,15']));
  });

  it('melaporkan matriks yang tidak didukung firmware', async () => {
    const { c } = client({ matrixState: false });
    await expect(c.readMatrixState(6, 16)).rejects.toBeInstanceOf(ViaUnhandled);
  });
});

describe('DeviceSession: makro dan encoder', () => {
  it('membaca makro dan encoder saat dibuka', async () => {
    const { state } = await session();
    expect(state.macroCount).toBe(16);
    expect(state.macroBuffer).toHaveLength(1024);
    expect(state.encoders).toHaveLength(4);
    expect(state.encoders?.[0]?.[0]).toEqual([0xaa, 0xa9]);
    expect(state.encoders?.[1]?.[0]).toEqual([1, 1]);
    expect(state.warnings).toEqual([]);
  });

  it('memberi peringatan bila makro atau encoder tidak tersedia', async () => {
    const noMacro = await session({ macros: false });
    expect(noMacro.state.macroBuffer).toBeNull();
    expect(noMacro.state.macroCount).toBe(0);
    expect(noMacro.state.warnings.join(' ')).toMatch(/Makro tidak tersedia/);
    expect(noMacro.state.writable).toBe(true);

    const noEnc = await session({ encoders: false });
    expect(noEnc.state.encoders).toBeNull();
    expect(noEnc.state.warnings.join(' ')).toMatch(/Putaran knob/);
  });

  it('menulis hanya rentang byte makro yang berubah', async () => {
    const { s, dev, state } = await session();
    const next = state.macroBuffer!.slice();
    next.set([0x61, 0x62, 0x63, 0x64], 100);
    await s.saveMacroBuffer(next);
    expect(dev.macroWrites).toEqual([{ offset: 100, size: 4 }]);
    expect(Array.from(state.macroBuffer!)).toEqual(Array.from(next));
    expect(Array.from(dev.macro)).toEqual(Array.from(next));
  });

  it('tidak menulis apa pun bila makro tidak berubah', async () => {
    const { s, dev, state } = await session();
    await s.saveMacroBuffer(state.macroBuffer!.slice());
    expect(dev.macroWrites).toHaveLength(0);
  });

  it('menolak ukuran buffer yang berbeda dan mode baca saja', async () => {
    const a = await session();
    await expect(a.s.saveMacroBuffer(new Uint8Array(10))).rejects.toBeInstanceOf(RangeError);
    const b = await session({ protocol: 11 });
    await expect(b.s.saveMacroBuffer(b.state.macroBuffer!.slice().fill(1, 0, 3))).rejects.toBeInstanceOf(ViaReadOnly);
  });

  it('menulis keycode encoder dan memperbarui salinan lokal', async () => {
    const { s, dev, state } = await session();
    await s.setEncoder(2, 0, false, 0x04);
    expect(dev.encoderMap.get('2,0,0')).toBe(0x04);
    expect(state.encoders?.[2]?.[0]?.[0]).toBe(0x04);
    await expect(s.setEncoder(9, 0, false, 0x04)).rejects.toBeInstanceOf(RangeError);
    await expect(s.setEncoder(0, 5, false, 0x04)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('store: putaran knob', () => {
  it('menulis keycode putaran lalu undo dan redo', async () => {
    const { store, dev } = await connected();
    expect(await store.getState().assignEncoder(0, true, 0xa8)).toEqual({ ok: true });
    expect(dev.encoderMap.get('0,0,1')).toBe(0xa8);
    expect(store.getState().encoders?.[0]?.[0]?.[1]).toBe(0xa8);
    expect(store.getState().past).toHaveLength(1);

    await store.getState().undo();
    expect(dev.encoderMap.get('0,0,1')).toBe(0xa9);
    expect(store.getState().encoders?.[0]?.[0]?.[1]).toBe(0xa9);

    await store.getState().redo();
    expect(dev.encoderMap.get('0,0,1')).toBe(0xa8);
  });

  it('mengurungkan tombol dan putaran bergantian dalam urutan terbalik', async () => {
    const { store, dev } = await connected();
    store.getState().select([0]);
    await store.getState().assignKeycode(0x05);
    await store.getState().assignEncoder(0, false, 0xa8);
    await store.getState().undo();
    expect(dev.encoderMap.get('0,0,0')).toBe(0xaa);
    expect(dev.keycodeAt(0, 0, 0)).toBe(0x05);
    await store.getState().undo();
    expect(dev.keycodeAt(0, 0, 0)).toBe(0x29);
  });

  it('meminta konfirmasi untuk keycode berisiko dan menolak tanpa encoder', async () => {
    const { store, dev } = await connected();
    expect(await store.getState().assignEncoder(0, true, 0x7e0a)).toMatchObject({ ok: false, reason: 'danger' });
    expect(writes(dev, 0x15)).toBe(0);

    const none = await connected({ encoders: false });
    expect(await none.store.getState().assignEncoder(0, true, 0x04)).toMatchObject({ ok: false, message: expect.stringMatching(/tidak tersedia/) });
  });
});

describe('store: makro', () => {
  const entriesOf = (store: Awaited<ReturnType<typeof connected>>['store']): MacroEntry[] =>
    parseMacroBuffer(store.getState().macroBuffer!, store.getState().macroCount);

  it('menyimpan satu makro yang diubah dan hanya menulis rentang yang berubah', async () => {
    const { store, dev } = await connected();
    const entries = entriesOf(store);
    const start = serializeEntry(entries[0]!).length + 1 + serializeEntry(entries[1]!).length + 1;
    entries[2] = { kind: 'actions', actions: [{ kind: 'text', text: 'baru' }] };

    expect(await store.getState().saveMacros(entries)).toEqual({ ok: true });
    expect(dev.macroWrites).toEqual([{ offset: start, size: 4 }]);
    expect(Array.from(store.getState().macroBuffer!)).toEqual(Array.from(dev.macro));
    expect(entriesOf(store)[2]).toMatchObject({ kind: 'actions', actions: [{ kind: 'text', text: 'baru' }] });
  });

  it('menolak makro yang tidak muat tanpa menulis apa pun', async () => {
    const { store, dev } = await connected();
    const entries = entriesOf(store);
    entries[3] = { kind: 'actions', actions: [{ kind: 'text', text: 'x'.repeat(2000) }] };
    expect(await store.getState().saveMacros(entries)).toMatchObject({ ok: false, message: expect.stringMatching(/penuh/) });
    expect(dev.macroWrites).toHaveLength(0);
  });

  it('menolak jumlah makro yang salah, makro tak valid, dan mode baca saja', async () => {
    const { store, dev } = await connected();
    expect(await store.getState().saveMacros([])).toMatchObject({ ok: false });
    const bad = entriesOf(store);
    bad[0] = { kind: 'actions', actions: [{ kind: 'delay', ms: 0 }] };
    expect(await store.getState().saveMacros(bad)).toMatchObject({ ok: false, message: expect.stringMatching(/jeda/) });
    expect(dev.macroWrites).toHaveLength(0);

    const ro = await connected({ protocol: 11 });
    expect(await ro.store.getState().saveMacros(entriesOf(ro.store))).toMatchObject({ ok: false, message: expect.stringMatching(/baca saja/) });
  });
});

describe('store: tester matriks', () => {
  it('membaca tombol yang sedang ditekan', async () => {
    const { store, dev } = await connected();
    dev.press(2, 3);
    const r = await store.getState().readMatrix();
    expect(r).toEqual({ ok: true, pressed: new Set(['2,3']) });
  });

  it('menandai firmware yang tidak mendukung dan perangkat yang belum tersambung', async () => {
    const { store } = await connected({ matrixState: false });
    expect(await store.getState().readMatrix()).toMatchObject({ ok: false, unsupported: true });
    const idle = makeStore();
    expect(await idle.store.getState().readMatrix()).toMatchObject({ ok: false, unsupported: false });
  });
});

describe('backup dengan makro dan encoder', () => {
  async function exported(): Promise<Backup> {
    const { state } = await session();
    return createBackup(gen75, state, new Date('2026-11-08T00:00:00Z'));
  }
  const parse = (b: unknown, layers = 4) => parseBackup(JSON.stringify(b), gen75, layers);
  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  it('memuat makro heksadesimal tanpa nol di ujung dan keycode encoder', async () => {
    const b = await exported();
    expect(b.macros?.count).toBe(16);
    expect(b.macros?.bytes).toMatch(/^[0-9a-f]+$/);
    expect(b.macros!.bytes.endsWith('00')).toBe(false);
    expect(b.encoders).toHaveLength(4);
    expect(b.encoders?.[0]?.[0]).toEqual(['0x00AA', '0x00A9']);
  });

  it('bolak-balik tanpa perubahan isi dan menerima backup lama tanpa kedua bagian itu', async () => {
    const b = await exported();
    const r = parse(b);
    expect(r.ok).toBe(true);
    if (r.ok) expect(sameContent(r.backup, b)).toBe(true);

    const old = clone(b) as Partial<Backup>;
    delete old.macros;
    delete old.encoders;
    const r2 = parse(old);
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      expect(r2.backup.macros).toBeNull();
      expect(r2.backup.encoders).toBeNull();
    }
  });

  it('menolak makro dan encoder yang tidak valid', async () => {
    const b = await exported();
    const badHex = clone(b);
    badHex.macros = { count: 16, bytes: 'zz' };
    expect(parse(badHex)).toMatchObject({ ok: false, error: expect.stringMatching(/heksadesimal/) });

    const badCount = clone(b);
    badCount.macros = { count: 0, bytes: '' };
    expect(parse(badCount)).toMatchObject({ ok: false, error: expect.stringMatching(/makro/) });

    const badDims = clone(b);
    badDims.encoders = [[['0x0001', '0x0001'], ['0x0001', '0x0001']]];
    expect(parse(badDims)).toMatchObject({ ok: false, error: expect.stringMatching(/1 encoder/) });

    const badCode = clone(b);
    badCode.encoders![0]![0]![0] = '0x7C00';
    expect(parse(badCode)).toMatchObject({ ok: false, error: expect.stringMatching(/encoder/) });
  });

  it('membedakan isi makro dan encoder pada perbandingan', async () => {
    const b = await exported();
    const changed = clone(b);
    changed.macros = { count: 16, bytes: `${b.macros!.bytes}41` };
    expect(sameContent(b, changed)).toBe(false);
    const enc = clone(b);
    enc.encoders![0]![0]![1] = '0x0004';
    expect(sameContent(b, enc)).toBe(false);
    expect(diffEncoders([[[1, 2]]], [[[1, 3]]])).toEqual([{ layer: 0, index: 0, clockwise: true, from: 2, to: 3 }]);
    expect(diffEncoders(null, [[[1, 2]]])).toEqual([]);
  });

  it('memulihkan makro dan encoder lewat store dan memverifikasi hasilnya', async () => {
    const { store, dev } = await connected();
    const b = store.getState().exportBackup()!;
    const edited = clone(b);
    edited.macros = { count: 16, bytes: `${b.macros!.bytes}00004142` };
    edited.encoders![0]![0]![0] = '0x0004';

    const prep = store.getState().prepareRestore(JSON.stringify(edited));
    if (!prep.ok) throw new Error(prep.error);
    expect(prep.macroTarget).not.toBeNull();
    expect(prep.encoderChanges).toHaveLength(1);
    expect(prep.keyChanges).toHaveLength(0);
    expect(prep.layers).toEqual([0]);

    const res = await store.getState().applyRestore(prep);
    expect(res).toEqual({ ok: true, applied: 2, mismatches: 0 });
    expect(dev.encoderMap.get('0,0,0')).toBe(0x04);
    expect(Array.from(dev.macro)).toEqual(Array.from(prep.macroTarget!));
    expect(Array.from(store.getState().macroBuffer!)).toEqual(Array.from(dev.macro));
  });

  it('menolak jumlah slot makro yang berbeda dan melewati bagian yang tidak tersedia', async () => {
    const { store } = await connected();
    const b = store.getState().exportBackup()!;
    const wrongCount = clone(b);
    wrongCount.macros = { count: 8, bytes: '' };
    expect(store.getState().prepareRestore(JSON.stringify(wrongCount))).toMatchObject({ ok: false, error: expect.stringMatching(/slot makro/) });

    const bare = await connected({ macros: false, encoders: false });
    const prep = bare.store.getState().prepareRestore(JSON.stringify(b));
    if (!prep.ok) throw new Error(prep.error);
    expect(prep.skipped).toHaveLength(2);
    expect(prep.macroTarget).toBeNull();
    expect(prep.encoderChanges).toEqual([]);
  });

  it('keymap tetap dibaca benar dari backup yang berisi makro', async () => {
    const b = await exported();
    const r = parse(b);
    if (!r.ok) throw new Error(r.error);
    expect(backupKeymap(r.backup)).toHaveLength(4);
  });
});
