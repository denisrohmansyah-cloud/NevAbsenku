# NEV Absenku V14.3 — Bulk Delete Attendance

## Perubahan tambahan
- HRD memiliki tombol **Hapus Semua Tampil** di halaman Rekap Absensi.
- Koor KP memiliki tombol **Hapus Semua Tampil** di halaman Absensi Ngoprek.
- Penghapusan mengikuti filter yang sedang aktif; jadi hanya data yang sedang tampil yang dihapus.
- Penghapusan memerlukan dua kali konfirmasi.
- Penghapusan diproses di Google Apps Script agar data Google Sheets ikut terhapus.
- Koor KP hanya dapat menghapus data Ngoprek dari divisinya sendiri.
- Foto di Google Drive **tidak ikut dihapus**; yang dihapus adalah record absensinya di Google Sheets.

## Deploy
1. Ganti `index.html` di GitHub Pages.
2. Ganti `Code.gs` di Google Apps Script.
3. Deploy Apps Script sebagai **New version**.
4. Reload website dengan `Ctrl + Shift + R`.

## Cara menggunakan
### HRD
Masuk → **Rekap Absensi** → atur filter jika perlu → klik **Hapus Semua Tampil**.

### Koor KP
Masuk → **Absensi Ngoprek** → atur filter jika perlu → klik **Hapus Semua Tampil**.

Jika ingin benar-benar menghapus semua record absensi HRD, pastikan seluruh filter berada pada **Semua** sebelum menekan tombol.
