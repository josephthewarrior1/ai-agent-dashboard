# Hermes HQ

Kantor 3D interaktif untuk memantau lima bot Hermes yang sudah berjalan. React Three Fiber merender ruangan, karakter, meja, dan jalur gerak; UI React menampilkan percakapan tiap bot saat dipilih.

Project berjalan di lokal. GitHub menyimpan source dan hasil build; Office belum dipasang kembali ke VPS.

## Jalankan di lokal

Butuh Python 3.10 atau lebih baru. Backend memakai standard library Python. Hasil build frontend sudah disertakan, jadi Node tidak dibutuhkan untuk menjalankan versi ini.

```powershell
$env:HERMES_URL = 'https://dashboard-hermes-lo.example'
$env:OFFICE_DATA_DIR = Join-Path (Get-Location) '.local/monitor-data'
python office-standalone/app.py --port 9140
```

Buka [http://127.0.0.1:9140](http://127.0.0.1:9140). Isi `HERMES_URL` dengan dashboard Hermes yang sudah ada. Login melalui **Hubungkan riwayat chat** memakai akun dashboard tersebut untuk membuka percakapan privat. Password dibuang setelah login resmi; cookie hanya berada di folder runtime lokal yang diabaikan Git.

## Kantor dan pemantauan

- Lima karakter mempunyai meja sendiri dan nama di atas kepala. Pilih karakter atau nama bot untuk melihat tugas, aktivitas, tool, dan chat bot itu.
- Putar atau geser kamera, zoom, reset, atau pilih tampilan atas 2D.
- Area kantor mencakup ruang kerja, meeting, fokus, riset, perpustakaan, server, lounge, pantry, resepsionis, dan taman, dengan jalur gerak karakter.
- **Live** membaca data Hermes. **Simulasi** memberi contoh alur kerja 3D tanpa membuat tugas atau memanggil model AI di server.
- Gerakan santai hanya animasi visual. Gateway yang aktif bukan bukti bot sedang mengerjakan tugas; nilai yang tidak diberikan sumber tetap ditampilkan sebagai belum tersedia.
- Pesan dan tool baru dapat muncul sebentar dekat karakter. Riwayat lama tidak ditampilkan seolah baru masuk. Cuplikan hanya disimpan di memori halaman.
- Percakapan dipisah per bot, kanal, dan sesi. Riwayat mengikuti sumber, termasuk urutan pesan, informasi tool, dan timestamp yang tersedia. Riwayat ini tidak menjamin arsip permanen setelah sesi dihapus dari Hermes.
- Pause/restart bot tidak tersedia pada koneksi pembaca ini. Kontrol gerak hanya menjeda animasi kantor.

Koneksi utama mempoll endpoint baca saat halaman aktif. Frontend juga siap menerima enam jenis event WebSocket untuk status, tugas, pesan, tool, dan perpindahan. Format dan pengaturan sambungan ada di [panduan frontend](office-standalone/frontend/README.md).

## Mengubah frontend

Gunakan Node 20.19+ atau 22.12+.

```powershell
cd office-standalone/frontend
npm ci
npm run build
```

Build membuat aset di `office-standalone/web/3d` dan mengganti entry halaman utama. Backend tetap berjalan di port 9140. Untuk hot reload, jalankan backend terlebih dahulu lalu `npm run dev`; buka [http://127.0.0.1:9142/3d/](http://127.0.0.1:9142/3d/).

## Pemeriksaan

```powershell
python -B -m unittest discover -s office-standalone/tests -p 'test_*.py'
cd office-standalone/frontend
npm test
npm run build
```

Source tidak menyertakan password, cookie, chat privat, snapshot bot, atau konfigurasi VPS. Kantor 3D dibuat dari geometri lokal tanpa model atau font eksternal. Aset pixel versi sebelumnya dari [NosytLabs/agent-office](https://github.com/NosytLabs/agent-office) tetap memiliki attribution/license di `office-standalone/web/assets`.
