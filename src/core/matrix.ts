/**
 * Mengurai nilai "switch matrix state" VIA: per baris ceil(kolom / 8) byte,
 * byte tertinggi lebih dulu, bit 0 = kolom 0. Hasilnya himpunan "baris,kolom" yang tertekan.
 */
export function decodeMatrix(bytes: Uint8Array, rows: number, cols: number): Set<string> {
  const perRow = Math.ceil(cols / 8);
  const pressed = new Set<string>();
  for (let r = 0; r < rows; r += 1) {
    let value = 0;
    for (let b = 0; b < perRow; b += 1) value = (value << 8) | (bytes[r * perRow + b] ?? 0);
    for (let c = 0; c < cols; c += 1) if ((value >> c) & 1) pressed.add(`${r},${c}`);
  }
  return pressed;
}

export function encodeMatrix(pressed: ReadonlySet<string>, rows: number, cols: number): Uint8Array {
  const perRow = Math.ceil(cols / 8);
  const out = new Uint8Array(rows * perRow);
  for (const key of pressed) {
    const [r, c] = key.split(',').map(Number) as [number, number];
    if (r >= rows || c >= cols) continue;
    const bit = 1 << c;
    for (let b = 0; b < perRow; b += 1) {
      const shift = (perRow - 1 - b) * 8;
      out[r * perRow + b] = ((out[r * perRow + b] ?? 0) | ((bit >> shift) & 0xff)) & 0xff;
    }
  }
  return out;
}
