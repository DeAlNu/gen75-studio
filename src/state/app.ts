import { useStore } from 'zustand';
import { gen75 } from '../core/definition';
import { createSnapshotStore } from '../core/storage/snapshots';
import { findPairedWebHid, requestWebHid } from '../core/transport/webhid';
import { createAppStore } from './store';
import type { AppState } from './store';

export const definition = gen75;

export const appStore = createAppStore({
  definition,
  snapshots: createSnapshotStore(),
  openWebHid: () => requestWebHid(definition),
  findPaired: () => findPairedWebHid(definition),
  openMock: async () => {
    const { MockViaDevice } = await import('../core/transport/mock');
    return new MockViaDevice(definition);
  },
});

export function useApp<T>(selector: (s: AppState) => T): T {
  return useStore(appStore, selector);
}
