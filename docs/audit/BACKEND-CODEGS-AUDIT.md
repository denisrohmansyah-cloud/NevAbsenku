# Audit Backend Code.gs — NEV Absenku

Tanggal pemeriksaan: 2026-10-30  
Sumber: Code.gs yang diberikan pengguna (backend v5, CODE_VERSION secure-v5.4-sp).  
Metode: pemeriksaan statis. Belum menjalankan endpoint atau mengakses spreadsheet/Drive produksi.

## Ringkasan

Backend sudah memiliki fondasi keamanan yang cukup berarti: token autentikasi, pemisahan data berdasarkan role, validasi input, pembatasan login, LockService pada sejumlah operasi tulis, validasi geofence di server, dan bukti izin yang disimpan privat.

Namun, ada beberapa risiko yang perlu diprioritaskan. Yang paling penting adalah validasi otorisasi record absensi untuk KOOR KP, race condition pada check-in vs submit sesi, serta akses publik foto selfie/presensi.

## Temuan

### B-01 — KOOR KP berpotensi memasukkan record absensi yang tidak terikat pada sesi dan staf yang sah

**Prioritas: Kritis**

Di `attendancePolicy_(old, clean, actor)`, pemeriksaan KOOR KP untuk record baru hanya memastikan `creatorId === actor.id`, `activity === "Ngoprek"`, dan `division === actor.division`. Pemeriksaan tersebut belum memastikan bahwa:
- `sessionId` benar-benar ada;
- sesi tersebut dibuat oleh KOOR KP yang sedang login;
- sesi merupakan sesi Ngoprek di divisi aktor;
- `userId` merupakan akun STAF yang sah di divisi tersebut;
- identitas pengguna pada record berasal dari data Users, bukan klaim klien.

Karena `saveAttendance` menerima batch dari KOOR KP, klien yang dimodifikasi berpotensi mengirim record absensi buatan untuk userId tertentu di sesi draft. Setelah sesi disubmit, data draft tersebut dapat terlihat oleh HRD.

**Rekomendasi:** validasi relasi sesi dan pengguna di server untuk setiap record baru/perubahan. Ambil creator, activity, division, nama, dan username dari data sesi/Users di server. Tolak record jika user bukan STAF dalam divisi yang tepat atau sesi bukan milik aktor. Pertahankan aturan bahwa sesi yang sudah disubmit hanya dapat diubah HRD.

### B-02 — Race condition antara check-in dan submit/penonaktifan sesi

**Prioritas: Kritis**

Di `addAttendance_`, status sesi, token, tanggal, waktu, dan geofence diperiksa sebelum memasuki `withLock_`. Di dalam lock, kode hanya memeriksa duplikasi lalu menulis absensi. Sementara itu, `submitSessionAttendance_` dan `setSessionActive_` juga menggunakan lock.

Skenario: request check-in memeriksa sesi saat masih aktif; kemudian request submit memperoleh lock dan menutup sesi; setelah itu request check-in memperoleh lock dan tetap menambahkan absensi karena status sesi tidak diperiksa ulang.

**Rekomendasi:** di dalam lock, baca ulang sesi dari Sheets dan ulangi pemeriksaan status aktif, status submit, token, tanggal/waktu, dan aturan yang relevan sebelum append. Dengan begitu keputusan dan penulisan absensi berada dalam satu bagian kritis.

### B-03 — Foto selfie/presensi dibagikan dengan akses Anyone with link

**Prioritas: Tinggi**

Di `savePhotoToDrive_`, untuk jenis selain `permit`, file diberi `DriveApp.Access.ANYONE_WITH_LINK`. Ini berarti foto selfie/presensi tidak sepenuhnya dilindungi oleh pemeriksaan role pada `getPhoto_` jika URL Drive tersebar atau diketahui pihak lain. Proxy `getPhoto_` sendiri sudah memeriksa kepemilikan/role, tetapi pengaturan berbagi langsung dapat melewati proxy tersebut.

**Rekomendasi:** evaluasi untuk menjadikan seluruh foto privat dan menyajikannya hanya melalui `getPhoto_`. Sebelum mengubah, inventarisasi kompatibilitas thumbnail frontend dan jalankan migrasi akses Drive terkontrol. Fungsi `privatkanFotoIzin()` saat ini hanya untuk folder permit; jangan jalankan fungsi migrasi massal baru tanpa backup dan persetujuan.

### B-04 — Upload foto dilakukan sebelum pemeriksaan duplikasi

**Prioritas: Sedang**

Di `addAttendance_` dan `addPermit_`, foto diunggah ke Drive sebelum masuk ke lock dan sebelum pemeriksaan record duplikat. Jika request diulang, backend dapat mengembalikan record lama tetapi meninggalkan file foto baru yang tidak direferensikan di Sheets.

