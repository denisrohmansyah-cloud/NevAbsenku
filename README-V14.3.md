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


## V14.4 Clean History Fix

Perbaikan khusus untuk kondisi ketika data Attendance sudah dihapus dari Google Sheets tetapi riwayat lama masih muncul di browser.

- Queue sinkronisasi versi lama tidak digunakan lagi.
- Jika endpoint server mengembalikan `attendance: []`, cache `nev_attendance` di browser juga dikosongkan.
- Polling sekarang mengambil data server terlebih dahulu sebelum mencoba mengirim queue, sehingga data lama tidak dapat hidup kembali dari queue.
- Data baru setelah V14.4 tetap dapat disinkronkan melalui queue baru.

Setelah mengganti `cloud-sync.js`, lakukan `Ctrl + Shift + R`. Jika browser masih menyimpan cache lama, gunakan DevTools → Application → Storage → Clear site data sekali saja.
