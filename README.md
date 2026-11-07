# Gen75 Studio

Aplikasi konfigurasi berbasis web untuk keyboard ElecFox Gen 75 (75%, mode kabel, 2.4G, Bluetooth). Idenya mirip VIA, tetapi khusus papan ini: definisi sudah tertanam, ada backup dengan snapshot otomatis, dan antarmuka Bahasa Indonesia.

Proyek pribadi, belum ada rilis. Bukan produk resmi pabrikan.

## Fitur saat ini

- Sambung lewat WebHID (Chrome atau Edge), sambung otomatis bila perangkat sudah pernah diizinkan.
- **Keymap** semua layer: kanvas dari definisi, pilih satu atau beberapa tombol, palet keycode dengan pencarian dan kolom keycode bebas, undo dan redo.
- **Putaran knob**: keycode searah dan berlawanan jarum jam per layer, bila firmware mendukung encoder map.
- **Fungsi Gen 75**: sebelas keycode khas papan ini (mode koneksi, Win-lock, dan lainnya) dengan penjelasan, dipasang ke tombol lewat satu klik.
- **Makro**: editor aksi (ketuk, tahan, lepas, jeda, teks), perekam dari keyboard, indikator memori, draf yang disimpan sekaligus dan diverifikasi.
- **Tester**: membaca keadaan matriks langsung dari keyboard (termasuk Fn dan knob), dengan cadangan lewat event browser.
- **Lighting**: menu dibangun dari definisi perangkat (brightness, efek, kecepatan, warna), disimpan ke keyboard setelah berhenti digeser.
- **Profil**: simpan keadaan keyboard sebagai profil bernama (sampai 30), tukar cepat dari bilah atas dengan ringkasan perubahan dan konfirmasi, pilih bagian yang diterapkan (keymap, knob, makro, lighting), ekspor dan impor berkas profil. Daftar profil dan impor tetap bisa dibuka tanpa keyboard.
- **Bandingkan**: selisih antara keyboard sekarang, profil, atau snapshot (keycode per layer dengan kanvas bertanda, putaran knob, makro, lighting), tanpa menulis apa pun.
- **Backup** berkas JSON (keymap, knob, makro, lighting) dan snapshot otomatis di browser; pemulihan menampilkan ringkasan perubahan dulu.
- Keselamatan: mode baca saja untuk protokol di bawah 12, daftar putih perintah HID, verifikasi baca-ulang setiap tulis, konfirmasi untuk keycode berisiko.
- Mode simulasi untuk mencoba tanpa keyboard.

Belum ada: impor dan ekspor format VIA, bahasa Inggris, mode offline (PWA). Pembaruan firmware dan aplikasi desktop sengaja tidak dibuat; alasannya ada di `RANCANGAN.md` bagian 13.1.

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

- Inti protokol, store, dan UI sudah jalan dan diuji dengan perangkat simulasi: tes unit, typecheck, build produksi, dan uji manual di browser.
- Belum pernah dijalankan pada keyboard fisik. Jalankan `tools/probe/` lebih dulu untuk memastikan firmware menjawab sesuai dugaan sebelum menulis apa pun lewat aplikasi ini.
- Penulisan hanya dibuka untuk protokol VIA 12 ke atas.
- Format makro mengikuti dugaan dari QMK dan belum dibandingkan dengan makro buatan VIA pada perangkat nyata.
