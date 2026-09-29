# NEV Absenku Performance V8

Target Lighthouse Performance: 90+.

Perubahan:
- Google Fonts, Font Awesome, Leaflet CSS dimuat non-blocking.
- QR, scanner, Excel, PDF, Leaflet JS memakai `defer`.
- geo-selfie.js dan cloud-sync.js memakai `defer`.
- Logo PNG 104 KB diganti WebP sekitar 14 KB.
- Logo pertama diberi ukuran eksplisit untuk mencegah layout shift.
- Polling cloud tetap 30 detik.

Setelah upload ke GitHub Pages, lakukan hard refresh dan jalankan Lighthouse lagi dalam mode Mobile/Incognito.


## Sinkronisasi
- Sinkronisasi otomatis `getAll` dilakukan setiap 30 detik.
- Tidak ada auto-refresh tambahan saat focus/visibility.
- Retry upload data lokal tidak memanggil `getAll` tambahan; menunggu siklus 30 detik berikutnya.
- Tombol refresh manual tetap dapat memicu request segera karena merupakan tindakan pengguna.
