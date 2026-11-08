import { useEffect } from 'react';
import { ConnectScreen } from '../components/ConnectScreen';
import { ProfileSwitcher } from '../components/ProfileSwitcher';
import { PwaBanner } from '../components/PwaBanner';
import { isWebHidSupported } from '../core/transport/webhid';
import { BackupView } from '../features/backup/BackupView';
import { FunctionsView } from '../features/functions/FunctionsView';
import { KeymapView } from '../features/keymap/KeymapView';
import { LightingView } from '../features/lighting/LightingView';
import { MacroView } from '../features/macros/MacroView';
import { CompareView } from '../features/profiles/CompareView';
import { ProfilesView } from '../features/profiles/ProfilesView';
import { SettingsView } from '../features/settings/SettingsView';
import { TesterView } from '../features/tester/TesterView';
import { pwaStore, usePwa } from '../pwa/status';
import { appStore, useApp } from '../state/app';
import { ConfirmHost } from './confirm';
import { useUi } from './useUi';
import type { Tab } from './useUi';
import { applyTheme, useSettings } from './useSettings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'keymap', label: 'Keymap' },
  { id: 'lighting', label: 'Lighting' },
  { id: 'functions', label: 'Fungsi Gen 75' },
  { id: 'macros', label: 'Makro' },
  { id: 'tester', label: 'Tester' },
  { id: 'profiles', label: 'Profil' },
  { id: 'compare', label: 'Bandingkan' },
  { id: 'backup', label: 'Backup' },
  { id: 'settings', label: 'Setelan' },
];

/** Bagian yang tetap bisa dibuka tanpa keyboard: pengaturan, profil tersimpan, dan perbandingan. */
const OFFLINE_TABS: readonly Tab[] = ['settings', 'profiles', 'compare'];

const STATUS_TEXT = {
  idle: 'belum terhubung',
  connecting: 'menyambung',
  ready: 'terhubung',
  error: 'gagal menyambung',
  disconnected: 'terputus',
} as const;

function viewFor(tab: Tab) {
  switch (tab) {
    case 'keymap':
      return <KeymapView />;
    case 'lighting':
      return <LightingView />;
    case 'functions':
      return <FunctionsView />;
    case 'macros':
      return <MacroView />;
    case 'tester':
      return <TesterView />;
    case 'profiles':
      return <ProfilesView />;
    case 'compare':
      return <CompareView />;
    case 'backup':
      return <BackupView />;
    case 'settings':
      return <SettingsView />;
  }
}

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
  const tab = useUi((s) => s.tab);
  const online = usePwa((s) => s.online);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    void appStore.getState().loadStored();
  }, []);

  useEffect(
    () =>
      pwaStore.subscribe((s, prev) => {
        if (prev.offline === 'installing' && s.offline === 'ready') appStore.setState({ toast: 'Aplikasi siap dipakai tanpa internet.' });
      }),
    [],
  );

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
    if (status !== 'ready') useUi.getState().resetDeviceState();
  }, [status]);

  useEffect(() => {
    const flush = (): void => void appStore.getState().flushLighting();
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  const ready = status === 'ready';
  const act = appStore.getState();
  const view = OFFLINE_TABS.includes(tab) || ready ? viewFor(tab) : <ConnectScreen />;

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
        {!online && <span className="pill warn">offline</span>}
        {ready && simulated && <span className="pill warn">SIMULASI</span>}
        {ready && !writable && <span className="pill warn">BACA SAJA</span>}
        <span className="sp" />
        {ready && (
          <>
            <ProfileSwitcher />
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
            <button key={t.id} type="button" aria-current={tab === t.id ? 'page' : undefined} onClick={() => useUi.getState().setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>

        <main>
          <PwaBanner />
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
