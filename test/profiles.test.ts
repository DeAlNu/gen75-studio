import { describe, expect, it } from 'vitest';
import { createBackup, sameContent } from '../src/core/backup';
import type { Backup } from '../src/core/backup';
import { compareBackups, describeMacroBytes, isUsableBackup, macroSlots } from '../src/core/compare';
import { gen75 } from '../src/core/definition';
import { controlsOf } from '../src/core/definition/menus';
import {
  checkProfileName,
  cleanName,
  createProfile,
  matchingProfile,
  NAME_MAX,
  parseProfileFile,
  profileParts,
  profileToFile,
  uniqueName,
} from '../src/core/profiles';
import type { Profile } from '../src/core/profiles';
import { DeviceSession } from '../src/core/session';
import { MemoryProfileStore } from '../src/core/storage/profiles';
import { MemorySnapshotStore } from '../src/core/storage/snapshots';
import { MockViaDevice } from '../src/core/transport/mock';
import { slug } from '../src/app/download';
import { createAppStore, ALL_PARTS } from '../src/state/store';

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const NOW = new Date('2026-11-08T00:00:00Z');

async function sample(): Promise<Backup> {
  const session = new DeviceSession(new MockViaDevice(gen75), gen75, { timeoutMs: 50, retries: 0 });
  return createBackup(gen75, await session.open(), NOW);
}

const profile = (name: string, backup: Backup, id = name): Profile => createProfile(name, '', backup, NOW, id);

describe('nama profil', () => {
  it('merapikan spasi dan menolak nama kosong, terlalu panjang, atau kembar', async () => {
    const backup = await sample();
    const list = [profile('Harian', backup)];
    expect(cleanName('  Game   FPS ')).toBe('Game FPS');
    expect(checkProfileName('   ', list)).toMatch(/kosong/);
    expect(checkProfileName('x'.repeat(NAME_MAX + 1), list)).toMatch(/paling panjang/);
    expect(checkProfileName('harian', list)).toMatch(/Sudah ada/);
    expect(checkProfileName('Kerja', list)).toBeNull();
  });

  it('mengizinkan nama yang sama bila itu profil yang sedang diubah', async () => {
    const list = [profile('Harian', await sample(), 'a')];
    expect(checkProfileName('Harian', list, 'a')).toBeNull();
    expect(checkProfileName('Harian', list, 'b')).toMatch(/Sudah ada/);
  });

  it('membuat nama unik dengan nomor dan tetap muat dalam batas panjang', async () => {
    const backup = await sample();
    const list = [profile('Harian', backup), profile('Harian (2)', backup)];
    expect(uniqueName('Kerja', list)).toBe('Kerja');
    expect(uniqueName('Harian', list)).toBe('Harian (3)');
    const long = 'a'.repeat(NAME_MAX);
    const next = uniqueName(long, [profile(long, backup)]);
    expect(next.length).toBeLessThanOrEqual(NAME_MAX);
    expect(next.endsWith(' (2)')).toBe(true);
  });
});

