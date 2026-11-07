import { useMemo, useState } from 'react';
import { useSettings } from '../../app/useSettings';
import { useUi } from '../../app/useUi';
import { KeyboardCanvas } from '../../components/KeyboardCanvas';
import { macLabel } from '../../components/labels';
import { backupKeymap } from '../../core/backup';
import type { Backup } from '../../core/backup';
import { compareBackups, isUsableBackup } from '../../core/compare';
import { defaultChoices, visibleKeys } from '../../core/definition/layout';
import { describeKeycode, KB_BASE_PROTOCOL_12 } from '../../core/keycodes';
import { appStore, definition, useApp } from '../../state/app';
import { keycodeContext } from '../../state/store';
import { runRestore } from '../backup/runRestore';

const keys = visibleKeys(definition, defaultChoices(definition));
const cols = definition.matrix.cols;
const REASON = { connect: 'saat tersambung', manual: 'manual', 'before-restore': 'sebelum pemulihan' } as const;

interface Source {
  id: string;
  label: string;
  backup: Backup;
}

const stamp = (iso: string): string => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });

export function CompareView() {
  const a = useUi((s) => s.compareA);
  const b = useUi((s) => s.compareB);
  const allProfiles = useApp((s) => s.profiles);
  const allSnapshots = useApp((s) => s.snapshots);
  const status = useApp((s) => s.status);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const customBase = useApp((s) => s.customBase);
  const keymap = useApp((s) => s.keymap);
  const lighting = useApp((s) => s.lighting);
  const macroBuffer = useApp((s) => s.macroBuffer);
  const encoders = useApp((s) => s.encoders);
  const mac = useSettings((s) => s.macLabels);
  const [layerPick, setLayerPick] = useState(0);
  const ready = status === 'ready';

  const device = useMemo(() => (ready ? appStore.getState().exportBackup() : null), [ready, keymap, lighting, macroBuffer, encoders]);

  const profileList = useMemo(() => allProfiles.filter((p) => isUsableBackup(p.backup)), [allProfiles]);
  const snapshotList = useMemo(() => allSnapshots.filter((s) => isUsableBackup(s.backup)), [allSnapshots]);

  const sources = useMemo<Source[]>(() => {
    const list: Source[] = [];
    if (device) list.push({ id: 'device', label: 'Keyboard sekarang', backup: device });
    for (const p of profileList) list.push({ id: `profile:${p.id}`, label: `Profil: ${p.name}`, backup: p.backup });
    for (const s of snapshotList) list.push({ id: `snapshot:${s.id}`, label: `Snapshot ${stamp(s.takenAt)} (${REASON[s.reason]})`, backup: s.backup });
    return list;
  }, [device, profileList, snapshotList]);

  const sa = sources.find((x) => x.id === a);
  const sb = sources.find((x) => x.id === b);
  const result = useMemo(() => (sa && sb ? compareBackups(definition, sa.backup, sb.backup) : null), [sa, sb]);

  const ctx = useMemo(() => keycodeContext(definition, ready ? customBase : KB_BASE_PROTOCOL_12), [ready, customBase]);
  const labelOf = (code: number): string => macLabel(describeKeycode(code, ctx).label, mac);
  const titleOf = (code: number): string => describeKeycode(code, ctx).title;

  const mapA = useMemo(() => (sa ? backupKeymap(sa.backup) : []), [sa]);
  const mapB = useMemo(() => (sb ? backupKeymap(sb.backup) : []), [sb]);

  const changedLayers = useMemo(() => [...new Set((result?.keys ?? []).map((c) => c.layer))].sort((x, y) => x - y), [result]);
  const layer = changedLayers.includes(layerPick) ? layerPick : (changedLayers[0] ?? 0);
  const layerChanges = useMemo(() => (result?.keys ?? []).filter((c) => c.layer === layer), [result, layer]);
  const changedKeys = useMemo(() => new Set(layerChanges.map((c) => c.keyIndex)), [layerChanges]);

  const countIn = (l: number): number => (result?.keys ?? []).filter((c) => c.layer === l).length;
  const select = (side: 'a' | 'b', id: string): void => (side === 'a' ? useUi.getState().setCompare(id, b) : useUi.getState().setCompare(a, id));
  const missing = (id: string): boolean => id !== '' && !sources.some((x) => x.id === id);

  const applyB = async (): Promise<void> => {
    if (!sb) return;
    const out = await runRestore(JSON.stringify(sb.backup), { title: `Terapkan "${sb.label}" ke keyboard?`, confirmLabel: 'Terapkan' });
    appStore.setState({ toast: out.text });
  };

  const options = (
    <>
      {device && <option value="device">Keyboard sekarang</option>}
      {profileList.length > 0 && (
        <optgroup label="Profil">
          {profileList.map((p) => (
            <option key={p.id} value={`profile:${p.id}`}>
              {p.name}
            </option>
          ))}
        </optgroup>
      )}
      {snapshotList.length > 0 && (
        <optgroup label="Snapshot">
          {snapshotList.map((s) => (
            <option key={s.id} value={`snapshot:${s.id}`}>
              {stamp(s.takenAt)} ({REASON[s.reason]})
            </option>
          ))}
        </optgroup>
      )}
    </>
  );

  return (
    <section>
      <h2>Bandingkan</h2>
      <p className="hint">
        Bandingkan dua sumber dari A ke B: keadaan keyboard sekarang, sebuah profil, atau snapshot. Perbedaan keymap, knob, makro, dan lighting
        ditampilkan tanpa menulis apa pun ke keyboard.
      </p>

      <div className="card">
        <div className="row">
          <label className="fld">
            <span>A (dasar)</span>
            <select value={sa ? a : ''} onChange={(e) => select('a', e.target.value)}>
              <option value="">Pilih sumber</option>
              {options}
            </select>
          </label>
          <button type="button" className="btn" onClick={() => useUi.getState().setCompare(b, a)} disabled={!a && !b} title="Tukar A dan B">
            Tukar
          </button>
          <label className="fld">
            <span>B (pembanding)</span>
            <select value={sb ? b : ''} onChange={(e) => select('b', e.target.value)}>
              <option value="">Pilih sumber</option>
              {options}
            </select>
          </label>
        </div>
        {(missing(a) || missing(b)) && (
          <div className="notice">{[a, b].some((x) => x === 'device') && !ready ? 'Sambungkan keyboard untuk memakai "Keyboard sekarang".' : 'Salah satu sumber tidak ditemukan lagi. Pilih ulang.'}</div>
        )}
        {sources.length === 0 && <p className="fine">Belum ada yang bisa dibandingkan. Simpan profil atau sambungkan keyboard.</p>}
      </div>

      {result && sa && sb && (
        <>
          <div className="card">
            <h3>Ringkasan</h3>
            {sa.id === sb.id ? (
              <p>A dan B adalah sumber yang sama.</p>
            ) : result.total === 0 ? (
              <p>
                <span className="tag ok">identik</span> Tidak ada perbedaan pada bagian yang bisa dibandingkan.
              </p>
            ) : (
              <p>
                {[
                  result.keys.length && `${result.keys.length} keycode`,
                  result.encoders?.length && `${result.encoders.length} putaran knob`,
                  result.macros?.length && `${result.macros.length} makro`,
                  result.lighting?.length && `${result.lighting.length} nilai lighting`,
                ]
                  .filter(Boolean)
                  .join(', ')}{' '}
                berbeda.
              </p>
            )}
            <p className="fine">
              A = {sa.label}. B = {sb.label}.
            </p>
            {result.notes.map((n) => (
              <div key={n} className="notice">
                {n}
              </div>
            ))}
            {sa.id === 'device' && sb.id !== 'device' && result.total > 0 && (
              <div className="row">
                <button type="button" className="btn primary" disabled={!writable || busy} onClick={() => void applyB()}>
                  Terapkan B ke keyboard...
                </button>
              </div>
            )}
          </div>

          {result.keys.length > 0 && (
            <div className="card">
              <h3>Keymap</h3>
              <div className="tabs" role="tablist" aria-label="Layer yang berbeda">
                {changedLayers.map((l) => (
                  <button key={l} type="button" role="tab" className="tab" aria-selected={l === layer} onClick={() => setLayerPick(l)}>
                    Layer {l} <span className="tag">{countIn(l)}</span>
                  </button>
                ))}
              </div>
              <KeyboardCanvas
                keys={keys}
                width={definition.width}
                height={definition.height}
                label={`Perbedaan keymap layer ${layer}`}
                legend={(k) => labelOf(mapB[layer]?.[k.row * cols + k.col] ?? 0)}
                title={(k) => {
                  const slot = k.row * cols + k.col;
                  return changedKeys.has(k.index) ? `A: ${labelOf(mapA[layer]?.[slot] ?? 0)}, B: ${labelOf(mapB[layer]?.[slot] ?? 0)}` : titleOf(mapB[layer]?.[slot] ?? 0);
                }}
                keyClass={(k) => (changedKeys.has(k.index) ? 'diff' : 'same')}
              />
              <p className="fine">Kanvas menampilkan isi B; tombol bergaris kuning berbeda dari A.</p>
              <div className="tablewrap">
                <table className="difftab">
                  <thead>
                    <tr>
                      <th>Tombol</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layerChanges.map((c) => {
                      const k = definition.keys[c.keyIndex];
                      const base = k ? labelOf(mapA[0]?.[k.row * cols + k.col] ?? 0) : '';
                      return (
                        <tr key={c.keyIndex}>
                          <td>
                            {k ? `${k.row},${k.col}` : c.keyIndex} <span className="fine">({base})</span>
                          </td>
                          <td>{labelOf(c.from)}</td>
                          <td>{labelOf(c.to)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.encoders && result.encoders.length > 0 && (
            <div className="card">
              <h3>Putaran knob</h3>
              <div className="tablewrap">
                <table className="difftab">
                  <thead>
                    <tr>
                      <th>Layer</th>
                      <th>Knob</th>
                      <th>Arah</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.encoders.map((c) => (
                      <tr key={`${c.layer}-${c.index}-${c.clockwise}`}>
                        <td>{c.layer}</td>
                        <td>{c.index}</td>
                        <td>{c.clockwise ? 'searah jarum jam' : 'berlawanan'}</td>
                        <td>{labelOf(c.from)}</td>
                        <td>{labelOf(c.to)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.macros && result.macros.length > 0 && (
            <div className="card">
              <h3>Makro</h3>
              <div className="tablewrap">
                <table className="difftab">
                  <thead>
                    <tr>
                      <th>Slot</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.macros.map((m) => (
                      <tr key={m.slot}>
                        <td>M{m.slot}</td>
                        <td>{m.from}</td>
                        <td>{m.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {result.lighting && result.lighting.length > 0 && (
            <div className="card">
              <h3>Lighting</h3>
              <div className="tablewrap">
                <table className="difftab">
                  <thead>
                    <tr>
                      <th>Setelan</th>
                      <th>A</th>
                      <th>B</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.lighting.map((l) => (
                      <tr key={l.id}>
                        <td>{l.label}</td>
                        <td>{l.from}</td>
                        <td>{l.to}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
