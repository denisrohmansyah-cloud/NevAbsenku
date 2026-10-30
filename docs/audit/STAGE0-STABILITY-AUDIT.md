# NEV Absenku — Stage 0 Stability Audit

Tanggal audit: 2026-10-30  
Branch dasar: `main` pada `a4102d98f7f3b8a69aecb1eb288ea4e5da391178`  
Metode: pemeriksaan statis repository. Tidak ada akses atau perubahan pada spreadsheet/Drive produksi, dan tidak ada deployment Apps Script.

## Ringkasan

Audit menegaskan bahwa beberapa temuan audit awal telah diperbaiki pada kode yang sekarang ada di `main`. Risiko sinkronisasi frontend masih perlu ditangani sebelum protokol atau penyimpanan diubah. Beberapa risiko keamanan backend tetap memerlukan desain perubahan terpisah dan uji dengan salinan data.

## Status temuan backend

| Temuan audit awal | Status pada source saat ini | Catatan |
|---|---|---|
| B-01: validasi relasi absensi KOOR KP | Diperbaiki pada source | `attendancePolicy_` memeriksa sesi, pembuat, jenis kegiatan, divisi, dan akun STAF sasaran. Perlu regresi endpoint untuk memastikan semua jalur simpan/edit. |
| B-02: race check-in vs submit sesi | Diperbaiki pada source | `addAttendance_` membaca ulang sesi dan memvalidasi status/token/jadwal di dalam `withLock_`. Uji konkurensi runtime tetap diperlukan. |
| B-03: foto baru dapat diakses publik | Diperbaiki untuk upload baru | `savePhotoToDrive_` menetapkan PRIVATE. Fungsi migrasi foto lama tersedia, tetapi belum dijalankan dan tidak boleh dijalankan tanpa inventarisasi, backup, serta persetujuan. |
| B-04: upload foto sebelum cek duplikasi | Diperbaiki pada jalur absensi/izin yang diperiksa | Cek duplikasi dilakukan sebelum upload di dalam lock. Tetap perlu uji kegagalan Drive/append agar tidak ada orphan file. |
| B-05: header sheet tertimpa otomatis | Diperbaiki pada source saat ini | `getSheet_` menolak header tidak cocok tanpa menulis ulang header. |
| B-06: penggantian seluruh isi sheet tidak atomik | Masih perlu perbaikan/desain | `objectsToSheet_` masih menulis ulang snapshot dan membersihkan baris lama. Perlu backup dan uji pemulihan sebelum perubahan. |
| B-07: hash password SHA-256 tanpa salt | Risiko tersisa | Jangan mengganti format hash tanpa rencana migrasi kompatibel dan pemulihan akun. |
| B-08: rate limit login berbasis username | Risiko tersisa | Perlu desain pembatasan yang tidak mudah disalahgunakan untuk mengunci akun target. |
| B-09: token sesi di Script Cache | Risiko operasional tersisa | Cache dapat mengeluarkan entri sebelum TTL; perilaku sesi perlu diuji dan didokumentasikan. |

## Status temuan sinkronisasi frontend

| Temuan | Status | Risiko / tindak lanjut |
|---|---|---|
| F-01: snapshot cloud menimpa data lokal sebelum queue dipulihkan | Terbuka | `fetchCloudAll()` menerapkan `applyCloudAll()` sebelum `flushCloudQueue()`. Rancang rekonsiliasi ID/urutan perubahan; uji offline dan dua perangkat. |
| F-02: item queue fatal dihapus | Terbuka | `flushCloudQueue()` menghapus item ketika server menolak. Rancang dead-letter/needs-attention dan ekspor pemulihan tanpa mengubah format queue secara diam-diam. |
| F-03: retry dapat mengulang check-in setelah respons hilang | Perlu verifikasi runtime | Backend memiliki duplicate check berdasarkan sesi + user di dalam lock. Uji skenario server commit tetapi respons hilang. |
| F-04: snapshot penuh antar-perangkat | Terbuka/perlu verifikasi | `pushToCloud()` mengirim array penuh. Jangan ubah kontrak API atau skema Sheets sebelum desain versi/konflik disetujui. |
| F-05: CI hanya memeriksa sintaks | Terbuka | Tambahkan test harness terisolasi untuk queue, bootstrap, role, tanggal, dan aturan deduplikasi. |

## Urutan tindak lanjut

1. Tambahkan regression tests terisolasi tanpa endpoint produksi: bootstrap saat queue berisi perubahan lokal, fatal queue retention, retry, dan duplikasi check-in.
2. Rancang pemulihan queue yang gagal agar payload tidak hilang; tentukan status, retensi, pesan aman, dan ekspor.
3. Rancang merge/reconciliation cloud-lokal dan konflik multi-perangkat setelah kontrak Apps Script dipahami.
4. Siapkan pengujian backend dengan salinan spreadsheet dan Drive: concurrency check-in/submit, upload gagal, foto privat, dan otorisasi tiap role.
5. Rancang peningkatan hashing password dan rate limit sebagai pekerjaan keamanan terpisah dengan kompatibilitas login.
6. Lanjutkan dashboard, notifikasi internal, dan UI/UX setelah integritas data aman.

## Batas perubahan

- Tidak mengubah `DATA_EPOCH`, key localStorage, bentuk record, nama sheet/kolom, endpoint, atau format ekspor.
- Tidak melakukan purge/reset, migrasi foto Drive, perubahan password hash, atau deployment Apps Script.
- Tidak menggunakan Telegram Bot; notifikasi tetap internal.
- Semua implementasi lanjutan dilakukan pada feature branch dan melalui Pull Request.
