import type { DeviceDefinition } from '../definition/types';
import { BASIC_BY_NAME } from '../keycodes/basic';
import { KB_BASE_PROTOCOL_12, Q } from '../keycodes';

const L = (name: string): number => {
  const k = BASIC_BY_NAME.get(name);
  if (!k) throw new Error(`nama keycode tidak ada: ${name}`);
  return k.code;
};

const letters = (s: string): number[] => s.split('').map((c) => L(`KC_${c}`));
const fkeys = (): number[] => Array.from({ length: 12 }, (_, i) => L(`KC_F${i + 1}`));

/** Layer 0 bawaan simulasi, urut sesuai urutan tombol di layout KLE (83 posisi). */
export const MOCK_LAYER0: number[] = [
  L('KC_ESC'), ...fkeys(), L('KC_DEL'), L('KC_MUTE'),
  L('KC_GRV'), ...'1234567890'.split('').map((d) => L(`KC_${d}`)), L('KC_MINS'), L('KC_EQL'), L('KC_BSPC'), L('KC_PGUP'),
  L('KC_TAB'), ...letters('QWERTYUIOP'), L('KC_LBRC'), L('KC_RBRC'), L('KC_BSLS'), L('KC_PGDN'),
  L('KC_CAPS'), ...letters('ASDFGHJKL'), L('KC_SCLN'), L('KC_QUOT'), L('KC_ENT'), L('KC_HOME'),
  L('KC_LSFT'), ...letters('ZXCVBNM'), L('KC_COMM'), L('KC_DOT'), L('KC_SLSH'), L('KC_RSFT'), L('KC_UP'), L('KC_END'),
  L('KC_LCTL'), L('KC_LGUI'), L('KC_LALT'), L('KC_SPC'), L('KC_RALT'), Q.MOMENTARY | 1, L('KC_RCTL'), L('KC_LEFT'), L('KC_DOWN'), L('KC_RGHT'),
];

const custom = (i: number): number => KB_BASE_PROTOCOL_12 + i;

/** Layer 1 bawaan simulasi: media di baris F, pintasan mode koneksi di baris angka. */
function layer1Overrides(): Map<number, number> {
  const m = new Map<number, number>();
  ['KC_BRID', 'KC_BRIU', 'KC_MPRV', 'KC_MPLY', 'KC_MNXT', 'KC_MUTE', 'KC_VOLD', 'KC_VOLU'].forEach((n, i) => m.set(1 + i, L(n)));
  [custom(1), custom(2), custom(3), custom(0), custom(4)].forEach((c, i) => m.set(16 + i, c));
  m.set(13, custom(9));
  m.set(MOCK_LAYER0.indexOf(L('KC_B')), custom(5));
  return m;
}

export function buildMockKeymap(def: DeviceDefinition, layers: number): Uint8Array {
  const { rows, cols } = def.matrix;
  const layerWords = rows * cols;
  const buf = new Uint8Array(layers * layerWords * 2);
  const put = (layer: number, slot: number, code: number): void => {
    const o = (layer * layerWords + slot) * 2;
    buf[o] = code >> 8;
    buf[o + 1] = code & 0xff;
  };
  const overrides = layer1Overrides();
  for (const key of def.keys) {
    const slot = key.row * cols + key.col;
    for (let l = 0; l < layers; l += 1) {
      if (l === 0) put(l, slot, MOCK_LAYER0[key.index] ?? 0);
      else if (l === 1) put(l, slot, overrides.get(key.index) ?? 0x0001);
      else put(l, slot, 0x0001);
    }
  }
  return buf;
}
