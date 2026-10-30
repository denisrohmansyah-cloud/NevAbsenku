# Audit Frontend — Sinkronisasi dan Integritas Data

Tanggal audit: 2026-10-30  
Cakupan: pembacaan statis `cloud-sync.js` pada branch `main`.  
Status: temuan frontend; belum merupakan audit backend atau uji runtime.

## Ringkasan

Ditemukan beberapa risiko yang perlu ditangani sebelum mengubah protokol sinkronisasi. Tidak ada perubahan pada kode aplikasi atau data produksi dalam audit ini.

## Temuan

### F-01 — Data lokal dapat tertimpa oleh hasil bootstrap cloud sebelum antrean lokal dipulihkan

**Prioritas: Tinggi**

Pada `fetchCloudAll()`, aplikasi memanggil `applyCloudAll(json)` terlebih dahulu. Fungsi tersebut langsung menulis `users`, `sessions`, `attendance`, `settings`, `permits`, dan `warnings` dari server ke localStorage. Setelah itu baru `flushCloudQueue()` dijalankan bila antrean tidak kosong.

Dampak yang mungkin terjadi: perubahan lokal yang belum tersinkron dapat hilang dari tampilan/perangkat saat bootstrap cloud menimpa localStorage. Payload antrean masih mungkin dikirim setelahnya, tetapi tampilan lokal tidak otomatis direkonsiliasi dengan payload tersebut pada saat yang sama.

**Rekomendasi:** sebelum menerapkan snapshot cloud, identifikasi perubahan lokal yang belum tersinkron. Jangan melakukan overwrite tanpa merge/reconcile. Rancang rekonsiliasi berdasarkan ID record dan versi/urutan perubahan setelah kontrak backend dipastikan. Uji dengan dua perangkat dan mode offline.

### F-02 — Antrean sinkronisasi menghapus item yang ditolak server

**Prioritas: Tinggi**

Di `flushCloudQueue()`, ketika `cloudPost()` menghasilkan error fatal, item antrean dihapus melalui `removeCloudQueueItem(item.id)`. Komentar kode menyatakan penolakan validasi/izin tidak akan berhasil bila diulang.

Dampak: payload yang ditolak dapat hilang dari antrean lokal tanpa jalur pemulihan atau ekspor yang terlihat. Jika penolakan disebabkan data yang masih bisa diperbaiki, pengguna berpotensi kehilangan perubahan yang belum tersimpan di server.

**Rekomendasi:** pertahankan item gagal dalam status dead-letter/needs-attention, tampilkan alasan yang aman, dan sediakan cara mengekspor atau mencoba ulang setelah koreksi. Jangan menghapus payload gagal secara otomatis. Perlu keputusan format dan retensi sebelum implementasi.

### F-03 — Retry operasi absensi dapat mengirim ulang permintaan setelah respons jaringan hilang

**Prioritas: Tinggi — perlu verifikasi backend**

`finalizeAttendance()` memanggil `cloudPost("addAttendance", record, 1)`. Jika server berhasil menyimpan tetapi respons tidak diterima browser, klien dapat mencoba ulang. Klien kemudian juga menyimpan record sementara dan memasukkan `addAttendance` ke antrean.

Dampak: duplikasi mungkin terjadi jika server tidak menerapkan idempotensi atomik untuk identitas absensi (misalnya kombinasi sesi dan pengguna).

**Rekomendasi:** server harus menerapkan idempotency key dan constraint/lock atomik untuk satu absensi per pengguna per sesi. Respons untuk pengiriman ulang harus mengembalikan record hasil simpan yang sama. Uji skenario respons hilang setelah commit.

### F-04 — Penulisan snapshot penuh dapat beradu antar-perangkat

**Prioritas: Tinggi — perlu verifikasi backend**

`pushToCloud()` mengirim seluruh array untuk key seperti sesi, absensi, pengaturan, dan izin. Tidak terlihat serialisasi/versi optimistis di frontend pada jalur ini.

Dampak: dua klien dapat mengirim snapshot dari keadaan berbeda dan snapshot yang lebih lama berpotensi menimpa perubahan baru, bergantung pada implementasi Apps Script.

**Rekomendasi:** periksa implementasi server dan mekanisme locking/versioning terlebih dahulu. Pilihan perbaikan dapat berupa operasi per-record dengan revision/version atau optimistic concurrency control. Jangan mengubah kontrak API atau skema Sheets sebelum disetujui.

### F-05 — Pemeriksaan sintaks belum menguji perilaku sinkronisasi

**Prioritas: Sedang**

Workflow saat ini memeriksa sintaks file JavaScript dan inline script. Pemeriksaan tersebut tidak menguji retry, queue, konflik, duplicate attendance, session expiry, atau konsistensi data lokal/cloud.

**Rekomendasi:** tambahkan test harness terisolasi dengan mock `fetch` dan `localStorage` untuk kasus-kasus di atas. Jalankan tanpa endpoint produksi dan tanpa data nyata.

## Hal yang sudah dijaga

- Tidak mengubah `DATA_EPOCH`.
- Tidak menjalankan `purgeData` atau menghapus antrean/data.
- Tidak mengubah key localStorage, bentuk payload, endpoint, Google Sheets, atau Apps Script.
- Tidak menyentuh branch `main` dengan perubahan kode.
- Telegram Bot tetap tidak digunakan.

## Prasyarat sebelum perbaikan kode sinkronisasi

1. Dapatkan source Google Apps Script yang melayani endpoint saat ini.
2. Pastikan perilaku autentikasi, otorisasi, locking, dan operasi `addAttendance`.
3. Siapkan salinan spreadsheet dan akun uji.
4. Sepakati mekanisme backup/restore dan uji pemulihan.
5. Buat test harness yang tidak mengirim permintaan ke endpoint produksi.

## Status tindak lanjut

- [x] Pemeriksaan statis awal `cloud-sync.js`.
- [x] Temuan risiko dan rekomendasi dicatat.
- [ ] Verifikasi semua temuan terhadap source Apps Script.
- [ ] Buat regression tests terisolasi.
- [ ] Implementasi perbaikan setelah kontrak backend dan strategi pemulihan disepakati.
