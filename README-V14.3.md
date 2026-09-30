# NEV Absenku V14.3 — Auto Alpha & Rekap per Staf

V14.3 melanjutkan V14.2 dan menambahkan dua fitur utama:

## 1. Auto Alpha

Setiap sesi absensi yang **sudah melewati jam selesai** akan diperiksa oleh backend.
Untuk setiap STAF yang memang menjadi peserta sesi tersebut dan belum memiliki
record absensi, sistem otomatis membuat record dengan:

- Status: `Alpha`
- `checkIn`: waktu selesai sesi
- `autoAlpha`: `true`

Aturan peserta:
- Sesi dengan divisi tertentu → hanya STAF pada divisi tersebut.
- Sesi dengan divisi `-` → seluruh STAF.
- Sesi yang belum selesai → belum dibuat Alpha.
- Jika STAF sudah Hadir/Izin/Sakit → tidak dibuat Alpha.
- Jika izin/sakit kemudian disetujui, record Alpha yang ada akan diperbarui menjadi `Izin` atau `Sakit` oleh proses persetujuan yang sudah ada.

Proses Auto Alpha dijalankan saat endpoint `getAll` dipanggil, sehingga data tetap tersimpan di Google Sheets dan tidak hanya dihitung di browser.

## 2. Rekap jumlah absensi setiap staf

### HRD
Menu **Rekap Absensi** sekarang menampilkan tabel:
- Nama
- NIM
- Divisi
- Hadir
- Izin
- Sakit
- Alpha
- Total Sesi

Ringkasan mengikuti filter tanggal, kegiatan, divisi, dan pencarian staf. Filter Status hanya memengaruhi tabel detail di bawahnya.

### Koor KP
Menu **Absensi Ngoprek** menampilkan rekap yang sama, tetapi hanya untuk STAF pada divisi Koor KP yang sedang login.

Koor KP tidak menerima data Ngoprek divisi lain karena pembatasan tetap dilakukan di backend.

## File yang diperbarui

Upload ke GitHub Pages:
- `index.html`
- `cloud-sync.js`
- `geo-selfie.js`
- `geo-selfie.css`
- `nev-logo.webp`

Update Apps Script:
- `Code.gs`

## Deploy wajib

Karena Auto Alpha berjalan di backend:

1. Buka Apps Script.
2. Ganti seluruh isi `Code.gs` dengan versi V14.3.
3. Simpan.
4. **Deploy → Manage deployments → Edit → Version: New version → Deploy**.
5. URL Web App tetap sama.
6. Upload file frontend ke GitHub Pages.
7. Lakukan `Ctrl + Shift + R`.

Versi backend: `secure-v7.3-alpha-rekap`.
