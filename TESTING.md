# Regression checklist

Checklist manual ringkas untuk setiap rilis NEV Absenku. Tandai hasil uji dan browser/perangkat yang digunakan pada catatan rilis.

## Login dan role

- [ ] Username/password valid membuka dashboard role yang benar.
- [ ] Kredensial salah dan role yang tidak cocok ditolak dengan pesan yang jelas.
- [ ] Tombol login mencegah pengiriman berulang saat permintaan berjalan.
- [ ] Refresh mempertahankan sesi yang valid; token invalid/revoked kembali ke layar login.
- [ ] Logout menutup sesi server, menghapus token lokal, dan tidak meninggalkan tampilan halaman privat.

## Kegiatan dan QR

- [ ] HRD membuat/mengubah jadwal dan menghasilkan QR.
- [ ] QR ditampilkan, diunduh, dicetak, dan dapat dibaca scanner.
- [ ] Tautan QR mengarahkan pengguna ke login dahulu jika belum login.
- [ ] Token invalid/kedaluwarsa atau di luar waktu sesi ditangani tanpa crash.
- [ ] STAF tidak dapat melakukan aksi khusus HRD/KOOR KP dengan memanggil fungsi secara langsung.

## Kehadiran dan laporan

- [ ] Absensi masuk/keluar tersimpan sekali dan tersinkron ke sumber data pusat.
- [ ] Kalender, riwayat, rekap individu, dan rekap kegiatan menggunakan tanggal/status yang sama.
- [ ] Pengajuan izin/sakit dan file bukti berjalan dengan izin yang benar.
- [ ] Ekspor Excel/PDF berisi filter/periode yang dipilih, bukan data yang tidak terkait.
- [ ] Surat peringatan hanya dapat diterbitkan/dicabut oleh role yang berwenang dan hanya terlihat oleh pihak terkait.

## Kamera, lokasi, dan sinkronisasi

- [ ] Uji izin kamera/lokasi: granted, denied, unavailable, dan timeout.
- [ ] Lokasi di dalam/di luar radius menghasilkan keputusan yang sesuai kebijakan.
- [ ] Selfie dan bukti izin tidak menjadi publik tanpa sengaja.
- [ ] Putuskan jaringan sementara; pastikan indikator sinkronisasi dan retry dapat dipahami.
- [ ] Pulihkan jaringan; antrean terkirim tanpa membuat record ganda.
- [ ] Uji dua perangkat yang mengubah data bersamaan untuk mencari kemungkinan overwrite data yang lebih baru.

## Tampilan dan aksesibilitas

- [ ] Uji lebar 320 px, 375 px, 768 px, 1024 px, dan desktop.
- [ ] Tidak ada kontrol tertutup, teks terpotong yang menyembunyikan informasi penting, atau overflow halaman yang tidak disengaja.
- [ ] Form bisa digunakan dengan keyboard; focus state terlihat dan label terhubung ke field.
- [ ] Preferensi reduced motion dihormati dan semua aksi menunjukkan status berhasil/gagal.

## Operasi berisiko

- [ ] Uji hapus/purge hanya di salinan data uji dan verifikasi data akun/lokasi yang seharusnya dipertahankan.
- [ ] Pastikan backup dan prosedur pemulihan tersedia sebelum melakukan purge data produksi.


## Pusat notifikasi dalam aplikasi
- [ ] STAF melihat pengingat sesi aktif/mendatang yang sesuai divisinya.
- [ ] STAF melihat perubahan status pengajuan izin/sakit/dispen.
- [ ] STAF melihat SP yang belum dibaca; akun lain tidak melihat notifikasi tersebut.
- [ ] KOOR KP hanya melihat pengajuan pada sesi Ngoprek miliknya.
- [ ] HRD melihat pengajuan menunggu review dan sesi yang telah disubmit.
- [ ] Klik notifikasi membuka halaman yang sesuai.
- [ ] Tandai dibaca hanya memengaruhi akun/perangkat yang sedang digunakan.
- [ ] Panel notifikasi responsif di desktop dan ponsel.
- [ ] Notifikasi diperbarui setelah data lokal berubah dan setelah getAll selesai.
- [ ] Tidak ada notifikasi duplikat untuk ID sumber yang sama.


## AuditLog
- [ ] Aksi penting menghasilkan catatan pada sheet AuditLog.
- [ ] Sheet AuditLog dibuat otomatis dengan header yang benar saat aktivitas pertama dicatat.
- [ ] Header sheet operasional lama tetap identik dan tidak dimigrasikan.
- [ ] HRD dapat mengambil audit log melalui action getAuditLog.
- [ ] STAF dan KOOR KP ditolak saat meminta getAuditLog.
- [ ] Password, auth token, QR token, alasan izin/SP, koordinat, dan URL foto tidak masuk ke ringkasan audit.
- [ ] Kegagalan pencatatan AuditLog tidak menggagalkan check-in atau mutasi utama.
- [ ] Audit review izin mencatat perubahan status, tanpa mencatat alasan pribadi.


## Penilaian staf
- [ ] HRD dapat menilai staf dari semua divisi.
- [ ] KOOR KP hanya dapat menilai staf di divisinya.
- [ ] STAF hanya dapat membaca penilaian miliknya.
- [ ] Nilai tiap kriteria dibatasi 1–5 dan rata-rata dihitung server-side.
- [ ] Evaluator yang sama tidak dapat menilai staf yang sama dua kali pada periode yang sama.
- [ ] Riwayat penilaian tampil pada profil sesuai lingkup akses.

## Analitik kehadiran
- [ ] Hanya HRD yang melihat menu analitik.
- [ ] Cocokkan statistik per periode dengan hitung manual dari pasangan sesi-staf yang memenuhi divisi.
- [ ] Setiap pasangan sesi-staf dihitung satu kali.
- [ ] Pasangan tanpa record dihitung Alpha; status valid dihitung sesuai record.
- [ ] Pastikan sesi divisi tertentu tidak menghitung staf dari divisi lain.

## Pemeriksaan penghapusan fitur
- [ ] Menu Koreksi Absensi tidak tampil pada seluruh role.
- [ ] Menu Profil Staf tidak tampil pada seluruh role.
- [ ] Menu Laporan HRD tidak tampil pada seluruh role.
- [ ] API koreksi absensi tidak tersedia.
- [ ] Data historis pada sheet lama/AttendanceCorrections tidak dihapus.
