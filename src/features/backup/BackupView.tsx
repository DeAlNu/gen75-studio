import { useRef, useState } from 'react';
import { downloadJson, fileStamp } from '../../app/download';
import type { SnapshotReason } from '../../core/storage/snapshots';
import { appStore, useApp } from '../../state/app';
import { runRestore } from './runRestore';

const REASON: Record<SnapshotReason, string> = {
  connect: 'Saat tersambung',
  manual: 'Manual',
  'before-restore': 'Sebelum pemulihan',
};

const MAX_FILE = 1024 * 1024;

export function BackupView() {
  const snapshots = useApp((s) => s.snapshots);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const download = (): void => {
    const backup = appStore.getState().exportBackup();
    if (!backup) return;
    downloadJson(`gen75-backup-${fileStamp(new Date())}.json`, backup);
    setMessage({ text: 'Backup diunduh.', bad: false });
  };

  const restore = async (text: string): Promise<void> => {
    setMessage(null);
    const out = await runRestore(text);
    setMessage({ text: out.applied ? `Pemulihan: ${out.text}` : out.text, bad: out.bad });
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
