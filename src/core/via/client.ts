import { REPORT_SIZE } from '../transport/types';
import type { Transport } from '../transport/types';
import { ALLOWED_COMMANDS, Cmd, WRITE_COMMANDS } from './commands';
import { ViaBlocked, ViaDisconnected, ViaReadOnly, ViaTimeout, ViaUnhandled, ViaVerify } from './errors';

export interface ClientOptions {
  timeoutMs: number;
  retries: number;
}

const DEFAULT_OPTIONS: ClientOptions = { timeoutMs: 500, retries: 2 };

/** Data per report: 32 byte dikurangi 4 byte kepala (perintah, offset 2 byte, ukuran). */
const CHUNK = REPORT_SIZE - 4;

interface RequestOptions {
  /** Jumlah byte setelah perintah yang harus sama dengan permintaan (parameter yang digemakan firmware). */
  echo?: number;
}

export class ViaClient {
  /** Perintah tulis ditolak sampai sesi menyatakan perangkat aman ditulisi. */
  writesEnabled = false;

  private chain: Promise<unknown> = Promise.resolve();
  private pending: ((report: Uint8Array) => boolean) | null = null;
  private readonly unsubscribe: () => void;
  private readonly options: ClientOptions;

  constructor(
    private readonly transport: Transport,
    options: Partial<ClientOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
    this.unsubscribe = transport.subscribe((report) => {
      this.pending?.(report);
    });
  }

  dispose(): void {
    this.unsubscribe();
    this.pending = null;
  }

  request(bytes: number[], opts: RequestOptions = {}): Promise<Uint8Array> {
    const cmd = bytes[0] as number;
    if (!ALLOWED_COMMANDS.has(cmd)) return Promise.reject(new ViaBlocked(cmd));
    if (WRITE_COMMANDS.has(cmd) && !this.writesEnabled) return Promise.reject(new ViaReadOnly(cmd));
    const job = this.chain.then(() => this.exchange(bytes, opts.echo ?? 0));
    this.chain = job.catch(() => undefined);
    return job;
  }

  private async exchange(bytes: number[], echo: number): Promise<Uint8Array> {
    let last: ViaTimeout | null = null;
    for (let attempt = 0; attempt <= this.options.retries; attempt += 1) {
      try {
        return await this.once(bytes, echo);
      } catch (err) {
        if (!(err instanceof ViaTimeout)) throw err;
        last = err;
      }
    }
    throw last as ViaTimeout;
  }

  private once(bytes: number[], echo: number): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      const report = new Uint8Array(REPORT_SIZE);
      report.set(bytes);
      const cmd = report[0] as number;
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new ViaTimeout(cmd));
      }, this.options.timeoutMs);

      this.pending = (r) => {
        if (r[0] !== cmd && r[0] !== Cmd.Unhandled) return false;
        // respons basi dari permintaan sebelumnya tidak boleh dipakai
        for (let i = 1; i <= echo; i += 1) if (r[i] !== report[i]) return false;
        clearTimeout(timer);
        this.pending = null;
        if (r[0] === Cmd.Unhandled) reject(new ViaUnhandled(cmd));
        else resolve(r);
        return true;
      };

      this.transport.send(report).catch((err: unknown) => {
        clearTimeout(timer);
        this.pending = null;
        reject(new ViaDisconnected(err instanceof Error ? err.message : String(err)));
      });
    });
  }

  async getProtocolVersion(): Promise<number> {
    const r = await this.request([Cmd.ProtocolVersion]);
    return ((r[1] as number) << 8) | (r[2] as number);
  }

  async getLayerCount(): Promise<number> {
    const r = await this.request([Cmd.LayerCount]);
    return r[1] as number;
  }

  async readKeymap(layers: number, rows: number, cols: number): Promise<Uint16Array[]> {
    const layerBytes = rows * cols * 2;
    const out: Uint16Array[] = [];
    for (let l = 0; l < layers; l += 1) {
      const bytes = new Uint8Array(layerBytes);
      for (let off = 0; off < layerBytes; off += CHUNK) {
        const size = Math.min(CHUNK, layerBytes - off);
        const abs = l * layerBytes + off;
        const r = await this.request([Cmd.GetBuffer, abs >> 8, abs & 0xff, size], { echo: 3 });
        bytes.set(r.subarray(4, 4 + size), off);
      }
      const words = new Uint16Array(rows * cols);
      for (let i = 0; i < words.length; i += 1) words[i] = ((bytes[i * 2] as number) << 8) | (bytes[i * 2 + 1] as number);
      out.push(words);
    }
    return out;
  }

  async readKeycode(layer: number, row: number, col: number): Promise<number> {
    const r = await this.request([Cmd.GetKeycode, layer, row, col], { echo: 3 });
    return ((r[4] as number) << 8) | (r[5] as number);
  }

  /** Menulis satu keycode lalu membacanya kembali untuk memastikan tersimpan. */
  async writeKeycode(layer: number, row: number, col: number, code: number): Promise<void> {
    if (!Number.isInteger(code) || code < 0 || code > 0xffff) throw new RangeError(`keycode di luar jangkauan: ${code}`);
    await this.request([Cmd.SetKeycode, layer, row, col, code >> 8, code & 0xff], { echo: 3 });
    const back = await this.readKeycode(layer, row, col);
    if (back !== code) {
      throw new ViaVerify(`verifikasi gagal di layer ${layer} (${row},${col}): ditulis 0x${code.toString(16)}, terbaca 0x${back.toString(16)}`);
    }
  }

  async customGet(channel: number, valueId: number, length: number): Promise<number[]> {
    const r = await this.request([Cmd.CustomGet, channel, valueId], { echo: 2 });
    return Array.from(r.subarray(3, 3 + length));
  }

  async customSet(channel: number, valueId: number, data: number[]): Promise<void> {
    await this.request([Cmd.CustomSet, channel, valueId, ...data], { echo: 2 });
  }

  async customSave(channel: number): Promise<void> {
    await this.request([Cmd.CustomSave, channel], { echo: 1 });
  }
}
