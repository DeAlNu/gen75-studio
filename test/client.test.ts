import { describe, expect, it } from 'vitest';
import { gen75 } from '../src/core/definition';
import { MockViaDevice } from '../src/core/transport/mock';
import type { MockOptions } from '../src/core/transport/mock';
import { ViaClient } from '../src/core/via/client';
import { ViaBlocked, ViaReadOnly, ViaTimeout, ViaUnhandled, ViaVerify } from '../src/core/via/errors';

function setup(mock: MockOptions = {}, timeoutMs = 50, retries = 1) {
  const dev = new MockViaDevice(gen75, mock);
  const client = new ViaClient(dev, { timeoutMs, retries });
  return { dev, client };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('ViaClient: pembacaan', () => {
  it('membaca versi protokol dan jumlah layer', async () => {
    const { client } = setup();
    expect(await client.getProtocolVersion()).toBe(12);
    expect(await client.getLayerCount()).toBe(4);
  });

  it('membaca seluruh keymap dalam potongan 28 byte', async () => {
    const { client, dev } = setup();
    const layers = await client.readKeymap(4, 6, 16);
    expect(layers).toHaveLength(4);
    expect(layers[0]).toHaveLength(96);
    expect(layers[0]?.[0]).toBe(0x29);
    expect(layers[0]?.[13]).toBe(0);
    expect(layers[1]?.[1 * 16 + 1]).toBe(0x7e01);
    // 192 byte per layer = 7 permintaan, 4 layer
    expect(dev.sent.filter((r) => r[0] === 0x12)).toHaveLength(28);
  });

  it('memproses permintaan paralel secara berurutan', async () => {
    const { client, dev } = setup({ latencyMs: 3 });
    const results = await Promise.all([0, 1, 2, 3, 4].map((c) => client.readKeycode(0, 1, c)));
    expect(results).toEqual([0x35, 0x1e, 0x1f, 0x20, 0x21]);
    expect(dev.sent.map((r) => r[3])).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('ViaClient: keselamatan', () => {
  it('menolak perintah di luar daftar putih tanpa mengirimnya', async () => {
    const { client, dev } = setup();
    for (const cmd of [0x03, 0x06, 0x0a, 0x0b, 0x10, 0x13]) {
      await expect(client.request([cmd, 0, 0, 0])).rejects.toBeInstanceOf(ViaBlocked);
    }
    expect(dev.sent).toHaveLength(0);
  });

  it('menolak perintah tulis saat mode baca saja', async () => {
    const { client, dev } = setup();
    await expect(client.writeKeycode(0, 1, 1, 0x05)).rejects.toBeInstanceOf(ViaReadOnly);
    await expect(client.customSet(3, 1, [10])).rejects.toBeInstanceOf(ViaReadOnly);
    await expect(client.customSave(3)).rejects.toBeInstanceOf(ViaReadOnly);
    expect(dev.sent).toHaveLength(0);
  });

  it('menulis keycode lalu memverifikasi lewat baca ulang', async () => {
    const { client, dev } = setup();
    client.writesEnabled = true;
    await client.writeKeycode(0, 1, 1, 0x0005);
    expect(dev.keycodeAt(0, 1, 1)).toBe(0x0005);
    expect(dev.sent.map((r) => r[0])).toEqual([0x05, 0x04]);
  });

  it('melaporkan kegagalan verifikasi bila perangkat tidak menyimpan nilai', async () => {
    const { client, dev } = setup();
    client.writesEnabled = true;
    const original = dev.send.bind(dev);
    dev.send = async (report: Uint8Array) => {
      // perangkat menyimpan nilai yang berbeda dari yang dikirim
      if (report[0] === 0x05) {
        const copy = report.slice();
        copy[4] = 0x7f;
        copy[5] = 0x7f;
        return original(copy);
      }
      return original(report);
    };
    await expect(client.writeKeycode(0, 1, 1, 0x0005)).rejects.toBeInstanceOf(ViaVerify);
  });

  it('menolak keycode di luar 16 bit', async () => {
    const { client } = setup();
    client.writesEnabled = true;
    await expect(client.writeKeycode(0, 0, 0, 0x10000)).rejects.toBeInstanceOf(RangeError);
  });
});

describe('ViaClient: lighting', () => {
  it('menulis, membaca, dan menyimpan nilai channel 3', async () => {
    const { client, dev } = setup();
    client.writesEnabled = true;
    await client.customSet(3, 1, [77]);
    await client.customSet(3, 4, [200, 100]);
    expect(await client.customGet(3, 1, 1)).toEqual([77]);
    expect(await client.customGet(3, 4, 2)).toEqual([200, 100]);
    await client.customSave(3);
    expect(dev.saves).toEqual([3]);
  });

  it('melaporkan perintah yang tidak dikenal firmware', async () => {
    const { client } = setup({ lighting: false });
    await expect(client.customGet(3, 1, 1)).rejects.toBeInstanceOf(ViaUnhandled);
  });
});

describe('ViaClient: ketahanan', () => {
  it('mengulang permintaan saat satu respons hilang', async () => {
    const { client, dev } = setup();
    dev.dropNext(1);
    expect(await client.getProtocolVersion()).toBe(12);
    expect(dev.sent).toHaveLength(2);
  });

  it('menyerah dengan ViaTimeout setelah percobaan habis', async () => {
    const { client, dev } = setup();
    dev.dropNext(10);
    await expect(client.getProtocolVersion()).rejects.toBeInstanceOf(ViaTimeout);
    expect(dev.sent).toHaveLength(2);
  });

  it('mengabaikan respons basi dengan parameter berbeda', async () => {
    const { client, dev } = setup({ latencyMs: 25 }, 300, 0);
    const pending = client.readKeycode(0, 0, 0);
    await sleep(5);
    dev.inject([0x04, 0, 5, 5, 0x12, 0x34]);
    expect(await pending).toBe(0x29);
  });
});
