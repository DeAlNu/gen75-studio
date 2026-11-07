import type { Backup } from '../backup';

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

const DB_NAME = 'gen75-studio';
const STORE = 'snapshots';

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class IndexedDbSnapshotStore implements SnapshotStore {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: 'id' });
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    return (await this.db()).transaction(STORE, mode).objectStore(STORE);
  }

  async list(): Promise<StoredSnapshot[]> {
    const all = await request((await this.store('readonly')).getAll() as IDBRequest<StoredSnapshot[]>);
    return all.sort(byNewest);
  }

  async add(snapshot: StoredSnapshot): Promise<void> {
    await request((await this.store('readwrite')).put(snapshot));
  }

  async remove(id: string): Promise<void> {
    await request((await this.store('readwrite')).delete(id));
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
