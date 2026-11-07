import { useRef, useState } from 'react';
import { askConfirm } from '../../app/confirm';
import type { SnapshotReason } from '../../core/storage/snapshots';
import { appStore, useApp } from '../../state/app';

const REASON: Record<SnapshotReason, string> = {
  connect: 'Saat tersambung',
  manual: 'Manual',
  'before-restore': 'Sebelum pemulihan',
};

const MAX_FILE = 1024 * 1024;

const stamp = (d: Date): string =>
  `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

export function BackupView() {
  const snapshots = useApp((s) => s.snapshots);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = (): void => {
    const backup = appStore.getState().exportBackup();
    if (!backup) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
    a.download = `gen75-backup-${stamp(new Date())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMessage({ text: 'Backup diunduh.', bad: false });
  };

  const restore = async (text: string): Promise<void> => {
    setMessage(null);
    const prep = appStore.getState().prepareRestore(text);
    if (!prep.ok) {
      setMessage({ text: prep.error, bad: true });
      return;
    }
    const nothing = prep.keyChanges.length === 0 && prep.encoderChanges.length === 0 && prep.lightingChanges.length === 0 && prep.macroTarget === null;
    if (nothing) {
      const skipped = prep.skipped.length ? ` ${prep.skipped.join(' ')}` : '';
      setMessage({ text: `Isi backup sama dengan keadaan keyboard saat ini. Tidak ada yang perlu dipulihkan.${skipped}`, bad: false });
      return;
    }
    const parts: string[] = [];
    if (prep.keyChanges.length) parts.push(`${prep.keyChanges.length} keycode akan diubah`);
    if (prep.encoderChanges.length) parts.push(`${prep.encoderChanges.length} putaran knob akan diubah`);
    if (prep.macroTarget) parts.push('isi makro akan diganti');
    if (prep.lightingChanges.length) parts.push(`${prep.lightingChanges.length} nilai lighting akan diubah`);
    let text2 = `${parts.join(', ')}${prep.layers.length ? ` (layer ${prep.layers.join(', ')})` : ''}. Keadaan saat ini disimpan dulu sebagai snapshot.`;
    if (prep.skipped.length) text2 += ` ${prep.skipped.join(' ')}`;
    if (prep.dangerous > 0) text2 += ` Peringatan: ${prep.dangerous} keycode berisiko (reset atau hapus pengaturan) ikut dipulihkan.`;
    const ok = await askConfirm({ title: 'Pulihkan backup?', message: text2, confirmLabel: 'Pulihkan', danger: prep.dangerous > 0 });
    if (!ok) return;
    const res = await appStore.getState().applyRestore(prep, { confirmedDanger: prep.dangerous > 0 });
    if (res.ok) {
      setMessage({
        text:
          res.mismatches === 0
            ? `Pemulihan selesai: ${res.applied} perubahan ditulis dan terverifikasi.`
            : `Pemulihan selesai, tetapi ${res.mismatches} posisi tidak cocok setelah dibaca ulang. Periksa keymap.`,
        bad: res.mismatches > 0,
      });
    } else {
      setMessage({ text: `Pemulihan gagal: ${res.message}`, bad: true });
    }
  };

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    if (file.size > MAX_FILE) {
      setMessage({ text: 'Berkas terlalu besar untuk sebuah backup.', bad: true });
      return;
    }
    await restore(await file.text());
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <section>
      <h2>Backup</h2>
      <p className="hint">
        Backup adalah berkas JSON berisi keymap semua layer, putaran knob, makro, dan nilai lighting. Memuat backup menolak berkas yang tidak
        cocok dengan perangkat (VID/PID, ukuran matriks, atau jumlah slot makro).
      </p>

      <div className="card">
        <div className="row">
          <button type="button" className="btn primary" onClick={download}>
            Unduh backup
          </button>
          <button type="button" className="btn" disabled={!writable || busy} onClick={() => fileRef.current?.click()}>
            Muat backup...
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void onFile(e.target.files?.[0])} />
          <button type="button" className="btn" onClick={() => void appStore.getState().takeSnapshot('manual')}>
            Simpan snapshot sekarang
          </button>
        </div>
        {message && (
          <div className={`notice${message.bad ? ' bad' : ''}`} role="status">
            {message.text}
          </div>
        )}
      </div>

      <div className="card">
        <h3>Snapshot di browser ini</h3>
        {snapshots.length === 0 ? (
          <p className="fine">Belum ada snapshot.</p>
        ) : (
          <ul className="snaps">
            {snapshots.map((s) => (
              <li key={s.id}>
                <span>
                  {new Date(s.takenAt).toLocaleString('id-ID')} <span className="tag">{REASON[s.reason]}</span>
                </span>
                <span className="row">
                  <button type="button" className="btn" disabled={!writable || busy} onClick={() => void restore(JSON.stringify(s.backup))}>
                    Pulihkan
                  </button>
                  <button type="button" className="btn" onClick={() => void appStore.getState().deleteSnapshot(s.id)}>
                    Hapus
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="fine">Snapshot terbaru 10 buah disimpan. Data hanya ada di browser ini, tidak dikirim ke mana pun.</p>
      </div>
    </section>
  );
}
