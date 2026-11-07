# Gen75 Studio

Aplikasi konfigurasi berbasis web untuk keyboard ElecFox Gen 75 (75%, mode kabel, 2.4G, Bluetooth). Idenya mirip VIA, tetapi khusus papan ini: definisi sudah tertanam, ada backup dengan snapshot otomatis, dan antarmuka Bahasa Indonesia.

Proyek pribadi, belum ada rilis. Bukan produk resmi pabrikan.

## Fitur saat ini

- Sambung lewat WebHID (Chrome atau Edge), sambung otomatis bila perangkat sudah pernah diizinkan.
- Keymap semua layer: kanvas dari definisi, pilih satu atau beberapa tombol, palet keycode dengan pencarian dan kolom keycode bebas, undo dan redo.
- Lighting: menu dibangun dari definisi perangkat (brightness, efek, kecepatan, warna), disimpan ke keyboard setelah berhenti digeser.
- Backup berkas JSON dan snapshot otomatis di browser; pemulihan menampilkan ringkasan perubahan dulu.
- Keselamatan: mode baca saja untuk protokol di bawah 12, daftar putih perintah HID, verifikasi baca-ulang setiap tulis, konfirmasi untuk keycode berisiko.
- Mode simulasi untuk mencoba tanpa keyboard.

Belum ada: makro, tester, panel fungsi Gen 75, profil, pembaruan firmware. Urutannya ada di peta jalan `RANCANGAN.md`.

## Menjalankan

Butuh Node 20 atau lebih baru.

```bash
npm install
npm run dev
```

Buka alamat yang tampil di Chrome atau Edge. Untuk memakai keyboard asli: sambung lewat kabel USB dan tutup tab VIA atau aplikasi lain yang sedang memakai perangkat. Untuk mencoba tanpa keyboard, klik "Coba tanpa keyboard (simulasi)".

Perintah lain:

```bash
npm test
npm run typecheck
npm run build
```

## Isi repo

| Jalur | Keterangan |
|---|---|
| `src/` | kode aplikasi (React, TypeScript) |
| `test/` | tes unit untuk inti aplikasi dan store |
| `RANCANGAN.md` | rancangan lengkap: fakta perangkat, fitur, UI, arsitektur, protokol, peta jalan |
| `prototype/index.html` | prototipe UI statis, buka langsung di browser |
| `tools/probe/` | halaman probe WebHID yang hanya membaca, untuk memeriksa kemampuan firmware |
| `GEN 75.JSON` | definisi VIA v3 bawaan pabrikan, dibaca langsung oleh aplikasi |

Berkas firmware pabrikan (`gen75.bin`) sengaja tidak disertakan.

## Status

- Inti protokol, store, dan UI sudah jalan dan diuji dengan perangkat simulasi: 93 tes unit, typecheck, build produksi, dan uji manual di browser.
- Belum pernah dijalankan pada keyboard fisik. Jalankan `tools/probe/` lebih dulu untuk memastikan firmware menjawab sesuai dugaan sebelum menulis apa pun lewat aplikasi ini.
- Penulisan hanya dibuka untuk protokol VIA 12 ke atas.
