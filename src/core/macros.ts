import { BASIC_BY_CODE } from './keycodes/basic';

/**
 * Format makro mengikuti dynamic keymap QMK: tiap makro berakhir byte 0x00.
 * Karakter ASCII 0x20-0x7E diketik apa adanya. Urutan khusus diawali 0x01:
 *   0x01 0x01 kc  ketuk     0x01 0x02 kc  tahan     0x01 0x03 kc  lepas
 *   0x01 0x04 digit... '|'  jeda dalam milidetik
 * Urutan lain tidak dikenal dan disimpan apa adanya sebagai makro "mentah".
 */

export class MacroError extends Error {}

export type MacroAction =
  | { kind: 'tap' | 'down' | 'up'; keycode: number }
  | { kind: 'delay'; ms: number }
  | { kind: 'text'; text: string };

export type MacroEntry =
  | { kind: 'actions'; actions: MacroAction[]; original?: number[] }
  | { kind: 'raw'; bytes: number[] };

const PREFIX = 0x01;
const OP = { tap: 0x01, down: 0x02, up: 0x03, delay: 0x04 } as const;
const PIPE = 0x7c;

export const MAX_DELAY_MS = 65535;

const isPlainChar = (b: number): boolean => b >= 0x20 && b <= 0x7e;
const isMacroKey = (kc: number): boolean => Number.isInteger(kc) && kc >= 2 && kc <= 0xff && BASIC_BY_CODE.has(kc);

export function serializeAction(a: MacroAction): number[] {
  switch (a.kind) {
    case 'tap':
    case 'down':
    case 'up':
      if (!isMacroKey(a.keycode)) throw new MacroError(`keycode makro tidak valid: ${a.keycode}`);
      return [PREFIX, OP[a.kind], a.keycode];
    case 'delay':
      if (!Number.isInteger(a.ms) || a.ms < 1 || a.ms > MAX_DELAY_MS) throw new MacroError(`jeda harus 1-${MAX_DELAY_MS} ms`);
      return [PREFIX, OP.delay, ...Array.from(String(a.ms), (c) => c.charCodeAt(0)), PIPE];
    case 'text': {
      const out: number[] = [];
      for (const ch of a.text) {
        const c = ch.charCodeAt(0);
        if (ch.length !== 1 || !isPlainChar(c)) throw new MacroError(`karakter tidak didukung dalam teks makro: "${ch}"`);
        out.push(c);
      }
      return out;
    }
  }
}

export function serializeEntry(e: MacroEntry): number[] {
  if (e.kind === 'raw') return e.bytes;
  // makro yang tidak diubah dipertahankan byte demi byte
  if (e.original) return e.original;
  return e.actions.flatMap(serializeAction);
}

export function parseMacroBytes(bytes: number[]): MacroEntry {
  const raw: MacroEntry = { kind: 'raw', bytes };
  const actions: MacroAction[] = [];
  let text = '';
  const flush = (): void => {
    if (text) actions.push({ kind: 'text', text });
    text = '';
  };

  let i = 0;
  while (i < bytes.length) {
    const b = bytes[i] as number;
    if (b === PREFIX) {
      flush();
      const op = bytes[i + 1];
      if (op === OP.tap || op === OP.down || op === OP.up) {
        const kc = bytes[i + 2];
        if (kc === undefined || !isMacroKey(kc)) return raw;
        actions.push({ kind: op === OP.tap ? 'tap' : op === OP.down ? 'down' : 'up', keycode: kc });
        i += 3;
      } else if (op === OP.delay) {
        let j = i + 2;
        let digits = '';
        while (j < bytes.length && (bytes[j] as number) >= 0x30 && (bytes[j] as number) <= 0x39) {
          digits += String.fromCharCode(bytes[j] as number);
          j += 1;
        }
        const ms = Number(digits);
        if (digits === '' || bytes[j] !== PIPE || ms < 1 || ms > MAX_DELAY_MS) return raw;
        actions.push({ kind: 'delay', ms });
        i = j + 1;
      } else {
        return raw;
      }
    } else if (isPlainChar(b)) {
      text += String.fromCharCode(b);
      i += 1;
    } else {
      return raw;
    }
  }
  flush();
  return { kind: 'actions', actions };
}

