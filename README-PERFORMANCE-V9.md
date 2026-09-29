# NEV Absenku — PERFORMANCE V9

## Tujuan
Login tidak lagi menunggu `getAll`. Endpoint login hanya melakukan autentikasi dan mengembalikan user aman + auth token. Dashboard langsung ditampilkan, lalu sinkronisasi data berjalan di background.

## Alur login baru
1. Browser mengirim username/password ke `action=login`.
2. Apps Script memvalidasi akun dan membuat auth token.
3. Browser langsung menampilkan dashboard.
4. `getAll` berjalan di background.
5. Polling otomatis tetap setiap 30 detik.

## Polling
- `getAll` otomatis: 30 detik sekali.
- Tidak ada refresh otomatis tambahan saat `focus` / `visibilitychange`.
- Refresh manual tetap tersedia dari badge sinkronisasi.

## Deploy
- Upload `index.html` dan `cloud-sync.js` ke GitHub Pages.
- `Code.gs` tidak perlu diubah untuk optimasi login ini jika backend V6/V5 yang sedang digunakan sudah aktif.
