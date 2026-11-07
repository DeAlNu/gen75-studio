import { parseBackup, sameContent } from './backup';
import type { Backup } from './backup';
import type { DeviceDefinition } from './definition/types';

/** Profil adalah backup bernama yang disimpan di browser. */
export interface Profile {
  id: string;
  name: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  backup: Backup;
}

export const PROFILE_LIMIT = 30;
export const NAME_MAX = 40;
export const NOTE_MAX = 200;
export const PROFILE_KIND = 'gen75-studio-profile';

export interface ProfileFile {
  schemaVersion: 1;
  kind: typeof PROFILE_KIND;
  name: string;
  note: string;
  backup: Backup;
}

export const cleanName = (raw: string): string => raw.replace(/\s+/g, ' ').trim();

const sameName = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Pesan galat bila nama tidak boleh dipakai, atau null bila boleh. */
export function checkProfileName(raw: string, profiles: readonly Profile[], exceptId?: string): string | null {
  const name = cleanName(raw);
  if (name.length === 0) return 'Nama profil tidak boleh kosong.';
  if (name.length > NAME_MAX) return `Nama profil paling panjang ${NAME_MAX} karakter.`;
  if (profiles.some((p) => p.id !== exceptId && sameName(p.name, name))) return `Sudah ada profil bernama "${name}".`;
  return null;
}

/** Nama yang belum dipakai: "Harian", lalu "Harian (2)", "Harian (3)", dan seterusnya. */
export function uniqueName(base: string, profiles: readonly Profile[]): string {
  const root = cleanName(base).slice(0, NAME_MAX) || 'Profil';
  if (!profiles.some((p) => sameName(p.name, root))) return root;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${root.slice(0, NAME_MAX - suffix.length)}${suffix}`;
    if (!profiles.some((p) => sameName(p.name, candidate))) return candidate;
  }
}

export function newProfileId(now: Date = new Date()): string {
  return `p-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createProfile(name: string, note: string, backup: Backup, now: Date = new Date(), id: string = newProfileId(now)): Profile {
  const stamp = now.toISOString();
  return { id, name: cleanName(name), note: note.trim().slice(0, NOTE_MAX), createdAt: stamp, updatedAt: stamp, backup };
}

export function profileToFile(p: Profile): ProfileFile {
  return { schemaVersion: 1, kind: PROFILE_KIND, name: p.name, note: p.note, backup: p.backup };
}

export type ProfileImport = { ok: true; name: string; note: string; backup: Backup } | { ok: false; error: string };

/**
 * Membaca berkas profil. Berkas backup biasa juga diterima; namanya diambil dari `fallbackName`.
 * Isi backup di dalamnya divalidasi sama ketatnya dengan saat memuat backup.
 */
export function parseProfileFile(text: string, def: DeviceDefinition, maxLayers: number, fallbackName: string): ProfileImport {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Berkas bukan JSON yang valid.' };
  }
  const fallback = cleanName(fallbackName).slice(0, NAME_MAX) || 'Profil impor';
  const obj = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;

  if (obj && obj.kind === PROFILE_KIND) {
    if (obj.schemaVersion !== 1) return { ok: false, error: 'Versi berkas profil tidak dikenal.' };
    const parsed = parseBackup(JSON.stringify(obj.backup ?? null), def, maxLayers);
    if (!parsed.ok) return parsed;
    const name = typeof obj.name === 'string' ? cleanName(obj.name).slice(0, NAME_MAX) : '';
    const note = typeof obj.note === 'string' ? obj.note.trim().slice(0, NOTE_MAX) : '';
    return { ok: true, name: name || fallback, note, backup: parsed.backup };
  }

  const parsed = parseBackup(text, def, maxLayers);
  if (!parsed.ok) return parsed;
  return { ok: true, name: fallback, note: '', backup: parsed.backup };
}

/** Profil yang isinya persis sama dengan keadaan sekarang, bila ada. */
export function matchingProfile(profiles: readonly Profile[], current: Backup): Profile | undefined {
  return profiles.find((p) => sameContent(p.backup, current));
}

/** Ringkasan bagian yang dimuat sebuah profil, untuk daftar. */
export function profileParts(b: Backup): string {
  const parts = [`${b.keymap.layers.length} layer`];
  if (b.encoders) parts.push('knob');
  if (b.macros) parts.push('makro');
  if (b.lighting) parts.push('lighting');
  return parts.join(', ');
}
