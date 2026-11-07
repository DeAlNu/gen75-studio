import type { Backup } from '../backup';
import { objectStore, request } from './db';

export type SnapshotReason = 'connect' | 'manual' | 'before-restore';

export interface StoredSnapshot {
  id: string;
  takenAt: string;
  reason: SnapshotReason;
  backup: Backup;
}

export interface SnapshotStore {
  list(): Promise<StoredSnapshot[]>;
  add(snapshot: StoredSnapshot): Promise<void>;
  remove(id: string): Promise<void>;
  /** Menyisakan max snapshot terbaru. */
  prune(max: number): Promise<void>;
}

const byNewest = (a: StoredSnapshot, b: StoredSnapshot): number => (a.takenAt < b.takenAt ? 1 : a.takenAt > b.takenAt ? -1 : 0);

export class MemorySnapshotStore implements SnapshotStore {
  private items: StoredSnapshot[] = [];

  async list(): Promise<StoredSnapshot[]> {
    return [...this.items].sort(byNewest);
  }

  async add(snapshot: StoredSnapshot): Promise<void> {
    this.items.push(snapshot);
  }

  async remove(id: string): Promise<void> {
    this.items = this.items.filter((s) => s.id !== id);
  }

  async prune(max: number): Promise<void> {
    this.items = [...this.items].sort(byNewest).slice(0, max);
  }
}

export class IndexedDbSnapshotStore implements SnapshotStore {
  async list(): Promise<StoredSnapshot[]> {
    const all = await request((await objectStore('snapshots', 'readonly')).getAll() as IDBRequest<StoredSnapshot[]>);
    return all.sort(byNewest);
  }

  async add(snapshot: StoredSnapshot): Promise<void> {
    await request((await objectStore('snapshots', 'readwrite')).put(snapshot));
  }

  async remove(id: string): Promise<void> {
    await request((await objectStore('snapshots', 'readwrite')).delete(id));
  }

  async prune(max: number): Promise<void> {
    const extra = (await this.list()).slice(max);
    for (const s of extra) await this.remove(s.id);
  }
}

/** Memakai IndexedDB bila ada; jika tidak (mis. mode privat), jatuh ke memori. */
export function createSnapshotStore(): SnapshotStore {
  return typeof indexedDB === 'undefined' ? new MemorySnapshotStore() : new IndexedDbSnapshotStore();
}
