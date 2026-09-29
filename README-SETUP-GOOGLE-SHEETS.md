# NEV Absenku v3 — Google Sheets + Drive

Versi ini mempertahankan fitur QR, geofencing, selfie, izin/sakit, rekap, Excel/PDF, tetapi menambahkan pembatasan akun/divisi dan pengelolaan data.

## Perubahan utama

1. **Akun STAF dibuat oleh HRD atau Koor KP**
   - Input: Nama, NIM, password, divisi.
   - Koor KP hanya dapat membuat STAF pada divisinya sendiri.
   - Role akun yang dibuat dari menu ini selalu STAF.
   - Tidak ada tombol **Daftar sekarang** pada halaman login.

2. **Pemisahan Ngoprek per Koor KP**
   - QR Ngoprek milik Koor KP hanya terlihat oleh Koor KP pembuatnya.
   - Koor KP lain tidak menerima sesi/QR/absensi milik Koor KP tersebut.
   - HRD tetap dapat melihat seluruh data.
   - Koor KP hanya dapat membuat/mengedit/menghapus Ngoprek miliknya sendiri.

3. **Edit & rekap**
   - HRD dapat mengedit seluruh status absensi.
   - Koor KP dapat mengedit status absensi Ngoprek miliknya.
   - Koor KP memiliki filter tanggal + nama/NIM serta ekspor Excel/PDF.
   - HRD memiliki filter tanggal, kegiatan, divisi, status, dan nama/NIM serta ekspor Excel/PDF.

4. **Password**
   - Password akun baru di-hash SHA-256 di Apps Script sebelum ditulis ke sheet `Users`.
   - Password tidak dikirim kembali pada respons `getAll`.
   - Data akun yang tampil di aplikasi tidak memuat kolom password.

5. **Hapus data**
   - QR/kegiatan dapat dihapus dari daftar QR.
   - Saat sesi/QR dihapus, seluruh absensi dan pengajuan izin/sakit yang terkait sesi tersebut ikut dihapus dari server.
   - Data absensi juga mempunyai tombol hapus.

6. **Search/filter**
   - Rekap HRD: tanggal + kegiatan + divisi + status + nama/NIM.
   - Absensi Ngoprek Koor KP: tanggal + nama/NIM.

7. **QR lebih sederhana**
   - QR diperkecil dan informasi tampilan disederhanakan.
   - Token mentah tidak ditampilkan pada kartu QR/hasil print.

8. **Loading animation**
   - Loading awal menampilkan logo yang diberikan, animasi bergerak, dan tulisan `NevAbsenku`.

## Struktur file

Upload/hosting file berikut dalam satu folder:

- `index.html`
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`
- `nev-logo.png`

`Code.gs` hanya dipasang di Google Apps Script, bukan di hosting website.

## Instalasi / update Apps Script

1. Buka Spreadsheet yang dipakai NEV Absenku.
2. Extensions → Apps Script.
3. Ganti seluruh isi Apps Script dengan `Code.gs` versi ini.
4. Save.
5. Deploy → Manage deployments.
6. Edit deployment aktif → Version: **New version** → Deploy.
7. Pastikan:
   - Execute as: **Me**
   - Who has access: **Anyone**
8. URL `/exec` harus sama dengan `CLOUD_SCRIPT_URL` di `cloud-sync.js`.

## Penting setelah update

Versi backend baru menggunakan autentikasi sesi. Browser yang sudah memiliki sesi lama dapat meminta login ulang setelah update.

Password lama yang masih plaintext di sheet akan dinormalisasi menjadi SHA-256 oleh backend saat bootstrap/update. Setelah itu kolom password pada `Users` tidak lagi berisi password asli.

## Akun demo bawaan

Jika sheet `Users` benar-benar kosong, backend akan membuat:

- STAF: `24101001` / `123456`
- HRD: `HRD001` / `123456`
- KOOR KP: `KOORKP001` / `123456`
- STAF Cyber: `24101002` / `123456`
- STAF Sysadmin: `24101003` / `123456`

Akun demo hanya dibuat ketika sheet Users kosong.

## Catatan keamanan

Backend Web App tetap menggunakan akses `Anyone` agar perangkat STAF tidak perlu login Google. Karena itu URL `/exec` harus dijaga. Versi ini menambahkan token sesi aplikasi dan filter data berdasarkan role/creator/divisi, tetapi deployment Apps Script tetap merupakan endpoint publik yang perlu dijaga.

Untuk keamanan password yang lebih kuat pada sistem produksi, SHA-256 sederhana sebaiknya ditingkatkan menjadi password KDF bersalt seperti PBKDF2/Argon2/bcrypt.
