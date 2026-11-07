import { describe, expect, it } from 'vitest';
import { createBackup } from '../src/core/backup';
import { gen75 } from '../src/core/definition';
import { hexToHs, hsToHex } from '../src/core/color';
import { MemorySnapshotStore } from '../src/core/storage/snapshots';
import type { StoredSnapshot } from '../src/core/storage/snapshots';

const keymap = [new Uint16Array(96)];

const snap = (n: number): StoredSnapshot => {
  const takenAt = new Date(Date.UTC(2026, 10, 8, 0, n)).toISOString();
  return { id: `s${n}`, takenAt, reason: 'manual', backup: createBackup(gen75, { protocolVersion: 12, keymap, lighting: null }, new Date(takenAt)) };
};

describe('MemorySnapshotStore', () => {
  it('mengurutkan dari yang terbaru', async () => {
    const store = new MemorySnapshotStore();
    for (const n of [1, 3, 2]) await store.add(snap(n));
    expect((await store.list()).map((s) => s.id)).toEqual(['s3', 's2', 's1']);
  });

  it('menyisakan snapshot terbaru saja saat dipangkas', async () => {
    const store = new MemorySnapshotStore();
    for (let n = 1; n <= 12; n += 1) await store.add(snap(n));
    await store.prune(10);
    const ids = (await store.list()).map((s) => s.id);
    expect(ids).toHaveLength(10);
    expect(ids[0]).toBe('s12');
    expect(ids).not.toContain('s1');
    expect(ids).not.toContain('s2');
  });

  it('menghapus satu snapshot', async () => {
    const store = new MemorySnapshotStore();
    await store.add(snap(1));
    await store.add(snap(2));
    await store.remove('s1');
    expect((await store.list()).map((s) => s.id)).toEqual(['s2']);
  });
});

describe('warna', () => {
  it('mengubah hue dan saturasi ke hex', () => {
    expect(hsToHex(0, 255)).toBe('#ff0000');
    expect(hsToHex(85, 255)).toBe('#00ff00');
    expect(hsToHex(170, 255)).toBe('#0000ff');
    expect(hsToHex(0, 0)).toBe('#ffffff');
  });

  it('mengubah hex ke hue dan saturasi', () => {
    expect(hexToHs('#ff0000')).toEqual([0, 255]);
    expect(hexToHs('#00ff00')).toEqual([85, 255]);
    expect(hexToHs('#ffffff')).toEqual([0, 0]);
    expect(() => hexToHs('merah')).toThrow();
  });

  it('bolak-balik dengan selisih paling banyak 2', () => {
    for (const [h, s] of [[10, 255], [100, 200], [200, 128], [250, 255]] as const) {
      const [h2, s2] = hexToHs(hsToHex(h, s));
      expect(Math.abs(h2 - h)).toBeLessThanOrEqual(2);
      expect(Math.abs(s2 - s)).toBeLessThanOrEqual(2);
    }
  });
});
