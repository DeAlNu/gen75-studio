import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { afterEach, describe, expect, it } from 'vitest';
import { fingerprint, listFiles, renderWorker, TEMPLATE_PATH, WORKER_NAME } from '../tools/pwa/plugin';
import { CACHE_PREFIX, createPwa, queryVersion, RECHECK_MS } from '../src/pwa/register';
import type { ContainerLike, RegistrationLike, WorkerLike } from '../src/pwa/register';
import { createPwaStore } from '../src/pwa/status';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);
const template = readFileSync(TEMPLATE_PATH, 'utf8');

describe('plugin: daftar berkas dan sidik jari', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('listFiles mengurutkan, memakai garis miring, dan melewati sw.js serta peta sumber', () => {
    const dir = mkdtempSync(join(tmpdir(), 'gen75-pwa-'));
    dirs.push(dir);
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'index.html'), 'x');
    writeFileSync(join(dir, 'assets', 'b.js'), 'x');
    writeFileSync(join(dir, 'assets', 'a.css'), 'x');
    writeFileSync(join(dir, 'assets', 'b.js.map'), 'x');
    writeFileSync(join(dir, WORKER_NAME), 'x');
    expect(listFiles(dir)).toEqual(['assets/a.css', 'assets/b.js', 'index.html']);
  });

  it('fingerprint tidak bergantung pada urutan dan berubah bila isi atau nama berubah', () => {
    const a = { path: 'a.js', bytes: bytes('satu') };
    const b = { path: 'b.js', bytes: bytes('dua') };
    const base = fingerprint([a, b]);
    expect(base).toMatch(/^[0-9a-f]{16}$/);
    expect(fingerprint([b, a])).toBe(base);
    expect(fingerprint([a, { path: 'b.js', bytes: bytes('dub') }])).not.toBe(base);
    expect(fingerprint([a, { path: 'c.js', bytes: bytes('dua') }])).not.toBe(base);
    expect(fingerprint([a])).not.toBe(base);
  });

  it('renderWorker mengganti kedua penanda dan menghasilkan JavaScript yang valid', () => {
    const out = renderWorker(template, 'abc123', ['index.html', 'assets/x.js']);
    expect(out).toContain('const VERSION = "abc123";');
    expect(out).not.toContain('__VERSION__');
    expect(out).not.toContain('__FILES__');
    expect(() => new vm.Script(out)).not.toThrow();
  });

  it('renderWorker menolak templat yang kehilangan penanda', () => {
    expect(() => renderWorker('const VERSION = 1;', 'v', [])).toThrow();
  });

  it('awalan cache di templat sama dengan yang dipakai halaman', () => {
    expect(template).toContain(`const PREFIX = '${CACHE_PREFIX}';`);
  });
});

interface FakeEvent {
  waitUntil?: (p: Promise<unknown>) => void;
  respondWith?: (p: Promise<unknown>) => void;
  request?: { method: string; url: string; mode: string; origin?: boolean };
  data?: unknown;
  ports?: { postMessage(m: unknown): void }[];
}

const SCOPE = 'https://example.test/app/';
const FILES = ['index.html', 'assets/app-1.js', 'manifest.webmanifest'];

