import { encoderCount } from './definition/layout';
import { controlsOf, valueByteLength } from './definition/menus';
import type { DeviceDefinition, MenuControl } from './definition/types';
import { KB_BASE_LEGACY, KB_BASE_PROTOCOL_12 } from './keycodes';
import type { Transport } from './transport/types';
import { ViaClient } from './via/client';
import type { ClientOptions } from './via/client';
import { ViaDisconnected, ViaError, ViaVerify } from './via/errors';

export type LightingValue = number | number[];
export type LightingValues = Record<string, LightingValue>;

export interface DeviceState {
  protocolVersion: number;
  layerCount: number;
  keymap: Uint16Array[];
  lighting: LightingValues | null;
  /** Jumlah slot makro; 0 bila makro tidak tersedia. */
  macroCount: number;
  macroBuffer: Uint8Array | null;
  /** [layer][indeks encoder][0 = berlawanan jarum jam, 1 = searah]; null bila tidak tersedia. */
  encoders: number[][][] | null;
  writable: boolean;
  warnings: string[];
  customBase: number;
}

/** Penulisan hanya dibuka untuk protokol 12 ke atas: penomoran keycode lama berbeda. */
export const MIN_WRITE_PROTOCOL = 12;
export const MAX_LAYERS = 8;
export const MAX_MACRO_BUFFER = 4096;

const isByte = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 255;

export function encodeValue(control: MenuControl, value: LightingValue): number[] {
  switch (control.kind) {
    case 'color': {
      if (!Array.isArray(value) || value.length !== 2 || !value.every(isByte)) throw new RangeError('warna harus [hue, sat] 0-255');
      return [value[0] as number, value[1] as number];
    }
    case 'range': {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < control.min || value > control.max) {
        throw new RangeError(`nilai di luar rentang ${control.min}-${control.max}`);
      }
      return valueByteLength(control) === 2 ? [value >> 8, value & 0xff] : [value];
    }
    case 'dropdown': {
      if (typeof value !== 'number' || !control.options.some((o) => o.value === value)) throw new RangeError('pilihan tidak ada di daftar');
      return [value];
    }
    case 'toggle': {
      if (value !== 0 && value !== 1) throw new RangeError('toggle harus 0 atau 1');
      return [value];
    }
  }
}

