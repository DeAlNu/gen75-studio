import { createStore } from 'zustand/vanilla';
import { backupKeymap, createBackup, diffKeymap, diffLighting, parseBackup, sameContent } from '../core/backup';
import type { Backup, KeyChange, LightingChange } from '../core/backup';
import { controlsOf } from '../core/definition/menus';
import type { DeviceDefinition } from '../core/definition/types';
import { dangerOf, hex4, isKnownRange } from '../core/keycodes';
import type { KeycodeContext } from '../core/keycodes';
import { DeviceSession, MAX_LAYERS } from '../core/session';
import type { DeviceState, LightingValue, LightingValues } from '../core/session';
import type { SnapshotReason, SnapshotStore, StoredSnapshot } from '../core/storage/snapshots';
import type { Transport } from '../core/transport/types';
import type { ClientOptions } from '../core/via/client';

export type Status = 'idle' | 'connecting' | 'ready' | 'disconnected' | 'error';

export type AssignResult = { ok: true } | { ok: false; reason: 'danger' | 'error'; message: string };

export interface PreparedRestore {
  backup: Backup;
  keyChanges: KeyChange[];
  lightingChanges: LightingChange[];
  dangerous: number;
  layers: number[];
}

export type PrepareResult = ({ ok: true } & PreparedRestore) | { ok: false; error: string };
export type RestoreResult = { ok: true; applied: number; mismatches: number } | { ok: false; reason: 'danger' | 'error'; message: string };

export interface AppState {
  status: Status;
  error: string | null;
  simulated: boolean;
  deviceLabel: string;
  protocolVersion: number;
  layerCount: number;
  writable: boolean;
  warnings: string[];
  customBase: number;
  keymap: Uint16Array[];
  lighting: LightingValues | null;
  layer: number;
  selected: number[];
  past: KeyChange[][];
  future: KeyChange[][];
  busy: boolean;
  toast: string | null;
  snapshots: StoredSnapshot[];

  tryAutoConnect(): Promise<void>;
  connectWebHid(): Promise<void>;
  connectMock(): Promise<void>;
  disconnect(): Promise<void>;
  setLayer(layer: number): void;
  select(indices: number[]): void;
  toggleSelect(index: number): void;
  assignKeycode(code: number, opts?: { confirmed?: boolean }): Promise<AssignResult>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  setLightingValue(id: string, value: LightingValue): void;
  flushLighting(): Promise<void>;
  exportBackup(): Backup | null;
  prepareRestore(text: string): PrepareResult;
  applyRestore(prepared: PreparedRestore, opts?: { confirmedDanger?: boolean }): Promise<RestoreResult>;
  takeSnapshot(reason: SnapshotReason): Promise<void>;
  deleteSnapshot(id: string): Promise<void>;
  clearToast(): void;
}

export interface AppDeps {
  definition: DeviceDefinition;
  snapshots: SnapshotStore;
  openWebHid: () => Promise<Transport | null>;
  findPaired: () => Promise<Transport | null>;
  openMock: () => Promise<Transport>;
  clientOptions?: Partial<ClientOptions>;
  lightingWriteMs?: number;
  lightingCommitMs?: number;
}

export const HISTORY_LIMIT = 50;
export const SNAPSHOT_LIMIT = 10;

