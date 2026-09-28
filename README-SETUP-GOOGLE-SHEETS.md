# NEV Absenku — Setup Data Terpusat (Google Sheets & Drive)

Sekarang semua data (akun, sesi/QR, absensi, pengaturan lokasi kantor,
**dan foto selfie**) bisa tersimpan terpusat di satu Google Spreadsheet
+ Google Drive, bukan lagi tersebar sendiri-sendiri di tiap HP/browser.

Spreadsheet acuan:
https://docs.google.com/spreadsheets/d/1E-JqBubHJAl_ym7Z3_FHoNBRh5FIjTL_Mh1pqOMkY_A/edit

## Langkah pasang (sekali saja)

1. **Buka Spreadsheet** di atas (pastikan Anda login dengan akun Google
   pemilik/editor spreadsheet tersebut).
2. Menu **Extensions/Ekstensi → Apps Script**.
3. Hapus kode contoh `myFunction() {...}` di editor yang terbuka.
4. Buka file **`Code.gs`** dari paket ini, salin **seluruh isinya**,
   lalu tempel ke editor Apps Script tadi. Simpan (Ctrl+S).
5. Klik **Deploy → New deployment**:
   - Klik ikon gerigi di "Select type" → pilih **Web app**.
   - Description: bebas (mis. "NEV Absenku API").
   - **Execute as: Me**
   - **Who has access: Anyone**
   - Klik **Deploy**.
6. Google akan minta izin (Authorize access) — pilih akun Anda, klik
   **Advanced/Lanjutan** → **Go to (nama project) (unsafe)** bila muncul
   peringatan, lalu **Allow/Izinkan**. Ini normal untuk script buatan
   sendiri; izin yang diminta hanya untuk mengakses Spreadsheet & Drive
   milik Anda sendiri.
7. Setelah deploy selesai, salin **Web app URL** yang ditampilkan
   (diakhiri `/exec`).
8. Buka file **`cloud-sync.js`**, cari baris:
   ```js
   const CLOUD_SCRIPT_URL = "PASTE_URL_WEB_APP_APPS_SCRIPT_DI_SINI";
   ```
   Ganti dengan URL yang tadi disalin, contoh:
   ```js
   const CLOUD_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx.../exec";
   ```
   Simpan file.
9. Upload/host ulang 5 file ini bersama-sama (harus dalam satu folder
   yang sama, karena saling memanggil lewat nama file relatif):
   - `index.html` (nama boleh diganti, ini file utama)
   - `geo-selfie.css`
   - `geo-selfie.js`
   - `cloud-sync.js`
   - (Code.gs TIDAK diupload ke web — itu khusus untuk Apps Script saja)

Selesai. Saat aplikasi dibuka pertama kali, sheet `Users`, `Sessions`,
`Attendance`, `Settings` akan **dibuat otomatis** di spreadsheet
beserta akun demo bawaan, dan folder Drive **"NEV Absenku - Foto
Selfie"** akan dibuat otomatis untuk menyimpan foto absensi.

## Pembaruan: Lokasi & Radius Khusus per Kegiatan (HRD & Koor KP)

Selain pengaturan "Lokasi & Radius Kantor" yang global (menu khusus
HRD), sekarang **HRD maupun Koor KP** juga bisa mengatur lokasi &
radius **khusus untuk satu kegiatan/QR tertentu**, langsung dari form
"Buat QR Absensi" (HRD) / "Buat QR Ngoprek" (Koor KP) — centang opsi
"Perketat dengan Lokasi & Radius Khusus Kegiatan Ini", lalu klik peta
atau gunakan tombol "Gunakan Lokasi Saya". Jika diaktifkan, titik &
radius inilah yang berlaku untuk kegiatan tersebut (menggantikan
pengaturan kantor, hanya untuk kegiatan itu saja).

**Jika Anda sudah pernah deploy `Code.gs` sebelumnya**, sheet
`Sessions` mendapat 4 kolom baru (`geoEnabled`, `geoLat`, `geoLng`,
`geoRadius`). Supaya kolom ini ikut disimpan, update kode Apps Script
Anda:
1. Buka Apps Script → tempel ulang **seluruh isi** `Code.gs` yang baru
   (menimpa yang lama).
2. **Deploy → Manage deployments** → klik ikon pensil pada deployment
   yang aktif → Version: **New version** → **Deploy**.
   (Ini penting — sekadar menyimpan kode di editor Apps Script TIDAK
   otomatis memperbarui Web App URL yang sudah berjalan.)
