import type { CustomKeycode } from '../definition/types';
import { BASIC_BY_CODE, BASIC_BY_NAME, BASIC_KEYS } from './basic';
import type { BasicGroup } from './basic';

/** Rentang keycode QMK 0.19 ke atas (protokol VIA 12). */
export const Q = {
  MODS: 0x0100,
  MOD_TAP: 0x2000,
  LAYER_TAP: 0x4000,
  TO: 0x5200,
  MOMENTARY: 0x5220,
  DEF_LAYER: 0x5240,
  TOGGLE_LAYER: 0x5260,
  ONE_SHOT_LAYER: 0x5280,
  ONE_SHOT_MOD: 0x52a0,
  LAYER_TAP_TOGGLE: 0x52c0,
  MACRO: 0x7700,
  RGB_MATRIX: 0x7820,
  BOOT_FIRST: 0x7c00,
  BOOT_LAST: 0x7c03,
  KB: 0x7e00,
  USER: 0x7e40,
} as const;

export const KB_BASE_PROTOCOL_12 = Q.KB;
export const KB_BASE_LEGACY = 0x5f80;

export interface KeycodeContext {
  customKeycodes: readonly CustomKeycode[];
  customBase: number;
}

export type KeycodeKind =
  | 'basic'
  | 'mods'
  | 'mod-tap'
  | 'layer-tap'
  | 'layer'
  | 'macro'
  | 'rgb'
  | 'custom'
  | 'unknown';

export interface KeycodeDescription {
  label: string;
  title: string;
  kind: KeycodeKind;
}

export const hex4 = (n: number): string => `0x${n.toString(16).toUpperCase().padStart(4, '0')}`;

const RGB_KEYS: { code: number; name: string; label: string; title: string }[] = [
  [0x7820, 'RM_ON', 'RM On', 'Nyalakan RGB matrix'],
  [0x7821, 'RM_OFF', 'RM Off', 'Matikan RGB matrix'],
  [0x7822, 'RM_TOGG', 'RM Tog', 'Hidup/matikan RGB matrix'],
  [0x7823, 'RM_NEXT', 'RM Next', 'Efek berikutnya'],
  [0x7824, 'RM_PREV', 'RM Prev', 'Efek sebelumnya'],
  [0x7825, 'RM_HUEU', 'Hue+', 'Hue naik'],
  [0x7826, 'RM_HUED', 'Hue-', 'Hue turun'],
  [0x7827, 'RM_SATU', 'Sat+', 'Saturasi naik'],
  [0x7828, 'RM_SATD', 'Sat-', 'Saturasi turun'],
  [0x7829, 'RM_VALU', 'Val+', 'Kecerahan naik'],
  [0x782a, 'RM_VALD', 'Val-', 'Kecerahan turun'],
  [0x782b, 'RM_SPDU', 'Spd+', 'Kecepatan naik'],
  [0x782c, 'RM_SPDD', 'Spd-', 'Kecepatan turun'],
].map(([code, name, label, title]) => ({ code: code as number, name: name as string, label: label as string, title: title as string }));

const RGB_BY_CODE = new Map(RGB_KEYS.map((k) => [k.code, k]));

const MOD_LABELS: [number, string][] = [
  [0x01, 'Ctrl'],
  [0x02, 'Shift'],
  [0x04, 'Alt'],
  [0x08, 'Win'],
];

function modsLabel(bits: number): string {
  const right = (bits & 0x10) !== 0;
  const parts = MOD_LABELS.filter(([b]) => (bits & b) !== 0).map(([, l]) => (right ? `R${l}` : l));
  return parts.length ? parts.join('+') : 'none';
}

function basicLabel(code: number): string {
  return BASIC_BY_CODE.get(code)?.label ?? hex4(code);
}

const LAYER_FUNCTIONS: { base: number; name: string; title: string }[] = [
  { base: Q.TO, name: 'TO', title: 'pindah ke layer' },
  { base: Q.MOMENTARY, name: 'MO', title: 'layer sementara selama ditahan' },
  { base: Q.DEF_LAYER, name: 'DF', title: 'jadikan layer dasar' },
  { base: Q.TOGGLE_LAYER, name: 'TG', title: 'hidup/matikan layer' },
  { base: Q.ONE_SHOT_LAYER, name: 'OSL', title: 'layer untuk satu ketukan' },
  { base: Q.LAYER_TAP_TOGGLE, name: 'TT', title: 'tahan = MO, ketuk berulang = TG' },
];

