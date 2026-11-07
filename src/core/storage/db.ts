export const DB_NAME = 'gen75-studio';
export const DB_VERSION = 2;
export const STORE_NAMES = ['snapshots', 'profiles'] as const;
export type StoreName = (typeof STORE_NAMES)[number];

let pending: Promise<IDBDatabase> | null = null;

/** Membuka database bersama. Versi 2 menambah gudang `profiles` tanpa menyentuh isi `snapshots`. */
export function openDb(): Promise<IDBDatabase> {
  pending ??= new Promise<IDBDatabase>((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, DB_VERSION);
    open.onupgradeneeded = () => {
      const db = open.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: 'id' });
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      db.onversionchange = () => {
        db.close();
        pending = null;
      };
      resolve(db);
    };
    open.onerror = () => {
      pending = null;
      reject(open.error);
    };
    open.onblocked = () => {
      pending = null;
      reject(new Error('Database browser sedang dipakai tab lain. Tutup tab Gen75 Studio yang lain lalu muat ulang.'));
    };
  });
  return pending;
}

export function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function objectStore(name: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await openDb()).transaction(name, mode).objectStore(name);
}
