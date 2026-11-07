import type { DeviceDefinition } from '../definition/types';
import { REPORT_SIZE } from './types';
import type { Transport } from './types';

export const RAW_HID_USAGE_PAGE = 0xff60;
export const RAW_HID_USAGE = 0x61;

export function isWebHidSupported(): boolean {
  return typeof navigator !== 'undefined' && 'hid' in navigator;
}

function filterFor(def: DeviceDefinition): HIDDeviceFilter {
  return { vendorId: def.vendorId, productId: def.productId, usagePage: RAW_HID_USAGE_PAGE, usage: RAW_HID_USAGE };
}

class WebHidTransport implements Transport {
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  private readonly listeners = new Set<(report: Uint8Array) => void>();
  private readonly closeListeners = new Set<() => void>();
  private closed = false;

  constructor(private readonly device: HIDDevice) {
    this.label = device.productName || 'Keyboard';
    this.vendorId = device.vendorId;
    this.productId = device.productId;
    device.addEventListener('inputreport', this.onInput);
    navigator.hid.addEventListener('disconnect', this.onDisconnect);
  }

  private readonly onInput = (e: HIDInputReportEvent): void => {
    if (e.reportId !== 0) return;
    const data = new Uint8Array(e.data.buffer, e.data.byteOffset, e.data.byteLength).slice();
    for (const l of this.listeners) l(data);
  };

  private readonly onDisconnect = (e: HIDConnectionEvent): void => {
    if (e.device === this.device) this.finish();
  };

  private finish(): void {
    if (this.closed) return;
    this.closed = true;
    this.device.removeEventListener('inputreport', this.onInput);
    navigator.hid.removeEventListener('disconnect', this.onDisconnect);
    for (const l of this.closeListeners) l();
  }

  async send(report: Uint8Array): Promise<void> {
    if (this.closed) throw new Error('perangkat sudah terputus');
    if (report.length !== REPORT_SIZE) throw new Error(`report harus ${REPORT_SIZE} byte`);
    const data = new Uint8Array(REPORT_SIZE);
    data.set(report);
    await this.device.sendReport(0, data);
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
    const wasClosed = this.closed;
    this.finish();
    if (!wasClosed && this.device.opened) await this.device.close();
  }
}

async function openDevice(device: HIDDevice): Promise<Transport> {
  if (!device.opened) await device.open();
  return new WebHidTransport(device);
}

/** Memunculkan dialog pemilihan perangkat. Harus dipanggil dari klik pengguna. */
export async function requestWebHid(def: DeviceDefinition): Promise<Transport | null> {
  const picked = await navigator.hid.requestDevice({ filters: [filterFor(def)] });
  const device = picked[0];
  return device ? openDevice(device) : null;
}

/** Perangkat yang sudah pernah diizinkan, untuk sambung otomatis tanpa dialog. */
export async function findPairedWebHid(def: DeviceDefinition): Promise<Transport | null> {
  const f = filterFor(def);
  const devices = await navigator.hid.getDevices();
  const device = devices.find(
    (d) =>
      d.vendorId === f.vendorId &&
      d.productId === f.productId &&
      d.collections.some((c) => c.usagePage === RAW_HID_USAGE_PAGE && c.usage === RAW_HID_USAGE),
  );
  return device ? openDevice(device) : null;
}
