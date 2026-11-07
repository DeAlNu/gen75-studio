import { createStore } from 'zustand/vanilla';
import {
  backupEncoders,
  backupKeymap,
  createBackup,
  diffEncoders,
  diffKeymap,
  diffLighting,
  macroBufferFromHex,
  parseBackup,
  sameContent,
} from '../core/backup';
import type { Backup, EncoderChange, KeyChange, LightingChange } from '../core/backup';
import { controlsOf } from '../core/definition/menus';
import type { DeviceDefinition } from '../core/definition/types';
import { dangerOf, hex4, isKnownRange } from '../core/keycodes';
import type { KeycodeContext } from '../core/keycodes';
import { encodeMacroBuffer, MacroError } from '../core/macros';
import type { MacroEntry } from '../core/macros';
import { decodeMatrix } from '../core/matrix';
import { cleanName, checkProfileName, createProfile, NOTE_MAX, parseProfileFile, PROFILE_LIMIT, profileToFile, uniqueName } from '../core/profiles';
import type { Profile, ProfileFile } from '../core/profiles';
import { DeviceSession, MAX_LAYERS } from '../core/session';
import type { DeviceState, LightingValue, LightingValues } from '../core/session';
import { MemoryProfileStore } from '../core/storage/profiles';
import type { ProfileStore } from '../core/storage/profiles';
import type { SnapshotReason, SnapshotStore, StoredSnapshot } from '../core/storage/snapshots';
import type { Transport } from '../core/transport/types';
import type { ClientOptions } from '../core/via/client';
import { ViaUnhandled } from '../core/via/errors';

export type Status = 'idle' | 'connecting' | 'ready' | 'disconnected' | 'error';

export type AssignResult = { ok: true } | { ok: false; reason: 'danger' | 'error'; message: string };
export type SaveResult = { ok: true } | { ok: false; message: string };
export type MatrixResult = { ok: true; pressed: Set<string> } | { ok: false; message: string; unsupported: boolean };

export type HistoryItem = ({ kind: 'key' } & KeyChange) | ({ kind: 'encoder' } & EncoderChange);

/** Bagian backup atau profil yang ikut ditulis ke keyboard. */
export interface RestoreParts {
  keymap: boolean;
  encoders: boolean;
  macros: boolean;
  lighting: boolean;
}

export const ALL_PARTS: RestoreParts = { keymap: true, encoders: true, macros: true, lighting: true };

export type ProfileResult = { ok: true; profile: Profile } | { ok: false; message: string };

export interface PreparedRestore {
  backup: Backup;
  parts: RestoreParts;
  keyChanges: KeyChange[];
  encoderChanges: EncoderChange[];
  lightingChanges: LightingChange[];
  /** Isi buffer makro yang akan ditulis, atau null bila makro tidak berubah. */
  macroTarget: Uint8Array | null;
  dangerous: number;
  layers: number[];
  /** Bagian backup yang dilewati karena perangkat tidak menyediakannya. */
  skipped: string[];
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
  macroCount: number;
  macroBuffer: Uint8Array | null;
  encoders: number[][][] | null;
  layer: number;
  selected: number[];
  past: HistoryItem[][];
  future: HistoryItem[][];
  busy: boolean;
  toast: string | null;
  snapshots: StoredSnapshot[];
  profiles: Profile[];
  /** Profil yang terakhir diterapkan atau disimpan pada sambungan ini. */
  lastProfileId: string | null;

