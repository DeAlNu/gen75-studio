import type { PwaStore } from './status';

/** Awalan nama cache; harus sama dengan PREFIX di tools/pwa/sw.template.js. */
export const CACHE_PREFIX = 'gen75-studio-';

/** Jarak minimum antar pemeriksaan otomatis saat tab kembali terlihat. */
export const RECHECK_MS = 30 * 60 * 1000;

const VERSION_TIMEOUT_MS = 1500;
/** Pengisian ulang cache mengunduh semua berkas aplikasi, jadi diberi waktu lebih lama. */
const HEAL_TIMEOUT_MS = 20000;

export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown, transfer: Transferable[]): void;
  postMessage(message: unknown): void;
  addEventListener(type: 'statechange', listener: () => void): void;
}

export interface RegistrationLike {
  readonly installing: WorkerLike | null;
  readonly waiting: WorkerLike | null;
  readonly active: WorkerLike | null;
  addEventListener(type: 'updatefound', listener: () => void): void;
  update(): Promise<unknown>;
  unregister(): Promise<boolean>;
}

export interface ContainerLike {
  readonly controller: WorkerLike | null;
  register(url: string): Promise<RegistrationLike>;
  addEventListener(type: 'controllerchange', listener: () => void): void;
}

export interface PwaEnv {
  store: PwaStore;
  /** navigator.serviceWorker, atau undefined bila tidak tersedia. */
  container: ContainerLike | undefined;
  reload(): void;
  now(): number;
  cacheNames?(): Promise<string[]>;
  deleteCache?(name: string): Promise<boolean>;
  hasCache?(name: string): Promise<boolean>;
}

/**
 * Mengikuti siklus hidup service worker dan menerjemahkannya ke status aplikasi.
 * Pemasangan pertama berarti "siap offline"; pemasangan saat sudah ada versi aktif berarti "pembaruan menunggu".
 */
export function watchRegistration(reg: RegistrationLike, store: PwaStore): void {
  const set = store.setState;

  const track = (worker: WorkerLike): void => {
    const firstInstall = reg.active === null;
    if (firstInstall) set({ offline: 'installing' });
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed') {
        if (firstInstall) set({ offline: 'ready' });
        else set({ updateReady: true });
      } else if (worker.state === 'redundant' && firstInstall && store.getState().offline === 'installing') {
        set({ offline: 'error' });
      }
    });
  };

  if (reg.active || reg.waiting) set({ offline: 'ready' });
  if (reg.waiting && reg.active) set({ updateReady: true });
  if (reg.installing) track(reg.installing);
  reg.addEventListener('updatefound', () => {
    if (reg.installing) track(reg.installing);
  });
}

/** Mengirim pesan ke worker dan menunggu satu jawaban lewat saluran pesan; null bila tidak menjawab tepat waktu. */
function askWorker(worker: WorkerLike, message: unknown, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve(null);
    }, timeoutMs);
    channel.port1.onmessage = (event: MessageEvent<unknown>) => {
      clearTimeout(timer);
      channel.port1.close();
      resolve(event.data);
    };
    worker.postMessage(message, [channel.port2]);
  });
}

/** Menanyakan versi cache kepada worker; null bila tidak menjawab tepat waktu atau jawabannya tidak dikenal. */
export async function queryVersion(worker: WorkerLike, timeoutMs = VERSION_TIMEOUT_MS): Promise<string | null> {
  const answer = (await askWorker(worker, { type: 'VERSION' }, timeoutMs)) as { version?: unknown } | null;
  return typeof answer?.version === 'string' ? answer.version : null;
}

/** Meminta worker mengisi ulang cache-nya bila hilang; true bila worker melaporkan berhasil. */
export async function requestHeal(worker: WorkerLike, timeoutMs = HEAL_TIMEOUT_MS): Promise<boolean> {
  const answer = (await askWorker(worker, { type: 'HEAL' }, timeoutMs)) as { ok?: unknown } | null;
  return answer?.ok === true;
}

export function createPwa(env: PwaEnv) {
  const { store } = env;
  let registration: RegistrationLike | null = null;
  let switching = false;
  let reloading = false;

  async function start(workerUrl: string): Promise<void> {
    const container = env.container;
    if (!container) {
      store.setState({ offline: 'unsupported' });
      return;
    }
    // Memuat ulang hanya bila pengguna sendiri yang meminta pembaruan; claim() saat
    // instalasi pertama juga memicu controllerchange dan tidak boleh memuat ulang halaman.
    container.addEventListener('controllerchange', () => {
      if (!switching || reloading) return;
      reloading = true;
      env.reload();
    });
    try {
      registration = await container.register(workerUrl);
    } catch {
      store.setState({ offline: 'error' });
      return;
    }
    store.setState({ checkedAt: env.now() });
    watchRegistration(registration, store);
    await refreshVersion();
  }

  /** Meminta versi baru dipakai; halaman dimuat ulang setelah worker baru mengambil alih. */
  function applyUpdate(): boolean {
    const waiting = registration?.waiting;
    if (!waiting) return false;
    switching = true;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    return true;
  }

  async function checkForUpdate(): Promise<boolean> {
    if (!registration || store.getState().checking) return false;
    store.setState({ checking: true });
    try {
      await registration.update();
      return true;
    } catch {
      return false;
    } finally {
      store.setState({ checking: false, checkedAt: env.now() });
    }
  }

  /** Dipanggil saat tab kembali terlihat; hanya memeriksa bila pemeriksaan terakhir sudah lama. */
  async function recheckIfStale(): Promise<boolean> {
    const last = store.getState().checkedAt;
    if (last !== null && env.now() - last < RECHECK_MS) return false;
    return checkForUpdate();
  }

  async function refreshVersion(): Promise<void> {
    const worker = env.container?.controller ?? registration?.active ?? null;
    if (!worker) return;
    const version = await queryVersion(worker);
    store.setState({ version });
    if (version !== null) await verifyCache(worker, version);
  }

  /**
   * Registrasi bisa hidup lebih lama dari cache-nya (cache dihapus saat tab lain masih memakai worker,
   * atau dibuang browser). Status "siap offline" hanya dipertahankan bila cache versi ini memang ada.
   */
  async function verifyCache(worker: WorkerLike, version: string): Promise<void> {
    if (!env.hasCache) return;
    const name = `${CACHE_PREFIX}${version}`;
    if (await env.hasCache(name)) return;
    store.setState({ offline: 'installing' });
    const ok = await requestHeal(worker);
    store.setState({ offline: ok && (await env.hasCache(name)) ? 'ready' : 'error' });
  }

  /** Mencabut service worker dan menghapus cache berkas aplikasi. Data pengguna (IndexedDB, localStorage) tidak disentuh. */
  async function removeOfflineData(): Promise<void> {
    if (registration) await registration.unregister();
    const names = (await env.cacheNames?.()) ?? [];
    await Promise.all(names.filter((n) => n.startsWith(CACHE_PREFIX)).map((n) => env.deleteCache?.(n)));
    registration = null;
    store.setState({ offline: 'idle', updateReady: false, version: null });
  }

  return { start, applyUpdate, checkForUpdate, recheckIfStale, refreshVersion, removeOfflineData };
}

export type Pwa = ReturnType<typeof createPwa>;
