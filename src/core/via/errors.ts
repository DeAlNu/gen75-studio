const cmdName = (cmd: number): string => `0x${cmd.toString(16).padStart(2, '0')}`;

export class ViaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ViaTimeout extends ViaError {
  constructor(readonly cmd: number) {
    super(`perangkat tidak merespons perintah ${cmdName(cmd)}`);
  }
}

export class ViaUnhandled extends ViaError {
  constructor(readonly cmd: number) {
    super(`firmware tidak mengenal perintah ${cmdName(cmd)}`);
  }
}

export class ViaBlocked extends ViaError {
  constructor(readonly cmd: number) {
    super(`perintah ${cmdName(cmd)} diblokir oleh aplikasi`);
  }
}

export class ViaReadOnly extends ViaError {
  constructor(readonly cmd: number) {
    super(`mode baca saja: perintah tulis ${cmdName(cmd)} ditolak`);
  }
}

export class ViaVerify extends ViaError {
  constructor(message: string) {
    super(message);
  }
}

export class ViaDisconnected extends ViaError {
  constructor(detail: string) {
    super(`perangkat terputus: ${detail}`);
  }
}
