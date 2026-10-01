# NEV Absenku V15 — HRD UI & Data Cleanup Fix

Perubahan:
1. Badge **Tersinkron** dipindah ke **pojok kanan bawah**.
2. Data absensi legacy/malformed yang menyebabkan baris `null` + foto lama dibersihkan dari cache dan, saat login sebagai HRD, dihapus dari server melalui `deleteAttendance`.
3. Peta **Lokasi & Radius Kantor** diperbaiki dengan CSS tinggi peta 340px dan tetap memakai Leaflet + OpenStreetMap.
4. **Rekap Jumlah Absensi Setiap Staf** dikembalikan di bawah filter Rekap Absensi HRD.
5. Polling sinkronisasi menjadi 30 detik dan tidak lagi refresh tambahan saat focus/visibility berubah.
6. Versi server tidak lagi dibandingkan dengan `secure-v3` secara hard-coded.

## File yang dipakai
- `index.html`
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`

## Pemasangan
Ganti 4 file di GitHub Pages dengan file V15, commit/push, lalu buka website dengan `Ctrl + Shift + R`.

**Tidak perlu mengganti Code.gs hanya untuk perubahan frontend ini.** Backend aktif Anda tetap digunakan.

### Catatan data lama
V15 menganggap data absensi sebagai legacy jika tidak memiliki `id`, `userId`, `sessionId`, tanggal `YYYY-MM-DD`, atau status valid (`Hadir/Izin/Sakit/Alpha`). Data seperti baris `null` pada screenshot akan dibersihkan.

Foto Drive yang sudah menjadi file yatim akibat penghapusan baris tidak otomatis dihapus dari Drive oleh endpoint backend lama; V15 menghapus record absensinya dari data aplikasi/server.
