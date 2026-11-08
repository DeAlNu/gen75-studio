import { useEffect } from 'react';
import { askConfirm } from '../../app/confirm';
import { pwa, promptInstall } from '../../pwa';
import { usePwa } from '../../pwa/status';
import type { OfflineState } from '../../pwa/status';
import { appStore } from '../../state/app';

const STATUS: Record<OfflineState, string> = {
  unsupported: 'Tidak tersedia di sini. Mode offline butuh halaman yang dibuka lewat HTTPS atau localhost.',
  disabled: 'Nonaktif pada mode pengembangan. Aktif pada hasil build.',
  idle: 'Belum aktif.',
  installing: 'Sedang menyimpan berkas aplikasi.',
  ready: 'Siap dipakai tanpa internet.',
  error: 'Gagal menyiapkan mode offline. Muat ulang halaman; bila tetap gagal, setel ulang cache offline.',
};

const clock = (ms: number): string => new Date(ms).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

const toast = (text: string): void => appStore.setState({ toast: text });

export function OfflineCard() {
  const offline = usePwa((s) => s.offline);
  const updateReady = usePwa((s) => s.updateReady);
  const installable = usePwa((s) => s.installable);
  const standalone = usePwa((s) => s.standalone);
  const version = usePwa((s) => s.version);
  const checking = usePwa((s) => s.checking);
  const checkedAt = usePwa((s) => s.checkedAt);

  useEffect(() => {
    if (offline === 'ready') void pwa.refreshVersion();
  }, [offline]);

  const check = async (): Promise<void> => {
    const ran = await pwa.checkForUpdate();
    toast(ran ? 'Pemeriksaan selesai. Pemberitahuan muncul bila ada versi baru.' : 'Pemeriksaan gagal. Periksa koneksi internet.');
  };

  const install = async (): Promise<void> => {
    const outcome = await promptInstall();
    if (outcome === 'accepted') toast('Aplikasi dipasang.');
  };

  const reset = async (): Promise<void> => {
    const ok = await askConfirm({
      title: 'Setel ulang cache offline?',
      message:
        'Berkas aplikasi yang tersimpan untuk mode offline dihapus, lalu halaman dimuat ulang dan berkas diunduh lagi (butuh internet). Profil, snapshot, dan setelan tidak ikut terhapus.',
      confirmLabel: 'Setel ulang',
      danger: true,
    });
    if (!ok) return;
    try {
      await pwa.removeOfflineData();
    } catch {
      toast('Gagal menyetel ulang cache offline.');
      return;
    }
    window.location.reload();
  };

  const active = offline === 'ready' || offline === 'error';

  return (
    <div className="card">
      <h3>Aplikasi dan offline</h3>
      <p>
        {STATUS[offline]}
        {offline === 'ready' && version && <span className="tag">cache {version.slice(0, 8)}</span>}
        {standalone && <span className="tag">terpasang</span>}
      </p>
      {updateReady && <div className="notice">Versi baru sudah diunduh. Pakai tombol "Muat ulang sekarang" di bagian atas halaman.</div>}
      <div className="row">
        {offline === 'ready' && (
          <button type="button" className="btn" disabled={checking} onClick={() => void check()}>
            {checking ? 'Memeriksa...' : 'Periksa pembaruan'}
          </button>
        )}
        {installable && (
          <button type="button" className="btn primary" onClick={() => void install()}>
            Pasang sebagai aplikasi
          </button>
        )}
        {active && (
          <button type="button" className="btn danger-outline" onClick={() => void reset()}>
            Setel ulang cache offline
          </button>
        )}
      </div>
      {checkedAt !== null && offline === 'ready' && <p className="fine">Pemeriksaan terakhir pukul {clock(checkedAt)}.</p>}
      <p className="fine">Cache hanya berisi berkas aplikasi. Versi baru tidak dipakai sebelum pemakai memintanya, supaya halaman tidak dimuat ulang di tengah penulisan ke keyboard.</p>
    </div>
  );
}