export function describeKeycode(code: number, ctx: KeycodeContext): KeycodeDescription {
  if (code <= 0xff) {
    const k = BASIC_BY_CODE.get(code);
    return k
      ? { label: k.label, title: k.title, kind: 'basic' }
      : { label: hex4(code), title: `keycode dasar tidak dikenal ${hex4(code)}`, kind: 'unknown' };
  }
  if (code < Q.MOD_TAP) {
    const bits = (code >> 8) & 0x1f;
    return {
      label: `${modsLabel(bits)}+${basicLabel(code & 0xff)}`,
      title: `${modsLabel(bits)} bersama ${basicLabel(code & 0xff)}`,
      kind: 'mods',
    };
  }
  if (code < Q.LAYER_TAP) {
    const bits = (code >> 8) & 0x1f;
    return {
      label: `MT(${modsLabel(bits)},${basicLabel(code & 0xff)})`,
      title: `Ketuk = ${basicLabel(code & 0xff)}, tahan = ${modsLabel(bits)}`,
      kind: 'mod-tap',
    };
  }
  if (code < 0x5000) {
    const layer = (code >> 8) & 0x0f;
    return {
      label: `LT(${layer},${basicLabel(code & 0xff)})`,
      title: `Ketuk = ${basicLabel(code & 0xff)}, tahan = layer ${layer}`,
      kind: 'layer-tap',
    };
  }
  for (const f of LAYER_FUNCTIONS) {
    if (code >= f.base && code < f.base + 0x20) {
      const layer = code & 0x1f;
      return { label: `${f.name}(${layer})`, title: `${f.name}(${layer}): ${f.title} ${layer}`, kind: 'layer' };
    }
  }
  if (code >= Q.ONE_SHOT_MOD && code < Q.ONE_SHOT_MOD + 0x20) {
    return { label: `OSM(${modsLabel(code & 0x1f)})`, title: 'modifier untuk satu ketukan', kind: 'layer' };
  }
  if (code >= Q.MACRO && code < Q.MACRO + 0x80) {
    return { label: `M${code - Q.MACRO}`, title: `Makro ${code - Q.MACRO}`, kind: 'macro' };
  }
  const rgb = RGB_BY_CODE.get(code);
  if (rgb) return { label: rgb.label, title: `${rgb.name}: ${rgb.title}`, kind: 'rgb' };
  const ci = code - ctx.customBase;
  if (ci >= 0 && ci < ctx.customKeycodes.length) {
    const c = ctx.customKeycodes[ci] as CustomKeycode;
    return { label: c.name, title: c.title, kind: 'custom' };
  }
  return { label: hex4(code), title: `keycode tidak dikenal ${hex4(code)}`, kind: 'unknown' };
}

const KNOWN_RANGES: [number, number][] = [
  [0x0000, 0x1fff],
  [0x2000, 0x3fff],
  [0x4000, 0x4fff],
  [0x5200, 0x52ff],
  [0x5900, 0x59ff],
  [0x7700, 0x77ff],
  [0x7800, 0x78ff],
  [0x7e00, 0x7fff],
];

/** Hanya rentang yang dikenal protokol yang boleh ditulis ke perangkat. */
export function isKnownRange(code: number): boolean {
  if (!Number.isInteger(code) || code < 0 || code > 0xffff) return false;
  if (code <= 0xff && !BASIC_BY_CODE.has(code)) return false;
  return KNOWN_RANGES.some(([a, b]) => code >= a && code <= b);
}

export interface Danger {
  reason: string;
}

/** Keycode yang butuh konfirmasi eksplisit sebelum ditulis. */
export function dangerOf(code: number, ctx: KeycodeContext): Danger | null {
  if (code >= Q.BOOT_FIRST && code <= Q.BOOT_LAST) {
    return { reason: 'Keycode ini me-reset keyboard, masuk ke bootloader, atau menghapus EEPROM.' };
  }
  const ci = code - ctx.customBase;
  const custom = ci >= 0 ? ctx.customKeycodes[ci] : undefined;
  if (custom && custom.name === 'U_EE_CLR') {
    return { reason: 'Keycode ini kemungkinan menghapus pengaturan keyboard (EEPROM).' };
  }
  return null;
}

export const layerKeycode = (fn: 'TO' | 'MO' | 'DF' | 'TG' | 'OSL' | 'TT', layer: number): number => {
  const base = LAYER_FUNCTIONS.find((f) => f.name === fn)?.base ?? Q.MOMENTARY;
  return base | (layer & 0x1f);
};

