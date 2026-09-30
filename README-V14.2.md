# NEV Absenku V14.2 — Divisi + Security + QR Zoom

## Perubahan utama
- Data Ngoprek Koor KP dipisahkan berdasarkan `division`.
- Koor KP hanya menerima sesi, absensi, dan izin/sakit Ngoprek dari divisinya.
- Koor KP dapat mengedit dan merekap absensi Ngoprek divisinya.
- HRD tetap dapat melihat, mengedit, dan merekap seluruh absensi.
- QR token tidak lagi dikirim dalam endpoint `getAll`.
- Token QR hanya diminta saat HRD/Koor KP membuka QR tertentu.
- Validasi server tetap memeriksa token QR asli saat absensi dikirim.
- Zoom kamera scanner ditambahkan jika perangkat/browser mendukung kontrol zoom kamera.
- Data foto tetap dibatasi berdasarkan role/divisi pada endpoint foto.

## File GitHub Pages
- index.html
- cloud-sync.js
- geo-selfie.js
- geo-selfie.css
- nev-logo.webp

## File Google Apps Script
- Code.gs

## Deploy
1. Ganti lima file frontend di GitHub Pages.
2. Ganti seluruh `Code.gs` di Apps Script.
3. Deploy → Manage deployments → Edit → Version: New version → Deploy.
4. URL `/exec` tetap sama.
5. Ctrl + Shift + R pada browser.

## Catatan response Network
Browser yang menjalankan aplikasi memang dapat melihat response request yang dikirim kepadanya melalui DevTools. Itu tidak dapat dibuat benar-benar tersembunyi dari pemilik browser.

Yang diperbaiki di V14.2 adalah **data lintas divisi dan QR token** tidak lagi dikirim sembarangan:
- Koor KP hanya menerima data Ngoprek divisinya.
- STAF hanya menerima data absensinya sendiri.
- QR token tidak ikut `getAll`.
- Token QR hanya diberikan saat QR tertentu diminta oleh HRD/Koor KP.
- Endpoint backend tetap melakukan otorisasi server-side.
