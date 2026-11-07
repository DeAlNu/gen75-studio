import { useMemo, useState } from 'react';
import { paletteCategories, parseKeycodeInput } from '../../core/keycodes';
import type { KeycodeContext, PaletteItem } from '../../core/keycodes';
import { macLabel } from '../../components/labels';

interface Props {
  ctx: KeycodeContext;
  layerCount: number;
  disabled: boolean;
  mac: boolean;
  onPick: (code: number) => void;
}

export function KeycodePalette({ ctx, layerCount, disabled, mac, onPick }: Props) {
  const categories = useMemo(() => paletteCategories(ctx, layerCount), [ctx, layerCount]);
  const [active, setActive] = useState('basic');
  const [query, setQuery] = useState('');
  const [anyText, setAnyText] = useState('');
  const [anyError, setAnyError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const items: PaletteItem[] = q
    ? categories.flatMap((c) => c.items).filter((i) => i.label.toLowerCase().includes(q) || i.title.toLowerCase().includes(q)).slice(0, 80)
    : (categories.find((c) => c.id === active)?.items ?? []);

  const submitAny = (e: React.FormEvent): void => {
    e.preventDefault();
    const r = parseKeycodeInput(anyText, ctx, layerCount);
    if (!r.ok) {
      setAnyError(r.error);
      return;
    }
    setAnyError(null);
    onPick(r.code);
  };

  return (
    <div className="card palette">
      <div className="palette-head">
        <div className="tabs" role="tablist" aria-label="Kategori keycode">
          {categories.map((c) => (
            <button
              key={c.id}
              type="button"
              role="tab"
              aria-selected={!q && c.id === active}
              className="tab"
              onClick={() => {
                setActive(c.id);
                setQuery('');
              }}
            >
              {c.label}
            </button>
          ))}
        </div>
        <input
          className="input search"
          type="search"
          placeholder="Cari keycode"
          aria-label="Cari keycode"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <div className="grid">
        {items.map((i) => (
          <button
            key={i.code}
            type="button"
            className={`kc${i.verified ? '' : ' unv'}`}
            disabled={disabled}
            title={i.verified ? i.title : `${i.title} (belum diverifikasi pada perangkat)`}
            onClick={() => onPick(i.code)}
          >
            {macLabel(i.label, mac)}
          </button>
        ))}
        {items.length === 0 && <p className="fine">Tidak ada keycode yang cocok.</p>}
      </div>

      <form className="any" onSubmit={submitAny}>
        <label htmlFor="any-code">Keycode bebas</label>
        <input
          id="any-code"
          className="input"
          placeholder="0x7E01, KC_A, MO(1), LT(1,KC_A)"
          value={anyText}
          onChange={(e) => setAnyText(e.target.value)}
          disabled={disabled}
        />
        <button type="submit" className="btn" disabled={disabled}>
          Pasang
        </button>
        {anyError && (
          <span className="error" role="alert">
            {anyError}
          </span>
        )}
      </form>
    </div>
  );
}