function loadWorker(version: string, shared: Map<string, Map<string, string>> = new Map()) {
  const source = renderWorker(template, version, FILES);
  const listeners: Record<string, ((e: FakeEvent) => void)[]> = {};
  const fetched: string[] = [];
  const requests: { url: string; cache?: string }[] = [];
  const calls = { skipWaiting: 0, claim: 0 };
  const pending: Promise<unknown>[] = [];
  let failAddAll = false;

  class FakeRequest {
    url: string;
    cache?: string;
    constructor(url: string, init?: { cache?: string }) {
      this.url = url;
      this.cache = init?.cache;
      requests.push(this);
    }
  }

  const caches = {
    async open(name: string) {
      const entries = shared.get(name) ?? new Map<string, string>();
      shared.set(name, entries);
      return {
        async addAll(list: FakeRequest[]) {
          if (failAddAll) throw new Error('unduhan gagal');
          for (const r of list) entries.set(r.url, `isi:${r.url}`);
        },
      };
    },
    async has(name: string) {
      return shared.has(name);
    },
    // Seperti CacheStorage.match dengan cacheName: tidak membuat cache yang belum ada.
    // Meniru server yang menjawab "Vary: Origin": permintaan yang membawa header Origin
    // (skrip modul crossorigin) hanya cocok bila ignoreVary menyala.
    async match(req: string | { url: string; origin?: boolean }, options?: { cacheName?: string; ignoreVary?: boolean }) {
      const entries = options?.cacheName ? shared.get(options.cacheName) : undefined;
      if (!entries) return undefined;
      const url = typeof req === 'string' ? req : req.url;
      const sendsOrigin = typeof req !== 'string' && req.origin === true;
      if (sendsOrigin && options?.ignoreVary !== true) return undefined;
      return entries.has(url) ? { from: 'cache', url } : undefined;
    },
    async keys() {
      return [...shared.keys()];
    },
    async delete(name: string) {
      return shared.delete(name);
    },
  };

  const self = {
    registration: { scope: SCOPE },
    addEventListener: (type: string, fn: (e: FakeEvent) => void) => (listeners[type] ??= []).push(fn),
    skipWaiting: () => {
      calls.skipWaiting += 1;
    },
    clients: {
      claim: async () => {
        calls.claim += 1;
      },
    },
  };

  const context = vm.createContext({
    self,
    caches,
    Request: FakeRequest,
    URL,
    fetch: async (r: { url: string }) => {
      fetched.push(r.url);
      return { from: 'network', url: r.url };
    },
  });
  vm.runInContext(source, context);

  const lifecycle = async (type: 'install' | 'activate'): Promise<void> => {
    const waits: Promise<unknown>[] = [];
    for (const l of listeners[type] ?? []) l({ waitUntil: (p) => waits.push(p) });
    await Promise.all(waits);
  };

  const request = async (url: string, mode = 'cors', method = 'GET', origin = false): Promise<unknown> => {
    let answer: Promise<unknown> | undefined;
    for (const l of listeners.fetch ?? []) {
      l({ request: { method, url, mode, origin }, respondWith: (p) => (answer = p), waitUntil: (p) => pending.push(p) });
    }
    return answer === undefined ? 'dilewatkan' : answer;
  };

  const message = (data: unknown, ports: { postMessage(m: unknown): void }[] = []): void => {
    for (const l of listeners.message ?? []) l({ data, ports, waitUntil: (p) => pending.push(p) });
  };

  /** Menunggu pekerjaan latar (waitUntil) yang dipicu event fetch atau message. */
  const settle = async (): Promise<void> => {
    await Promise.all(pending.splice(0));
  };

  return {
    shared,
    fetched,
    requests,
    calls,
    lifecycle,
    request,
    message,
    settle,
    failDownloads: () => {
      failAddAll = true;
    },
  };
}

