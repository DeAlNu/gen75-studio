import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import type { StoreApi } from 'zustand/vanilla';

/**
 * unsupported: browser atau konteks tidak mendukung service worker (butuh HTTPS atau localhost).
 * disabled: sengaja mati, yaitu pada mode pengembangan.
 */
export type OfflineState = 'unsupported' | 'disabled' | 'idle' | 'installing' | 'ready' | 'error';

export interface PwaState {
  offline: OfflineState;
  /** Versi baru sudah diunduh dan menunggu dipakai. */
  updateReady: boolean;
  online: boolean;
  /** Browser menawarkan pemasangan sebagai aplikasi. */
  installable: boolean;
  standalone: boolean;
  /** Versi cache yang sedang melayani halaman ini. */
  version: string | null;
  checking: boolean;
  checkedAt: number | null;
}

export type PwaStore = StoreApi<PwaState>;

export function createPwaStore(): PwaStore {
  return createStore<PwaState>(() => ({
    offline: 'idle',
    updateReady: false,
    online: typeof navigator === 'undefined' ? true : navigator.onLine !== false,
    installable: false,
    standalone: false,
    version: null,
    checking: false,
    checkedAt: null,
  }));
}

export const pwaStore = createPwaStore();

export function usePwa<T>(selector: (s: PwaState) => T): T {
  return useStore(pwaStore, selector);
}
