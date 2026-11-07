# Gen75 Studio

Aplikasi konfigurasi berbasis web untuk keyboard ElecFox Gen 75 (75%, mode kabel, 2.4G, Bluetooth). Idenya mirip VIA, tetapi khusus papan ini: definisi sudah tertanam, ada panel fungsi khas Gen 75, backup, dan antarmuka Bahasa Indonesia.

Proyek pribadi, belum ada rilis. Bukan produk resmi pabrikan.

## Isi repo

| Jalur | Keterangan |
|---|---|
| `RANCANGAN.md` | rancangan lengkap: fakta perangkat, fitur, UI, arsitektur, protokol, peta jalan |
| `prototype/index.html` | prototipe UI statis, buka langsung di Chrome atau Edge |
| `tools/probe/` | halaman probe WebHID yang hanya membaca, untuk memeriksa kemampuan firmware |
| `GEN 75.JSON` | definisi VIA v3 bawaan pabrikan |

Berkas firmware pabrikan (`gen75.bin`) sengaja tidak disertakan.

## Menjalankan

Prototipe: buka `prototype/index.html` di browser.

Probe: jalankan server lokal dari akar repo, lalu buka alamatnya di Chrome atau Edge.

```bash
python -m http.server 8765
```

Buka `http://localhost:8765/tools/probe/index.html`. Tambahkan `?mock` di akhir alamat untuk mencobanya dengan perangkat simulasi, tanpa keyboard.

Syarat memakai keyboard asli: sambung lewat kabel USB, dan tutup tab VIA atau aplikasi lain yang sedang memakai perangkat.

## Status

- Rancangan dan prototipe selesai.
- Probe sudah diuji dengan perangkat simulasi, belum dengan keyboard fisik.
- Aplikasi utama belum dimulai; urutannya ada di bagian peta jalan `RANCANGAN.md`.
