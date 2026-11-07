import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../../app/confirm';
import { useSettings } from '../../app/useSettings';
import { useUi } from '../../app/useUi';
import { KeyboardCanvas } from '../../components/KeyboardCanvas';
import { macLabel } from '../../components/labels';
import { defaultChoices, visibleKeys } from '../../core/definition/layout';
import type { PhysicalKey } from '../../core/definition/types';
import { describeKeycode, hex4 } from '../../core/keycodes';
import { appStore, definition, useApp } from '../../state/app';
import type { AssignResult } from '../../state/store';
import { keycodeContext } from '../../state/store';
import { KeycodePalette } from './KeycodePalette';

const keys = visibleKeys(definition, defaultChoices(definition));
const cols = definition.matrix.cols;
const encoderIndexes = [...new Set(definition.keys.flatMap((k) => (k.encoder === null ? [] : [k.encoder])))].sort((a, b) => a - b);

export function KeymapView() {
  const keymap = useApp((s) => s.keymap);
  const layer = useApp((s) => s.layer);
  const layerCount = useApp((s) => s.layerCount);
  const selected = useApp((s) => s.selected);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const customBase = useApp((s) => s.customBase);
  const encoders = useApp((s) => s.encoders);
  const macroCount = useApp((s) => s.macroCount);
  const pending = useUi((s) => s.pending);
  const encoderTarget = useUi((s) => s.encoderTarget);
  const mac = useSettings((s) => s.macLabels);
  const coords = useSettings((s) => s.showCoords);
  const dev = useSettings((s) => s.devMode);
  const [hint, setHint] = useState<string | null>(null);

  const ctx = useMemo(() => keycodeContext(definition, customBase), [customBase]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const codeAt = (k: PhysicalKey): number => keymap[layer]?.[k.row * cols + k.col] ?? 0;
  const labelOf = (code: number): string => macLabel(describeKeycode(code, ctx).label, mac);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        void appStore.getState().undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        void appStore.getState().redo();
      } else if (e.key === 'Escape') {
        appStore.getState().select([]);
        useUi.getState().setEncoderTarget(null);
        useUi.getState().setPending(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const assign = async (code: number): Promise<void> => {
    setHint(null);
    const target = useUi.getState().encoderTarget;
    const run = (confirmed: boolean): Promise<AssignResult> =>
      target
        ? appStore.getState().assignEncoder(target.index, target.clockwise, code, { confirmed })
        : appStore.getState().assignKeycode(code, { confirmed });
    let res = await run(false);
    if (!res.ok && res.reason === 'danger') {
      const ok = await askConfirm({ title: 'Keycode berisiko', message: res.message, confirmLabel: 'Tetap pasang', danger: true });
      if (!ok) return;
      res = await run(true);
    }
    if (!res.ok) setHint(res.message);
  };

  const onKeyClick = (k: PhysicalKey, e: React.MouseEvent): void => {
    setHint(null);
    const ui = useUi.getState();
    ui.setEncoderTarget(null);
    if (ui.pending) {
      const p = ui.pending;
      ui.setPending(null);
      appStore.getState().select([k.index]);
      void assign(p.code);
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) appStore.getState().toggleSelect(k.index);
    else appStore.getState().select([k.index]);
  };

  const one = selected.length === 1 ? definition.keys[selected[0] as number] : undefined;
  const oneDesc = one ? describeKeycode(codeAt(one), ctx) : null;
  const canPick = writable && !busy && (selected.length > 0 || encoderTarget !== null);

  return (
    <section>
      <h2>Keymap</h2>
      <p className="hint">
        Klik tombol di kanvas, lalu pilih keycode. Shift atau Ctrl + klik memilih beberapa tombol. Perubahan langsung ditulis ke keyboard dan bisa
        diurungkan dengan Ctrl+Z.
      </p>

      {pending && (
        <div className="banner" role="status">
          <span>
            Klik tombol di kanvas untuk memasang <b>{pending.label}</b> pada layer {layer}.
          </span>
          <button type="button" className="btn" onClick={() => useUi.getState().setPending(null)}>
            Batal
          </button>
        </div>
      )}

      <div className="row">
        <span>Layer</span>
        <div className="seg" role="group" aria-label="Layer">
          {Array.from({ length: layerCount }, (_, i) => (
            <button key={i} type="button" aria-pressed={i === layer} onClick={() => appStore.getState().setLayer(i)}>
              {i}
            </button>
          ))}
        </div>
        {busy && <span className="fine">Menulis ke keyboard...</span>}
      </div>

      <KeyboardCanvas
        keys={keys}
        width={definition.width}
        height={definition.height}
        label="Kanvas keymap"
        legend={(k) => labelOf(codeAt(k))}
        title={(k) => describeKeycode(codeAt(k), ctx).title}
        keyClass={(k) => {
          const kind = describeKeycode(codeAt(k), ctx).kind;
          return kind === 'custom' ? 'custom' : kind === 'unknown' ? 'unk' : '';
        }}
        selected={selectedSet}
        onKeyClick={onKeyClick}
        showCoords={coords}
      />

      <div className="detail" aria-live="polite">
        {selected.length === 0 && !encoderTarget && <span>Belum ada tombol terpilih.</span>}
        {encoderTarget && (
          <span>
            Tujuan: putaran knob {encoderTarget.index} ({encoderTarget.clockwise ? 'searah jarum jam' : 'berlawanan jarum jam'}) pada layer {layer}.
          </span>
        )}
        {selected.length > 1 && <span>{selected.length} tombol terpilih. Keycode yang dipilih akan dipasang ke semuanya.</span>}
        {one && oneDesc && (
          <>
            <span>
              Matriks{' '}
              <b>
                {one.row},{one.col}
              </b>
            </span>
            <span>
              Keycode <b>{oneDesc.label}</b>
            </span>
            {dev && (
              <span>
                Hex <b>{hex4(codeAt(one))}</b>
              </span>
            )}
            <span>{oneDesc.title}</span>
            {one.encoder !== null && <span>Ini tombol tekan knob. Putarannya diatur di kartu Putaran knob di bawah.</span>}
          </>
        )}
      </div>

      {hint && (
        <div className="notice bad" role="alert">
          {hint}
        </div>
      )}
      {!writable && (
        <div className="notice" role="status">
          Mode baca saja: perubahan dinonaktifkan untuk perangkat ini.
        </div>
      )}

      {encoderIndexes.length > 0 && (
        <div className="card">
          <h3>Putaran knob</h3>
          {encoders === null ? (
            <p className="fine">Firmware ini tidak mengizinkan membaca atau mengubah putaran knob. Hanya tekanannya yang bisa diubah.</p>
          ) : (
            encoderIndexes.map((i) => (
              <div className="row" key={i}>
                <span>
                  Knob {i}, layer {layer}
                </span>
                {[false, true].map((cw) => {
                  const code = encoders[layer]?.[i]?.[cw ? 1 : 0] ?? 0;
                  const active = encoderTarget?.index === i && encoderTarget.clockwise === cw;
                  return (
                    <button
                      key={String(cw)}
                      type="button"
                      className="btn"
                      aria-pressed={active}
                      disabled={!writable || busy}
                      title={describeKeycode(code, ctx).title}
                      onClick={() => {
                        useUi.getState().setEncoderTarget(active ? null : { index: i, clockwise: cw });
                        if (!active) appStore.getState().select([]);
                      }}
                    >
                      {cw ? 'Searah jarum jam' : 'Berlawanan'}: <b>{labelOf(code)}</b>
                    </button>
                  );
                })}
              </div>
            ))
          )}
          {encoderTarget && <p className="fine">Pilih keycode di palet untuk memasangnya pada putaran yang dipilih.</p>}
        </div>
      )}

      <KeycodePalette ctx={ctx} layerCount={layerCount} macroCount={macroCount} disabled={!canPick} mac={mac} onPick={(c) => void assign(c)} />
    </section>
  );
}
