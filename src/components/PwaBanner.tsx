import { useState } from 'react';
import { pwa } from '../pwa';
import { usePwa } from '../pwa/status';
import { appStore, useApp } from '../state/app';

/** Pemberitahuan versi baru. Memuat ulang hanya atas permintaan pengguna, tidak pernah otomatis. */
export function PwaBanner() {
  const updateReady = usePwa((s) => s.updateReady);
  const busy = useApp((s) => s.busy);
  const [hidden, setHidden] = useState(false);
  const [applying, setApplying] = useState(false);

  if (!updateReady || hidden) return null;

  const apply = async (): Promise<void> => {
    setApplying(true);
    await appStore.getState().flushLighting();
    if (!pwa.applyUpdate()) setApplying(false);
  };

  return (
    <div className="banner" role="status">
      <span>Versi baru Gen75 Studio sudah diunduh. Memuat ulang menghapus riwayat undo dan redo sesi ini.</span>
      <span className="acts">
        <button type="button" className="btn primary" disabled={busy || applying} onClick={() => void apply()}>
          {applying ? 'Memuat ulang...' : 'Muat ulang sekarang'}
        </button>
        <button type="button" className="btn" disabled={applying} onClick={() => setHidden(true)}>
          Nanti
        </button>
      </span>
    </div>
  );
}