**Rekomendasi:** lakukan pemeriksaan awal dan pemeriksaan ulang di dalam lock sebelum upload. Untuk menghindari lock terlalu lama saat upload, gunakan pola status sementara atau mekanisme idempotensi yang dirancang hati-hati. Jangan sekadar memindahkan upload ke dalam lock tanpa menguji durasi eksekusi dan kegagalan Drive.

### B-05 — Header sheet yang tidak cocok ditimpa tanpa migrasi data

**Prioritas: Tinggi — perlu inventarisasi skema**

Di `getSheet_`, jika header baris pertama tidak sama persis dengan `HEADERS[name]`, fungsi langsung menulis header baru pada kolom yang sama. Kode tidak memetakan atau memigrasikan data lama ke susunan kolom baru. Jika sheet memiliki struktur lama atau kolom yang berbeda, baris data lama dapat dibaca dengan pemetaan kolom yang salah.

**Rekomendasi:** jangan melakukan perubahan header otomatis pada sheet yang sudah berisi data. Buat pemeriksaan skema read-only dan hentikan proses dengan pesan yang jelas bila header tidak cocok. Rancang migrasi terpisah dengan backup dan pemetaan kolom eksplisit. Jangan mengubah schema Google Sheets saat ini tanpa persetujuan.

### B-06 — Operasi penggantian seluruh isi sheet bukan transaksi atomik

**Prioritas: Tinggi**

`objectsToSheet_` menghapus isi semua baris data terlebih dahulu, kemudian menulis ulang array. `LockService` mencegah dua eksekusi script saling menulis bersamaan pada jalur yang memakai lock, tetapi tidak membuat rangkaian clearContent + setValues menjadi transaksi atomik. Kegagalan setelah penghapusan dan sebelum penulisan selesai berpotensi meninggalkan sheet kosong atau parsial.

**Rekomendasi:** sebelum mengubah pola tulis, siapkan backup otomatis/terverifikasi dan uji pemulihan. Pertimbangkan penulisan batch yang meminimalkan jendela data kosong atau mekanisme staging/versi. Ini harus dirancang agar tidak mengubah nama sheet, header, dan kontrak API.

### B-07 — Hash password menggunakan SHA-256 tanpa salt

**Prioritas: Tinggi**

`hashPassword_` menghasilkan SHA-256 langsung dari password. SHA-256 adalah hash cepat dan tanpa salt per pengguna, sehingga jika spreadsheet bocor, penyerang dapat menguji tebakan password secara offline dan hash password yang sama akan identik.

**Rekomendasi:** rencanakan migrasi ke password hashing dengan salt unik dan fungsi derivasi yang lambat/beriterasi. Pastikan kompatibilitas login dan migrasi bertahap agar pengguna tidak terkunci. Jangan mengganti format hash sebelum alur migrasi dan pemulihan diuji.

### B-08 — Pembatasan login berdasarkan username dapat dipakai untuk mengunci akun target

**Prioritas: Sedang**

`loginKey_` membuat kunci rate limit dari username. Lima percobaan gagal mengunci username selama 15 menit. Ini membatasi brute force sederhana, tetapi siapa pun yang mengetahui username dapat sengaja menghabiskan percobaan dan mengunci pengguna tersebut. Pencatatan juga tidak membedakan sumber percobaan.

**Rekomendasi:** gabungkan pembatasan per akun dengan pembatasan tambahan yang sesuai untuk sumber/tingkat sistem, dan sediakan prosedur pemulihan yang aman. Uji juga request login paralel karena penghitung cache tidak dibungkus lock.

### B-09 — Token login disimpan di Script Cache selama enam jam

**Prioritas: Sedang**

Token dibuat dengan UUID dan disimpan di Script Cache dengan TTL 21600 detik. Penggantian password membatalkan token melalui fingerprint password, dan logout menghapus token. Namun Script Cache bukan penyimpanan sesi persisten dan dapat mengeluarkan entri sebelum TTL ketika cache perlu dibersihkan. Selain itu, belum ada daftar sesi aktif/perangkat untuk pencabutan sesi terpilih.

**Rekomendasi:** dokumentasikan bahwa sesi dapat berakhir lebih awal; pertimbangkan penyimpanan sesi yang lebih dapat diprediksi dan mekanisme pencabutan terpusat jika kebutuhan operasional mengharuskannya. Hindari menyimpan token di URL atau log.

### B-10 — Password awal akun HRD ditulis ke Execution log

**Prioritas: Sedang**

`seedUsers_` membuat password acak saat sheet Users kosong dan menulis username/password ke Apps Script Execution log. Ini lebih baik daripada password default yang diketahui publik, tetapi log menjadi tempat penyimpanan kredensial yang perlu dibatasi dan dibersihkan sesuai kebijakan akses/retensi.

