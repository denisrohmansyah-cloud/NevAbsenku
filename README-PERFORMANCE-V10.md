# NEV Absenku — Performance V10 (Fast Login)

Perubahan:
- Login hanya 1 request POST, tanpa retry 1.5 detik.
- Login tidak menunggu getAll. Dashboard tampil setelah autentikasi berhasil.
- Apps Script memakai CacheService untuk cache daftar Users selama 5 menit.
- Bootstrap menghangatkan cache Users di background sehingga login berikutnya lebih cepat.
- Cache Users di-invalidasi saat create/update/delete akun.
- Polling data tetap tepat 30 detik.

Deploy Code.gs sebagai New version. Upload frontend ke GitHub Pages.
