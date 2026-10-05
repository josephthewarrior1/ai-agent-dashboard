# AI Agent Dashboard

Pixel control room untuk memantau bot yang sudah berjalan di Hermes. Semua bot berbagi satu lantai kantor: meja kerja, area meeting, sofa, dan sudut server berada di ruangan yang sama.

Project ini dijalankan dan ditinjau di lokal. GitHub menyimpan source; Office tidak terpasang di VPS.

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
- Pilih bot atau mejanya untuk langsung membuka chat bot tersebut. Filter kanal memisahkan Telegram, WhatsApp, API, dan kanal lain yang tersedia.
- Bot idle berjalan dan berhenti di beberapa tempat di kantor; bot bekerja kembali ke meja. Gerakan hanya visual dan dapat dijeda. Jika perangkat mengurangi animasi, gunakan **Aktifkan gerak** untuk mengizinkannya pada tab ini.
- Buka **Audit chat** untuk memilih bot, kanal, dan sesi percakapan. Riwayat mengikuti data Hermes; status idle tidak berarti riwayat chat kosong.
- Idle, bekerja, offline, dan status belum pasti mengikuti data gateway; sesi yang baru aktif bukan bukti bot sedang bekerja.
- Mode utama membaca endpoint status Hermes. Provider/model AI dan API key tidak diperlukan untuk pemantauan ini.
- Status bot dapat dibaca tanpa login. Riwayat chat privat membutuhkan login sekali melalui halaman **Hubungkan riwayat chat**, menggunakan akun dashboard Hermes yang sudah ada.
- Password tidak disimpan. Sesi login disimpan di folder runtime lokal; isi percakapan tidak masuk ke GitHub maupun snapshot status bot.
- Riwayat chat adalah pembaca sesi Hermes. Ia tidak menjamin rekaman permanen jika sesi dihapus di sumber.
- Source dipoll saat halaman terbuka, dengan cache, pembatasan request, dan penyimpanan data terakhir ketika koneksi gagal.

## Pemeriksaan

```powershell
python -B -m unittest discover -s office-standalone/tests -p 'test_*.py'
node --test office-standalone/tests/test_motion.cjs
```

Frontend memakai HTML, CSS, dan JavaScript tanpa build step. Sprite berasal dari [NosytLabs/agent-office](https://github.com/NosytLabs/agent-office). Latar kantor baru dibuat mengikuti referensi pengguna; prompt dan notice/license aset ada di `office-standalone/web/assets`.

Source di repo ini tidak menyertakan login runtime, cookie, snapshot bot, paket instalasi lama, maupun konfigurasi VPS pribadi.
