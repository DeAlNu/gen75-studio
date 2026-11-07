import { isWebHidSupported } from '../core/transport/webhid';
import { appStore, useApp } from '../state/app';

export function ConnectScreen() {
  const status = useApp((s) => s.status);
  const error = useApp((s) => s.error);
  const supported = isWebHidSupported();
  const connecting = status === 'connecting';
  const act = appStore.getState();

  return (
    <section className="connect">
      <h1>Sambungkan keyboard Gen 75</h1>
      <p className="lead">
        Aplikasi membaca dan mengubah keymap serta lighting langsung lewat kabel USB. Sebelum mengubah apa pun, keadaan keyboard disimpan sebagai
        snapshot di browser ini.
      </p>

      {!supported && (
        <div className="notice bad" role="alert">
          Browser ini tidak mendukung WebHID. Pakai Chrome atau Edge versi terbaru.
        </div>
      )}
      {status === 'disconnected' && (
        <div className="notice" role="status">
          Keyboard terputus. Sambungkan ulang kabelnya, lalu klik Sambungkan.
        </div>
      )}
      {status === 'error' && error && (
        <div className="notice bad" role="alert">
          {error}
        </div>
      )}

      <ol className="steps">
        <li>Sambungkan keyboard lewat kabel USB (mode kabel).</li>
        <li>Tutup tab VIA dan aplikasi lain yang memakai keyboard.</li>
        <li>Klik Sambungkan, lalu pilih perangkat di dialog browser.</li>
      </ol>

      <div className="row">
        <button type="button" className="btn primary" disabled={!supported || connecting} onClick={() => void act.connectWebHid()}>
          {connecting ? 'Menyambung...' : 'Sambungkan keyboard'}
        </button>
        <button type="button" className="btn" disabled={connecting} onClick={() => void act.connectMock()}>
          Coba tanpa keyboard (simulasi)
        </button>
      </div>

      <p className="fine">Versi awal: belum diuji pada keyboard fisik. Mode simulasi memakai perangkat palsu di dalam halaman ini.</p>
    </section>
  );
}
