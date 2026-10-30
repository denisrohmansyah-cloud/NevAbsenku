# NEV Absenku 2.0 — Roadmap Perbaikan Bertahap

Dokumen ini menjadi urutan kerja dan gerbang kualitas untuk pengembangan NEV Absenku 2.0. Perubahan harus mempertahankan kompatibilitas fitur dan data yang sudah berjalan.

## Prinsip wajib

1. Jangan menghapus, mengosongkan, atau menimpa data produksi sebagai bagian dari perbaikan rutin.
2. Jangan mengubah nama key localStorage yang sudah dipakai: `nev_users`, `nev_sessions`, `nev_attendance`, `nev_settings`, `nev_permits`, dan `nev_warnings`, kecuali ada migrasi kompatibel yang telah diuji dan disetujui.
3. Jangan mengubah struktur/nama sheet, kolom, endpoint Apps Script, format ekspor, maupun akses Google Drive tanpa audit dan persetujuan pemilik.
4. Jangan mengubah nilai `DATA_EPOCH` atau menjalankan purge/reset untuk menyelesaikan bug. Perubahan epoch dapat menghapus data lokal dan antrean sinkronisasi.
5. Semua perubahan kode dikerjakan pada feature branch, diperiksa, diuji, dan diajukan melalui Pull Request. Branch `main` tetap stabil.
6. Telegram Bot tidak termasuk dalam arsitektur, dependensi, notifikasi, maupun roadmap NEV Absenku 2.0.

## Baseline arsitektur yang diketahui

- `index.html`: antarmuka dan logika inti aplikasi.
- `cloud-sync.js`: autentikasi/token sisi klien, komunikasi Google Apps Script, polling, dan antrean retry.
- `geo-selfie.js` dan `geo-selfie.css`: geofence, peta, lokasi, dan selfie.
- `sp-warning.js` dan `sp-warning.css`: surat peringatan.
- Google Apps Script menjadi API; Google Sheets menjadi penyimpanan data; Google Drive menyimpan berkas tertentu.
- Kode server Google Apps Script tidak tersedia di repository ini. Karena itu, audit otorisasi server, validasi token, dan keamanan Drive belum dapat dinyatakan selesai hanya dari pemeriksaan frontend.

## Urutan pengerjaan

### Tahap 0 — Audit, stabilisasi, dan perlindungan data

- Catat perilaku fitur yang ada sebagai baseline regresi.
- Petakan alur login, role HRD/STAF/KOOR KP, QR, absensi, izin/sakit, rekap, ekspor, geofence, selfie, SP, dan sinkronisasi.
- Periksa seluruh jalur baca/tulis localStorage dan API sebelum menyentuh logika data.
- Audit risiko sinkronisasi berbasis pengiriman seluruh array, retry, konflik dua perangkat, dan duplikasi.
- Pastikan tidak ada rahasia/kredensial privat di frontend atau log.
- Dokumentasikan bagian yang tidak dapat diverifikasi karena source Apps Script tidak ada.

**Gerbang selesai:** baseline fitur dan data terdokumentasi; pengujian sintaks/CI lulus; tidak ada perubahan destruktif atau perubahan skema.

### Tahap 1 — Keamanan dan integritas data

- Validasi otorisasi di server untuk setiap aksi; identitas aktor harus berasal dari token tervalidasi, bukan role/userId dari browser.
- Tinjau masa berlaku, pencabutan, dan logout token.
- Tinjau validasi QR: konteks sesi, masa berlaku, pencegahan replay, dan validasi server-side.
- Tinjau validasi input, escaping output, akses file Drive, dan minimisasi data sensitif.
- Rancang audit trail untuk perubahan absensi, izin, sesi, akun, dan SP.
- Rancang alur koreksi absensi dengan alasan, aktor, waktu, dan persetujuan bila dibutuhkan.
- Tambahkan proteksi konflik/duplikasi sinkronisasi setelah kontrak API dan perilaku backend dipahami.

**Gerbang selesai:** uji akses langsung ke endpoint membuktikan aksi tanpa izin ditolak; pengujian konflik dan retry tidak menggandakan atau menghilangkan data. Perubahan Apps Script dan skema memerlukan persetujuan terpisah.

### Tahap 2 — Dashboard dan analitik

- Ringkasan kehadiran harian, mingguan, dan bulanan.
- Filter periode, kegiatan, divisi/kelompok, dan status.
- Statistik untuk HRD dan tampilan terbatas sesuai hak akses KOOR KP/STAF.
- Rekap keterlambatan hanya jika aturan jam kerja dan sumber waktunya telah disepakati.
- Pastikan angka dashboard konsisten dengan rekap dan ekspor.

**Gerbang selesai:** angka dashboard cocok dengan data uji terhitung manual dan tidak membocorkan data lintas role.

