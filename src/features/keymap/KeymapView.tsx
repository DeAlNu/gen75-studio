import { useEffect, useMemo, useState } from 'react';
import { askConfirm } from '../../app/confirm';
import { useSettings } from '../../app/useSettings';
import { KeyboardCanvas } from '../../components/KeyboardCanvas';
import { macLabel } from '../../components/labels';
import { defaultChoices, visibleKeys } from '../../core/definition/layout';
import type { PhysicalKey } from '../../core/definition/types';
import { describeKeycode, hex4 } from '../../core/keycodes';
import { appStore, definition, useApp } from '../../state/app';
import { keycodeContext } from '../../state/store';
import { KeycodePalette } from './KeycodePalette';

const keys = visibleKeys(definition, defaultChoices(definition));
const cols = definition.matrix.cols;

export function KeymapView() {
  const keymap = useApp((s) => s.keymap);
  const layer = useApp((s) => s.layer);
  const layerCount = useApp((s) => s.layerCount);
  const selected = useApp((s) => s.selected);
  const writable = useApp((s) => s.writable);
  const busy = useApp((s) => s.busy);
  const customBase = useApp((s) => s.customBase);
  const mac = useSettings((s) => s.macLabels);
  const coords = useSettings((s) => s.showCoords);
  const dev = useSettings((s) => s.devMode);
  const [hint, setHint] = useState<string | null>(null);

  const ctx = useMemo(() => keycodeContext(definition, customBase), [customBase]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);
  const codeAt = (k: PhysicalKey): number => keymap[layer]?.[k.row * cols + k.col] ?? 0;

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
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const assign = async (code: number): Promise<void> => {
    setHint(null);
    let res = await appStore.getState().assignKeycode(code);
    if (!res.ok && res.reason === 'danger') {
      const ok = await askConfirm({ title: 'Keycode berisiko', message: res.message, confirmLabel: 'Tetap pasang', danger: true });
      if (!ok) return;
      res = await appStore.getState().assignKeycode(code, { confirmed: true });
    }
    if (!res.ok) setHint(res.message);
  };

  const onKeyClick = (k: PhysicalKey, e: React.MouseEvent): void => {
    setHint(null);
    if (e.shiftKey || e.ctrlKey || e.metaKey) appStore.getState().toggleSelect(k.index);
    else appStore.getState().select([k.index]);
  };

  const one = selected.length === 1 ? definition.keys[selected[0] as number] : undefined;
  const oneDesc = one ? describeKeycode(codeAt(one), ctx) : null;

  return (
    <section>
      <h2>Keymap</h2>
      <p className="hint">
        Klik tombol di kanvas, lalu pilih keycode. Shift atau Ctrl + klik memilih beberapa tombol. Perubahan langsung ditulis ke keyboard dan bisa
        diurungkan dengan Ctrl+Z.
      </p>

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
        legend={(k) => macLabel(describeKeycode(codeAt(k), ctx).label, mac)}
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
        {selected.length === 0 && <span>Belum ada tombol terpilih.</span>}
        {selected.length > 1 && <span>{selected.length} tombol terpilih. Keycode yang dipilih akan dipasang ke semuanya.</span>}
        {one && oneDesc && (
          <>
            <span>
              Matriks <b>{one.row},{one.col}</b>
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
            {one.encoder !== null && <span>Tombol knob: hanya tekanannya yang bisa diubah di versi ini.</span>}
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

      <KeycodePalette ctx={ctx} layerCount={layerCount} disabled={!writable || busy || selected.length === 0} mac={mac} onPick={(c) => void assign(c)} />
    </section>
  );
}
