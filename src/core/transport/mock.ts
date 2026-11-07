import { encoderCount } from '../definition/layout';
import type { DeviceDefinition } from '../definition/types';
import { encodeMatrix } from '../matrix';
import { encodeMacroBuffer } from '../macros';
import type { MacroEntry } from '../macros';
import { Cmd } from '../via/commands';
import { buildMockKeymap } from './mock-keymap';
import { REPORT_SIZE } from './types';
import type { Transport } from './types';

export interface MockOptions {
  protocol?: number;
  layers?: number;
  /** Jeda respons dalam ms; 0 berarti langsung (microtask). */
  latencyMs?: number;
  /** false: lighting dijawab "tidak dikenal" seperti firmware tanpa RGB matrix VIA. */
  lighting?: boolean;
  /** false: perintah makro dijawab "tidak dikenal". */
  macros?: boolean;
  /** false: perintah encoder dijawab "tidak dikenal". */
  encoders?: boolean;
  /** false: pembacaan matriks dijawab "tidak dikenal". */
  matrixState?: boolean;
}

const MACRO_COUNT = 16;
const MACRO_SIZE = 1024;

function defaultMacros(): Uint8Array {
  const entries: MacroEntry[] = Array.from({ length: MACRO_COUNT }, () => ({ kind: 'actions', actions: [] }));
  entries[0] = {
    kind: 'actions',
    actions: [
      { kind: 'down', keycode: 0xe0 },
      { kind: 'tap', keycode: 0x06 },
      { kind: 'up', keycode: 0xe0 },
    ],
  };
  entries[1] = {
    kind: 'actions',
    actions: [
      { kind: 'text', text: 'halo@contoh.id' },
      { kind: 'tap', keycode: 0x28 },
    ],
  };
  return encodeMacroBuffer(entries, MACRO_SIZE);
}

/** Perangkat VIA tiruan di memori, dipakai untuk tes dan mode simulasi. */
export class MockViaDevice implements Transport {
  readonly label = 'Gaming keyboard (simulasi)';
  readonly vendorId: number;
  readonly productId: number;
  readonly keymap: Uint8Array;
  readonly macro: Uint8Array = defaultMacros();
  readonly lighting = new Map<number, number[]>([
    [1, [128]],
    [2, [12]],
    [3, [128]],
    [4, [10, 255]],
  ]);
  /** Keycode putaran encoder, kunci "layer,indeks,arah" (arah 1 = searah jarum jam). */
  readonly encoderMap = new Map<string, number>();
  /** Posisi "baris,kolom" yang sedang ditekan pada matriks. */
  readonly pressed = new Set<string>();
  /** Semua report keluar yang diterima (byte pertama = perintah). */
  readonly sent: number[][] = [];
  /** Channel yang pernah disimpan lewat custom_save. */
  readonly saves: number[] = [];
  /** Setiap penulisan buffer makro yang diterima. */
  readonly macroWrites: { offset: number; size: number }[] = [];

  private readonly rows: number;
  private readonly cols: number;
  private readonly layers: number;
  private readonly protocol: number;
  private readonly latencyMs: number;
  private readonly lightingEnabled: boolean;
  private readonly macrosEnabled: boolean;
  private readonly encodersEnabled: boolean;
  private readonly matrixEnabled: boolean;
  private dropCount = 0;
  private closed = false;
  private readonly listeners = new Set<(report: Uint8Array) => void>();
  private readonly closeListeners = new Set<() => void>();

  constructor(def: DeviceDefinition, options: MockOptions = {}) {
    this.vendorId = def.vendorId;
    this.productId = def.productId;
    this.rows = def.matrix.rows;
    this.cols = def.matrix.cols;
    this.layers = options.layers ?? 4;
    this.protocol = options.protocol ?? 12;
    this.latencyMs = options.latencyMs ?? 0;
    this.lightingEnabled = options.lighting ?? true;
    this.macrosEnabled = options.macros ?? true;
    this.encodersEnabled = options.encoders ?? true;
    this.matrixEnabled = options.matrixState ?? true;
    this.keymap = buildMockKeymap(def, this.layers);
    for (let l = 0; l < this.layers; l += 1) {
      for (let i = 0; i < encoderCount(def); i += 1) {
        this.encoderMap.set(`${l},${i},0`, l === 0 ? 0xaa : 0x0001);
        this.encoderMap.set(`${l},${i},1`, l === 0 ? 0xa9 : 0x0001);
      }
    }
  }

  /** Membuang n respons berikutnya, untuk menguji timeout dan retry. */
  dropNext(n: number): void {
    this.dropCount = n;
  }

  /** Mengirim report liar ke aplikasi, mis. respons basi. */
  inject(report: number[]): void {
    const r = new Uint8Array(REPORT_SIZE);
    r.set(report);
    for (const l of this.listeners) l(r);
  }

  press(row: number, col: number): void {
    this.pressed.add(`${row},${col}`);
  }

