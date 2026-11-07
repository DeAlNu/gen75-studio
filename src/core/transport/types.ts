/** Ukuran report Raw HID VIA/QMK. */
export const REPORT_SIZE = 32;

export interface Transport {
  readonly label: string;
  readonly vendorId: number;
  readonly productId: number;
  send(report: Uint8Array): Promise<void>;
  /** Mendengarkan report masuk; mengembalikan fungsi untuk berhenti. */
  subscribe(listener: (report: Uint8Array) => void): () => void;
  /** Dipanggil saat perangkat dicabut atau koneksi terputus. */
  onClose(listener: () => void): () => void;
  close(): Promise<void>;
}
