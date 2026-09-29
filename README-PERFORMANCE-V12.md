# NEV Absenku V12 — Lazy Loading Performance

V12 melanjutkan V11 dengan optimasi frontend:
- QRCode.js dimuat hanya saat fitur QR dipakai.
- html5-qrcode dimuat hanya saat scanner dibuka.
- SheetJS dimuat hanya saat export Excel.
- jsPDF + AutoTable dimuat hanya saat export PDF.
- Leaflet JS/CSS dimuat hanya saat fitur peta dibuka.
- Font, Font Awesome, dan CSS utama tetap non-blocking.
- Queue pending, login cepat, pembatasan data, dan polling 30 detik V11 dipertahankan.

Upload ke GitHub Pages: index.html, cloud-sync.js, geo-selfie.js, geo-selfie.css, nev-logo.webp.
Code.gs V11 tetap digunakan; V12 tidak mengubah backend.
Setelah upload: Ctrl+Shift+R.
