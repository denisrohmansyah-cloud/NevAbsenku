# NEV Absenku V13.1 — Foto + Sync Fix

## Yang diperbaiki
- Mengembalikan `finalizeAttendance()` asli yang mengirim selfie melalui `addAttendance`, sehingga Apps Script menyimpan foto ke Google Drive.
- Mengembalikan `submitPermit()` asli yang mengirim bukti izin/sakit melalui `addPermit`, sehingga foto disimpan ke Google Drive.
- Login tidak lagi diblokir hanya karena `getAll` gagal sementara.
- Polling cloud menjadi 30 detik.
- Tidak ada refresh otomatis tambahan saat pindah tab/focus.
- Sinkronisasi yang gagal memakai queue eksplisit dan dicoba ulang.
- Tidak lagi membandingkan dengan versi server `secure-v3` secara hard-coded; versi server dibaca dari bootstrap.

## Cara pasang
1. Ganti **hanya** `cloud-sync.js` di repository GitHub Pages dengan file dari paket ini.
2. Commit → Push.
3. Buka website dan tekan `Ctrl + Shift + R`.
4. Login sebagai HRD.
5. Cek menu **Rekap Absensi** dan **Persetujuan Izin/Sakit**.

## Penting untuk foto lama yang masih rusak
V13.1 memperbaiki **alur upload foto baru**. Jika foto lama masih menampilkan ikon gambar rusak, masalahnya kemungkinan izin Google Drive pada folder/file foto.

Pastikan folder berikut pada Google Drive pemilik Apps Script dibagikan:
- `NEV Absenku - Foto Selfie`
- `NEV Absenku - Bukti Izin Sakit`

Setel akses folder menjadi **Anyone with the link / Siapa saja yang memiliki link → Viewer** jika kebijakan akun Google Anda mengizinkannya.

Jika folder sudah dibagikan tetapi foto lama tetap tidak tampil, jangan mengganti `Code.gs` dengan source lama. Backend Anda saat ini sudah berada pada deployment `secure-v6-fast-login`. Kirim screenshot/hasil klik foto lama tersebut; backend proxy foto dapat ditambahkan sebagai patch kecil ke deployment v6 tanpa menurunkan versi backend.