export function parseMacroBuffer(buffer: Uint8Array, count: number): MacroEntry[] {
  const entries: MacroEntry[] = [];
  let pos = 0;
  for (let i = 0; i < count; i += 1) {
    const start = pos;
    while (pos < buffer.length && buffer[pos] !== 0) pos += 1;
    const bytes = Array.from(buffer.subarray(start, pos));
    const parsed = parseMacroBytes(bytes);
    entries.push(parsed.kind === 'actions' ? { ...parsed, original: bytes } : parsed);
    pos += 1;
  }
  return entries;
}

/** Panjang byte sebuah entri; entri yang tidak valid dihitung 0 karena tidak bisa ditulis. */
function entryLength(e: MacroEntry): number {
  try {
    return serializeEntry(e).length;
  } catch {
    return 0;
  }
}

/** Byte yang terpakai: isi semua makro ditambah pemisah antar makro. */
export function macroUsage(entries: readonly MacroEntry[], size: number): { used: number; size: number; fits: boolean } {
  const used = entries.reduce((a, e) => a + entryLength(e), 0) + Math.max(0, entries.length - 1);
  // satu byte nol di ujung dipertahankan sebagai penutup makro terakhir
  return { used, size, fits: used + 1 <= size };
}

export function encodeMacroBuffer(entries: readonly MacroEntry[], size: number): Uint8Array {
  const parts = entries.map(serializeEntry);
  const usage = macroUsage(entries, size);
  if (!usage.fits) throw new MacroError(`Memori makro penuh: butuh ${usage.used + 1} byte, tersedia ${size}.`);
  const buf = new Uint8Array(size);
  let pos = 0;
  parts.forEach((p, i) => {
    buf.set(p, pos);
    pos += p.length;
    if (i < parts.length - 1) pos += 1;
  });
  return buf;
}

export function validateEntry(e: MacroEntry): string | null {
  try {
    serializeEntry(e);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function actionLabel(a: MacroAction): string {
  const key = (kc: number): string => BASIC_BY_CODE.get(kc)?.label ?? `0x${kc.toString(16)}`;
  switch (a.kind) {
    case 'tap':
      return `Ketuk ${key(a.keycode)}`;
    case 'down':
      return `Tahan ${key(a.keycode)}`;
    case 'up':
      return `Lepas ${key(a.keycode)}`;
    case 'delay':
      return `Jeda ${a.ms} ms`;
    case 'text':
      return `Ketik "${a.text}"`;
  }
}

export interface RecordedEvent {
  type: 'down' | 'up';
  keycode: number;
  t: number;
}

/** Mengubah rangkaian tekan dan lepas tombol menjadi aksi makro. */
export class MacroRecorder {
  private readonly events: RecordedEvent[] = [];
  private readonly held = new Set<number>();

  get size(): number {
    return this.events.length;
  }

  down(keycode: number, t: number): void {
    if (this.held.has(keycode)) return;
    this.held.add(keycode);
    this.events.push({ type: 'down', keycode, t });
  }

  up(keycode: number, t: number): void {
    if (!this.held.has(keycode)) return;
    this.held.delete(keycode);
    this.events.push({ type: 'up', keycode, t });
  }

  finish(t: number, opts: { delays: boolean }): MacroAction[] {
    for (const kc of [...this.held]) this.up(kc, t);
    const actions: MacroAction[] = [];
    let lastEnd: number | null = null;
    const push = (a: MacroAction, start: number): void => {
      if (opts.delays && lastEnd !== null) {
        const gap = Math.round((start - lastEnd) / 10) * 10;
        if (gap >= 40) actions.push({ kind: 'delay', ms: Math.min(gap, 10000) });
      }
      actions.push(a);
    };
    for (let i = 0; i < this.events.length; i += 1) {
      const e = this.events[i] as RecordedEvent;
      const next = this.events[i + 1];
      if (e.type === 'down' && next && next.type === 'up' && next.keycode === e.keycode) {
        push({ kind: 'tap', keycode: e.keycode }, e.t);
        lastEnd = next.t;
        i += 1;
      } else {
        push({ kind: e.type, keycode: e.keycode }, e.t);
        lastEnd = e.t;
      }
    }
    return actions;
  }
}
