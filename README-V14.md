# NEV Absenku V14 — Manajemen Akun Role Fix

## Perbaikan V14
- HRD dapat membuat akun **STAF**, **KOOR KP**, dan **HRD**.
- KOOR KP hanya dapat membuat akun **STAF** pada divisinya sendiri.
- Form Tambah Akun sekarang benar-benar mengirim role yang dipilih.
- Akun HRD tidak membutuhkan divisi.
- Akun STAF/KOOR KP wajib memiliki divisi.
- HRD dapat mengedit nama, Username/NIM, role, divisi, dan password akun.
- HRD tidak dapat mengubah role akun HRD yang sedang login menjadi role lain.
- KOOR KP hanya dapat mengedit/mengelola STAF di divisinya.
- Username/NIM dicek agar tidak boleh duplikat.
- Perubahan Username/NIM dan divisi disimpan ke Google Sheets.
- File frontend lain seperti `cloud-sync.js`, `geo-selfie.js`, `geo-selfie.css`, dan logo tidak diubah oleh V14.

## File yang di-upload ke GitHub Pages
Ganti **hanya**:
- `index.html`

Pertahankan file yang sudah ada:
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`
- `nev-logo.webp`

## Backend Google Apps Script
`Code.gs` berisi perubahan backend yang diperlukan agar role HRD/KOOR KP benar-benar dapat dibuat.

### PENTING
Backend yang sedang live sebelumnya terlihat menggunakan versi `secure-v6-fast-login`, sedangkan source `Code.gs` yang diberikan sebelumnya memiliki label `secure-v3`. Karena itu, **jangan langsung mengganti seluruh Code.gs live jika source Apps Script Anda saat ini sudah berisi perubahan v6 yang lebih baru**.

Ada dua pilihan:
1. Jika `Code.gs` di Apps Script memang sama dengan file `Code.gs` dalam paket ini, tempel seluruh `Code.gs` V14 dan deploy sebagai **New version**.
2. Jika Apps Script live Anda sudah berbeda/lebih baru, gunakan `PATCH-USER-MANAGEMENT-V14.txt`: ganti hanya fungsi `createUser_()` dan `updateUser_()` pada source live, lalu deploy **New version**.

URL Web App tetap sama.

## Setelah upload
1. GitHub Pages: commit/push `index.html` V14.
2. Jika backend diperbarui: Apps Script → Deploy → Manage deployments → Edit → Version: **New version** → Deploy.
3. Buka website dengan Incognito atau tekan `Ctrl + Shift + R`.
4. Login sebagai HRD.
5. Buka **Manajemen Akun → Tambah Akun**.
6. Uji tiga role:
   - STAF + divisi
   - KOOR KP + divisi
   - HRD tanpa divisi
7. Setelah dibuat, edit akun STAF dan pastikan Username/NIM serta Divisi dapat berubah dan tersimpan.
