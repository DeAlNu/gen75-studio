import { useUi } from '../../app/useUi';
import { appStore, definition, useApp } from '../../state/app';

const GROUPS: { title: string; names: string[] }[] = [
  { title: 'Mode koneksi', names: ['2.4G', 'BLE1', 'BLE2', 'BLE3', 'USB'] },
  { title: 'Fungsi', names: ['BAT', 'WLO', 'SIX_N', 'FN_ALT', 'RTOG'] },
  { title: 'Berbahaya', names: ['U_EE_CLR'] },
];

const EXPLAIN: Record<string, string> = {
  '2.4G': 'Pindah ke mode dongle 2.4G.',
  BLE1: 'Pindah ke slot Bluetooth 1.',
  BLE2: 'Pindah ke slot Bluetooth 2.',
  BLE3: 'Pindah ke slot Bluetooth 3.',
  USB: 'Pindah ke mode kabel USB.',
  BAT: 'Menampilkan status baterai (kemungkinan lewat lampu keyboard).',
  WLO: 'Kunci atau buka tombol Windows.',
  SIX_N: 'Diduga menukar 6KRO dan NKRO (dugaan dari nama dan descriptor USB).',
  FN_ALT: 'Diduga menukar baris F dan fungsi media.',
  RTOG: 'Hidupkan atau matikan lampu.',
  U_EE_CLR: 'Diduga mereset pengaturan keyboard (EEPROM). Jangan dipasang di tombol yang mudah tertekan.',
};

export function FunctionsView() {
  const customBase = useApp((s) => s.customBase);
  const writable = useApp((s) => s.writable);

  const assign = (name: string, code: number): void => {
    useUi.getState().setPending({ code, label: name });
    useUi.getState().setTab('keymap');
    appStore.getState().select([]);
  };

  return (
    <section>
      <h2>Fungsi Gen 75</h2>
      <p className="hint">
        Sebelas keycode khas Gen 75 dari definisi perangkat. Di sini masing-masing dijelaskan dan bisa dipasang ke tombol dengan satu klik
        pada kanvas keymap.
      </p>
      <div className="notice" role="note">
        Konfigurasi hanya lewat kabel USB. Pindah mode (2.4G, BLE, USB) dilakukan dengan menekan tombol yang dipasangi keycode di keyboard.
        Aplikasi tidak bisa menekannya dari layar karena protokol VIA tidak punya perintah untuk itu.
      </div>

      {GROUPS.map((g) => (
        <div className="card" key={g.title}>
          <h3>{g.title}</h3>
          <div className="grid2">
            {g.names.map((name) => {
              const i = definition.customKeycodes.findIndex((c) => c.name === name);
              if (i < 0) return null;
              const danger = name === 'U_EE_CLR';
              return (
                <div className={`fn${danger ? ' danger' : ''}`} key={name}>
                  <b>{name}</b>
                  <span>
                    {EXPLAIN[name]} (definisi: &quot;{definition.customKeycodes[i]?.title}&quot;)
                  </span>
                  <button type="button" className={`btn${danger ? ' danger-outline' : ''}`} disabled={!writable} onClick={() => assign(name, customBase + i)}>
                    Pasang ke tombol...
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="card">
        <h3>Status perangkat</h3>
        <div className="stats">
          <div>
            Mode aktif <b>-</b>
          </div>
          <div>
            Baterai <b>-</b>
          </div>
        </div>
        <div className="notice bad" role="note">
          Belum tersedia: protokol VIA standar tidak punya perintah untuk membaca mode atau baterai. Fitur ini baru bisa dibuat bila firmware
          menyediakannya (lihat RANCANGAN.md, bagian 9.7).
        </div>
      </div>
    </section>
  );
}
