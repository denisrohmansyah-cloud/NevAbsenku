# Fase P2 — Rencana hardening keamanan dan keandalan

Dokumen ini merupakan rencana kerja berdasarkan audit statis repository. Ini bukan bukti bahwa deployment Apps Script aktif memiliki source yang sama.

## Batas aman

- Tidak mengubah Code.gs atau menjalankan deployment Apps Script pada tahap dokumentasi ini.
- Tidak mengubah nama sheet, header, urutan kolom, atau data Google Sheets.
- Tidak menjalankan reset/purge data maupun mengubah izin file/folder Google Drive.
- Implementasi backend hanya dilakukan setelah source Code.gs yang benar-benar aktif diverifikasi dan tersedia salinan spreadsheet untuk pengujian.

## Temuan dan rencana

### P2-01 — Password hashing

**Temuan pada source repository:** password disimpan sebagai `sha256$<digest>` menggunakan SHA-256 satu putaran tanpa salt unik. Ini bukan password KDF yang dirancang untuk memperlambat brute-force.

**Rencana:**
1. Gunakan format hash berversi dan salt acak unik per akun.
2. Gunakan password KDF standar dengan parameter kerja yang terukur pada runtime Apps Script.
3. Verifikasi format hash lama dan baru selama masa transisi.
4. Upgrade hash secara transparan setelah login berhasil dengan password benar.
5. Jangan mengubah kolom Users atau memaksa reset massal tanpa rencana pemulihan.
6. Uji kompatibilitas login, reset password, seed HRD, dan sesi lama sebelum rilis.

**Belum boleh dilakukan:** memilih algoritma/iterasi final tanpa benchmark runtime Apps Script dan pengujian terhadap source aktif.

### P2-02 — Login throttling

**Temuan:** penghitung gagal login menggunakan cache key berbasis username. Satu pihak dapat sengaja memicu lockout terhadap akun target.

**Rencana:**
1. Pertahankan perlindungan brute-force yang ada selama desain pengganti diuji.
2. Terapkan kombinasi batas percobaan per akun dan sinyal sumber yang tersedia secara sah pada Apps Script.
3. Tambahkan backoff bertahap dan pesan yang tidak membocorkan apakah username terdaftar.
4. Sediakan mekanisme pemulihan akun yang tidak bergantung pada membuka lockout secara manual.
5. Uji agar satu akun tidak mudah dikunci pihak lain dan percobaan masif tetap dibatasi.

### P2-03 — Audit trail untuk aksi sensitif

**Temuan:** repository memiliki `auditEvent_`, tetapi fungsi ini sengaja menangkap kegagalan tulis agar aksi utama tetap berjalan. Karena itu, keberhasilan aksi tidak menjamin audit event selalu tersimpan.

**Rencana:**
1. Petakan seluruh aksi sensitif: ubah role, reset password, hapus akun, hapus sesi, koreksi absensi, keputusan izin, SP, ekspor, dan perubahan konfigurasi.
2. Pastikan event berisi aktor, aksi, entitas, waktu, dan hasil tanpa password, token, foto, alasan pribadi, atau koordinat.
3. Bedakan aksi utama berhasil dengan audit gagal; berikan indikator/alert untuk kegagalan audit yang penting.
4. Uji penulisan audit ketika sheet tidak tersedia, header salah, dan terjadi kegagalan kuota.
5. Jangan membuat perubahan header AuditLog tanpa memeriksa sheet aktif.

### P2-04 — Foto Drive orphan dan idempotensi upload

**Risiko:** file dapat dibuat di Drive sebelum record spreadsheet berhasil disimpan. Kegagalan di tengah proses dapat meninggalkan file tanpa record induk.

**Rencana:**
1. Catat ID file Drive hasil upload.
2. Jika penyimpanan record gagal, hapus file yang baru dibuat dan verifikasi hasil cleanup.
3. Jika cleanup gagal, catat ID file ke mekanisme rekonsiliasi agar tidak hilang jejak.
4. Tambahkan idempotency key untuk upload dan retry.
5. Uji timeout setelah upload, sebelum append, dan setelah append.

### P2-05 — Sesi dan otorisasi

**Temuan:** token sesi pada source repository menggunakan Script Cache. Cache dapat menghapus entri sebelum TTL yang diharapkan.

**Rencana:**
1. Uji perilaku logout, reset password, token hilang, dan cache eviction.
2. Pertimbangkan penyimpanan sesi persisten dengan expiry dan revocation bila kebutuhan operasional membenarkan kompleksitasnya.
3. Pastikan semua operasi tetap memvalidasi token dan role di server.
4. Jangan memperpanjang masa hidup token hanya untuk mengurangi login ulang.

## Kriteria selesai Fase P2

- Hash password lama dan baru dapat diverifikasi selama masa transisi tanpa kehilangan akses akun.
- Throttling mengurangi brute-force tanpa memungkinkan lockout akun target secara mudah.
- Aksi sensitif memiliki audit trail yang dapat diverifikasi.
- Upload/retry tidak menghasilkan duplikasi atau file orphan yang tidak terdeteksi.
- Sesi dan otorisasi diuji terhadap cache eviction, logout, dan perubahan password.
- Seluruh pengujian dilakukan pada salinan spreadsheet dan deployment uji sebelum perubahan produksi.

## Data yang dibutuhkan sebelum implementasi

1. Source `Code.gs` terbaru yang benar-benar sedang di-deploy.
2. Konfirmasi apakah Apps Script aktif menggunakan struktur sheet yang sama dengan repository.
3. Salinan spreadsheet uji dengan header yang sama dan data dummy.
4. Hasil benchmark sederhana untuk operasi hash pada runtime Apps Script.