  release(row: number, col: number): void {
    this.pressed.delete(`${row},${col}`);
  }

  unplug(): void {
    if (this.closed) return;
    this.closed = true;
    for (const l of this.closeListeners) l();
  }

  keycodeAt(layer: number, row: number, col: number): number {
    const o = ((layer * this.rows + row) * this.cols + col) * 2;
    return ((this.keymap[o] as number) << 8) | (this.keymap[o + 1] as number);
  }

  async send(report: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('perangkat sudah dicabut');
    this.sent.push(Array.from(report));
    const res = this.handle(report);
    if (this.dropCount > 0) {
      this.dropCount -= 1;
      return;
    }
    const emit = (): void => {
      for (const l of this.listeners) l(res);
    };
    if (this.latencyMs > 0) setTimeout(emit, this.latencyMs);
    else queueMicrotask(emit);
  }

  subscribe(listener: (report: Uint8Array) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onClose(listener: () => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  private handle(req: Uint8Array): Uint8Array {
    const r = new Uint8Array(REPORT_SIZE);
    r.set(req);
    const unhandled = (): Uint8Array => {
      r[0] = Cmd.Unhandled;
      return r;
    };
    const encoderKey = `${req[1]},${req[2]},${req[3] === 1 ? 1 : 0}`;
    switch (req[0]) {
      case Cmd.ProtocolVersion:
        r[1] = this.protocol >> 8;
        r[2] = this.protocol & 0xff;
        return r;
      case Cmd.LayerCount:
        r[1] = this.layers;
        return r;
      case Cmd.GetKeyboardValue:
        if (req[1] === 1) {
          r[2] = 0;
          r[3] = 0;
          r[4] = 0;
          r[5] = 1;
          return r;
        }
        if (req[1] === 3 && this.matrixEnabled) {
          r.set(encodeMatrix(this.pressed, this.rows, this.cols), 2);
          return r;
        }
        return unhandled();
      case Cmd.MacroCount:
        if (!this.macrosEnabled) return unhandled();
        r[1] = MACRO_COUNT;
        return r;
      case Cmd.MacroBufferSize:
        if (!this.macrosEnabled) return unhandled();
        r[1] = MACRO_SIZE >> 8;
        r[2] = MACRO_SIZE & 0xff;
        return r;
      case Cmd.MacroGetBuffer: {
        if (!this.macrosEnabled) return unhandled();
        const off = ((req[1] as number) << 8) | (req[2] as number);
        r.set(this.macro.subarray(off, off + (req[3] as number)), 4);
        return r;
      }
      case Cmd.MacroSetBuffer: {
        if (!this.macrosEnabled) return unhandled();
        const off = ((req[1] as number) << 8) | (req[2] as number);
        const size = req[3] as number;
        if (size <= 28 && off + size <= this.macro.length) {
          this.macro.set(req.subarray(4, 4 + size), off);
          this.macroWrites.push({ offset: off, size });
        }
        return r;
      }
      case Cmd.GetEncoder: {
        if (!this.encodersEnabled) return unhandled();
        const code = this.encoderMap.get(encoderKey) ?? 0;
        r[4] = code >> 8;
        r[5] = code & 0xff;
        return r;
      }
      case Cmd.SetEncoder:
        if (!this.encodersEnabled) return unhandled();
        if (this.encoderMap.has(encoderKey)) this.encoderMap.set(encoderKey, ((req[4] as number) << 8) | (req[5] as number));
        return r;
      case Cmd.GetKeycode: {
        const code = this.keycodeAt(req[1] as number, req[2] as number, req[3] as number);
        r[4] = code >> 8;
        r[5] = code & 0xff;
        return r;
      }
      case Cmd.SetKeycode: {
        const o = (((req[1] as number) * this.rows + (req[2] as number)) * this.cols + (req[3] as number)) * 2;
        if (o + 1 < this.keymap.length) {
          this.keymap[o] = req[4] as number;
          this.keymap[o + 1] = req[5] as number;
        }
        return r;
      }
      case Cmd.GetBuffer: {
        const off = ((req[1] as number) << 8) | (req[2] as number);
        const size = req[3] as number;
        r.set(this.keymap.subarray(off, off + size), 4);
        return r;
      }
      case Cmd.CustomGet:
        if (!this.lightingEnabled || req[1] !== 3) return unhandled();
        r.set(this.lighting.get(req[2] as number) ?? [0], 3);
        return r;
      case Cmd.CustomSet:
        if (!this.lightingEnabled || req[1] !== 3) return unhandled();
        this.lighting.set(req[2] as number, Array.from(req.subarray(3, 3 + ((req[2] as number) === 4 ? 2 : 1))));
        return r;
      case Cmd.CustomSave:
        if (!this.lightingEnabled) return unhandled();
        this.saves.push(req[1] as number);
        return r;
      default:
        return unhandled();
    }
  }
}
