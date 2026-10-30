# Tahap 1 — Sinkronisasi Source dan Integritas Data

Tanggal: 2026-10-30

## Status sumber

- Source of truth backend untuk pekerjaan lanjutan adalah file `Code.gs` aktif yang diberikan pemilik proyek, versi `secure-v5.5-security-hardening`.
- File aktif berisi modul `AttendanceCorrections`, pengajuan koreksi absensi, dan review koreksi oleh HRD. Versi `apps-script/Code.gs` di repository `main` belum memuat modul tersebut.
- Karena itu, source backend repository belum boleh diperlakukan sebagai salinan identik dari deployment aktif.
- Jangan deploy source repository sebelum rekonsiliasi dan verifikasi terhadap file aktif selesai.

## Batas aman

Tidak ada perubahan terhadap:
- Spreadsheet produksi, header/kolom, nama sheet, atau isi data.
- Endpoint Apps Script, `DATA_EPOCH`, localStorage keys, dan bentuk payload.
- Deployment Web App, permission Drive, atau sesi pengguna.

Tidak menjalankan purge, reset, migrasi foto, migrasi password, maupun deployment.

## Temuan backend pada source aktif

### BE-01 — Password SHA-256 tanpa salt per pengguna

Source aktif menyimpan password dalam format `sha256$<hex>`. Hash SHA-256 langsung bukan password KDF dan tidak memiliki salt unik per akun. Risiko: password lemah lebih mudah diuji dengan wordlist/rainbow table jika salinan sheet bocor.

Tindak lanjut aman: rancang format hash versi baru dengan salt acak per akun dan verifikasi kompatibilitas login. Migrasi hanya setelah tersedia backup, prosedur rollback, dan uji akun; jangan mengubah password pengguna secara massal.

### BE-02 — Pembatasan percobaan login hanya berdasarkan username

Counter kegagalan disimpan di Script Cache dengan key turunan username. Hal ini dapat memungkinkan penguncian akun yang ditargetkan oleh pihak lain. Apps Script Web App tidak menyediakan alamat IP klien secara langsung melalui event object standar, sehingga mitigasi tidak boleh mengandalkan IP yang tidak tersedia.

Tindak lanjut: gabungkan pembatasan per akun dengan kontrol tambahan yang tidak mudah dipicu pihak lain; pastikan pesan respons tidak membocorkan keberadaan akun.

### BE-03 — Token sesi bergantung pada Script Cache

Token sesi disimpan di Script Cache dengan TTL 6 jam. Cache dapat menghapus entri lebih awal dari TTL. Dampaknya, sesi dapat berakhir sebelum waktu yang diharapkan.

Tindak lanjut: uji perilaku sesi dan tentukan penyimpanan sesi yang sesuai kuota/retensi sebelum migrasi. Jangan mengganti penyimpanan sesi tanpa uji beban dan rencana invalidasi token.

### BE-04 — Penulisan ulang snapshot sheet

`objectsToSheet_` menulis ulang seluruh daftar dan membersihkan baris lama. Walaupun pemanggil tertentu menggunakan Script Lock, pola full-snapshot tetap perlu diuji untuk kegagalan saat penulisan dan operasi lintas jalur yang tidak seluruhnya terkunci.

Tindak lanjut: inventarisasi seluruh pemanggil, pastikan mutasi kritis berada dalam lock yang sama, dan uji pemulihan pada salinan spreadsheet. Hindari perubahan skema.

## Temuan frontend yang sudah diaudit

### FE-01 — Bootstrap cloud mendahului pemulihan antrean lokal

`fetchCloudAll()` menerapkan snapshot server ke localStorage sebelum `flushCloudQueue()`. Perubahan lokal yang belum tersinkron dapat hilang dari tampilan lokal sebelum antrean dipulihkan.

### FE-02 — Item antrean fatal dihapus otomatis

`flushCloudQueue()` menghapus item antrean ketika server memberi error fatal. Payload yang belum tersimpan tidak memiliki jalur pemulihan yang terlihat.

### FE-03 — Retry check-in setelah respons hilang

Client dapat mengulang permintaan ketika server sudah menyimpan data tetapi respons tidak diterima. Backend harus menjamin idempotensi atomik untuk satu pengguna pada satu sesi. Verifikasi statis saja belum cukup.

### FE-04 — Snapshot penuh dari beberapa perangkat

Penulisan array penuh berpotensi saling menimpa. Perubahan protokol API atau skema Sheets belum boleh dilakukan sebelum desain versi/revisi disetujui.

## Perubahan implementasi berikutnya

1. Rekonsiliasi file backend aktif dengan `apps-script/Code.gs` repository tanpa menghilangkan modul koreksi absensi.
2. Buat test harness terisolasi untuk queue, bootstrap, retry, deduplikasi check-in, role authorization, dan tanggal WIB.
3. Perbaiki pemulihan antrean gagal dengan mekanisme dead-letter/needs-attention dan ekspor data gagal; jangan membuang payload secara otomatis.
4. Rancang merge/reconcile bootstrap untuk data lokal yang masih memiliki antrean.
5. Lakukan uji concurrency dan pemulihan pada salinan spreadsheet sebelum perubahan backend produksi.

## Kriteria selesai tahap

- Source repository sudah identik/terverifikasi terhadap source aktif.
- Tidak ada perubahan skema atau penghapusan data.
- Queue gagal tetap dapat dipulihkan.
- Bootstrap tidak menghilangkan perubahan lokal tertunda.
- Check-in retry tidak membuat duplikasi.
- Semua tes berjalan tanpa endpoint dan data produksi.