3. URL Web App (`.../exec`) tetap sama, tidak perlu diganti di
   `cloud-sync.js`.


## Cara kerjanya

- Saat aplikasi dibuka, ia mengambil data terbaru dari Google Sheets
  lebih dulu (ada layar "Menyinkronkan..." sebentar), baru menampilkan
  halaman login/dashboard.
- Setiap perubahan (tambah user, buat sesi/QR, ubah pengaturan kantor,
  edit status absensi) otomatis dikirim ke Google Sheets.
- Saat STAF absen: foto selfie diunggah ke Google Drive dulu, lalu
  linknya dicatat di sheet `Attendance` — jadi HRD bisa membuka foto
  langsung dari Google Sheets/Drive, dari HP mana pun.
- Aplikasi menarik ulang data dari Google Sheets setiap ~20 detik,
  supaya QR/absensi yang dibuat di HP lain ikut terlihat di sini.
- Jika koneksi ke Google terputus, aplikasi tetap bisa dipakai dengan
  data cache lokal (localStorage) sebagai cadangan sementara.

## Pembaruan: Folder Drive sendiri, foto stabil, tanggal tidak rusak

**Folder Drive** kini memakai folder yang Anda buat (ID diatur di bagian atas `Code.gs`, konstanta `FOLDER_IDS`):
- `NEV Absenku_Foto Selfie` → selfie saat absen
- `NEV Absenku_Bukti Izin Sakit` → bukti izin/sakit
- `NEV Absenku_Foto Presensi` → belum dipakai (tukar ID `selfie`/`presensi` di `Code.gs` bila ingin selfie absen masuk ke sini)

**Wajib:** bagikan ketiga folder sebagai *Siapa saja yang memiliki link → Viewer*. File baru mewarisi izin folder, sehingga foto tampil juga di HP staf / browser yang tidak login akun pemilik. Bila folder tidak bisa diakses, script otomatis membuat folder cadangan bernama lama.

**Yang diperbaiki:**
1. Foto diperbesar kini tampil di dalam halaman (bukan popup) dengan beberapa link cadangan Drive.
2. Tanggal/jam yang berubah jadi `2026-09-27T17:00:00.000Z`: Google Sheets mengubah teks menjadi tanggal. Sekarang semua sel ditulis sebagai teks polos, dan data lama dinormalkan otomatis saat dibaca.
3. Simpan absensi lebih andal: selfie diperkecil (±720 px), upload tidak memblokir staf lain, otomatis dicoba ulang sekali, dan pesan error menyebutkan penyebabnya.
4. Absensi/pengajuan ganda (misal karena dicoba ulang) ditolak server dengan aman.

**Cara memperbarui** (semua langkah wajib):
1. Ganti `index.html`, `geo-selfie.js`, `cloud-sync.js` di hosting (GitHub Pages).
2. Tempel ulang seluruh `Code.gs` di Apps Script, lalu **Deploy → Manage deployments → pensil → New version → Deploy**. Bila Google meminta izin baru, setujui.
3. Buka aplikasi dengan refresh keras (Ctrl+Shift+R / hapus cache di HP).

## Catatan keamanan (penting)

Web App Apps Script ini diakses **tanpa login Google** dari sisi HP
staf (supaya siapa pun bisa absen tanpa perlu akun Google). Konsekuensinya:
siapa pun yang mengetahui URL Web App (`.../exec`) tersebut bisa
membaca maupun menulis data lewat URL itu — sama seperti token QR,
jangan disebarluaskan sembarangan. Untuk kebutuhan keamanan yang lebih
ketat (mis. autentikasi tambahan per-request), backend ini bisa
dikembangkan lebih lanjut, tapi di luar cakupan perubahan ini.

## Batasan yang perlu diketahui

- Penyimpanan memakai pola "timpa semua data" per tabel (mirip cara
  kerja localStorage sebelumnya), jadi bila dua orang menyimpan
  perubahan yang tumpang tindih dalam waktu sangat berdekatan pada
  data yang sama, perubahan terakhir yang menang. Untuk skala
  pemakaian kelas/organisasi kecil, ini biasanya tidak masalah.
- Apps Script Web App punya kuota pemakaian harian dari Google
  (cukup besar untuk pemakaian normal, tapi ada baiknya diketahui).
