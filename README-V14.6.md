# NEV Absenku V14.6 — Account Management Fix

Versi ini memperbaiki masalah HRD tidak dapat membuat akun KOOR KP/HRD dan memperbaiki pengelolaan akun.

## Fitur yang diperbaiki
- HRD dapat membuat akun **STAF**, **KOOR KP**, dan **HRD**.
- KOOR KP hanya dapat membuat akun **STAF**.
- Akun HRD tidak memerlukan divisi.
- Akun STAF dan KOOR KP wajib memiliki divisi.
- Username/NIM harus unik.
- HRD dapat mengubah **Nama, Username/NIM, dan Divisi** akun STAF/KOOR KP.
- HRD dapat mengubah Username/NIM akun HRD.
- Koor KP tetap dibatasi hanya pada STAF di divisinya.
- Hak akses pembuatan akun divalidasi di backend, bukan hanya di tampilan.
- Sinkronisasi cloud, foto/selfie, QR, geofencing, dan fitur V14.5 lainnya dipertahankan.

## 1. Update Apps Script — WAJIB
File yang dipakai:
- `Code.gs`

Buka **Google Sheets → Extensions → Apps Script**.
Ganti seluruh isi `Code.gs` dengan file `Code.gs` dari paket ini.

Kemudian:
1. Save.
2. **Deploy → Manage deployments**.
3. Klik ikon pensil pada Web App yang aktif.
4. Pada **Version**, pilih **New version**.
5. Deploy.
6. Pastikan Web App tetap:
   - Execute as: **Me**
   - Who has access: **Anyone**

Versi backend paket ini: `secure-v7.6-account-management`.

**Jangan membuat deployment baru dengan URL berbeda jika tidak diperlukan.** Edit deployment yang sekarang agar URL `/exec` tetap sama.

## 2. Update GitHub Pages
Upload/ganti 5 file berikut pada repository GitHub Pages:
- `index.html`
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`
- `nev-logo.webp`

`Code.gs` **tidak** di-upload ke GitHub Pages.

## 3. Setelah upload
1. Commit & push ke GitHub.
2. Buka website.
3. Tekan **Ctrl + Shift + R**.
4. Jika masih ada cache lama, buka DevTools → Network → centang **Disable cache**, lalu reload.
5. Login sebagai HRD.

## 4. Pengujian akun
### HRD
Di **Manajemen Akun → Tambah Akun**, pilihan Role harus:
- STAF
- KOOR KP
- HRD

Jika memilih:
- **STAF** → pilih divisi.
- **KOOR KP** → pilih divisi.
- **HRD** → divisi otomatis tidak diperlukan.

### KOOR KP
Saat login sebagai KOOR KP, menu Tambah Akun hanya boleh membuat:
- STAF

Divisi otomatis mengikuti divisi Koor KP.

## 5. Pengujian perubahan akun STAF
Login sebagai HRD → Manajemen Akun → klik tombol pensil pada STAF.
HRD dapat mengubah:
- Nama
- Username/NIM
- Divisi
- Password

Perubahan disimpan ke Google Sheets dan disinkronkan kembali ke browser.

## Catatan
Backend harus di-deploy ulang karena aturan role pembuatan akun berada di `Code.gs`. Mengganti `index.html` saja tidak cukup untuk membuat akun HRD/KOOR KP.
