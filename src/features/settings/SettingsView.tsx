import { useSettings } from '../../app/useSettings';
import type { Theme } from '../../app/useSettings';

const THEMES: [Theme, string][] = [
  ['auto', 'Otomatis'],
  ['dark', 'Gelap'],
  ['light', 'Terang'],
];

export function SettingsView() {
  const { theme, macLabels, showCoords, devMode, update } = useSettings();

  return (
    <section>
      <h2>Setelan</h2>
      <div className="card">
        <div className="row">
          <span>Tema</span>
          <div className="seg" role="group" aria-label="Tema">
            {THEMES.map(([id, label]) => (
              <button key={id} type="button" aria-pressed={theme === id} onClick={() => update({ theme: id })}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label className="chk">
            <input type="checkbox" checked={macLabels} onChange={(e) => update({ macLabels: e.target.checked })} /> Label Mac (Win menjadi Cmd, Alt menjadi Opt)
          </label>
        </div>
        <div className="row">
          <label className="chk">
            <input type="checkbox" checked={showCoords} onChange={(e) => update({ showCoords: e.target.checked })} /> Tampilkan koordinat matriks pada tombol
          </label>
        </div>
        <div className="row">
          <label className="chk">
            <input type="checkbox" checked={devMode} onChange={(e) => update({ devMode: e.target.checked })} /> Mode pengembang (tampilkan nilai hex keycode)
          </label>
        </div>
        <div className="row">
          <label className="chk">
            <input type="checkbox" checked disabled /> Kunci perintah berbahaya (selalu aktif)
          </label>
        </div>
      </div>
    </section>
  );
}