### Tahap 3 — Notifikasi dalam aplikasi (tanpa Telegram)

- Pusat notifikasi di dalam aplikasi dengan status sudah/belum dibaca.
- Pemberitahuan perubahan status izin/sakit.
- Pengingat sesi/kegiatan berdasarkan jadwal yang tersimpan.
- Pengingat kepada KOOR KP jika kewajiban pengiriman rekap belum dipenuhi, jika alur tersebut memang tersedia.
- Pemberitahuan HRD saat rekap/pengajuan membutuhkan tindak lanjut.
- Pemberitahuan terkait SP hanya kepada pihak yang berwenang dan terkait.
- Ringkasan notifikasi di dashboard; preferensi dan penanda waktu yang jelas.

**Gerbang selesai:** tidak ada notifikasi ganda untuk satu peristiwa; penerima mengikuti role/ownership; tidak ada integrasi Telegram Bot atau token Telegram.

### Tahap 4 — Operasional dan pengalaman pengguna

- Riwayat aktivitas/perangkat login jika backend mendukung dengan aman.
- Pengelolaan profil dan informasi akun.
- Kartu anggota digital atau jadwal pribadi hanya setelah kebutuhan dan sumber datanya disepakati.
- Pengajuan koreksi absensi dan pelacakan status.
- Pengelolaan dokumen dengan akses privat dan batas ukuran/jenis berkas.
- Perbaikan alur SP dan izin tanpa mengubah aturan yang sedang berlaku secara diam-diam.

**Gerbang selesai:** seluruh alur memiliki validasi role, pesan status, dan uji regresi.

### Tahap 5 — UI/UX, aksesibilitas, dan performa

- Konsistensi komponen, navigasi, tabel, formulir, modal, dan notifikasi.
- Responsif pada lebar 320, 375, 768, 1024 px, dan desktop.
- Perbaiki loading, empty state, error state, dan status sinkronisasi.
- Optimalkan pemuatan foto/berkas dan rendering daftar besar tanpa mengubah data.
- Pastikan keyboard navigation, label form, focus state, kontras, dan reduced motion.
- Kurangi polling/permintaan berulang hanya setelah dampaknya terhadap sinkronisasi diuji.

**Gerbang selesai:** checklist regresi lintas role dan perangkat lulus.

## Strategi kompatibilitas dan migrasi

- Pertahankan key localStorage dan bentuk record yang sudah digunakan.
- Pertahankan nama sheet, kolom, endpoint, serta kontrak respons Apps Script sampai audit backend selesai.
- Jika penambahan data benar-benar diperlukan, ajukan desain perubahan terpisah yang menjelaskan kolom/tabel baru, default, kompatibilitas data lama, rollback, dan backup.
- Jalankan migrasi hanya pada salinan data uji terlebih dahulu. Jangan pernah menggunakan purge/reset sebagai migrasi.
- Jangan menghapus field lama sebelum seluruh pembaca/penulis lama dan baru terbukti kompatibel.

## Prosedur setiap perubahan

1. Ambil kondisi terbaru branch `main`.
2. Buat feature branch dengan lingkup kecil dan satu tujuan.
3. Periksa dampak pada fitur, data, role, dan kontrak API.
4. Jalankan pemeriksaan sintaks/CI serta checklist regresi terkait.
5. Catat hasil uji yang benar-benar dilakukan; jangan menyatakan pengujian lulus jika belum dijalankan.
6. Buat Pull Request dengan ringkasan, risiko, bukti uji, dan langkah rollback.
7. Merge/deploy hanya setelah review dan persetujuan yang diperlukan.

## Temuan awal dan batas audit

- Sinkronisasi yang mengirim seluruh array berpotensi menimpa perubahan terbaru saat dua klien menyimpan data bersamaan; perlu pengujian dan rancangan konflik sebelum mengubah mekanismenya.
- Token dan data pengguna tersimpan di localStorage sehingga risiko XSS perlu ditangani.
- Pemeriksaan role/geofence pada frontend bukan pengganti otorisasi server.
- Source Google Apps Script belum ada di repository, sehingga validasi server, penguncian transaksi, dan izin Google Sheets/Drive belum dapat diverifikasi.
- Mekanisme `DATA_EPOCH` memiliki dampak penghapusan data lokal/antrean saat berubah; jangan mengubahnya tanpa rencana migrasi eksplisit.

## Status

- [x] Baseline repository dan dokumen keamanan/regresi diperiksa.
- [x] Urutan roadmap dan gerbang kualitas ditetapkan.
- [ ] Audit detail seluruh jalur data frontend.
- [ ] Audit dan uji source Google Apps Script bersama pemilik.
- [ ] Implementasi tahap 1 setelah audit membuktikan perubahan yang aman.