export function keycodeContext(def: DeviceDefinition, customBase: number): KeycodeContext {
  return { customKeycodes: def.customKeycodes, customBase };
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function withCode(keymap: Uint16Array[], layer: number, slot: number, code: number): Uint16Array[] {
  return keymap.map((words, i) => {
    if (i !== layer) return words;
    const copy = words.slice();
    copy[slot] = code;
    return copy;
  });
}

export function createAppStore(deps: AppDeps) {
  const def = deps.definition;
  const cols = def.matrix.cols;
  const controls = controlsOf(def.menus);
  const writeMs = deps.lightingWriteMs ?? 60;
  const commitMs = deps.lightingCommitMs ?? 1000;

  let session: DeviceSession | null = null;
  let queue: Promise<unknown> = Promise.resolve();
  const pendingLighting = new Map<string, LightingValue>();
  let writeTimer: ReturnType<typeof setTimeout> | null = null;
  let commitTimer: ReturnType<typeof setTimeout> | null = null;

  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const job = queue.then(fn);
    queue = job.catch(() => undefined);
    return job;
  };

  return createStore<AppState>()((set, get) => {
    const slotOf = (keyIndex: number): number => {
      const key = def.keys[keyIndex];
      if (!key) throw new RangeError(`tombol ${keyIndex} tidak ada`);
      return key.row * cols + key.col;
    };

    const notify = (text: string): void => set({ toast: text });

    const resync = async (): Promise<void> => {
      if (!session) return;
      try {
        set({ keymap: await session.readKeymap() });
      } catch {
        /* perangkat mungkin terputus; status ditangani onClose */
      }
    };

    const applyDeviceState = (s: DeviceState): Partial<AppState> => ({
      protocolVersion: s.protocolVersion,
      layerCount: s.layerCount,
      writable: s.writable,
      warnings: s.warnings,
      customBase: s.customBase,
      keymap: s.keymap,
      lighting: s.lighting,
    });

    const takeSnapshot = async (reason: SnapshotReason): Promise<void> => {
      const s = get();
      if (s.status !== 'ready' || s.keymap.length === 0) return;
      const backup = createBackup(def, s);
      const existing = await deps.snapshots.list();
      const latest = existing[0];
      if (reason === 'connect' && latest && sameContent(latest.backup, backup)) return;
      await deps.snapshots.add({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, takenAt: backup.createdAt, reason, backup });
      await deps.snapshots.prune(SNAPSHOT_LIMIT);
      set({ snapshots: await deps.snapshots.list() });
    };

    const connectWith = async (transport: Transport, simulated: boolean): Promise<void> => {
      set({ status: 'connecting', error: null });
      const next = new DeviceSession(transport, def, deps.clientOptions);
      try {
        const state = await next.open();
        session = next;
        transport.onClose(() => {
          if (session !== next) return;
          session = null;
          pendingLighting.clear();
          if (writeTimer) clearTimeout(writeTimer);
          if (commitTimer) clearTimeout(commitTimer);
          writeTimer = null;
          commitTimer = null;
          next.client.dispose();
          set({ status: 'disconnected', busy: false });
        });
        set({
          ...applyDeviceState(state),
          status: 'ready',
          error: null,
          simulated,
          deviceLabel: transport.label,
          layer: 0,
          selected: [],
          past: [],
          future: [],
          busy: false,
        });
        await takeSnapshot('connect');
      } catch (e) {
        next.client.dispose();
        await transport.close().catch(() => undefined);
        session = null;
        set({ status: 'error', error: message(e) });
      }
    };

    const writeChanges = async (changes: KeyChange[], dir: 'from' | 'to'): Promise<KeyChange[]> => {
      const done: KeyChange[] = [];
      if (!session) return done;
      for (const c of changes) {
        const target = dir === 'to' ? c.to : c.from;
        await session.setKeycode(c.layer, c.keyIndex, target);
        set((s) => ({ keymap: withCode(s.keymap, c.layer, slotOf(c.keyIndex), target) }));
        done.push(c);
      }
      return done;
    };

    const runLightingWrites = async (): Promise<void> => {
      if (!session || pendingLighting.size === 0) return;
      const batch = [...pendingLighting];
      pendingLighting.clear();
      try {
        for (const [id, value] of batch) await session.setLighting(id, value);
      } catch (e) {
        notify(`Gagal menulis lighting: ${message(e)}`);
      }
    };

    const runLightingCommit = async (): Promise<void> => {
      if (!session) return;
      try {
        const values = await session.commitLighting();
        set({ lighting: values });
      } catch (e) {
        notify(`Gagal menyimpan lighting: ${message(e)}`);
      }
    };

    return {
      status: 'idle',
      error: null,
      simulated: false,
      deviceLabel: '',
      protocolVersion: 0,
      layerCount: 0,
      writable: false,
      warnings: [],
      customBase: 0,
      keymap: [],
      lighting: null,
      layer: 0,
      selected: [],
      past: [],
      future: [],
      busy: false,
      toast: null,
      snapshots: [],

      async tryAutoConnect() {
        const st = get().status;
        if (st === 'connecting' || st === 'ready') return;
        try {
          const t = await deps.findPaired();
          if (t) await connectWith(t, false);
        } catch {
          /* tanpa izin sebelumnya: biarkan pengguna menekan Sambungkan */
        }
        set({ snapshots: await deps.snapshots.list().catch(() => []) });
      },

      async connectWebHid() {
        set({ status: 'connecting', error: null });
        try {
          const t = await deps.openWebHid();
          if (!t) {
            set({ status: 'idle' });
            return;
          }
          await connectWith(t, false);
        } catch (e) {
          set({
            status: 'error',
            error: `${message(e)}. Tutup VIA atau aplikasi lain yang memakai keyboard, lalu coba lagi.`,
          });
        }
      },

      async connectMock() {
        await connectWith(await deps.openMock(), true);
      },

      async disconnect() {
        await get().flushLighting();
        const s = session;
        session = null;
        if (s) await s.close().catch(() => undefined);
        set({ status: 'idle', keymap: [], lighting: null, selected: [], past: [], future: [], busy: false });
      },

      setLayer(layer) {
        const max = Math.max(0, get().layerCount - 1);
        set({ layer: Math.min(Math.max(0, layer), max) });
      },

      select(indices) {
        set({ selected: [...new Set(indices)].filter((i) => def.keys[i] !== undefined) });
      },

      toggleSelect(index) {
        set((s) => ({ selected: s.selected.includes(index) ? s.selected.filter((i) => i !== index) : [...s.selected, index] }));
      },

      async assignKeycode(code, opts = {}) {
        const s = get();
        const fail = (reason: 'danger' | 'error', msg: string): AssignResult => ({ ok: false, reason, message: msg });
        if (s.status !== 'ready' || !s.writable) return fail('error', 'Perangkat dalam mode baca saja.');
        if (!isKnownRange(code)) return fail('error', `Keycode ${hex4(code)} di luar rentang yang dikenal.`);
        const danger = dangerOf(code, keycodeContext(def, s.customBase));
        if (danger && !opts.confirmed) return fail('danger', danger.reason);
        if (s.selected.length === 0) return fail('error', 'Pilih tombol di kanvas dulu.');

        return enqueue(async (): Promise<AssignResult> => {
          const layer = get().layer;
          const applied: KeyChange[] = [];
          set({ busy: true });
          try {
            for (const keyIndex of get().selected) {
              const from = get().keymap[layer]?.[slotOf(keyIndex)] ?? 0;
              if (from === code) continue;
              const change: KeyChange = { layer, keyIndex, from, to: code };
              await writeChanges([change], 'to');
              applied.push(change);
            }
            if (applied.length) set((st) => ({ past: [...st.past, applied].slice(-HISTORY_LIMIT), future: [] }));
            return { ok: true };
          } catch (e) {
            await resync();
            if (applied.length) set((st) => ({ past: [...st.past, applied].slice(-HISTORY_LIMIT), future: [] }));
            const msg = message(e);
            notify(`Gagal menulis keycode: ${msg}`);
            return fail('error', msg);
          } finally {
            set({ busy: false });
          }
        });
      },

      async undo() {
        const s = get();
        const group = s.past[s.past.length - 1];
        if (!group || !s.writable) return;
        await enqueue(async () => {
          set({ busy: true });
          try {
            await writeChanges([...group].reverse(), 'from');
            set((st) => ({ past: st.past.slice(0, -1), future: [...st.future, group], layer: group[0]?.layer ?? st.layer }));
          } catch (e) {
            await resync();
            notify(`Gagal mengurungkan: ${message(e)}`);
          } finally {
            set({ busy: false });
          }
        });
      },

      async redo() {
        const s = get();
        const group = s.future[s.future.length - 1];
        if (!group || !s.writable) return;
        await enqueue(async () => {
          set({ busy: true });
          try {
            await writeChanges(group, 'to');
            set((st) => ({ future: st.future.slice(0, -1), past: [...st.past, group], layer: group[0]?.layer ?? st.layer }));
          } catch (e) {
            await resync();
            notify(`Gagal mengulangi: ${message(e)}`);
          } finally {
            set({ busy: false });
          }
        });
      },

      setLightingValue(id, value) {
        const s = get();
        if (!s.writable || !s.lighting || !controls.some((c) => c.ref.id === id)) return;
        set({ lighting: { ...s.lighting, [id]: value } });
        pendingLighting.set(id, value);
        if (writeTimer) clearTimeout(writeTimer);
        if (commitTimer) clearTimeout(commitTimer);
        writeTimer = setTimeout(() => {
          writeTimer = null;
          void enqueue(runLightingWrites);
        }, writeMs);
        commitTimer = setTimeout(() => {
          commitTimer = null;
          void enqueue(runLightingCommit);
        }, commitMs);
      },

      async flushLighting() {
        const hadWrite = writeTimer !== null || pendingLighting.size > 0;
        const hadCommit = commitTimer !== null;
        if (writeTimer) clearTimeout(writeTimer);
        if (commitTimer) clearTimeout(commitTimer);
        writeTimer = null;
        commitTimer = null;
        if (hadWrite) await enqueue(runLightingWrites);
        if (hadCommit) await enqueue(runLightingCommit);
      },

      exportBackup() {
        const s = get();
        if (s.status !== 'ready' || s.keymap.length === 0) return null;
        return createBackup(def, s);
      },

      prepareRestore(text) {
        const s = get();
        if (s.status !== 'ready') return { ok: false, error: 'Sambungkan keyboard dulu.' };
        const parsed = parseBackup(text, def, Math.min(s.layerCount, MAX_LAYERS));
        if (!parsed.ok) return parsed;
        const keyChanges = diffKeymap(def, s.keymap, backupKeymap(parsed.backup));
        const ctx = keycodeContext(def, s.customBase);
        return {
          ok: true,
          backup: parsed.backup,
          keyChanges,
          lightingChanges: diffLighting(s.lighting, parsed.backup.lighting),
          dangerous: keyChanges.filter((c) => dangerOf(c.to, ctx) !== null).length,
          layers: [...new Set(keyChanges.map((c) => c.layer))].sort((a, b) => a - b),
        };
      },

      async applyRestore(prepared, opts = {}) {
        const s = get();
        if (s.status !== 'ready' || !s.writable) return { ok: false, reason: 'error', message: 'Perangkat dalam mode baca saja.' };
        if (prepared.dangerous > 0 && !opts.confirmedDanger) {
          return { ok: false, reason: 'danger', message: `${prepared.dangerous} keycode berisiko ikut dipulihkan.` };
        }
        await get().flushLighting();
        return enqueue(async (): Promise<RestoreResult> => {
          set({ busy: true });
          try {
            await takeSnapshot('before-restore');
            let applied = 0;
            for (const c of prepared.keyChanges) {
              await writeChanges([c], 'to');
              applied += 1;
            }
            if (prepared.lightingChanges.length > 0 && session) {
              for (const c of prepared.lightingChanges) await session.setLighting(c.id, c.to);
              set({ lighting: await session.commitLighting() });
            }
            await resync();
            const target = backupKeymap(prepared.backup);
            const mismatches = diffKeymap(def, get().keymap, target).length;
            set({ past: [], future: [] });
            return { ok: true, applied, mismatches };
          } catch (e) {
            await resync();
            return { ok: false, reason: 'error', message: message(e) };
          } finally {
            set({ busy: false });
          }
        });
      },

      async takeSnapshot(reason) {
        await takeSnapshot(reason);
      },

      async deleteSnapshot(id) {
        await deps.snapshots.remove(id);
        set({ snapshots: await deps.snapshots.list() });
      },

      clearToast() {
        set({ toast: null });
      },
    };
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
