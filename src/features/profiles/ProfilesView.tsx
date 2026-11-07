import { useMemo, useRef, useState } from 'react';
import { askConfirm } from '../../app/confirm';
import { downloadJson, slug } from '../../app/download';
import { useUi } from '../../app/useUi';
import { matchingProfile, NAME_MAX, NOTE_MAX, PROFILE_LIMIT, profileParts } from '../../core/profiles';
import type { Profile } from '../../core/profiles';
import { appStore, useApp } from '../../state/app';
import { ALL_PARTS } from '../../state/store';
import type { RestoreParts } from '../../state/store';
import { runRestore } from '../backup/runRestore';

const MAX_FILE = 1024 * 1024;

const PART_LABELS: [keyof RestoreParts, string][] = [
  ['keymap', 'Keymap'],
  ['encoders', 'Knob'],
  ['macros', 'Makro'],
  ['lighting', 'Lighting'],
];

interface Message {
  text: string;
  bad: boolean;
}

const when = (iso: string): string => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export function ProfilesView() {
  const profiles = useApp((s) => s.profiles);
  const lastProfileId = useApp((s) => s.lastProfileId);
  const status = useApp((s) => s.status);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const keymap = useApp((s) => s.keymap);
  const lighting = useApp((s) => s.lighting);
  const macroBuffer = useApp((s) => s.macroBuffer);
  const encoders = useApp((s) => s.encoders);
  const ready = status === 'ready';

  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [parts, setParts] = useState<RestoreParts>(ALL_PARTS);
  const [message, setMessage] = useState<Message | null>(null);
  const [editing, setEditing] = useState<{ id: string; name: string; note: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const current = useMemo(() => (ready ? appStore.getState().exportBackup() : null), [ready, keymap, lighting, macroBuffer, encoders]);
  const active = current ? matchingProfile(profiles, current) : undefined;
  const noPart = !Object.values(parts).some(Boolean);
  const full = profiles.length >= PROFILE_LIMIT;

  const save = async (): Promise<void> => {
    setMessage(null);
    const res = await appStore.getState().saveProfile(name, note);
    if (res.ok) {
      setName('');
      setNote('');
      setMessage({ text: `Profil "${res.profile.name}" disimpan.`, bad: false });
    } else {
      setMessage({ text: res.message, bad: true });
    }
  };

  const apply = async (p: Profile): Promise<void> => {
    setMessage(null);
    const out = await runRestore(JSON.stringify(p.backup), { parts, title: `Terapkan profil "${p.name}"?`, confirmLabel: 'Terapkan' });
    if (out.applied) appStore.getState().setLastProfile(p.id);
    setMessage({ text: out.applied ? `Profil "${p.name}": ${out.text}` : out.text, bad: out.bad });
  };

  const overwrite = async (p: Profile): Promise<void> => {
    const ok = await askConfirm({
      title: `Perbarui profil "${p.name}"?`,
      message: 'Isi profil diganti dengan keadaan keyboard sekarang (keymap, knob, makro, lighting). Isi lama tidak bisa dikembalikan.',
      confirmLabel: 'Perbarui',
      danger: true,
    });
    if (!ok) return;
    const res = await appStore.getState().overwriteProfile(p.id);
    setMessage(res.ok ? { text: `Profil "${p.name}" diperbarui dari keyboard.`, bad: false } : { text: res.message, bad: true });
  };

  const remove = async (p: Profile): Promise<void> => {
    const ok = await askConfirm({ title: `Hapus profil "${p.name}"?`, message: 'Profil dihapus dari browser ini dan tidak bisa dikembalikan. Keyboard tidak berubah.', confirmLabel: 'Hapus', danger: true });
    if (!ok) return;
    await appStore.getState().deleteProfile(p.id);
    setMessage({ text: `Profil "${p.name}" dihapus.`, bad: false });
  };

  const exportOne = (p: Profile): void => {
    const file = appStore.getState().exportProfile(p.id);
    if (!file) return;
    downloadJson(`gen75-profil-${slug(p.name)}.json`, file);
    setMessage({ text: `Profil "${p.name}" diunduh.`, bad: false });
  };

  const saveEdit = async (): Promise<void> => {
    if (!editing) return;
    const res = await appStore.getState().editProfile(editing.id, editing.name, editing.note);
    if (res.ok) {
      setEditing(null);
      setMessage({ text: 'Profil diperbarui.', bad: false });
    } else {
      setMessage({ text: res.message, bad: true });
    }
  };

  const compare = (p: Profile): void => {
    useUi.getState().setCompare(ready ? 'device' : '', `profile:${p.id}`);
    useUi.getState().setTab('compare');
  };

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return;
    const results: string[] = [];
    let bad = false;
    for (const file of Array.from(files)) {
      if (file.size > MAX_FILE) {
        results.push(`${file.name}: berkas terlalu besar.`);
        bad = true;
        continue;
      }
      const res = await appStore.getState().importProfile(await file.text(), file.name.replace(/\.json$/i, ''));
      results.push(res.ok ? `${file.name}: masuk sebagai "${res.profile.name}".` : `${file.name}: ${res.message}`);
      if (!res.ok) bad = true;
    }
    setMessage({ text: results.join(' '), bad });
    if (fileRef.current) fileRef.current.value = '';
  };

  return (
    <section>
      <h2>Profil</h2>
      <p className="hint">
        Profil adalah backup bernama yang disimpan di browser ini: keymap semua layer, putaran knob, makro, dan lighting. Menerapkan profil menulis ke
        keyboard setelah ringkasan perubahan, dan keadaan sebelumnya disimpan dulu sebagai snapshot.
      </p>

      <div className="card">
        <h3>Simpan keadaan sekarang</h3>
        <div className="row">
          <input
            className="input"
            aria-label="Nama profil"
            placeholder="Nama, mis. Harian"
            maxLength={NAME_MAX}
            value={name}
            disabled={!ready || full}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <input
            className="input grow"
            aria-label="Catatan profil"
            placeholder="Catatan (boleh kosong)"
            maxLength={NOTE_MAX}
            value={note}
            disabled={!ready || full}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save();
            }}
          />
          <button type="button" className="btn primary" disabled={!ready || full || name.trim() === ''} onClick={() => void save()}>
            Simpan profil
          </button>
        </div>
        <div className="row">
          <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={full}>
            Impor profil...
          </button>
          <input ref={fileRef} type="file" accept="application/json,.json" multiple hidden onChange={(e) => void onFiles(e.target.files)} />
          <span className="fine">
            {ready ? 'Impor menerima berkas profil dan berkas backup biasa. Impor hanya menyimpan, tidak menulis ke keyboard.' : 'Sambungkan keyboard untuk menyimpan keadaan sekarang. Impor dan perbandingan tetap bisa dipakai.'}
          </span>
        </div>
        {full && <div className="notice">Batas {PROFILE_LIMIT} profil tercapai. Hapus salah satu untuk menambah.</div>}
        {message && (
          <div className={`notice${message.bad ? ' bad' : ''}`} role="status">
            {message.text}
          </div>
        )}
      </div>

      <div className="card">
        <h3>
          Profil tersimpan <span className="tag">{profiles.length}</span>
        </h3>
        <div className="row" role="group" aria-label="Bagian yang diterapkan">
          <span className="fine">Bagian yang diterapkan:</span>
          {PART_LABELS.map(([key, label]) => (
            <label key={key} className="chk">
              <input type="checkbox" checked={parts[key]} onChange={(e) => setParts({ ...parts, [key]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>

        {profiles.length === 0 ? (
          <p className="fine">Belum ada profil. Simpan keadaan keyboard sekarang atau impor berkas.</p>
        ) : (
          <ul className="plist">
            {profiles.map((p) => {
              const isActive = active?.id === p.id;
              const edited = !active && lastProfileId === p.id;
              const isEditing = editing?.id === p.id;
              return (
                <li key={p.id} className={isActive ? 'on' : ''}>
                  {isEditing ? (
                    <div className="row">
                      <input
                        className="input"
                        aria-label="Nama baru"
                        maxLength={NAME_MAX}
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      />
                      <input
                        className="input grow"
                        aria-label="Catatan baru"
                        maxLength={NOTE_MAX}
                        value={editing.note}
                        onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                      />
                      <button type="button" className="btn primary" onClick={() => void saveEdit()}>
                        Simpan
                      </button>
                      <button type="button" className="btn" onClick={() => setEditing(null)}>
                        Batal
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="phead">
                        <strong>{p.name}</strong>
                        {isActive && <span className="tag ok">sama dengan keyboard</span>}
                        {edited && <span className="tag">diterapkan, lalu diubah</span>}
                        <span className="fine">{profileParts(p.backup)}</span>
                      </div>
                      {p.note && <div className="pnote">{p.note}</div>}
                      <div className="fine">
                        Dibuat {when(p.createdAt)}
                        {p.updatedAt !== p.createdAt ? `, diperbarui ${when(p.updatedAt)}` : ''}
                      </div>
                      <div className="row pbtns">
                        <button type="button" className="btn primary" disabled={!ready || !writable || busy || noPart || isActive} onClick={() => void apply(p)}>
                          Terapkan
                        </button>
                        <button type="button" className="btn" onClick={() => compare(p)}>
                          Bandingkan
                        </button>
                        <button type="button" className="btn" disabled={!ready || busy} onClick={() => void overwrite(p)}>
                          Perbarui dari keyboard
                        </button>
                        <button type="button" className="btn" onClick={() => exportOne(p)}>
                          Ekspor
                        </button>
                        <button type="button" className="btn" onClick={() => setEditing({ id: p.id, name: p.name, note: p.note })}>
                          Ubah nama
                        </button>
                        <button type="button" className="btn danger-outline" onClick={() => void remove(p)}>
                          Hapus
                        </button>
                      </div>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        <p className="fine">Data profil hanya ada di browser ini. Ekspor berkasnya bila ingin memindahkan atau membagikan.</p>
      </div>
    </section>
  );
}