  loadStored(): Promise<void>;
  tryAutoConnect(): Promise<void>;
  connectWebHid(): Promise<void>;
  connectMock(): Promise<void>;
  disconnect(): Promise<void>;
  setLayer(layer: number): void;
  select(indices: number[]): void;
  toggleSelect(index: number): void;
  assignKeycode(code: number, opts?: { confirmed?: boolean }): Promise<AssignResult>;
  assignEncoder(index: number, clockwise: boolean, code: number, opts?: { confirmed?: boolean }): Promise<AssignResult>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  setLightingValue(id: string, value: LightingValue): void;
  flushLighting(): Promise<void>;
  saveMacros(entries: MacroEntry[]): Promise<SaveResult>;
  readMatrix(): Promise<MatrixResult>;
  exportBackup(): Backup | null;
  prepareRestore(text: string, parts?: RestoreParts): PrepareResult;
  applyRestore(prepared: PreparedRestore, opts?: { confirmedDanger?: boolean }): Promise<RestoreResult>;
  takeSnapshot(reason: SnapshotReason): Promise<void>;
  deleteSnapshot(id: string): Promise<void>;
  saveProfile(name: string, note: string): Promise<ProfileResult>;
  overwriteProfile(id: string): Promise<ProfileResult>;
  editProfile(id: string, name: string, note: string): Promise<ProfileResult>;
  deleteProfile(id: string): Promise<void>;
  importProfile(text: string, fallbackName: string): Promise<ProfileResult>;
  exportProfile(id: string): ProfileFile | null;
  setLastProfile(id: string | null): void;
  clearToast(): void;
}