describe('service worker hasil render', () => {
  it('instalasi menyimpan semua berkas dengan alamat mutlak dan cache: reload, tanpa skipWaiting otomatis', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    const cache = w.shared.get(`${CACHE_PREFIX}v1`);
    expect([...(cache?.keys() ?? [])]).toEqual(FILES.map((f) => `${SCOPE}${f}`));
    expect(w.requests.every((r) => r.cache === 'reload')).toBe(true);
    expect(w.calls.skipWaiting).toBe(0);
  });

  it('aktivasi hanya menghapus cache lama milik aplikasi ini, lalu mengambil alih halaman', async () => {
    const shared = new Map<string, Map<string, string>>([
      [`${CACHE_PREFIX}lama`, new Map()],
      [`${CACHE_PREFIX}v2`, new Map()],
      ['punya-aplikasi-lain', new Map()],
    ]);
    const w = loadWorker('v2', shared);
    await w.lifecycle('activate');
    expect([...shared.keys()].sort()).toEqual([`${CACHE_PREFIX}v2`, 'punya-aplikasi-lain']);
    expect(w.calls.claim).toBe(1);
  });

  it('navigasi ke akar dan index.html dijawab cangkang dari cache, query diabaikan', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    expect(await w.request(SCOPE, 'navigate')).toEqual({ from: 'cache', url: `${SCOPE}index.html` });
    expect(await w.request(`${SCOPE}index.html?x=1`, 'navigate')).toEqual({ from: 'cache', url: `${SCOPE}index.html` });
    expect(w.fetched).toEqual([]);
  });

  it('navigasi ke halaman lain di dalam scope tidak dibelokkan ke cangkang', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    expect(await w.request(`${SCOPE}tools/probe/index.html`, 'navigate')).toBe('dilewatkan');
  });

  it('berkas yang disimpan dijawab dari cache, yang tidak ada diambil dari jaringan', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    expect(await w.request(`${SCOPE}assets/app-1.js`)).toEqual({ from: 'cache', url: `${SCOPE}assets/app-1.js` });
    expect(await w.request(`${SCOPE}assets/lain.js`)).toEqual({ from: 'network', url: `${SCOPE}assets/lain.js` });
  });

  it('skrip modul yang membawa header Origin tetap cocok walau server memakai Vary: Origin', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    expect(await w.request(`${SCOPE}assets/app-1.js`, 'cors', 'GET', true)).toEqual({ from: 'cache', url: `${SCOPE}assets/app-1.js` });
    expect(w.fetched).toEqual([]);
  });

  it('permintaan non-GET dan lintas origin tidak disentuh', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    expect(await w.request(`${SCOPE}assets/app-1.js`, 'cors', 'POST')).toBe('dilewatkan');
    expect(await w.request('https://lain.test/app/assets/app-1.js')).toBe('dilewatkan');
  });

  it('hanya membaca cache versinya sendiri, bukan cache versi lain', async () => {
    const shared = new Map<string, Map<string, string>>([[`${CACHE_PREFIX}lama`, new Map([[`${SCOPE}index.html`, 'lama']])]]);
    const w = loadWorker('baru', shared);
    expect(await w.request(SCOPE, 'navigate')).toEqual({ from: 'network', url: SCOPE });
  });

  it('cache yang hilang diisi ulang saat navigasi, tanpa membuat cache kosong lebih dulu', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    w.shared.delete(`${CACHE_PREFIX}v1`);
    // permintaan biasa tidak boleh membuat cache kosong
    expect(await w.request(`${SCOPE}assets/app-1.js`)).toEqual({ from: 'network', url: `${SCOPE}assets/app-1.js` });
    expect(w.shared.has(`${CACHE_PREFIX}v1`)).toBe(false);
    // navigasi jatuh ke jaringan, lalu cache diisi ulang di latar
    expect(await w.request(SCOPE, 'navigate')).toEqual({ from: 'network', url: SCOPE });
    await w.settle();
    expect([...(w.shared.get(`${CACHE_PREFIX}v1`)?.keys() ?? [])]).toEqual(FILES.map((f) => `${SCOPE}${f}`));
    expect(await w.request(SCOPE, 'navigate')).toEqual({ from: 'cache', url: `${SCOPE}index.html` });
  });

  it('cache yang masih ada tidak diunduh ulang saat navigasi', async () => {
    const w = loadWorker('v1');
    await w.lifecycle('install');
    const before = w.requests.length;
    await w.request(SCOPE, 'navigate');
    await w.settle();
    expect(w.requests.length).toBe(before);
  });

  it('pemulihan yang gagal tidak membuat navigasi gagal', async () => {
    const w = loadWorker('v1');
    w.failDownloads();
    expect(await w.request(SCOPE, 'navigate')).toEqual({ from: 'network', url: SCOPE });
    await expect(w.settle()).resolves.toBeUndefined();
  });

  it('HEAL mengisi ulang cache dan melaporkan hasilnya lewat port', async () => {
    const w = loadWorker('v1');
    const replies: unknown[] = [];
    w.message({ type: 'HEAL' }, [{ postMessage: (m: unknown) => replies.push(m) }]);
    await w.settle();
    expect(w.shared.has(`${CACHE_PREFIX}v1`)).toBe(true);
    expect(replies).toEqual([{ ok: true }]);
  });

  it('HEAL melaporkan gagal bila unduhan gagal', async () => {
    const w = loadWorker('v1');
    w.failDownloads();
    const replies: unknown[] = [];
    w.message({ type: 'HEAL' }, [{ postMessage: (m: unknown) => replies.push(m) }]);
    await w.settle();
    expect(replies).toEqual([{ ok: false }]);
  });

  it('SKIP_WAITING memanggil skipWaiting, pesan lain tidak', () => {
    const w = loadWorker('v1');
    w.message({ type: 'tidak-dikenal' });
    w.message(null);
    expect(w.calls.skipWaiting).toBe(0);
    w.message({ type: 'SKIP_WAITING' });
    expect(w.calls.skipWaiting).toBe(1);
  });

  it('VERSION dijawab lewat port pesan', () => {
    const w = loadWorker('v9');
    const replies: unknown[] = [];
    w.message({ type: 'VERSION' }, [{ postMessage: (m) => replies.push(m) }]);
    expect(replies).toEqual([{ version: 'v9' }]);
  });
});

