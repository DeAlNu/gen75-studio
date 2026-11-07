export type BasicGroup =
  | 'letters'
  | 'numbers'
  | 'control'
  | 'punct'
  | 'nav'
  | 'fkeys'
  | 'keypad'
  | 'mods'
  | 'media'
  | 'special';

export interface BasicKey {
  code: number;
  name: string;
  label: string;
  title: string;
  group: BasicGroup;
}

export const BASIC_KEYS: BasicKey[] = [];

function add(code: number, name: string, label: string, group: BasicGroup, title: string = name): void {
  BASIC_KEYS.push({ code, name, label, title, group });
}

add(0x00, 'KC_NO', 'NO', 'special', 'Kosong: tombol tidak melakukan apa-apa');
add(0x01, 'KC_TRNS', '▽', 'special', 'Transparan: memakai tombol layer di bawahnya');

'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l, i) => add(0x04 + i, `KC_${l}`, l, 'letters'));
'1234567890'.split('').forEach((d, i) => add(0x1e + i, `KC_${d}`, d, 'numbers'));

add(0x28, 'KC_ENT', 'Enter', 'control');
add(0x29, 'KC_ESC', 'Esc', 'control');
add(0x2a, 'KC_BSPC', 'Bksp', 'control', 'KC_BSPC (Backspace)');
add(0x2b, 'KC_TAB', 'Tab', 'control');
add(0x2c, 'KC_SPC', 'Space', 'control');
add(0x39, 'KC_CAPS', 'Caps', 'control', 'KC_CAPS (Caps Lock)');

add(0x2d, 'KC_MINS', '-', 'punct');
add(0x2e, 'KC_EQL', '=', 'punct');
add(0x2f, 'KC_LBRC', '[', 'punct');
add(0x30, 'KC_RBRC', ']', 'punct');
add(0x31, 'KC_BSLS', '\\', 'punct');
add(0x32, 'KC_NUHS', '#~', 'punct', 'KC_NUHS (tanda pagar, layout non-US)');
add(0x33, 'KC_SCLN', ';', 'punct');
add(0x34, 'KC_QUOT', "'", 'punct');
add(0x35, 'KC_GRV', '`', 'punct');
add(0x36, 'KC_COMM', ',', 'punct');
add(0x37, 'KC_DOT', '.', 'punct');
add(0x38, 'KC_SLSH', '/', 'punct');

for (let i = 0; i < 12; i += 1) add(0x3a + i, `KC_F${i + 1}`, `F${i + 1}`, 'fkeys');
for (let i = 0; i < 12; i += 1) add(0x68 + i, `KC_F${i + 13}`, `F${i + 13}`, 'fkeys');

add(0x46, 'KC_PSCR', 'PrtSc', 'nav', 'KC_PSCR (Print Screen)');
add(0x47, 'KC_SCRL', 'ScrLk', 'nav', 'KC_SCRL (Scroll Lock)');
add(0x48, 'KC_PAUS', 'Pause', 'nav');
add(0x49, 'KC_INS', 'Ins', 'nav', 'KC_INS (Insert)');
add(0x4a, 'KC_HOME', 'Home', 'nav');
add(0x4b, 'KC_PGUP', 'PgUp', 'nav');
add(0x4c, 'KC_DEL', 'Del', 'nav', 'KC_DEL (Delete)');
add(0x4d, 'KC_END', 'End', 'nav');
add(0x4e, 'KC_PGDN', 'PgDn', 'nav');
add(0x4f, 'KC_RGHT', '→', 'nav', 'KC_RGHT (panah kanan)');
add(0x50, 'KC_LEFT', '←', 'nav', 'KC_LEFT (panah kiri)');
add(0x51, 'KC_DOWN', '↓', 'nav', 'KC_DOWN (panah bawah)');
add(0x52, 'KC_UP', '↑', 'nav', 'KC_UP (panah atas)');
add(0x65, 'KC_APP', 'Menu', 'nav', 'KC_APP (tombol menu konteks)');

add(0x53, 'KC_NUM', 'Num', 'keypad', 'KC_NUM (Num Lock)');
add(0x54, 'KC_PSLS', 'KP /', 'keypad');
add(0x55, 'KC_PAST', 'KP *', 'keypad');
add(0x56, 'KC_PMNS', 'KP -', 'keypad');
add(0x57, 'KC_PPLS', 'KP +', 'keypad');
add(0x58, 'KC_PENT', 'KP Ent', 'keypad');
for (let i = 1; i <= 9; i += 1) add(0x58 + i, `KC_P${i}`, `KP ${i}`, 'keypad');
add(0x62, 'KC_P0', 'KP 0', 'keypad');
add(0x63, 'KC_PDOT', 'KP .', 'keypad');

add(0xe0, 'KC_LCTL', 'Ctrl', 'mods', 'KC_LCTL (Ctrl kiri)');
add(0xe1, 'KC_LSFT', 'Shift', 'mods', 'KC_LSFT (Shift kiri)');
add(0xe2, 'KC_LALT', 'Alt', 'mods', 'KC_LALT (Alt kiri)');
add(0xe3, 'KC_LGUI', 'Win', 'mods', 'KC_LGUI (Windows kiri)');
add(0xe4, 'KC_RCTL', 'RCtrl', 'mods', 'KC_RCTL (Ctrl kanan)');
add(0xe5, 'KC_RSFT', 'RShift', 'mods', 'KC_RSFT (Shift kanan)');
add(0xe6, 'KC_RALT', 'RAlt', 'mods', 'KC_RALT (Alt kanan)');
add(0xe7, 'KC_RGUI', 'RWin', 'mods', 'KC_RGUI (Windows kanan)');

add(0xa8, 'KC_MUTE', 'Mute', 'media');
add(0xa9, 'KC_VOLU', 'Vol+', 'media', 'KC_VOLU (volume naik)');
add(0xaa, 'KC_VOLD', 'Vol-', 'media', 'KC_VOLD (volume turun)');
add(0xab, 'KC_MNXT', 'Next', 'media', 'KC_MNXT (lagu berikutnya)');
add(0xac, 'KC_MPRV', 'Prev', 'media', 'KC_MPRV (lagu sebelumnya)');
add(0xaf, 'KC_MSTP', 'Stop', 'media', 'KC_MSTP (berhenti)');
add(0xb0, 'KC_MPLY', 'Play', 'media', 'KC_MPLY (putar/jeda)');
add(0xb3, 'KC_MAIL', 'Mail', 'media');
add(0xb4, 'KC_CALC', 'Calc', 'media', 'KC_CALC (kalkulator)');
add(0xb5, 'KC_MYCM', 'My PC', 'media', 'KC_MYCM (My Computer)');
add(0xbd, 'KC_BRIU', 'Bri+', 'media', 'KC_BRIU (kecerahan layar naik)');
add(0xbe, 'KC_BRID', 'Bri-', 'media', 'KC_BRID (kecerahan layar turun)');

export const BASIC_BY_CODE = new Map<number, BasicKey>(BASIC_KEYS.map((k) => [k.code, k]));
export const BASIC_BY_NAME = new Map<string, BasicKey>(BASIC_KEYS.map((k) => [k.name, k]));
