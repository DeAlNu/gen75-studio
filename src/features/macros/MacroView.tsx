import { useEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from '../../app/confirm';
import { useUi } from '../../app/useUi';
import { hidFromEventCode } from '../../core/hid-codes';
import { BASIC_KEYS } from '../../core/keycodes/basic';
import { macroUsage, MacroRecorder, parseMacroBuffer, validateEntry } from '../../core/macros';
import type { MacroAction, MacroEntry } from '../../core/macros';
import { appStore, useApp } from '../../state/app';

const KEY_OPTIONS = BASIC_KEYS.filter((k) => k.code >= 2);

const KIND_LABEL: Record<MacroAction['kind'], string> = {
  tap: 'Ketuk',
  down: 'Tahan',
  up: 'Lepas',
  delay: 'Jeda',
  text: 'Teks',
};

function defaultAction(kind: MacroAction['kind']): MacroAction {
  if (kind === 'delay') return { kind, ms: 100 };
  if (kind === 'text') return { kind, text: '' };
  return { kind, keycode: 0x04 };
}

function convert(a: MacroAction, kind: MacroAction['kind']): MacroAction {
  if (kind === 'tap' || kind === 'down' || kind === 'up') return { kind, keycode: 'keycode' in a ? a.keycode : 0x04 };
  return defaultAction(kind);
}

export function MacroView() {
  const buffer = useApp((s) => s.macroBuffer);
  const count = useApp((s) => s.macroCount);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const drafts = useUi((s) => s.macroDrafts);
  const [current, setCurrent] = useState(0);
  const [recording, setRecording] = useState(false);
  const [withDelays, setWithDelays] = useState(true);
  const [recorded, setRecorded] = useState(0);
  const [message, setMessage] = useState<{ text: string; bad: boolean } | null>(null);
  const recorder = useRef<MacroRecorder | null>(null);
  const stopRef = useRef<() => void>(() => undefined);

  const device = useMemo(() => (buffer ? parseMacroBuffer(buffer, count) : []), [buffer, count]);
  const effective = useMemo(() => device.map((e, i) => drafts[i] ?? e), [device, drafts]);
  const size = buffer?.length ?? 0;
  const usage = useMemo(() => macroUsage(effective, size), [effective, size]);
  const errors = useMemo(() => effective.map(validateEntry), [effective]);
  const dirty = Object.keys(drafts).length;
  const entry: MacroEntry | undefined = effective[current];
  const canSave = writable && !busy && dirty > 0 && usage.fits && errors.every((e) => e === null);

  const setDraft = (e: MacroEntry): void => useUi.getState().setMacroDraft(current, e);
  const actionsOf = (): MacroAction[] => (entry?.kind === 'actions' ? entry.actions : []);
  const edit = (actions: MacroAction[]): void => setDraft({ kind: 'actions', actions });

  stopRef.current = (): void => {
    const rec = recorder.current;
    recorder.current = null;
    setRecording(false);
    if (!rec) return;
    const actions = rec.finish(performance.now(), { delays: withDelays });
    if (actions.length === 0) {
      setMessage({ text: 'Tidak ada tombol yang terekam.', bad: false });
      return;
    }
    edit([...actionsOf(), ...actions]);
    setMessage({ text: `${actions.length} aksi ditambahkan ke makro M${current}. Periksa lalu simpan ke keyboard.`, bad: false });
  };

  useEffect(() => {
    if (!recording) return;
    const down = (e: KeyboardEvent): void => {
      const kc = hidFromEventCode(e.code);
      if (kc === null) return;
      e.preventDefault();
      recorder.current?.down(kc, performance.now());
      setRecorded(recorder.current?.size ?? 0);
    };
    const up = (e: KeyboardEvent): void => {
      const kc = hidFromEventCode(e.code);
      if (kc === null) return;
      e.preventDefault();
      recorder.current?.up(kc, performance.now());
      setRecorded(recorder.current?.size ?? 0);
    };
    const blur = (): void => stopRef.current();
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up, true);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up, true);
      window.removeEventListener('blur', blur);
    };
  }, [recording]);

  const startRecording = (): void => {
    if (entry?.kind !== 'actions') {
      setMessage({ text: 'Makro ini berisi format yang tidak dikenal. Kosongkan dulu sebelum merekam.', bad: true });
      return;
    }
    recorder.current = new MacroRecorder();
    setRecorded(0);
    setMessage(null);
    setRecording(true);
  };

  const save = async (): Promise<void> => {
    const res = await appStore.getState().saveMacros(effective);
    if (res.ok) {
      useUi.getState().clearMacroDrafts();
      setMessage({ text: 'Makro tersimpan dan terverifikasi.', bad: false });
    } else {
      setMessage({ text: res.message, bad: true });
    }
  };

  const clearCurrent = async (): Promise<void> => {
    const hasContent = entry?.kind === 'raw' || (entry?.kind === 'actions' && entry.actions.length > 0);
    if (hasContent) {
      const ok = await askConfirm({ title: `Kosongkan makro M${current}?`, message: 'Isi makro ini dihapus dari draf. Baru berlaku di keyboard setelah disimpan.', confirmLabel: 'Kosongkan', danger: true });
      if (!ok) return;
    }
    edit([]);
  };

  if (!buffer) {
    return (
      <section>
        <h2>Makro</h2>
        <div className="notice" role="status">
          Makro tidak tersedia pada perangkat ini. Lihat peringatan di bagian atas untuk alasannya.
        </div>
      </section>
    );
  }

  return (
    <section>
      <h2>Makro</h2>
      <p className="hint">
        Makro tersimpan di memori keyboard. Edit dulu sebagai draf, lalu simpan sekaligus. Pasang makro ke tombol lewat kategori Makro di palet
        pada tab Keymap.
      </p>

      <div className="slots" role="group" aria-label="Slot makro">
        {effective.map((e, i) => {
          const empty = e.kind === 'actions' && e.actions.length === 0;
          return (
            <button
              key={i}
              type="button"
              className={`slot${empty ? '' : ' filled'}${drafts[i] ? ' dirty' : ''}`}
              aria-pressed={i === current}
              title={drafts[i] ? `M${i} (belum disimpan)` : `M${i}`}
              onClick={() => setCurrent(i)}
            >
              M{i}
              {drafts[i] ? ' *' : ''}
            </button>
          );
        })}
      </div>

      <div className="card">
        <h3>Makro M{current}</h3>

        {entry?.kind === 'raw' ? (
          <div className="notice" role="note">
            Makro ini memakai format yang belum didukung editor ({entry.bytes.length} byte). Isinya dijaga apa adanya selama tidak diubah.
            <div className="mono">{entry.bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ')}</div>
          </div>
        ) : (
          <>
            {actionsOf().length === 0 && <p className="fine">Makro kosong. Tambahkan aksi atau rekam dari keyboard.</p>}
            {actionsOf().map((a, i) => (
              <div className="act" key={i}>
                <select
                  aria-label="Jenis aksi"
                  value={a.kind}
                  disabled={!writable}
                  onChange={(e) => edit(actionsOf().map((x, j) => (j === i ? convert(x, e.target.value as MacroAction['kind']) : x)))}
                >
                  {(Object.keys(KIND_LABEL) as MacroAction['kind'][]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                {a.kind === 'delay' ? (
                  <input
                    className="input"
                    type="number"
                    min={1}
                    max={65535}
                    aria-label="Lama jeda dalam milidetik"
                    value={a.ms}
                    disabled={!writable}
                    onChange={(e) => edit(actionsOf().map((x, j) => (j === i ? { kind: 'delay', ms: Number(e.target.value) } : x)))}
                  />
                ) : a.kind === 'text' ? (
                  <input
                    className="input"
                    aria-label="Teks yang diketik"
                    value={a.text}
                    disabled={!writable}
                    onChange={(e) => edit(actionsOf().map((x, j) => (j === i ? { kind: 'text', text: e.target.value } : x)))}
                  />
                ) : (
                  <select
                    aria-label="Tombol"
                    value={a.keycode}
                    disabled={!writable}
                    onChange={(e) => edit(actionsOf().map((x, j) => (j === i && 'keycode' in x ? { ...x, keycode: Number(e.target.value) } : x)))}
                  >
                    {KEY_OPTIONS.map((k) => (
                      <option key={k.code} value={k.code}>
                        {k.label} ({k.name})
                      </option>
                    ))}
                  </select>
                )}
                <span className="row">
                  <button
                    type="button"
                    className="btn"
                    aria-label="Naikkan aksi"
                    disabled={!writable || i === 0}
                    onClick={() => {
                      const list = [...actionsOf()];
                      [list[i - 1], list[i]] = [list[i] as MacroAction, list[i - 1] as MacroAction];
                      edit(list);
                    }}
                  >
                    Naik
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label="Turunkan aksi"
                    disabled={!writable || i === actionsOf().length - 1}
                    onClick={() => {
                      const list = [...actionsOf()];
                      [list[i], list[i + 1]] = [list[i + 1] as MacroAction, list[i] as MacroAction];
                      edit(list);
                    }}
                  >
                    Turun
                  </button>
                  <button type="button" className="btn" aria-label="Hapus aksi" disabled={!writable} onClick={() => edit(actionsOf().filter((_, j) => j !== i))}>
                    Hapus
                  </button>
                </span>
              </div>
            ))}
          </>
        )}

        {errors[current] && (
          <div className="notice bad" role="alert">
            {errors[current]}
          </div>
        )}

        <div className="row">
          {(['tap', 'down', 'up', 'delay', 'text'] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="btn"
              disabled={!writable || entry?.kind === 'raw' || recording}
              onClick={() => edit([...actionsOf(), defaultAction(k)])}
            >
              + {KIND_LABEL[k]}
            </button>
          ))}
          <button type="button" className="btn" disabled={!writable || recording} onClick={() => void clearCurrent()}>
            Kosongkan
          </button>
        </div>

        <div className="row">
          {recording ? (
            <>
              <button type="button" className="btn danger" onClick={() => stopRef.current()}>
                Berhenti merekam
              </button>
              <span className="fine" role="status">
                Merekam: {recorded} peristiwa. Tekan tombol di keyboard, lalu klik Berhenti.
              </span>
            </>
          ) : (
            <>
              <button type="button" className="btn" disabled={!writable} onClick={startRecording}>
                Rekam dari keyboard
              </button>
              <label className="chk">
                <input type="checkbox" checked={withDelays} onChange={(e) => setWithDelays(e.target.checked)} /> sertakan jeda
              </label>
            </>
          )}
        </div>
      </div>

      <div className="card">
        <div className="row">
          <span className="val">
            Memori makro: {usage.used} / {size} B
          </span>
          <div className="bar" aria-hidden="true">
            <i style={{ width: `${Math.min(100, (usage.used / Math.max(1, size)) * 100)}%` }} />
          </div>
        </div>
        {!usage.fits && (
          <div className="notice bad" role="alert">
            Memori makro penuh. Kurangi isi makro sebelum menyimpan.
          </div>
        )}
        <div className="row">
          <button type="button" className="btn primary" disabled={!canSave} onClick={() => void save()}>
            Simpan ke keyboard{dirty > 0 ? ` (${dirty} makro)` : ''}
          </button>
          <button type="button" className="btn" disabled={dirty === 0} onClick={() => useUi.getState().clearMacroDrafts()}>
            Buang perubahan
          </button>
        </div>
        {message && (
          <div className={`notice${message.bad ? ' bad' : ''}`} role="status">
            {message.text}
          </div>
        )}
        {!writable && (
          <div className="notice" role="status">
            Mode baca saja: makro hanya bisa dilihat.
          </div>
        )}
      </div>
    </section>
  );
}
