# NEV Absenku V14 — Stable Bug Fix

Paket ini dibuat dari source yang Anda kirim dan difokuskan pada stabilitas frontend, sinkronisasi, foto Google Drive, geofencing, selfie, serta operasi HRD/Koor KP.

## Perbaikan utama

1. **Perbaikan fatal `index.html`**
   - Menghapus `<script>...</script>` yang tersisip di dalam template `printQR()`. Tag tersebut dapat menutup script utama HTML terlalu dini dan menyebabkan banyak fungsi JavaScript setelah `printQR()` tidak berjalan.
   - Setelah perbaikan, inline JavaScript sudah lulus `node --check`.

2. **Logo**
   - Semua referensi `nev-logo.png` diarahkan ke `nev-logo.webp` yang ikut dalam paket.

3. **Login**
   - Login hanya menunggu endpoint `login`. Dashboard ditampilkan segera setelah autentikasi berhasil.
   - `getAll` dijalankan di background.
   - Tombol login dikunci selama request agar tidak terjadi login ganda.

4. **Sinkronisasi**
   - Polling tetap 30 detik.
   - Pending queue hanya dibuat dari request yang benar-benar gagal karena jaringan.
   - Queue `saveSessions/saveAttendance/saveSettings` memakai item terbaru untuk action yang sama agar tidak menumpuk snapshot lama.
   - `addAttendance/addPermit` dapat masuk queue jika koneksi gagal.
   - `fetchCloudAll()` tidak lagi melakukan retry queue atau `getAll` tambahan di dalam dirinya.
   - Refresh manual dan polling mengirim queue terlebih dahulu, kemudian mengambil data server.
   - Cache-busting pada `getAll`.
   - Sesi kedaluwarsa mengembalikan pengguna ke halaman login.

5. **Foto Google Drive**
   - Ditambahkan endpoint backend `getPhoto` yang memeriksa hak akses pengguna sebelum mengambil foto dari Drive.
   - Frontend mencoba thumbnail Drive lalu fallback ke proxy Apps Script jika thumbnail tidak dapat ditampilkan.
   - Ini menangani kasus foto tersimpan di Drive tetapi `<img>` tidak bisa menampilkan link Drive secara langsung.

6. **Persetujuan Izin/Sakit**
   - `approvePermit()` dan `rejectPermit()` sekarang memakai endpoint `reviewPermit`, bukan `savePermits` yang memang ditolak backend.
   - Backend dibuat idempoten untuk keputusan yang sama.

7. **Absensi manual HRD/Koor KP**
   - Backend `saveAttendance` sekarang dapat membuat catatan absensi manual yang memang belum ada, dengan validasi role, sesi, staf, dan divisi.

8. **Geofencing + Selfie**
   - Ditambahkan fallback pemeriksaan Leaflet agar tidak gagal karena `ensureLeaflet()` tidak tersedia.
   - Kamera selfie memeriksa HTTPS/getUserMedia sebelum dipanggil.
   - Submit selfie tidak dapat dilakukan sebelum verifikasi lokasi selesai dan valid.
   - Penutupan modal menghentikan stream kamera.
   - Radius harus lebih besar dari 0.

9. **Waktu WIB**
   - Default tanggal dan tampilan jam menggunakan Asia/Jakarta agar tidak bergeser karena timezone perangkat.

## File yang di-upload

- `index.html`
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`
- `nev-logo.webp`

## Backend Apps Script

Upload isi `Code.gs` ke Apps Script yang sama, lalu:

1. **Deploy → Manage deployments**
2. Pilih deployment Web App Anda
3. **Edit**
4. **Version → New version**
5. **Deploy**
6. Pastikan Web App tetap **Execute as: Me** dan akses sesuai kebutuhan aplikasi (misalnya Anyone).

Versi backend pada source ini: `secure-v7-stable`.

## Setelah deploy

1. Upload seluruh file frontend di atas ke GitHub Pages.
2. Commit & push.
3. Buka website.
4. Tekan `Ctrl + Shift + R`.
5. Login sebagai HRD.
6. Uji:
   - Buat QR
   - Login STAF dari perangkat lain
   - Scan QR + lokasi + selfie
   - Cek Rekap Absensi dan foto
   - Ajukan Izin/Sakit + foto
   - Setujui/Tolak dari HRD
   - Edit absensi manual HRD
   - Uji lokasi kantor/geofence

## Catatan

Foto lama yang sudah tersimpan sebelum V14 tetap bergantung pada file Drive yang masih ada dan dapat diakses oleh akun Apps Script. V14 menambahkan jalur proxy terotorisasi untuk membantu menampilkan foto tersebut tanpa mengubah isi foto.
