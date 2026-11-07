import type { Profile } from '../profiles';
import { objectStore, request } from './db';

export interface ProfileStore {
  list(): Promise<Profile[]>;
  put(profile: Profile): Promise<void>;
  remove(id: string): Promise<void>;
}

const byName = (a: Profile, b: Profile): number => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }) || (a.id < b.id ? -1 : 1);

export class MemoryProfileStore implements ProfileStore {
  private items = new Map<string, Profile>();

  async list(): Promise<Profile[]> {
    return [...this.items.values()].sort(byName);
  }

  async put(profile: Profile): Promise<void> {
    this.items.set(profile.id, profile);
  }

  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export class IndexedDbProfileStore implements ProfileStore {
  async list(): Promise<Profile[]> {
    const all = await request((await objectStore('profiles', 'readonly')).getAll() as IDBRequest<Profile[]>);
    return all.sort(byName);
  }

  async put(profile: Profile): Promise<void> {
    await request((await objectStore('profiles', 'readwrite')).put(profile));
  }

  async remove(id: string): Promise<void> {
    await request((await objectStore('profiles', 'readwrite')).delete(id));
  }
}

/** Memakai IndexedDB bila ada; jika tidak (mis. mode privat), jatuh ke memori. */
export function createProfileStore(): ProfileStore {
  return typeof indexedDB === 'undefined' ? new MemoryProfileStore() : new IndexedDbProfileStore();
}