class FakeWorker implements WorkerLike {
  state: string;
  messages: unknown[] = [];
  /** Hasil pengisian ulang cache yang dilaporkan worker; dapat juga mengubah keadaan cache palsu. */
  onHeal: () => boolean = () => true;
  private listeners: (() => void)[] = [];
  constructor(state = 'installing') {
    this.state = state;
  }
  postMessage(message: unknown, transfer?: Transferable[]): void {
    this.messages.push(message);
    const port = transfer?.[0] as MessagePort | undefined;
    const type = (message as { type?: string }).type;
    if (port && type === 'VERSION') {
      port.postMessage({ version: 'cache-uji' });
      port.close();
    } else if (port && type === 'HEAL') {
      port.postMessage({ ok: this.onHeal() });
      port.close();
    }
  }
  addEventListener(_type: 'statechange', listener: () => void): void {
    this.listeners.push(listener);
  }
  move(state: string): void {
    this.state = state;
    for (const l of this.listeners) l();
  }
}

class FakeRegistration implements RegistrationLike {
  installing: FakeWorker | null = null;
  waiting: FakeWorker | null = null;
  active: FakeWorker | null = null;
  updates = 0;
  unregistered = 0;
  failUpdate = false;
  private found: (() => void)[] = [];
  addEventListener(_type: 'updatefound', listener: () => void): void {
    this.found.push(listener);
  }
  async update(): Promise<void> {
    this.updates += 1;
    if (this.failUpdate) throw new Error('jaringan putus');
  }
  async unregister(): Promise<boolean> {
    this.unregistered += 1;
    return true;
  }
  updateFound(worker: FakeWorker): void {
    this.installing = worker;
    for (const l of this.found) l();
  }
}

class FakeContainer implements ContainerLike {
  controller: FakeWorker | null = null;
  registered: string[] = [];
  failRegister = false;
  private changes: (() => void)[] = [];
  constructor(readonly reg: FakeRegistration) {}
  async register(url: string): Promise<RegistrationLike> {
    this.registered.push(url);
    if (this.failRegister) throw new Error('ditolak');
    return this.reg;
  }
  addEventListener(_type: 'controllerchange', listener: () => void): void {
    this.changes.push(listener);
  }
  switchController(): void {
    for (const l of this.changes) l();
  }
}

function setup(prepare: (reg: FakeRegistration, container: FakeContainer) => void = () => undefined) {
  const reg = new FakeRegistration();
  const container = new FakeContainer(reg);
  prepare(reg, container);
  const store = createPwaStore();
  const clock = { t: 1_000_000 };
  const log = { reloads: 0, deleted: [] as string[] };
  const names = [`${CACHE_PREFIX}a`, `${CACHE_PREFIX}b`, 'milik-lain'];
  /** Cache yang dianggap ada di browser; bawaan: cache versi yang dilaporkan FakeWorker. */
  const present = new Set([`${CACHE_PREFIX}cache-uji`]);
  const pwa = createPwa({
    store,
    container,
    reload: () => {
      log.reloads += 1;
    },
    now: () => clock.t,
    cacheNames: async () => names,
    deleteCache: async (n) => {
      log.deleted.push(n);
      return true;
    },
    hasCache: async (n) => present.has(n),
  });
  return { reg, container, store, pwa, clock, log, present };
}

