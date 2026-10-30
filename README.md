# NEV Absenku

Aplikasi absensi digital berbasis web untuk pengelolaan jadwal kegiatan, QR attendance, kehadiran, rekap laporan, geofencing, selfie, izin/sakit, dan surat peringatan.

## Fitur utama

- **STAF:** melihat jadwal, melakukan absensi melalui QR, melihat riwayat/kalender kehadiran, mengajukan izin atau sakit, serta membaca surat peringatan.
- **HRD:** mengelola akun dan kegiatan, membuat QR, memeriksa rekap absensi, mengekspor laporan, mengatur lokasi/radius kantor, dan mengelola surat peringatan.
- **KOOR KP:** mengelola kegiatan/absensi sesuai menu yang diberikan aplikasi dan memantau rekap.
- **Integrasi:** Google Apps Script sebagai API, Google Sheets untuk data pusat, Google Drive untuk file tertentu, dan antrean lokal saat sinkronisasi gagal.
- **Perangkat:** layout responsif untuk desktop dan ponsel; kamera dan geolocation memerlukan izin browser dan biasanya membutuhkan HTTPS atau localhost.

## Struktur repository

| File | Fungsi |
| --- | --- |
| `index.html` | Antarmuka dan logika inti aplikasi |
| `cloud-sync.js` | Login, token sesi, sinkronisasi API, polling, dan antrean retry |
| `geo-selfie.js` / `geo-selfie.css` | Geofencing, peta, lokasi sesi, dan selfie |
| `sp-warning.js` / `sp-warning.css` | Surat peringatan (SP) |
| `nev-logo.png` | Logo aplikasi |
| `persist-login-dan-fix-garis-tabel.patch` | Patch historis; bukan file yang dimuat oleh halaman |

## Menjalankan dan deploy

1. Pastikan Web App Google Apps Script yang dipakai aplikasi tersedia dan sudah memiliki spreadsheet/Drive serta izin yang sesuai.
2. Buka `cloud-sync.js` dan periksa `CLOUD_SCRIPT_URL`. URL tersebut harus menunjuk pada deployment Apps Script yang memang digunakan oleh lingkungan Anda. Jangan menaruh password, API key privat, atau kredensial layanan di dalam JavaScript frontend.
3. Deploy frontend melalui **GitHub Pages**: buka **Settings → Pages**, pilih sumber branch/folder sesuai konfigurasi repository, lalu tunggu status deployment berhasil. Aplikasi ini statis; tidak memerlukan proses build npm.
4. Buka situs yang memakai HTTPS, lalu uji login untuk setiap role dan alur sinkronisasi dengan data uji. Perubahan frontend saja tidak mengubah kode Google Apps Script.
5. Jika URL endpoint Apps Script berubah, perbarui konstanta tersebut, commit, deploy ulang, lalu periksa badge/status sinkronisasi di aplikasi.

> Catatan: kode Google Apps Script/server tidak berada di repository ini. Sebagian perilaku keamanan dan validasi data tidak dapat diverifikasi hanya dari frontend; periksa juga implementasi server sebelum menggunakan data kehadiran sebenarnya.

## Pemeriksaan sebelum rilis

Lakukan pemeriksaan pada browser desktop dan ponsel. Gunakan akun uji untuk setiap role dan jangan menguji fitur hapus/purge terhadap data produksi.

- Login berhasil/gagal, role yang salah ditolak, sesi bertahan sesudah refresh, dan logout mengakhiri sesi di server.
- QR sesi yang aktif diterima; QR untuk sesi yang tidak valid, kedaluwarsa, atau di luar jadwal ditolak sesuai kebijakan.
- Absensi masuk/keluar, izin/sakit, rekap, unduh Excel/PDF, dan surat peringatan menghasilkan data yang konsisten.
- Kamera/lokasi diizinkan, ditolak, atau tidak tersedia; aplikasi menampilkan pesan yang jelas tanpa mencatat absensi yang tidak sah.
- Saat offline atau endpoint gagal, status sinkronisasi terlihat dan perubahan yang didukung antrean dapat dikirim ulang tanpa duplikasi.
- Tidak ada horizontal overflow pada lebar 320 px, 375 px, tablet, dan desktop; tombol dapat digunakan dengan keyboard.
- Pastikan foto, lokasi, identitas, dan token sesi tidak muncul di log, URL, atau laporan publik.

## Catatan keamanan penting

Baca [SECURITY.md](SECURITY.md) sebelum production. Jangan menganggap pembatasan menu atau pemeriksaan geofence di browser sebagai kontrol keamanan server. Endpoint harus memverifikasi sesi, role, kepemilikan data, masa berlaku QR, dan aturan absensi untuk setiap aksi.


## Pusat notifikasi
Pusat notifikasi dalam aplikasi tersedia untuk pengingat kegiatan, status pengajuan izin/sakit/dispen, SP, pengajuan yang menunggu review, dan penyerahan absensi KOOR KP ke HRD. Status baca disimpan secara lokal per akun/perangkat; tidak menambah kolom Google Sheets. Notifikasi dihitung dari data yang sudah diterima aplikasi dan bukan push notification ketika browser ditutup.
