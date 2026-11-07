import type { CSSProperties } from 'react';
import { KeyboardCanvas } from '../../components/KeyboardCanvas';
import { hexToHs, hsToHex } from '../../core/color';
import { controlsOf, isVisible } from '../../core/definition/menus';
import type { MenuControl, MenuNode } from '../../core/definition/types';
import type { LightingValues } from '../../core/session';
import { appStore, definition, useApp } from '../../state/app';

const controls = controlsOf(definition.menus);
const effectControl = controls.find((c) => c.kind === 'dropdown' && c.ref.id === 'id_qmk_rgb_matrix_effect');
const brightnessControl = controls.find((c) => c.kind === 'range' && c.ref.id === 'id_qmk_rgb_matrix_brightness');

const valueOf = (values: LightingValues, id: string): number => {
  const v = values[id];
  return Array.isArray(v) ? (v[0] ?? 0) : (v ?? 0);
};

function Control({ c, values, disabled }: { c: MenuControl; values: LightingValues; disabled: boolean }) {
  const id = `ctl-${c.ref.id}`;
  const set = appStore.getState().setLightingValue;
  const v = values[c.ref.id];

  switch (c.kind) {
    case 'range': {
      const n = typeof v === 'number' ? v : c.min;
      return (
        <div className="ctl">
          <label htmlFor={id}>{c.label}</label>
          <input id={id} type="range" min={c.min} max={c.max} value={n} disabled={disabled} onChange={(e) => set(c.ref.id, Number(e.target.value))} />
          <span className="val">
            {n} / {c.max}
          </span>
        </div>
      );
    }
    case 'dropdown': {
      const n = typeof v === 'number' ? v : (c.options[0]?.value ?? 0);
      return (
        <div className="ctl">
          <label htmlFor={id}>{c.label}</label>
          <select id={id} value={n} disabled={disabled} onChange={(e) => set(c.ref.id, Number(e.target.value))}>
            {c.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
          <span className="val">id {n}</span>
        </div>
      );
    }
    case 'color': {
      const [h, s] = Array.isArray(v) ? v : [0, 0];
      return (
        <div className="ctl">
          <label htmlFor={id}>{c.label}</label>
          <input id={id} type="color" value={hsToHex(h ?? 0, s ?? 0)} disabled={disabled} onChange={(e) => set(c.ref.id, hexToHs(e.target.value))} />
          <span className="val">
            H {h} · S {s}
          </span>
        </div>
      );
    }
    case 'toggle':
      return (
        <div className="ctl">
          <label htmlFor={id}>{c.label}</label>
          <input id={id} type="checkbox" checked={v === 1} disabled={disabled} onChange={(e) => set(c.ref.id, e.target.checked ? 1 : 0)} />
          <span className="val">{v === 1 ? 'aktif' : 'mati'}</span>
        </div>
      );
  }
}

function MenuNodeView({ node, values, disabled }: { node: MenuNode; values: LightingValues; disabled: boolean }) {
  if (!isVisible(node, (id) => valueOf(values, id))) return null;
  if (node.kind === 'group') {
    return (
      <fieldset>
        <legend>{node.label}</legend>
        {node.items.map((n, i) => (
          <MenuNodeView key={i} node={n} values={values} disabled={disabled} />
        ))}
      </fieldset>
    );
  }
  return <Control c={node} values={values} disabled={disabled} />;
}

export function LightingView() {
  const lighting = useApp((s) => s.lighting);
  const writable = useApp((s) => s.writable);
  const keys = definition.keys;

  if (!lighting) {
    return (
      <section>
        <h2>Lighting</h2>
        <div className="notice" role="status">
          Lighting tidak tersedia pada perangkat ini. Lihat peringatan di bagian atas untuk alasannya.
        </div>
      </section>
    );
  }

  const effectValue = valueOf(lighting, 'id_qmk_rgb_matrix_effect');
  const effectName = effectControl?.kind === 'dropdown' ? (effectControl.options.find((o) => o.value === effectValue)?.label ?? '') : '';
  const max = brightnessControl?.kind === 'range' ? brightnessControl.max : 255;
  const hs = lighting.id_qmk_rgb_matrix_color;
  const [hue, sat] = Array.isArray(hs) ? hs : [0, 255];
  const previewStyle = {
    '--h': Math.round(((hue ?? 0) / 255) * 360),
    '--s': Math.round(((sat ?? 0) / 255) * 100),
    '--b': valueOf(lighting, 'id_qmk_rgb_matrix_brightness') / max,
  } as CSSProperties;
  const mode = effectName === 'none' ? 'off' : /^(cycle|rainbow|hue)/.test(effectName) ? 'cyc' : effectName === 'breathing' ? 'brt' : '';

  return (
    <section>
      <h2>Lighting</h2>
      <p className="hint">
        Menu di bawah dibangun dari definisi perangkat. Perubahan dikirim ke keyboard saat digeser dan disimpan ke memori keyboard setelah
        berhenti sebentar. Pratinjau disederhanakan dan tidak meniru semua efek.
      </p>
      <div className="card">
        <KeyboardCanvas keys={keys} width={definition.width} height={definition.height} label="Pratinjau lampu" className={`pv ${mode}`} style={previewStyle} />
      </div>
      {!writable && (
        <div className="notice" role="status">
          Mode baca saja: pengaturan lighting dinonaktifkan.
        </div>
      )}
      {definition.menus.map((m, i) => (
        <MenuNodeView key={i} node={m} values={lighting} disabled={!writable} />
      ))}
    </section>
  );
}