describe('siklus hidup PWA di halaman', () => {
  it('tanpa dukungan service worker: status unsupported', async () => {
    const store = createPwaStore();
    const pwa = createPwa({ store, container: undefined, reload: () => undefined, now: () => 0 });
    await pwa.start('sw.js');
    expect(store.getState().offline).toBe('unsupported');
  });

  it('pendaftaran gagal: status error', async () => {
    const s = setup((_r, c) => {
      c.failRegister = true;
    });
    await s.pwa.start('sw.js');
    expect(s.store.getState().offline).toBe('error');
  });

  it('instalasi pertama: installing, lalu ready tanpa menandai pembaruan', async () => {
    const worker = new FakeWorker();
    const s = setup((r) => {
      r.installing = worker;
    });
    await s.pwa.start('sw.js');
    expect(s.container.registered).toEqual(['sw.js']);
    expect(s.store.getState().offline).toBe('installing');
    worker.move('installed');
    expect(s.store.getState()).toMatchObject({ offline: 'ready', updateReady: false });
  });

  it('instalasi pertama gagal: error', async () => {
    const worker = new FakeWorker();
    const s = setup((r) => {
      r.installing = worker;
    });
    await s.pwa.start('sw.js');
    worker.move('redundant');
    expect(s.store.getState().offline).toBe('error');
  });

  it('kunjungan berikutnya dengan versi aktif: ready dan versi cache terbaca', async () => {
    const s = setup((r, c) => {
      r.active = new FakeWorker('activated');
      c.controller = r.active;
    });
    await s.pwa.start('sw.js');
    expect(s.store.getState()).toMatchObject({ offline: 'ready', updateReady: false, version: 'cache-uji' });
  });

  it('cache versi aktif ada: tidak ada permintaan pengisian ulang', async () => {
    const worker = new FakeWorker('activated');
    const s = setup((r, c) => {
      r.active = worker;
      c.controller = worker;
    });
    await s.pwa.start('sw.js');
    expect(worker.messages).toEqual([{ type: 'VERSION' }]);
    expect(s.store.getState().offline).toBe('ready');
  });

  it('cache versi aktif hilang: worker diminta mengisi ulang, lalu status kembali ready', async () => {
    const worker = new FakeWorker('activated');
    const s = setup((r, c) => {
      r.active = worker;
      c.controller = worker;
    });
    s.present.clear();
    worker.onHeal = () => {
      s.present.add(`${CACHE_PREFIX}cache-uji`);
      return true;
    };
    const seen: string[] = [];
    s.store.subscribe((state) => seen.push(state.offline));
    await s.pwa.start('sw.js');
    expect(worker.messages).toContainEqual({ type: 'HEAL' });
    expect(seen).toContain('installing');
    expect(s.store.getState().offline).toBe('ready');
  });

  it('pengisian ulang gagal: status error, bukan ready yang menyesatkan', async () => {
    const worker = new FakeWorker('activated');
    const s = setup((r, c) => {
      r.active = worker;
      c.controller = worker;
    });
    s.present.clear();
    worker.onHeal = () => false;
    await s.pwa.start('sw.js');
    expect(s.store.getState().offline).toBe('error');
  });

  it('worker melapor berhasil tetapi cache tetap tidak ada: status error', async () => {
    const worker = new FakeWorker('activated');
    const s = setup((r, c) => {
      r.active = worker;
      c.controller = worker;
    });
    s.present.clear();
    await s.pwa.start('sw.js');
    expect(s.store.getState().offline).toBe('error');
  });

  it('versi menunggu saat dimuat: updateReady langsung menyala', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
    });
    await s.pwa.start('sw.js');
    expect(s.store.getState().updateReady).toBe(true);
  });

  it('pembaruan yang ditemukan kemudian: updateReady, status offline tetap ready', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    await s.pwa.start('sw.js');
    const next = new FakeWorker();
    s.reg.updateFound(next);
    expect(s.store.getState()).toMatchObject({ offline: 'ready', updateReady: false });
    next.move('installed');
    expect(s.store.getState()).toMatchObject({ offline: 'ready', updateReady: true });
  });

  it('pembaruan yang gagal dipasang tidak mengubah status', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    await s.pwa.start('sw.js');
    const next = new FakeWorker();
    s.reg.updateFound(next);
    next.move('redundant');
    expect(s.store.getState()).toMatchObject({ offline: 'ready', updateReady: false });
  });

  it('applyUpdate tanpa versi menunggu mengembalikan false dan tidak mengirim apa pun', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    await s.pwa.start('sw.js');
    expect(s.pwa.applyUpdate()).toBe(false);
  });

  it('muat ulang hanya terjadi setelah applyUpdate, dan hanya sekali', async () => {
    const waiting = new FakeWorker('installed');
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
      r.waiting = waiting;
    });
    await s.pwa.start('sw.js');
    // controllerchange tanpa permintaan pengguna (misalnya claim saat instalasi pertama) tidak memuat ulang
    s.container.switchController();
    expect(s.log.reloads).toBe(0);
    expect(s.pwa.applyUpdate()).toBe(true);
    expect(waiting.messages).toEqual([{ type: 'SKIP_WAITING' }]);
    expect(s.log.reloads).toBe(0);
    s.container.switchController();
    s.container.switchController();
    expect(s.log.reloads).toBe(1);
  });

  it('checkForUpdate memanggil update, mencatat waktu, dan menolak pemeriksaan bersamaan', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    await s.pwa.start('sw.js');
    s.clock.t += 5000;
    const first = s.pwa.checkForUpdate();
    expect(s.store.getState().checking).toBe(true);
    expect(await s.pwa.checkForUpdate()).toBe(false);
    expect(await first).toBe(true);
    expect(s.reg.updates).toBe(1);
    expect(s.store.getState()).toMatchObject({ checking: false, checkedAt: s.clock.t });
  });

  it('checkForUpdate yang gagal melapor false dan melepas status memeriksa', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
      r.failUpdate = true;
    });
    await s.pwa.start('sw.js');
    expect(await s.pwa.checkForUpdate()).toBe(false);
    expect(s.store.getState().checking).toBe(false);
  });

  it('recheckIfStale melewati pemeriksaan yang masih baru dan menjalankan yang sudah lama', async () => {
    const s = setup((r) => {
      r.active = new FakeWorker('activated');
    });
    await s.pwa.start('sw.js');
    s.clock.t += RECHECK_MS - 1;
    expect(await s.pwa.recheckIfStale()).toBe(false);
    expect(s.reg.updates).toBe(0);
    s.clock.t += 2;
    expect(await s.pwa.recheckIfStale()).toBe(true);
    expect(s.reg.updates).toBe(1);
  });

  it('removeOfflineData mencabut worker, hanya menghapus cache milik aplikasi, dan mengosongkan status', async () => {
    const s = setup((r, c) => {
      r.active = new FakeWorker('activated');
      r.waiting = new FakeWorker('installed');
      c.controller = r.active;
    });
    await s.pwa.start('sw.js');
    await s.pwa.removeOfflineData();
    expect(s.reg.unregistered).toBe(1);
    expect(s.log.deleted.sort()).toEqual([`${CACHE_PREFIX}a`, `${CACHE_PREFIX}b`]);
    expect(s.store.getState()).toMatchObject({ offline: 'idle', updateReady: false, version: null });
    expect(s.pwa.applyUpdate()).toBe(false);
  });
});

describe('queryVersion', () => {
  it('mengembalikan null bila worker tidak menjawab tepat waktu', async () => {
    const silent: WorkerLike = { state: 'activated', postMessage: () => undefined, addEventListener: () => undefined };
    expect(await queryVersion(silent, 20)).toBeNull();
  });

  it('mengembalikan null bila jawaban bukan string', async () => {
    const odd: WorkerLike = {
      state: 'activated',
      postMessage: (_m: unknown, transfer?: Transferable[]) => {
        const port = transfer?.[0] as MessagePort;
        port.postMessage({ version: 42 });
        port.close();
      },
      addEventListener: () => undefined,
    };
    expect(await queryVersion(odd, 200)).toBeNull();
  });
});
