/**
 * Pemetaan KeyboardEvent.code ke keycode HID dasar (sama dengan keycode QMK 0x00-0xFF).
 * Dipakai perekam makro dan tester cadangan yang membaca event browser.
 */

const entries: [string, number][] = [];

'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').forEach((l, i) => entries.push([`Key${l}`, 0x04 + i]));
'1234567890'.split('').forEach((d, i) => entries.push([`Digit${d}`, 0x1e + i]));

entries.push(
  ['Enter', 0x28],
  ['Escape', 0x29],
  ['Backspace', 0x2a],
  ['Tab', 0x2b],
  ['Space', 0x2c],
  ['Minus', 0x2d],
  ['Equal', 0x2e],
  ['BracketLeft', 0x2f],
  ['BracketRight', 0x30],
  ['Backslash', 0x31],
  ['Semicolon', 0x33],
  ['Quote', 0x34],
  ['Backquote', 0x35],
  ['Comma', 0x36],
  ['Period', 0x37],
  ['Slash', 0x38],
  ['CapsLock', 0x39],
);
for (let i = 0; i < 12; i += 1) entries.push([`F${i + 1}`, 0x3a + i]);
for (let i = 0; i < 12; i += 1) entries.push([`F${i + 13}`, 0x68 + i]);
entries.push(
  ['PrintScreen', 0x46],
  ['ScrollLock', 0x47],
  ['Pause', 0x48],
  ['Insert', 0x49],
  ['Home', 0x4a],
  ['PageUp', 0x4b],
  ['Delete', 0x4c],
  ['End', 0x4d],
  ['PageDown', 0x4e],
  ['ArrowRight', 0x4f],
  ['ArrowLeft', 0x50],
  ['ArrowDown', 0x51],
  ['ArrowUp', 0x52],
  ['NumLock', 0x53],
  ['NumpadDivide', 0x54],
  ['NumpadMultiply', 0x55],
  ['NumpadSubtract', 0x56],
  ['NumpadAdd', 0x57],
  ['NumpadEnter', 0x58],
);
for (let i = 1; i <= 9; i += 1) entries.push([`Numpad${i}`, 0x58 + i]);
entries.push(
  ['Numpad0', 0x62],
  ['NumpadDecimal', 0x63],
  ['ContextMenu', 0x65],
  ['ControlLeft', 0xe0],
  ['ShiftLeft', 0xe1],
  ['AltLeft', 0xe2],
  ['MetaLeft', 0xe3],
  ['ControlRight', 0xe4],
  ['ShiftRight', 0xe5],
  ['AltRight', 0xe6],
  ['MetaRight', 0xe7],
);

export const HID_BY_EVENT_CODE: ReadonlyMap<string, number> = new Map(entries);

export function hidFromEventCode(code: string): number | null {
  return HID_BY_EVENT_CODE.get(code) ?? null;
}
