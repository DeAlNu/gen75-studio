// Service worker Gen75 Studio. Berkas ini hanya templat: saat build, plugin di
// tools/pwa/plugin.ts mengganti VERSION dan FILES, lalu menulisnya sebagai dist/sw.js.
//
// Aturan yang dipegang:
// - Semua berkas aplikasi disimpan saat instalasi, jadi aplikasi jalan tanpa internet.
// - Versi baru menunggu. Halaman tidak dimuat ulang sendiri karena bisa terjadi di tengah
//   penulisan ke keyboard; pengguna yang memutuskan lewat pesan SKIP_WAITING.
// - Hanya GET dari origin yang sama yang dilayani. Selain itu lewat ke jaringan apa adanya.
// - Cache yang hilang (dihapus saat tab lain masih memakai worker ini, atau dibuang browser)
//   diisi ulang tanpa menunggu pemasangan baru.
'use strict';

const VERSION = '__VERSION__';
const FILES = __FILES__;
const PREFIX = 'gen75-studio-';
const CACHE = PREFIX + VERSION;

const scope = new URL(self.registration.scope);
const shell = new URL('index.html', scope);

const absolute = (path) => new URL(path, scope).href;

// Hanya akar aplikasi dan index.html yang dijawab dengan cangkang aplikasi.
const isShellPath = (url) => url.pathname === scope.pathname || url.pathname === shell.pathname;

// cache: 'reload' melewati cache HTTP supaya berkas dari satu build tidak tercampur dengan build lain.
const precache = () =>
  caches.open(CACHE).then((cache) => cache.addAll(FILES.map((path) => new Request(absolute(path), { cache: 'reload' }))));

// Mengisi ulang hanya bila cache-nya tidak ada. Memakai has(), bukan open(), karena open() membuat cache kosong.
const heal = () => caches.has(CACHE).then((exists) => (exists ? undefined : precache()));

// ignoreVary wajib: server dev menjawab dengan "Vary: Origin", dan skrip modul bertanda crossorigin
// mengirim header Origin yang tidak ada pada permintaan saat instalasi. Tanpa opsi ini pencocokan
// meleset dan halaman gagal dimuat saat offline. Aman karena tiap alamat hanya punya satu isi per versi.
// Mencari lewat caches.match dengan cacheName supaya tidak membuat cache kosong bila cache-nya hilang.
const lookup = (request) => caches.match(request, { cacheName: CACHE, ignoreVary: true });

self.addEventListener('install', (event) => {
  event.waitUntil(precache());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name.startsWith(PREFIX) && name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;
  const reply = event.ports && event.ports[0];
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (data.type === 'VERSION' && reply) {
    reply.postMessage({ version: VERSION });
  } else if (data.type === 'HEAL') {
    const job = heal().then(
      () => true,
      () => false,
    );
    event.waitUntil(job);
    if (reply) job.then((ok) => reply.postMessage({ ok }));
  }
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== scope.origin) return;

  if (request.mode === 'navigate') {
    if (!isShellPath(url)) return;
    // Pemulihan tidak ditunggu: muat kali ini jatuh ke jaringan, muat berikutnya sudah bisa offline.
    event.waitUntil(heal().catch(() => undefined));
    event.respondWith(lookup(shell.href).then((hit) => hit || fetch(request)));
    return;
  }

  event.respondWith(lookup(request).then((hit) => hit || fetch(request)));
});
