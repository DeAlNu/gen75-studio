import { createPwa } from './register';
import type { ContainerLike } from './register';
import { pwaStore } from './status';

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const browser = typeof window !== 'undefined' && typeof navigator !== 'undefined';

export const pwa = createPwa({
  store: pwaStore,
  container: browser && window.isSecureContext && 'serviceWorker' in navigator ? (navigator.serviceWorker as unknown as ContainerLike) : undefined,
  reload: () => window.location.reload(),
  now: () => Date.now(),
  cacheNames: () => caches.keys(),
  deleteCache: (name) => caches.delete(name),
  hasCache: (name) => caches.has(name),
});

let deferredInstall: InstallPromptEvent | null = null;

/** Menawarkan pemasangan sebagai aplikasi; hanya ada setelah browser mengirim beforeinstallprompt. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredInstall;
  if (!event) return 'unavailable';
  deferredInstall = null;
  pwaStore.setState({ installable: false });
  await event.prompt();
  return (await event.userChoice).outcome;
}

/** Dipanggil sekali saat aplikasi dimuat. Service worker hanya didaftarkan pada build produksi. */
export function initPwa(): void {
  if (!browser) return;

  const syncOnline = (): void => pwaStore.setState({ online: navigator.onLine !== false });
  window.addEventListener('online', syncOnline);
  window.addEventListener('offline', syncOnline);

  const display = window.matchMedia('(display-mode: standalone)');
  pwaStore.setState({ standalone: display.matches });
  display.addEventListener('change', (e) => pwaStore.setState({ standalone: e.matches }));

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e as InstallPromptEvent;
    pwaStore.setState({ installable: true });
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    pwaStore.setState({ installable: false });
  });

  if (!import.meta.env.PROD) {
    pwaStore.setState({ offline: 'disabled' });
    return;
  }

  void pwa.start('sw.js');
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pwa.recheckIfStale();
  });
}
