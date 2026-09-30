# NEV Absenku V14.7 READY — Manajemen Akun

Paket ini dibuat dari file proyek yang diberikan, dengan perbaikan backend untuk manajemen akun.

## Perbaikan utama

- HRD dapat membuat akun STAF, KOOR KP, dan HRD.
- STAF dan KOOR KP wajib mempunyai divisi.
- HRD tidak memerlukan divisi.
- Username/NIM tidak boleh duplikat.
- KOOR KP hanya dapat membuat/mengelola STAF di divisinya.
- KOOR KP tidak dapat mengubah role/divisi STAF.
- **Bug penting diperbaiki:** ketika KOOR KP menyimpan pengaturan profil sendiri, akun tidak lagi berubah menjadi STAF.
- Password backend tetap disimpan sebagai hash SHA-256.
- Login, sinkronisasi Google Sheets/Drive, selfie, izin/sakit, QR, dan geofencing tetap menggunakan file proyek yang diberikan.
- Logo yang diberikan disertakan sebagai `nev-logo.png`.

## File

- `index.html`
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`
- `Code.gs`
- `nev-logo.png`

## Upload frontend ke GitHub Pages

1. Backup repository GitHub terlebih dahulu.
2. Ganti `index.html` dengan file dari paket ini.
3. Ganti `cloud-sync.js`, `geo-selfie.js`, dan `geo-selfie.css` dengan file paket.
4. Pastikan `nev-logo.png` berada di folder yang sama dengan `index.html`.
5. Jangan menghapus library/file lain yang sudah dipakai proyek.
6. Commit dan Push.
7. Buka GitHub Pages lalu tekan `Ctrl + Shift + R`.

## Upload backend ke Google Apps Script

1. Backup `Code.gs` lama.
2. Buka project Google Apps Script.
3. Ganti isi `Code.gs` dengan `Code.gs` dari paket.
4. Save.
5. Deploy -> Manage deployments.
6. Edit deployment Web App yang dipakai aplikasi.
7. Version -> New version.
8. Deploy.
9. Pertahankan akses Web App sesuai konfigurasi sebelumnya.
10. Jangan membuat URL `/exec` baru jika ingin frontend tetap menggunakan deployment yang sama.

## Tes setelah upload

Login HRD, buka Manajemen Akun, lalu buat:

1. STAF
   - Nama
   - Username/NIM
   - Password
   - Divisi

2. KOOR KP
   - Nama
   - Username/NIM
   - Password
   - Divisi

3. HRD
   - Nama
   - Username
   - Password
   - Divisi tidak diperlukan

Kemudian cek Google Sheets pada sheet `Users`.

## Catatan

Jika deployment Apps Script Anda memiliki perubahan backend lain yang lebih baru daripada `Code.gs` paket ini, backup dan bandingkan terlebih dahulu sebelum mengganti seluruh backend.