describe('berkas profil', () => {
  it('bolak-balik tanpa kehilangan nama, catatan, dan isi', async () => {
    const backup = await sample();
    const p = createProfile('Game FPS', 'untuk Valorant', backup, NOW, 'x');
    const r = parseProfileFile(JSON.stringify(profileToFile(p)), gen75, 4, 'cadangan');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.name).toBe('Game FPS');
      expect(r.note).toBe('untuk Valorant');
      expect(sameContent(r.backup, backup)).toBe(true);
    }
  });

  it('menerima berkas backup biasa dan memakai nama cadangan', async () => {
    const r = parseProfileFile(JSON.stringify(await sample()), gen75, 4, 'gen75-backup-20261108');
    expect(r).toMatchObject({ ok: true, name: 'gen75-backup-20261108', note: '' });
  });

  it('menolak berkas rusak, versi asing, dan backup dari perangkat lain', async () => {
    const backup = await sample();
    const file = profileToFile(profile('A', backup));
    expect(parseProfileFile('bukan json', gen75, 4, 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) });
    expect(parseProfileFile(JSON.stringify({ ...file, schemaVersion: 2 }), gen75, 4, 'x')).toMatchObject({ ok: false });
    const foreign = clone(file);
    foreign.backup.device.vendorId = '0x1234';
    expect(parseProfileFile(JSON.stringify(foreign), gen75, 4, 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/VID\/PID/) });
    expect(parseProfileFile(JSON.stringify({ ...file, backup: null }), gen75, 4, 'x').ok).toBe(false);
  });

  it('memotong nama dan catatan yang kepanjangan, dan memakai cadangan bila nama kosong', async () => {
    const file = profileToFile(profile('A', await sample()));
    const r = parseProfileFile(JSON.stringify({ ...file, name: 'n'.repeat(100), note: 'c'.repeat(500) }), gen75, 4, 'x');
    expect(r.ok && r.name.length).toBe(NAME_MAX);
    expect(r.ok && r.note.length).toBe(200);
    expect(parseProfileFile(JSON.stringify({ ...file, name: '   ' }), gen75, 4, 'cadangan')).toMatchObject({ ok: true, name: 'cadangan' });
  });

  it('menolak profil dengan layer lebih banyak dari batas perangkat', async () => {
    const file = profileToFile(profile('A', await sample()));
    expect(parseProfileFile(JSON.stringify(file), gen75, 3, 'x')).toMatchObject({ ok: false, error: expect.stringMatching(/4 layer/) });
  });

  it('merangkum bagian yang dimuat', async () => {
    const backup = await sample();
    expect(profileParts(backup)).toBe('4 layer, knob, makro, lighting');
    expect(profileParts({ ...backup, encoders: null, macros: null, lighting: null })).toBe('4 layer');
  });
});

describe('nama berkas', () => {
  it('mengubah nama bebas menjadi nama berkas yang aman', () => {
    expect(slug('Game FPS (Valorant)')).toBe('game-fps-valorant');
    expect(slug('Ketik cepat')).toBe('ketik-cepat');
    expect(slug('Café Malam')).toBe('cafe-malam');
    expect(slug('///')).toBe('profil');
  });
});

describe('profil yang cocok', () => {
  it('mengenali isi yang sama walau urutan kunci lighting berbeda', async () => {
    const backup = await sample();
    const reordered = clone(backup);
    reordered.lighting = Object.fromEntries(Object.entries(backup.lighting ?? {}).reverse());
    expect(sameContent(backup, reordered)).toBe(true);
    expect(matchingProfile([profile('A', reordered)], backup)?.name).toBe('A');
  });

  it('tidak cocok bila satu keycode berbeda', async () => {
    const backup = await sample();
    const changed = clone(backup);
    changed.keymap.layers[1]![5] = '0x0004';
    expect(matchingProfile([profile('A', changed)], backup)).toBeUndefined();
  });
});

