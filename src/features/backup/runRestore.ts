import { askConfirm } from '../../app/confirm';
import { appStore } from '../../state/app';
import { ALL_PARTS } from '../../state/store';
import type { RestoreParts } from '../../state/store';

export interface RestoreOptions {
  parts?: RestoreParts;
  title?: string;
  confirmLabel?: string;
}

export interface RestoreOutcome {
  text: string;
  bad: boolean;
  /** true bila perubahan benar-benar ditulis ke keyboard. */
  applied: boolean;
}

const PART_NAMES: [keyof RestoreParts, string][] = [
  ['keymap', 'keymap'],
  ['encoders', 'knob'],
  ['macros', 'makro'],
  ['lighting', 'lighting'],
];

/**
 * Alur pemulihan yang dipakai backup, snapshot, dan profil: periksa isi, tampilkan ringkasan perubahan,
 * minta konfirmasi, lalu tulis dan verifikasi.
 */
export async function runRestore(text: string, opts: RestoreOptions = {}): Promise<RestoreOutcome> {
  const parts = opts.parts ?? ALL_PARTS;
  const prep = appStore.getState().prepareRestore(text, parts);
  if (!prep.ok) return { text: prep.error, bad: true, applied: false };

  const nothing = prep.keyChanges.length === 0 && prep.encoderChanges.length === 0 && prep.lightingChanges.length === 0 && prep.macroTarget === null;
  if (nothing) {
    const skipped = prep.skipped.length ? ` ${prep.skipped.join(' ')}` : '';
    return { text: `Isi yang dipilih sama dengan keadaan keyboard saat ini. Tidak ada yang perlu ditulis.${skipped}`, bad: false, applied: false };
  }

  const summary: string[] = [];
  if (prep.keyChanges.length) summary.push(`${prep.keyChanges.length} keycode akan diubah`);
  if (prep.encoderChanges.length) summary.push(`${prep.encoderChanges.length} putaran knob akan diubah`);
  if (prep.macroTarget) summary.push('isi makro akan diganti');
  if (prep.lightingChanges.length) summary.push(`${prep.lightingChanges.length} nilai lighting akan diubah`);
  let message = `${summary.join(', ')}${prep.layers.length ? ` (layer ${prep.layers.join(', ')})` : ''}. Keadaan saat ini disimpan dulu sebagai snapshot.`;
  const chosen = PART_NAMES.filter(([k]) => parts[k]).map(([, n]) => n);
  if (chosen.length < PART_NAMES.length) message += ` Hanya bagian ${chosen.join(', ')} yang diterapkan.`;
  if (prep.skipped.length) message += ` ${prep.skipped.join(' ')}`;
  if (prep.dangerous > 0) message += ` Peringatan: ${prep.dangerous} keycode berisiko (reset atau hapus pengaturan) ikut diterapkan.`;

  const ok = await askConfirm({
    title: opts.title ?? 'Pulihkan backup?',
    message,
    confirmLabel: opts.confirmLabel ?? 'Pulihkan',
    danger: prep.dangerous > 0,
  });
  if (!ok) return { text: 'Dibatalkan. Keyboard tidak diubah.', bad: false, applied: false };

  const res = await appStore.getState().applyRestore(prep, { confirmedDanger: prep.dangerous > 0 });
  if (!res.ok) return { text: `Gagal menulis ke keyboard: ${res.message}`, bad: true, applied: false };
  if (res.mismatches > 0) {
    return { text: `Selesai, tetapi ${res.mismatches} posisi tidak cocok setelah dibaca ulang. Periksa keymap.`, bad: true, applied: true };
  }
  return { text: `Selesai: ${res.applied} perubahan ditulis dan terverifikasi.`, bad: false, applied: true };
}