**Rekomendasi:** gunakan prosedur bootstrap kredensial yang lebih terkontrol dan pastikan akses Execution log dibatasi. Jangan membagikan log berisi password melalui chat atau dokumen.

### B-11 — Geofence server masih bergantung pada koordinat yang dikirim browser

**Prioritas: Sedang — batasan teknis**

Server menghitung jarak dengan benar dari koordinat request, tetapi koordinat berasal dari `data.lat/data.lng` yang dikirim klien. Browser/GPS perangkat dapat memberikan lokasi yang tidak akurat atau dimanipulasi. Validasi server mencegah klien mengubah titik kantor/radius, tetapi tidak membuktikan secara kriptografis bahwa koordinat berasal dari lokasi fisik sebenarnya.

**Rekomendasi:** posisikan geofence sebagai kontrol pembatasan berbasis lokasi, bukan bukti anti-spoofing absolut. Tambahkan indikator akurasi GPS dan prosedur verifikasi manual bila diperlukan; jangan mengklaim sistem kebal GPS spoofing.

### B-12 — Penghapusan data dan SP tidak memiliki audit trail khusus

**Prioritas: Sedang**

`deleteSession_`, `deleteAttendance_`, `deleteWarning_`, dan `purgeData_` menghapus data tanpa menulis riwayat tindakan ke sheet audit. Foto yang dihapus melalui purge dipindahkan ke Trash, tetapi log aplikasi tidak mencatat secara rinci aktor, waktu, cakupan, dan hasil penghapusan.

**Rekomendasi:** rancang audit log append-only untuk tindakan sensitif (aktor, aksi, target, waktu server, hasil). Ini memerlukan persetujuan penambahan sheet/kolom dan kebijakan retensi terlebih dahulu.

## Temuan yang mengurangi/mengoreksi risiko audit frontend

- Penulisan batch utama `saveSessions`, `saveAttendance`, dan `savePermits` dijalankan di dalam `withLock_`. Karena itu, risiko tabrakan dua penulis pada operasi batch yang sama lebih rendah daripada yang dapat disimpulkan dari frontend saja.
- Operasi `addAttendance`, `addPermit`, `submitSessionAttendance`, dan `setSessionActive` juga memakai lock untuk bagian tulis. Namun validasi status sesi pada `addAttendance` terjadi sebelum lock, sehingga race condition tetap ada.
- Server sudah menolak penyimpanan massal absensi/izin dari role STAF dan menyediakan action khusus `addAttendance` / `addPermit`.
- Foto bukti izin sudah tidak diberi akses Anyone with link dan `getPhoto_` memeriksa hak akses sebelum mengembalikan data foto.
- Server memfilter `getAll` berdasarkan role/pemilik akun dan menghapus password dari objek user yang dikirim ke klien.

## Batasan audit

- Tidak ada akses langsung ke spreadsheet, Google Drive, Apps Script deployment settings, execution logs, atau traffic produksi.
- Belum ada pengujian runtime, uji penetrasi, uji beban, atau verifikasi terhadap versi deployment yang sedang aktif.
- Belum dipastikan apakah frontend saat ini mengirim payload tertentu yang dapat memicu seluruh jalur temuan.
- Tidak mengubah Google Sheets, Drive, deployment, data, atau source produksi.

## Urutan perbaikan yang direkomendasikan

1. **P0:** Perketat validasi record baru/perubahan KOOR KP di `attendancePolicy_`.
2. **P0:** Pindahkan validasi ulang sesi ke dalam lock pada `addAttendance_`.
3. **P1:** Tutup akses publik foto selfie/presensi setelah uji kompatibilitas dan migrasi terencana.
4. **P1:** Lindungi penulisan sheet dari kegagalan clear-then-write dan siapkan backup/restore.
5. **P1:** Audit header aktual seluruh sheet sebelum menyentuh fungsi `getSheet_`.
6. **P2:** Rancang hash password salted/iterated dan rate limiting yang lebih kuat.
7. **P2:** Audit trail untuk perubahan/penghapusan sensitif.
8. **P2:** Perbaiki orphan photo akibat retry dan tambahkan uji idempotensi.

## Kebijakan perubahan

- Tidak mengubah nama sheet atau kolom yang sudah ada tanpa persetujuan.
- Tidak menjalankan `resetDataAbsensi`, `purgeData`, atau `privatkanFotoIzin` tanpa persetujuan eksplisit dan backup terverifikasi.
- Tidak melakukan deploy Apps Script tanpa persetujuan eksplisit.
- Telegram Bot tidak ditambahkan.