describe('perbandingan', () => {
  it('menyatakan isi yang sama sebagai tanpa perbedaan', async () => {
    const backup = await sample();
    const c = compareBackups(gen75, backup, clone(backup));
    expect(c.total).toBe(0);
    expect(c.notes).toEqual([]);
    expect(c.keys).toEqual([]);
  });

  it('menemukan perubahan keycode dari A ke B dengan layer dan nomor tombolnya', async () => {
    const a = await sample();
    const b = clone(a);
    const key = gen75.keys[3]!;
    const slot = key.row * gen75.matrix.cols + key.col;
    b.keymap.layers[2]![slot] = '0x0005';
    const c = compareBackups(gen75, a, b);
    expect(c.keys).toEqual([{ layer: 2, keyIndex: key.index, from: Number.parseInt(a.keymap.layers[2]![slot]!, 16), to: 5 }]);
    expect(c.total).toBe(1);
  });

  it('mengabaikan slot matriks yang tidak punya tombol', async () => {
    const a = await sample();
    const b = clone(a);
    const used = new Set(gen75.keys.map((k) => k.row * gen75.matrix.cols + k.col));
    const empty = [...Array(96).keys()].find((i) => !used.has(i))!;
    b.keymap.layers[0]![empty] = '0x0004';
    expect(compareBackups(gen75, a, b).total).toBe(0);
  });

  it('hanya membandingkan layer yang ada di kedua sisi dan memberi catatan', async () => {
    const a = await sample();
    const b = clone(a);
    b.keymap.layers = b.keymap.layers.slice(0, 2);
    b.encoders = b.encoders?.slice(0, 2) ?? null;
    const c = compareBackups(gen75, a, b);
    expect(c.layerCounts).toEqual([4, 2]);
    expect(c.notes.join(' ')).toMatch(/Jumlah layer berbeda/);
    expect(c.keys).toEqual([]);
  });

  it('membandingkan putaran knob dan memberi catatan bila hanya satu sisi punya', async () => {
    const a = await sample();
    const b = clone(a);
    b.encoders![0]![0]![1] = '0x0006';
    const c = compareBackups(gen75, a, b);
    expect(c.encoders).toEqual([{ layer: 0, index: 0, clockwise: true, from: 0xa9, to: 0x06 }]);

    const none = clone(a);
    none.encoders = null;
    const d = compareBackups(gen75, a, none);
    expect(d.encoders).toBeNull();
    expect(d.notes.join(' ')).toMatch(/knob/);
  });

  it('menuliskan nilai lighting dengan label, nama efek, dan warna heksadesimal', async () => {
    const a = await sample();
    const b = clone(a);
    const controls = controlsOf(gen75.menus);
    const effect = controls.find((x) => x.ref.id === 'id_qmk_rgb_matrix_effect');
    if (effect?.kind !== 'dropdown') throw new Error('efek harus dropdown');
    b.lighting = { ...b.lighting!, id_qmk_rgb_matrix_brightness: 64, id_qmk_rgb_matrix_effect: 1, id_qmk_rgb_matrix_color: [0, 255] };
    const c = compareBackups(gen75, a, b);
    const by = (id: string) => c.lighting!.find((x) => x.id === id)!;
    expect(by('id_qmk_rgb_matrix_brightness')).toMatchObject({ label: 'Brightness', to: '64' });
    expect(by('id_qmk_rgb_matrix_effect').to).toBe(effect.options.find((o) => o.value === 1)!.label);
    expect(by('id_qmk_rgb_matrix_color').to).toBe('#ff0000');
    expect(c.lighting!.every((x) => x.from !== x.to)).toBe(true);
  });

  it('memecah makro per slot dan menjelaskan isi yang berbeda', async () => {
    const a = await sample();
    const b = clone(a);
    const slots = macroSlots(b.macros!);
    expect(slots).toHaveLength(b.macros!.count);

    // slot 2 diisi teks "hi", slot lain tidak berubah
    const rebuilt = slots.map((s, i) => (i === 2 ? [0x68, 0x69] : s));
    const hex = rebuilt.map((s) => s.map((x) => x.toString(16).padStart(2, '0')).join('')).join('00').replace(/(00)+$/, '');
    b.macros = { count: b.macros!.count, bytes: hex };
    const c = compareBackups(gen75, a, b);
    expect(c.macros).toEqual([{ slot: 2, from: 'kosong', to: 'Ketik "hi"' }]);
  });

  it('memberi catatan bila makro atau lighting hanya ada di satu sisi', async () => {
    const a = await sample();
    const b = clone(a);
    b.macros = null;
    b.lighting = null;
    const c = compareBackups(gen75, a, b);
    expect(c.macros).toBeNull();
    expect(c.lighting).toBeNull();
    expect(c.notes.join(' ')).toMatch(/Makro/);
    expect(c.notes.join(' ')).toMatch(/Lighting/);
  });

  it('mengenali data backup yang rusak atau dari versi lain', async () => {
    expect(isUsableBackup(await sample())).toBe(true);
    expect(isUsableBackup({ marker: 'lama' })).toBe(false);
    expect(isUsableBackup(null)).toBe(false);
    expect(isUsableBackup({ keymap: { layers: [] } })).toBe(false);
    expect(isUsableBackup({ keymap: { layers: [[1, 2]] } })).toBe(false);
  });

  it('menjelaskan makro berformat tidak dikenal tanpa melempar galat', () => {
    expect(describeMacroBytes([])).toBe('kosong');
    expect(describeMacroBytes([0x01, 0x09, 0x01])).toMatch(/tidak dikenal \(3 byte\)/);
    expect(describeMacroBytes([0x01, 0x01, 0x06, 0x01, 0x04, 0x31, 0x30, 0x30, 0x7c])).toBe('Ketuk C, Jeda 100 ms');
  });
});