export const layerTapKeycode = (layer: number, key: number): number => Q.LAYER_TAP | ((layer & 0x0f) << 8) | (key & 0xff);

export interface PaletteItem {
  code: number;
  label: string;
  title: string;
  verified: boolean;
}

export interface PaletteCategory {
  id: string;
  label: string;
  items: PaletteItem[];
}

function fromGroups(groups: BasicGroup[]): PaletteItem[] {
  return BASIC_KEYS.filter((k) => groups.includes(k.group)).map((k) => ({
    code: k.code,
    label: k.label,
    title: k.title,
    verified: true,
  }));
}

export function paletteCategories(ctx: KeycodeContext, layerCount: number): PaletteCategory[] {
  const layerItems: PaletteItem[] = fromGroups(['special']);
  for (let l = 0; l < layerCount; l += 1) {
    for (const f of LAYER_FUNCTIONS) {
      const code = f.base | l;
      layerItems.push({ code, label: `${f.name}(${l})`, title: `${f.name}(${l}): ${f.title} ${l}`, verified: true });
    }
  }
  return [
    { id: 'basic', label: 'Dasar', items: fromGroups(['letters', 'numbers', 'control', 'punct']) },
    { id: 'nav', label: 'Navigasi', items: fromGroups(['nav']) },
    { id: 'fkeys', label: 'F1-F24', items: fromGroups(['fkeys']) },
    { id: 'mods', label: 'Modifier', items: fromGroups(['mods']) },
    { id: 'keypad', label: 'Keypad', items: fromGroups(['keypad']) },
    { id: 'media', label: 'Media', items: fromGroups(['media']) },
    { id: 'layer', label: 'Layer', items: layerItems },
    {
      id: 'device',
      label: 'Gen 75',
      items: ctx.customKeycodes.map((c, i) => ({ code: ctx.customBase + i, label: c.name, title: c.title, verified: true })),
    },
    {
      id: 'light',
      label: 'Lampu',
      items: RGB_KEYS.map((k) => ({ code: k.code, label: k.label, title: `${k.name}: ${k.title}`, verified: false })),
    },
  ];
}

export type ParsedKeycode = { ok: true; code: number } | { ok: false; error: string };

const LAYER_FN = /^(MO|TG|TO|TT|DF|OSL)\(\s*(\d+)\s*\)$/i;
const LT_FN = /^LT\(\s*(\d+)\s*,\s*([^)]+?)\s*\)$/i;

/** Menerima hex (0x7E01), nama QMK (KC_A), nama keycode Gen 75 (BLE1), MO(1), TG(2), LT(1,KC_A). */
export function parseKeycodeInput(text: string, ctx: KeycodeContext, layerCount: number): ParsedKeycode {
  const t = text.trim();
  if (!t) return { ok: false, error: 'Isi keycode dulu.' };

  if (/^0x[0-9a-f]{1,4}$/i.test(t)) {
    const code = Number.parseInt(t, 16);
    return isKnownRange(code) ? { ok: true, code } : { ok: false, error: `${hex4(code)} di luar rentang yang dikenal.` };
  }

  const key = BASIC_BY_NAME.get(t.toUpperCase());
  if (key) return { ok: true, code: key.code };

  const custom = ctx.customKeycodes.findIndex((c) => c.name.toUpperCase() === t.toUpperCase());
  if (custom >= 0) return { ok: true, code: ctx.customBase + custom };

  const rgb = RGB_KEYS.find((k) => k.name === t.toUpperCase());
  if (rgb) return { ok: true, code: rgb.code };

  const lf = LAYER_FN.exec(t);
  if (lf) {
    const layer = Number(lf[2]);
    if (layer >= layerCount) return { ok: false, error: `Layer ${layer} tidak ada (jumlah layer ${layerCount}).` };
    return { ok: true, code: layerKeycode(lf[1]!.toUpperCase() as 'MO', layer) };
  }

  const lt = LT_FN.exec(t);
  if (lt) {
    const layer = Number(lt[1]);
    if (layer >= layerCount || layer > 15) return { ok: false, error: `Layer ${layer} tidak valid untuk LT().` };
    const inner = BASIC_BY_NAME.get(lt[2]!.toUpperCase());
    if (!inner) return { ok: false, error: `Tombol "${lt[2]}" tidak dikenal.` };
    return { ok: true, code: layerTapKeycode(layer, inner.code) };
  }

  return { ok: false, error: `"${t}" tidak dikenali. Pakai hex (0x7E01), nama QMK (KC_A), atau MO(1), LT(1,KC_A).` };
}
