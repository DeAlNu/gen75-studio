import { create } from 'zustand';
import type { MacroEntry } from '../core/macros';

export type Tab = 'keymap' | 'lighting' | 'functions' | 'macros' | 'tester' | 'profiles' | 'compare' | 'backup' | 'settings';

/** Sumber perbandingan: 'device', 'profile:<id>', atau 'snapshot:<id>'. Kosong berarti belum dipilih. */
export type CompareSource = string;

export interface PendingAssign {
  code: number;
  label: string;
}

export interface EncoderTarget {
  index: number;
  clockwise: boolean;
}

interface Ui {
  tab: Tab;
  /** Keycode yang menunggu klik pada sebuah tombol di kanvas keymap. */
  pending: PendingAssign | null;
  /** Putaran knob yang sedang dipilih sebagai tujuan keycode dari palet. */
  encoderTarget: EncoderTarget | null;
  /** Perubahan makro yang belum disimpan ke keyboard, per nomor slot. */
  macroDrafts: Record<number, MacroEntry>;
  compareA: CompareSource;
  compareB: CompareSource;
  setTab(tab: Tab): void;
  setCompare(a: CompareSource, b: CompareSource): void;
  setPending(p: PendingAssign | null): void;
  setEncoderTarget(t: EncoderTarget | null): void;
  setMacroDraft(index: number, entry: MacroEntry): void;
  clearMacroDrafts(): void;
  resetDeviceState(): void;
}

export const useUi = create<Ui>((set) => ({
  tab: 'keymap',
  pending: null,
  encoderTarget: null,
  macroDrafts: {},
  compareA: 'device',
  compareB: '',
  setTab: (tab) => set({ tab }),
  setCompare: (compareA, compareB) => set({ compareA, compareB }),
  setPending: (pending) => set({ pending }),
  setEncoderTarget: (encoderTarget) => set({ encoderTarget }),
  setMacroDraft: (index, entry) => set((s) => ({ macroDrafts: { ...s.macroDrafts, [index]: entry } })),
  clearMacroDrafts: () => set({ macroDrafts: {} }),
  resetDeviceState: () => set({ pending: null, encoderTarget: null, macroDrafts: {} }),
}));
