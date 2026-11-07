import { useEffect, useMemo, useRef, useState } from 'react';
import { useSettings } from '../../app/useSettings';
import { KeyboardCanvas } from '../../components/KeyboardCanvas';
import { macLabel } from '../../components/labels';
import { defaultChoices, visibleKeys } from '../../core/definition/layout';
import { hidFromEventCode } from '../../core/hid-codes';
import { describeKeycode } from '../../core/keycodes';
import { appStore, definition, useApp } from '../../state/app';
import { keycodeContext } from '../../state/store';

const keys = visibleKeys(definition, defaultChoices(definition));
const cols = definition.matrix.cols;
const POLL_MS = 40;

type Mode = 'device' | 'browser' | 'idle';

const sameSet = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean => a.size === b.size && [...a].every((x) => b.has(x));

export function TesterView() {
  const layer0 = useApp((s) => s.keymap[0]);
  const customBase = useApp((s) => s.customBase);
  const mac = useSettings((s) => s.macLabels);
  const [running, setRunning] = useState(true);
  const [mode, setMode] = useState<Mode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<ReadonlySet<string>>(new Set());
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const nowRef = useRef<ReadonlySet<string>>(now);
  nowRef.current = now;

  const ctx = useMemo(() => keycodeContext(definition, customBase), [customBase]);
  const codeAt = (row: number, col: number): number => layer0?.[row * cols + col] ?? 0;

  const press = (pressed: ReadonlySet<string>): void => {
    if (!sameSet(pressed, nowRef.current)) setNow(pressed);
    if (pressed.size > 0) {
      setSeen((prev) => {
        if ([...pressed].every((k) => prev.has(k))) return prev;
        const next = new Set(prev);
        pressed.forEach((k) => next.add(k));
        return next;
      });
    }
  };

  // sumber utama: keadaan matriks dari perangkat
  useEffect(() => {
    if (!running || mode === 'browser') return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async (): Promise<void> => {
      const r = await appStore.getState().readMatrix();
      if (stopped) return;
      if (r.ok) {
        setMode('device');
        setError(null);
        press(r.pressed);
        timer = setTimeout(() => void tick(), POLL_MS);
      } else if (r.unsupported) {
        setMode('browser');
      } else {
        setMode('idle');
        setError(r.message);
      }
    };
    void tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [running, mode === 'browser']);

  // cadangan: event keyboard browser, dipetakan lewat keymap layer 0
  useEffect(() => {
    if (!running || mode !== 'browser') return;
    const held = new Set<string>();
    const sync = (): void => {
      const hids = new Set([...held].map((c) => hidFromEventCode(c)).filter((v): v is number => v !== null));
      const pressed = new Set<string>();
      for (const k of keys) if (hids.has(codeAt(k.row, k.col))) pressed.add(`${k.row},${k.col}`);
      press(pressed);
    };
    const down = (e: KeyboardEvent): void => {
      if (hidFromEventCode(e.code) === null) return;
      e.preventDefault();
      held.add(e.code);
      sync();
    };
    const up = (e: KeyboardEvent): void => {
      held.delete(e.code);
      sync();
    };
    const blur = (): void => {
      held.clear();
      sync();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, [running, mode]);

  const tested = keys.filter((k) => seen.has(`${k.row},${k.col}`)).length;
  const modeText =
    mode === 'device'
      ? 'Membaca keadaan matriks langsung dari keyboard.'
      : mode === 'browser'
        ? 'Firmware tidak mendukung pembacaan matriks. Memakai event keyboard browser: Fn dan knob tidak terdeteksi.'
        : running
          ? 'Menunggu data dari keyboard...'
          : 'Dijeda.';

  return (
    <section>
      <h2>Tester</h2>
      <p className="hint">
        Tekan tombol di keyboard untuk melihatnya menyala. Tombol yang pernah ditekan tetap berwarna agar kelihatan mana yang belum teruji.
        Posisi dibaca dari matriks, jadi tombol dengan keycode apa pun ikut terbaca, termasuk Fn dan knob.
      </p>
      <div className="row">
        <button type="button" className="btn primary" onClick={() => setRunning((r) => !r)}>
          {running ? 'Jeda' : 'Lanjutkan'}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            setSeen(new Set());
            setNow(new Set());
          }}
        >
          Reset
        </button>
        <span className="fine">{modeText}</span>
      </div>
      {error && (
        <div className="notice bad" role="alert">
          {error}
        </div>
      )}
      <div className="stats">
        <div>
          Teruji{' '}
          <b>
            {tested} / {keys.length}
          </b>
        </div>
      </div>
      <KeyboardCanvas
        keys={keys}
        width={definition.width}
        height={definition.height}
        label="Kanvas tester"
        legend={(k) => macLabel(describeKeycode(codeAt(k.row, k.col), ctx).label, mac)}
        keyClass={(k) => (now.has(`${k.row},${k.col}`) ? 'now' : seen.has(`${k.row},${k.col}`) ? 'seen' : '')}
      />
    </section>
  );
}
