import { useEffect, useState } from 'react';
import { ConnectScreen } from '../components/ConnectScreen';
import { isWebHidSupported } from '../core/transport/webhid';
import { BackupView } from '../features/backup/BackupView';
import { KeymapView } from '../features/keymap/KeymapView';
import { LightingView } from '../features/lighting/LightingView';
import { SettingsView } from '../features/settings/SettingsView';
import { appStore, useApp } from '../state/app';
import { ConfirmHost } from './confirm';
import { applyTheme, useSettings } from './useSettings';

type Tab = 'keymap' | 'lighting' | 'backup' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'keymap', label: 'Keymap' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'backup', label: 'Backup' },
  { id: 'settings', label: 'Setelan' },
];

const COMING_SOON = ['Fungsi Gen 75', 'Makro', 'Tester'];

const STATUS_TEXT = {
  idle: 'belum terhubung',
  connecting: 'menyambung',
  ready: 'terhubung',
  error: 'gagal menyambung',
  disconnected: 'terputus',
} as const;

export default function App() {
  const status = useApp((s) => s.status);
  const deviceLabel = useApp((s) => s.deviceLabel);
  const protocolVersion = useApp((s) => s.protocolVersion);
  const simulated = useApp((s) => s.simulated);
  const writable = useApp((s) => s.writable);
  const warnings = useApp((s) => s.warnings);
  const toast = useApp((s) => s.toast);
  const busy = useApp((s) => s.busy);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const theme = useSettings((s) => s.theme);
  const [tab, setTab] = useState<Tab>('keymap');

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    if (!isWebHidSupported()) return;
    const connect = (): void => void appStore.getState().tryAutoConnect();
    connect();
    navigator.hid.addEventListener('connect', connect);
    return () => navigator.hid.removeEventListener('connect', connect);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => appStore.getState().clearToast(), 4500);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    if (tab !== 'lighting') void appStore.getState().flushLighting();
  }, [tab]);

  useEffect(() => {
    const flush = (): void => void appStore.getState().flushLighting();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const ready = status === 'ready';
  const act = appStore.getState();

  let view = <ConnectScreen />;
  if (tab === 'settings') view = <SettingsView />;
  else if (ready) view = tab === 'keymap' ? <KeymapView /> : tab === 'lighting' ? <LightingView /> : <BackupView />;

  return (
    <div className="app">
      <header className="top">
        <span className="brand">
          Gen75 <b>Studio</b>
        </span>
        <span className={`pill${ready ? ' on' : ''}`}>
          <span className="dot" aria-hidden="true" />
          {ready ? `${deviceLabel} · protokol ${protocolVersion}` : STATUS_TEXT[status]}
        </span>
        {ready && simulated && <span className="pill warn">SIMULASI</span>}
        {ready && !writable && <span className="pill warn">BACA SAJA</span>}
        <span className="sp" />
        {ready && (
          <>
            <button type="button" className="btn" disabled={!canUndo || busy || !writable} onClick={() => void act.undo()} title="Urungkan (Ctrl+Z)">
              Undo
            </button>
            <button type="button" className="btn" disabled={!canRedo || busy || !writable} onClick={() => void act.redo()} title="Ulangi (Ctrl+Y)">
              Redo
            </button>
            <button type="button" className="btn" onClick={() => void act.disconnect()}>
              Putuskan
            </button>
          </>
        )}
      </header>

      <div className="main">
        <nav aria-label="Bagian aplikasi">
          {TABS.map((t) => (
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
          {COMING_SOON.map((l) => (
            <button key={l} type="button" disabled title="Dikerjakan di fase berikutnya">
              {l} <span className="tag">segera</span>
            </button>
          ))}
        </nav>

        <main>
          {ready && warnings.length > 0 && (
            <div className="notice" role="status">
              {warnings.map((w) => (
                <div key={w}>{w}</div>
              ))}
            </div>
          )}
          {view}
        </main>
      </div>

      <div className={`toast${toast ? ' on' : ''}`} role="status">
        {toast}
      </div>
      <ConfirmHost />
    </div>
  );
}