export function decodeValue(control: MenuControl, bytes: number[]): LightingValue {
  if (control.kind === 'color') return [bytes[0] ?? 0, bytes[1] ?? 0];
  return bytes.reduce((acc, b) => (acc << 8) | b, 0);
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

export class DeviceSession {
  readonly client: ViaClient;
  state: DeviceState | null = null;
  private readonly controls: MenuControl[];
  private readonly encoders: number;

  constructor(
    readonly transport: Transport,
    readonly def: DeviceDefinition,
    clientOptions?: Partial<ClientOptions>,
  ) {
    this.client = new ViaClient(transport, clientOptions);
    this.controls = controlsOf(def.menus);
    this.encoders = encoderCount(def);
  }

  private control(id: string): MenuControl {
    const c = this.controls.find((x) => x.ref.id === id);
    if (!c) throw new Error(`nilai lighting tidak dikenal: ${id}`);
    return c;
  }

  private requireState(): DeviceState {
    if (!this.state) throw new Error('sesi belum dibuka');
    return this.state;
  }

  async open(): Promise<DeviceState> {
    const warnings: string[] = [];
    const { rows, cols } = this.def.matrix;

    const protocolVersion = await this.client.getProtocolVersion();
    if (protocolVersion < MIN_WRITE_PROTOCOL) {
      warnings.push(`Protokol VIA ${protocolVersion}: aplikasi hanya menulis ke protokol ${MIN_WRITE_PROTOCOL} ke atas, jadi perangkat dibuka dalam mode baca saja.`);
    }

    const layerCount = await this.client.getLayerCount();
    let keymap: Uint16Array[] = [];
    if (layerCount < 1 || layerCount > MAX_LAYERS) {
      warnings.push(`Jumlah layer tidak wajar (${layerCount}), keymap tidak dibaca.`);
    } else {
      keymap = await this.client.readKeymap(layerCount, rows, cols);
    }

    const lighting = await this.readLighting(warnings);
    const macros = await this.readMacros(warnings);
    const encoders = await this.readEncoders(layerCount, warnings);
    const writable = protocolVersion >= MIN_WRITE_PROTOCOL && keymap.length > 0;
    this.client.writesEnabled = writable;

    this.state = {
      protocolVersion,
      layerCount,
      keymap,
      lighting,
      macroCount: macros?.count ?? 0,
      macroBuffer: macros?.buffer ?? null,
      encoders,
      writable,
      warnings,
      customBase: protocolVersion >= MIN_WRITE_PROTOCOL ? KB_BASE_PROTOCOL_12 : KB_BASE_LEGACY,
    };
    return this.state;
  }

  private async readLighting(warnings: string[]): Promise<LightingValues | null> {
    if (this.controls.length === 0) return null;
    const values: LightingValues = {};
    try {
      for (const c of this.controls) {
        const bytes = await this.client.customGet(c.ref.channel, c.ref.valueId, valueByteLength(c));
        values[c.ref.id] = decodeValue(c, bytes);
      }
      return values;
    } catch (err) {
      if (err instanceof ViaDisconnected) throw err;
      const detail = err instanceof ViaError ? err.message : String(err);
      warnings.push(`Lighting tidak tersedia: ${detail}.`);
      return null;
    }
  }

  private async readMacros(warnings: string[]): Promise<{ count: number; buffer: Uint8Array } | null> {
    try {
      const count = await this.client.getMacroCount();
      const size = await this.client.getMacroBufferSize();
      if (count < 1 || size < 1 || size > MAX_MACRO_BUFFER) {
        warnings.push(`Makro tidak dibaca: jumlah ${count}, ukuran buffer ${size} byte tidak wajar.`);
        return null;
      }
      return { count, buffer: await this.client.readMacroBuffer(size) };
    } catch (err) {
      if (err instanceof ViaDisconnected) throw err;
      const detail = err instanceof ViaError ? err.message : String(err);
      warnings.push(`Makro tidak tersedia: ${detail}.`);
      return null;
    }
  }

  private async readEncoders(layerCount: number, warnings: string[]): Promise<number[][][] | null> {
    if (this.encoders === 0 || layerCount < 1 || layerCount > MAX_LAYERS) return null;
    try {
      const out: number[][][] = [];
      for (let l = 0; l < layerCount; l += 1) {
        const perLayer: number[][] = [];
        for (let i = 0; i < this.encoders; i += 1) {
          perLayer.push([await this.client.readEncoder(l, i, false), await this.client.readEncoder(l, i, true)]);
        }
        out.push(perLayer);
      }
      return out;
    } catch (err) {
      if (err instanceof ViaDisconnected) throw err;
      const detail = err instanceof ViaError ? err.message : String(err);
      warnings.push(`Putaran knob tidak bisa dibaca: ${detail}.`);
      return null;
    }
  }

  /** Membaca ulang keymap, makro, dan encoder dari perangkat setelah penulisan gagal atau pemulihan. */
  async refresh(): Promise<DeviceState> {
    const s = this.requireState();
    const { rows, cols } = this.def.matrix;
    const scratch: string[] = [];
    s.keymap = await this.client.readKeymap(s.layerCount, rows, cols);
    if (s.macroBuffer) s.macroBuffer = await this.client.readMacroBuffer(s.macroBuffer.length);
    if (s.encoders) s.encoders = (await this.readEncoders(s.layerCount, scratch)) ?? s.encoders;
    return s;
  }

  async readKeymap(): Promise<Uint16Array[]> {
    const s = this.requireState();
    const { rows, cols } = this.def.matrix;
    s.keymap = await this.client.readKeymap(s.layerCount, rows, cols);
    return s.keymap;
  }

  async setKeycode(layer: number, keyIndex: number, code: number): Promise<void> {
    const s = this.requireState();
    const key = this.def.keys[keyIndex];
    if (!key) throw new RangeError(`tombol ${keyIndex} tidak ada`);
    if (layer < 0 || layer >= s.layerCount) throw new RangeError(`layer ${layer} tidak ada`);
    await this.client.writeKeycode(layer, key.row, key.col, code);
    const words = s.keymap[layer];
    if (words) words[key.row * this.def.matrix.cols + key.col] = code;
  }

  async setEncoder(layer: number, index: number, clockwise: boolean, code: number): Promise<void> {
    const s = this.requireState();
    if (!s.encoders) throw new Error('putaran knob tidak tersedia pada perangkat ini');
    if (layer < 0 || layer >= s.layerCount) throw new RangeError(`layer ${layer} tidak ada`);
    if (index < 0 || index >= this.encoders) throw new RangeError(`encoder ${index} tidak ada`);
    await this.client.writeEncoder(layer, index, clockwise, code);
    const slot = s.encoders[layer]?.[index];
    if (slot) slot[clockwise ? 1 : 0] = code;
  }

  /** Menulis hanya rentang byte yang berubah, lalu membaca seluruh buffer untuk memastikan hasilnya sama. */
  async saveMacroBuffer(next: Uint8Array): Promise<void> {
    const s = this.requireState();
    const cur = s.macroBuffer;
    if (!cur) throw new Error('makro tidak tersedia pada perangkat ini');
    if (next.length !== cur.length) throw new RangeError('ukuran buffer makro berbeda');
    let first = -1;
    let last = -1;
    for (let i = 0; i < cur.length; i += 1) {
      if (cur[i] !== next[i]) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return;
    await this.client.writeMacroBuffer(first, next.subarray(first, last + 1));
    const back = await this.client.readMacroBuffer(cur.length);
    s.macroBuffer = back;
    if (!sameBytes(back, next)) throw new ViaVerify('verifikasi makro gagal: isi yang terbaca berbeda dari yang ditulis');
  }

  async setLighting(id: string, value: LightingValue): Promise<void> {
    const s = this.requireState();
    const c = this.control(id);
    await this.client.customSet(c.ref.channel, c.ref.valueId, encodeValue(c, value));
    if (s.lighting) s.lighting[id] = value;
  }

  /** Menyimpan lighting ke EEPROM perangkat lalu membaca ulang nilai sebenarnya. */
  async commitLighting(): Promise<LightingValues> {
    const s = this.requireState();
    for (const channel of new Set(this.controls.map((c) => c.ref.channel))) {
      await this.client.customSave(channel);
    }
    const values: LightingValues = {};
    for (const c of this.controls) {
      values[c.ref.id] = decodeValue(c, await this.client.customGet(c.ref.channel, c.ref.valueId, valueByteLength(c)));
    }
    s.lighting = values;
    return values;
  }

  async close(): Promise<void> {
    this.client.dispose();
    await this.transport.close();
  }
}
