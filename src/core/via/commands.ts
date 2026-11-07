export const Cmd = {
  ProtocolVersion: 0x01,
  GetKeyboardValue: 0x02,
  SetKeyboardValue: 0x03,
  GetKeycode: 0x04,
  SetKeycode: 0x05,
  KeymapReset: 0x06,
  CustomSet: 0x07,
  CustomGet: 0x08,
  CustomSave: 0x09,
  EepromReset: 0x0a,
  BootloaderJump: 0x0b,
  MacroCount: 0x0c,
  MacroBufferSize: 0x0d,
  MacroGetBuffer: 0x0e,
  MacroSetBuffer: 0x0f,
  MacroReset: 0x10,
  LayerCount: 0x11,
  GetBuffer: 0x12,
  SetBuffer: 0x13,
  GetEncoder: 0x14,
  SetEncoder: 0x15,
  Unhandled: 0xff,
} as const;

export const Channel = {
  Custom: 0,
  Backlight: 1,
  RgbLight: 2,
  RgbMatrix: 3,
  Audio: 4,
  LedMatrix: 5,
} as const;

/** Perintah baca yang boleh dikirim. */
export const READ_COMMANDS: ReadonlySet<number> = new Set([
  Cmd.ProtocolVersion,
  Cmd.GetKeyboardValue,
  Cmd.GetKeycode,
  Cmd.CustomGet,
  Cmd.MacroCount,
  Cmd.MacroBufferSize,
  Cmd.MacroGetBuffer,
  Cmd.LayerCount,
  Cmd.GetBuffer,
  Cmd.GetEncoder,
]);

/**
 * Perintah tulis yang diizinkan di Fase 1: satu keycode, nilai lighting, dan
 * simpan lighting. Reset, bootloader, dan tulis buffer massal sengaja tidak ada.
 */
export const WRITE_COMMANDS: ReadonlySet<number> = new Set([Cmd.SetKeycode, Cmd.CustomSet, Cmd.CustomSave]);

export const ALLOWED_COMMANDS: ReadonlySet<number> = new Set([...READ_COMMANDS, ...WRITE_COMMANDS]);
