# NEV Absenku V14.6 — Perbaikan Manajemen Akun

## Perubahan
- HRD dapat membuat akun STAF, KOOR KP, dan HRD.
- KOOR KP hanya dapat membuat akun STAF pada divisinya sendiri.
- HRD dapat mengedit nama, Username/NIM, role, divisi, dan password akun.
- KOOR KP dapat mengedit nama, Username/NIM, dan password STAF pada divisinya; role/divisi tetap dikunci.
- Username/NIM dicek agar tidak boleh duplikat.
- Akun HRD otomatis tidak memiliki divisi.

## Upload frontend ke GitHub Pages
1. Backup repository terlebih dahulu.
2. Ganti file `index.html` lama dengan `index.html` dari paket ini.
3. Jangan hapus `cloud-sync.js`, `geo-selfie.js`, `geo-selfie.css`, `nev-logo.webp/png`, dan library lain yang sudah ada di repository.
4. Commit dan push ke branch yang dipakai GitHub Pages.
5. Buka website lalu tekan `Ctrl + Shift + R`.

## Upload backend ke Google Apps Script
1. Buka project Google Apps Script NEV Absenku.
2. Buka file `Code.gs`.
3. Backup kode lama terlebih dahulu.
4. Ganti isi `Code.gs` dengan file `Code.gs` dari paket ini.
5. Klik Save.
6. Pilih `Deploy` → `Manage deployments`.
7. Pada deployment Web App yang sedang digunakan, klik ikon pensil/Edit.
8. Pada `Version`, pilih `New version`.
9. Klik `Deploy`.
10. Pastikan akses Web App tetap sama seperti sebelumnya (akun pengguna harus dapat mengaksesnya sesuai konfigurasi deployment).
11. URL `/exec` tetap digunakan oleh frontend selama deployment yang diedit adalah deployment yang sama.

## Pengujian
Login sebagai HRD dan buka Manajemen Akun.

Uji 3 akun:
- STAF → wajib pilih divisi.
- KOOR KP → wajib pilih divisi.
- HRD → divisi otomatis tidak diperlukan.

Setelah akun dibuat, cek Google Sheets pada sheet Users.

## Catatan penting
`Code.gs` paket ini adalah perubahan dari source Code.gs yang diberikan untuk perbaikan manajemen akun. Jika deployment Web App Anda memiliki perubahan backend lain yang lebih baru daripada file ini, backup dan bandingkan terlebih dahulu sebelum mengganti seluruh `Code.gs`.