export interface AppDeps {
  definition: DeviceDefinition;
  snapshots: SnapshotStore;
  /** Penyimpanan profil; bila tidak diberikan, profil hanya hidup selama sesi. */
  profiles?: ProfileStore;
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

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

function withCode(keymap: Uint16Array[], layer: number, slot: number, code: number): Uint16Array[] {
  return keymap.map((words, i) => {
    if (i !== layer) return words;
    const copy = words.slice();
    copy[slot] = code;
    return copy;
  });
}

function withEncoder(encoders: number[][][] | null, layer: number, index: number, clockwise: boolean, code: number): number[][][] | null {
  if (!encoders) return encoders;
  return encoders.map((perLayer, l) =>
    l !== layer ? perLayer : perLayer.map((pair, i) => (i !== index ? pair : pair.map((v, dir) => (dir === (clockwise ? 1 : 0) ? code : v)))),
  );
}

const cloneEncoders = (e: number[][][] | null): number[][][] | null => (e ? e.map((l) => l.map((p) => [...p])) : null);

export function createAppStore(deps: AppDeps) {
  const def = deps.definition;
  const { rows, cols } = def.matrix;
  const controls = controlsOf(def.menus);
  const writeMs = deps.lightingWriteMs ?? 60;
  const commitMs = deps.lightingCommitMs ?? 1000;
  const profileStore = deps.profiles ?? new MemoryProfileStore();

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
        const st = await session.refresh();
        set({ keymap: st.keymap.map((w) => w.slice()), macroBuffer: st.macroBuffer?.slice() ?? null, encoders: cloneEncoders(st.encoders) });
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
      keymap: s.keymap.map((w) => w.slice()),
      lighting: s.lighting ? { ...s.lighting } : null,
      macroCount: s.macroCount,
      macroBuffer: s.macroBuffer?.slice() ?? null,
      encoders: cloneEncoders(s.encoders),
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
          lastProfileId: null,
        });
        await takeSnapshot('connect');
      } catch (e) {
        next.client.dispose();
        await transport.close().catch(() => undefined);
        session = null;
        set({ status: 'error', error: message(e) });
      }
    };

    const writeItems = async (items: HistoryItem[], dir: 'from' | 'to'): Promise<void> => {
      if (!session) return;
      for (const it of items) {
        const target = dir === 'to' ? it.to : it.from;
        if (it.kind === 'key') {
          await session.setKeycode(it.layer, it.keyIndex, target);
          set((s) => ({ keymap: withCode(s.keymap, it.layer, slotOf(it.keyIndex), target) }));
        } else {
          await session.setEncoder(it.layer, it.index, it.clockwise, target);
          set((s) => ({ encoders: withEncoder(s.encoders, it.layer, it.index, it.clockwise, target) }));
        }
      }
    };

    const pushHistory = (items: HistoryItem[]): void => {
      if (items.length) set((st) => ({ past: [...st.past, items].slice(-HISTORY_LIMIT), future: [] }));
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
        set({ lighting: { ...values } });
      } catch (e) {
        notify(`Gagal menyimpan lighting: ${message(e)}`);
      }
    };

    const checkWrite = (code: number): AssignResult | null => {
      const s = get();
      if (s.status !== 'ready' || !s.writable) return { ok: false, reason: 'error', message: 'Perangkat dalam mode baca saja.' };
      if (!isKnownRange(code)) return { ok: false, reason: 'error', message: `Keycode ${hex4(code)} di luar rentang yang dikenal.` };
      return null;
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
      macroCount: 0,
      macroBuffer: null,
      encoders: null,
      layer: 0,
      selected: [],
      past: [],
      future: [],
      busy: false,
      toast: null,
      snapshots: [],
      profiles: [],
      lastProfileId: null,

      async loadStored() {
        const [snapshots, profiles] = await Promise.all([deps.snapshots.list().catch(() => []), profileStore.list().catch(() => [])]);
        set({ snapshots, profiles });
      },

      async tryAutoConnect() {
        const st = get().status;
        if (st === 'connecting' || st === 'ready') return;
        try {
          const t = await deps.findPaired();
          if (t) await connectWith(t, false);
        } catch {
          /* tanpa izin sebelumnya: biarkan pengguna menekan Sambungkan */
        }
        await get().loadStored();
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
        set({
          status: 'idle',
          keymap: [],
          lighting: null,
          macroBuffer: null,
          macroCount: 0,
          encoders: null,
          selected: [],
          past: [],
          future: [],
          busy: false,
          lastProfileId: null,
        });
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
        const refused = checkWrite(code);
        if (refused) return refused;
        const s = get();
        const danger = dangerOf(code, keycodeContext(def, s.customBase));
        if (danger && !opts.confirmed) return { ok: false, reason: 'danger', message: danger.reason };
        if (s.selected.length === 0) return { ok: false, reason: 'error', message: 'Pilih tombol di kanvas dulu.' };

        return enqueue(async (): Promise<AssignResult> => {
          const layer = get().layer;
          const applied: HistoryItem[] = [];
          set({ busy: true });
          try {
            for (const keyIndex of get().selected) {
              const from = get().keymap[layer]?.[slotOf(keyIndex)] ?? 0;
              if (from === code) continue;
              const item: HistoryItem = { kind: 'key', layer, keyIndex, from, to: code };
              await writeItems([item], 'to');
              applied.push(item);
            }
            pushHistory(applied);
            return { ok: true };
          } catch (e) {
            await resync();
            pushHistory(applied);
            const msg = message(e);
            notify(`Gagal menulis keycode: ${msg}`);
            return { ok: false, reason: 'error', message: msg };
          } finally {
            set({ busy: false });
          }
        });
      },

      async assignEncoder(index, clockwise, code, opts = {}) {
        const refused = checkWrite(code);
        if (refused) return refused;
        const s = get();
        if (!s.encoders) return { ok: false, reason: 'error', message: 'Putaran knob tidak tersedia pada perangkat ini.' };
        const danger = dangerOf(code, keycodeContext(def, s.customBase));
        if (danger && !opts.confirmed) return { ok: false, reason: 'danger', message: danger.reason };

        return enqueue(async (): Promise<AssignResult> => {
          const layer = get().layer;
          const from = get().encoders?.[layer]?.[index]?.[clockwise ? 1 : 0];
          if (from === undefined) return { ok: false, reason: 'error', message: 'Encoder tidak ditemukan.' };
          if (from === code) return { ok: true };
          set({ busy: true });
          try {
            const item: HistoryItem = { kind: 'encoder', layer, index, clockwise, from, to: code };
            await writeItems([item], 'to');
            pushHistory([item]);
            return { ok: true };
          } catch (e) {
            await resync();
            const msg = message(e);
            notify(`Gagal menulis putaran knob: ${msg}`);
            return { ok: false, reason: 'error', message: msg };
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
            await writeItems([...group].reverse(), 'from');
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
            await writeItems(group, 'to');
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

      async saveMacros(entries) {
        const s = get();
        if (s.status !== 'ready' || !s.writable) return { ok: false, message: 'Perangkat dalam mode baca saja.' };
        const current = s.macroBuffer;
        if (!current) return { ok: false, message: 'Makro tidak tersedia pada perangkat ini.' };
        if (entries.length !== s.macroCount) return { ok: false, message: `Jumlah makro harus ${s.macroCount}.` };
        let next: Uint8Array;
        try {
          next = encodeMacroBuffer(entries, current.length);
        } catch (e) {
          return { ok: false, message: e instanceof MacroError ? e.message : message(e) };
        }
        return enqueue(async (): Promise<SaveResult> => {
          if (!session) return { ok: false, message: 'Tidak terhubung.' };
          set({ busy: true });
          try {
            await session.saveMacroBuffer(next);
            set({ macroBuffer: session.state?.macroBuffer?.slice() ?? null });
            return { ok: true };
          } catch (e) {
            await resync();
            const msg = message(e);
            notify(`Gagal menyimpan makro: ${msg}`);
            return { ok: false, message: msg };
          } finally {
            set({ busy: false });
          }
        });
      },

      async readMatrix() {
        if (!session || get().status !== 'ready') return { ok: false, message: 'Tidak terhubung.', unsupported: false };
        try {
          const bytes = await session.client.readMatrixState(rows, cols);
          return { ok: true, pressed: decodeMatrix(bytes, rows, cols) };
        } catch (e) {
          return { ok: false, message: message(e), unsupported: e instanceof ViaUnhandled };
        }
      },

      exportBackup() {
        const s = get();
        if (s.status !== 'ready' || s.keymap.length === 0) return null;
        return createBackup(def, s);
      },

      prepareRestore(text, parts = ALL_PARTS) {
        const s = get();
        if (s.status !== 'ready') return { ok: false, error: 'Sambungkan keyboard dulu.' };
        const parsed = parseBackup(text, def, Math.min(s.layerCount, MAX_LAYERS));
        if (!parsed.ok) return parsed;
        const { backup } = parsed;
        const skipped: string[] = [];

        const keyChanges = parts.keymap ? diffKeymap(def, s.keymap, backupKeymap(backup)) : [];

        let encoderChanges: EncoderChange[] = [];
        if (parts.encoders && backup.encoders) {
          if (!s.encoders) skipped.push('Putaran knob dalam backup dilewati karena perangkat ini tidak menyediakannya.');
          else encoderChanges = diffEncoders(s.encoders, backupEncoders(backup));
        }

        let macroTarget: Uint8Array | null = null;
        if (parts.macros && backup.macros) {
          const current = s.macroBuffer;
          if (!current) {
            skipped.push('Makro dalam backup dilewati karena perangkat ini tidak menyediakannya.');
          } else if (backup.macros.count !== s.macroCount) {
            return { ok: false, error: `Jumlah slot makro backup (${backup.macros.count}) berbeda dari perangkat (${s.macroCount}).` };
          } else if (backup.macros.bytes.length / 2 > current.length) {
            return { ok: false, error: 'Isi makro backup lebih besar dari memori makro perangkat.' };
          } else {
            const target = macroBufferFromHex(backup.macros.bytes, current.length);
            if (!sameBytes(target, current)) macroTarget = target;
          }
        }

        const ctx = keycodeContext(def, s.customBase);
        const dangerous =
          keyChanges.filter((c) => dangerOf(c.to, ctx) !== null).length + encoderChanges.filter((c) => dangerOf(c.to, ctx) !== null).length;
        return {
          ok: true,
          backup,
          parts,
          keyChanges,
          encoderChanges,
          lightingChanges: parts.lighting ? diffLighting(s.lighting, backup.lighting) : [],
          macroTarget,
          dangerous,
          layers: [...new Set([...keyChanges.map((c) => c.layer), ...encoderChanges.map((c) => c.layer)])].sort((a, b) => a - b),
          skipped,
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
              await writeItems([{ kind: 'key', ...c }], 'to');
              applied += 1;
            }
            for (const c of prepared.encoderChanges) {
              await writeItems([{ kind: 'encoder', ...c }], 'to');
              applied += 1;
            }
            if (prepared.macroTarget && session) {
              await session.saveMacroBuffer(prepared.macroTarget);
              applied += 1;
            }
            if (prepared.lightingChanges.length > 0 && session) {
              for (const c of prepared.lightingChanges) await session.setLighting(c.id, c.to);
              set({ lighting: { ...(await session.commitLighting()) } });
            }
            await resync();
            const after = get();
            let mismatches = prepared.parts.keymap ? diffKeymap(def, after.keymap, backupKeymap(prepared.backup)).length : 0;
            if (prepared.parts.encoders) mismatches += diffEncoders(after.encoders, backupEncoders(prepared.backup)).length;
            if (prepared.macroTarget && (!after.macroBuffer || !sameBytes(after.macroBuffer, prepared.macroTarget))) mismatches += 1;
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

      async saveProfile(name, note) {
        const s = get();
        if (s.status !== 'ready' || s.keymap.length === 0) return { ok: false, message: 'Sambungkan keyboard dulu untuk menyimpan profil.' };
        if (s.profiles.length >= PROFILE_LIMIT) return { ok: false, message: `Batas ${PROFILE_LIMIT} profil tercapai. Hapus salah satu dulu.` };
        const bad = checkProfileName(name, s.profiles);
        if (bad) return { ok: false, message: bad };
        try {
          const profile = createProfile(name, note, createBackup(def, s));
          await profileStore.put(profile);
          set({ profiles: await profileStore.list(), lastProfileId: profile.id });
          return { ok: true, profile };
        } catch (e) {
          return { ok: false, message: `Gagal menyimpan profil: ${message(e)}` };
        }
      },

      async overwriteProfile(id) {
        const s = get();
        const old = s.profiles.find((p) => p.id === id);
        if (!old) return { ok: false, message: 'Profil tidak ditemukan.' };
        if (s.status !== 'ready' || s.keymap.length === 0) return { ok: false, message: 'Sambungkan keyboard dulu.' };
        try {
          const profile: Profile = { ...old, updatedAt: new Date().toISOString(), backup: createBackup(def, s) };
          await profileStore.put(profile);
          set({ profiles: await profileStore.list(), lastProfileId: profile.id });
          return { ok: true, profile };
        } catch (e) {
          return { ok: false, message: `Gagal memperbarui profil: ${message(e)}` };
        }
      },

      async editProfile(id, name, note) {
        const s = get();
        const old = s.profiles.find((p) => p.id === id);
        if (!old) return { ok: false, message: 'Profil tidak ditemukan.' };
        const bad = checkProfileName(name, s.profiles, id);
        if (bad) return { ok: false, message: bad };
        try {
          const profile: Profile = { ...old, name: cleanName(name), note: note.trim().slice(0, NOTE_MAX), updatedAt: new Date().toISOString() };
          await profileStore.put(profile);
          set({ profiles: await profileStore.list() });
          return { ok: true, profile };
        } catch (e) {
          return { ok: false, message: `Gagal mengubah profil: ${message(e)}` };
        }
      },

      async deleteProfile(id) {
        await profileStore.remove(id);
        set((st) => ({ lastProfileId: st.lastProfileId === id ? null : st.lastProfileId }));
        set({ profiles: await profileStore.list() });
      },

      async importProfile(text, fallbackName) {
        const s = get();
        if (s.profiles.length >= PROFILE_LIMIT) return { ok: false, message: `Batas ${PROFILE_LIMIT} profil tercapai. Hapus salah satu dulu.` };
        const maxLayers = s.status === 'ready' ? Math.min(s.layerCount, MAX_LAYERS) : MAX_LAYERS;
        const parsed = parseProfileFile(text, def, maxLayers, fallbackName);
        if (!parsed.ok) return { ok: false, message: parsed.error };
        try {
          const profile = createProfile(uniqueName(parsed.name, s.profiles), parsed.note, parsed.backup);
          await profileStore.put(profile);
          set({ profiles: await profileStore.list() });
          return { ok: true, profile };
        } catch (e) {
          return { ok: false, message: `Gagal menyimpan profil: ${message(e)}` };
        }
      },

      exportProfile(id) {
        const p = get().profiles.find((x) => x.id === id);
        return p ? profileToFile(p) : null;
      },

      setLastProfile(id) {
        set({ lastProfileId: id });
      },

      clearToast() {
        set({ toast: null });
      },
    };
  });
}

export type AppStore = ReturnType<typeof createAppStore>;
