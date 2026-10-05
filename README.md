# AI Agent Dashboard

Pixel control room untuk memantau bot yang sudah berjalan di Hermes. Semua bot berbagi satu lantai kantor: meja kerja, area meeting, sofa, dan sudut server berada di ruangan yang sama.

Project ini dikerjakan dan ditinjau di lokal terlebih dahulu. Perubahan di GitHub tidak otomatis mengubah VPS.

## Jalankan di lokal

Butuh Python 3.10 atau lebih baru. Backend menggunakan standard library Python; tidak perlu memasang package tambahan.

PowerShell:

```powershell
$env:HERMES_URL = 'https://dashboard-hermes-lo.example'
$env:OFFICE_DATA_DIR = Join-Path (Get-Location) '.local/monitor-data'
python office-standalone/app.py --port 9140
```

Buka [http://127.0.0.1:9140](http://127.0.0.1:9140).

Alamat ini menjalankan project di komputer tempat command tersebut dijalankan. Gunakan URL dashboard Hermes yang sudah ada sebagai `HERMES_URL`. Jangan menaruh password atau API key di source maupun GitHub.

## Pemantauan

- Nama bot mengikuti profile Hermes yang sebenarnya.
- Semua karakter dan meja berada dalam satu kantor bersama.
- Pilih bot atau mejanya untuk melihat status dan informasi aktivitas.
- Idle, bekerja, offline, dan status belum pasti mengikuti data gateway; sesi yang baru aktif bukan bukti bot sedang bekerja.
- Mode utama membaca endpoint status Hermes. Provider/model AI dan API key tidak diperlukan untuk pemantauan ini.
- Detail sesi dapat dibuka di dashboard Hermes asli. Penghubung detail sesi melalui akun Hermes bersifat opsional.
- Source dipoll saat halaman terbuka, dengan cache, pembatasan request, dan penyimpanan data terakhir ketika koneksi gagal.

## Pemeriksaan

```powershell
python -B -m unittest discover -s office-standalone/tests -p 'test_*.py'
```

Frontend memakai HTML, CSS, dan JavaScript tanpa build step. Sprite serta notice/license asalnya ada di `office-standalone/web/assets`; aset berasal dari [NosytLabs/agent-office](https://github.com/NosytLabs/agent-office).

Source di repo ini tidak menyertakan login runtime, cookie, snapshot bot, paket instalasi lama, maupun konfigurasi VPS pribadi.