function build(profiles = new MemoryProfileStore()) {
  const holder: { dev: MockViaDevice | null } = { dev: null };
  const store = createAppStore({
    definition: gen75,
    snapshots: new MemorySnapshotStore(),
    profiles,
    openWebHid: async () => null,
    findPaired: async () => null,
    openMock: async () => {
      holder.dev = new MockViaDevice(gen75);
      return holder.dev;
    },
    clientOptions: { timeoutMs: 100, retries: 0 },
    lightingWriteMs: 5,
    lightingCommitMs: 20,
  });
  return { store, holder, profiles };
}

describe('profil di store', () => {
  it('menolak menyimpan profil sebelum terhubung', async () => {
    const { store } = build();
    expect(await store.getState().saveProfile('Harian', '')).toMatchObject({ ok: false, message: expect.stringMatching(/Sambungkan/) });
  });

  it('menyimpan keadaan sekarang, mencatat profil terakhir, dan menolak nama kembar', async () => {
    const { store, profiles } = build();
    await store.getState().connectMock();
    const r = await store.getState().saveProfile('  Harian ', 'catatan');
    expect(r.ok).toBe(true);
    const s = store.getState();
    expect(s.profiles.map((p) => p.name)).toEqual(['Harian']);
    expect(s.lastProfileId).toBe(s.profiles[0]!.id);
    expect(sameContent(s.profiles[0]!.backup, s.exportBackup()!)).toBe(true);
    expect((await profiles.list()).map((p) => p.name)).toEqual(['Harian']);
    expect(await s.saveProfile('harian', '')).toMatchObject({ ok: false, message: expect.stringMatching(/Sudah ada/) });
  });

  it('memuat profil yang tersimpan dari sesi sebelumnya', async () => {
    const shared = new MemoryProfileStore();
    const first = build(shared);
    await first.store.getState().connectMock();
    await first.store.getState().saveProfile('Kerja', '');

    const second = build(shared);
    expect(second.store.getState().profiles).toEqual([]);
    await second.store.getState().loadStored();
    expect(second.store.getState().profiles.map((p) => p.name)).toEqual(['Kerja']);
  });

  it('menerapkan profil ke keyboard dan mengenalinya sebagai cocok', async () => {
    const { store, holder } = build();
    await store.getState().connectMock();
    const saved = await store.getState().saveProfile('Awal', '');
    if (!saved.ok) throw new Error(saved.message);

    const key = gen75.keys[10]!;
    store.getState().select([key.index]);
    await store.getState().assignKeycode(0x05);
    expect(matchingProfile(store.getState().profiles, store.getState().exportBackup()!)).toBeUndefined();

    const prep = store.getState().prepareRestore(JSON.stringify(saved.profile.backup));
    if (!prep.ok) throw new Error(prep.error);
    expect(prep.keyChanges).toHaveLength(1);
    expect(await store.getState().applyRestore(prep)).toEqual({ ok: true, applied: 1, mismatches: 0 });
    expect(holder.dev!.keycodeAt(0, key.row, key.col)).not.toBe(0x05);
    expect(matchingProfile(store.getState().profiles, store.getState().exportBackup()!)?.name).toBe('Awal');
  });

  it('hanya menulis bagian yang dipilih saat menerapkan', async () => {
    const { store, holder } = build();
    await store.getState().connectMock();
    const base = store.getState().exportBackup()!;
    const target = clone(base);
    const key = gen75.keys[10]!;
    target.keymap.layers[0]![key.row * 16 + key.col] = '0x0005';
    target.lighting = { ...target.lighting!, id_qmk_rgb_matrix_brightness: 32 };
    target.encoders![0]![0]![0] = '0x0006';
    const text = JSON.stringify(target);

    const all = store.getState().prepareRestore(text);
    if (!all.ok) throw new Error(all.error);
    expect(all.keyChanges).toHaveLength(1);
    expect(all.lightingChanges).toHaveLength(1);
    expect(all.encoderChanges).toHaveLength(1);

    const only = store.getState().prepareRestore(text, { ...ALL_PARTS, encoders: false, lighting: false, macros: false });
    if (!only.ok) throw new Error(only.error);
    expect(only.keyChanges).toHaveLength(1);
    expect(only.encoderChanges).toEqual([]);
    expect(only.lightingChanges).toEqual([]);
    expect(await store.getState().applyRestore(only)).toEqual({ ok: true, applied: 1, mismatches: 0 });
    expect(holder.dev!.lighting.get(1)).not.toEqual([32]);
    expect(holder.dev!.encoderMap.get('0,0,0')).toBe(0xaa);
  });

  it('memperbarui profil dari keyboard tanpa mengubah nama dan catatan', async () => {
    const { store } = build();
    await store.getState().connectMock();
    const saved = await store.getState().saveProfile('Awal', 'catatan');
    if (!saved.ok) throw new Error(saved.message);
    store.getState().select([gen75.keys[10]!.index]);
    await store.getState().assignKeycode(0x05);
    const r = await store.getState().overwriteProfile(saved.profile.id);
    expect(r.ok).toBe(true);
    const p = store.getState().profiles[0]!;
    expect(p).toMatchObject({ name: 'Awal', note: 'catatan', createdAt: saved.profile.createdAt });
    expect(sameContent(p.backup, store.getState().exportBackup()!)).toBe(true);
    expect(await store.getState().overwriteProfile('tidak-ada')).toMatchObject({ ok: false });
  });

  it('mengubah nama dengan aturan nama unik dan menghapus profil', async () => {
    const { store } = build();
    await store.getState().connectMock();
    const a = await store.getState().saveProfile('A', '');
    const b = await store.getState().saveProfile('B', '');
    if (!a.ok || !b.ok) throw new Error('gagal menyimpan');
    expect(await store.getState().editProfile(b.profile.id, 'a', '')).toMatchObject({ ok: false });
    expect(await store.getState().editProfile(b.profile.id, ' Kerja ', 'baru')).toMatchObject({ ok: true });
    expect(store.getState().profiles.map((p) => p.name)).toEqual(['A', 'Kerja']);

    expect(store.getState().lastProfileId).toBe(b.profile.id);
    await store.getState().deleteProfile(b.profile.id);
    expect(store.getState().profiles.map((p) => p.name)).toEqual(['A']);
    expect(store.getState().lastProfileId).toBeNull();
  });

  it('mengimpor profil tanpa keyboard, memberi nama unik, dan mengekspornya kembali', async () => {
    const { store } = build();
    const file = profileToFile(profile('Impor', await sample()));
    const text = JSON.stringify(file);
    expect(store.getState().status).toBe('idle');
    expect(await store.getState().importProfile(text, 'x')).toMatchObject({ ok: true });
    const second = await store.getState().importProfile(text, 'x');
    expect(second.ok && second.profile.name).toBe('Impor (2)');
    expect(store.getState().profiles.map((p) => p.name)).toEqual(['Impor', 'Impor (2)']);

    const out = store.getState().exportProfile(store.getState().profiles[0]!.id);
    expect(out).toMatchObject({ kind: 'gen75-studio-profile', name: 'Impor' });
    expect(store.getState().exportProfile('tidak-ada')).toBeNull();
    expect(await store.getState().importProfile('{}', 'x')).toMatchObject({ ok: false });
  });

  it('membatasi jumlah profil', async () => {
    const { store } = build();
    await store.getState().connectMock();
    for (let n = 0; n < 30; n += 1) expect(await store.getState().saveProfile(`P${n}`, '')).toMatchObject({ ok: true });
    expect(await store.getState().saveProfile('Lebih', '')).toMatchObject({ ok: false, message: expect.stringMatching(/Batas 30/) });
    const file = JSON.stringify(profileToFile(profile('Impor', await sample())));
    expect(await store.getState().importProfile(file, 'x')).toMatchObject({ ok: false, message: expect.stringMatching(/Batas 30/) });
  });
});
