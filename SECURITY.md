# Security notes — NEV Absenku

Dokumen ini mencatat batas keamanan yang perlu diperhatikan untuk deployment NEV Absenku. Ini bukan pernyataan bahwa audit keamanan penuh telah dilakukan.

## Yang terlihat dari frontend

- Frontend memanggil Google Apps Script dari browser dan menyimpan `nev_auth_token` serta data pengguna di `localStorage`.
- Kode frontend dapat dilihat publik dari browser. Karena itu, URL endpoint bukan rahasia, dan JavaScript sisi klien tidak boleh menyimpan password admin, service-account credentials, atau API key privat.
- Pemeriksaan role, kepemilikan data, masa aktif QR, dan geofencing yang hanya berjalan di browser dapat dilewati oleh pengguna yang mengubah kode/runtime lokal.
- Selfie, lokasi, dan data absensi adalah informasi sensitif. Batasi siapa yang boleh membacanya dan hindari menyertakan informasi ini dalam log atau URL.

## Wajib diperiksa di Google Apps Script

1. Setiap aksi selain login memverifikasi token yang valid, belum kedaluwarsa/dicabut, dan role yang berhak menjalankannya.
2. Server menentukan identitas aktor dari token sesi; jangan mempercayai `userId`, `role`, nama, atau status kehadiran yang dikirim browser sebagai otoritas.
3. Server memvalidasi input, ID record, nilai tanggal/waktu, dan transisi status. Aksi baca, edit, delete, ekspor, purge, upload, dan surat peringatan harus punya pemeriksaan izin masing-masing.
4. QR sebaiknya sulit ditebak, memiliki masa berlaku dan konteks sesi, serta divalidasi server-side untuk mencegah replay/absensi lintas sesi.
5. Jika geofencing diwajibkan, server harus memeriksa bukti lokasi yang diterima dan aturan radius; tetap pahami bahwa lokasi perangkat/browser dapat dimanipulasi.
6. Lindungi upload Drive: validasi ukuran/jenis file, hindari file publik secara default, dan hanya izinkan akses bagi pengguna yang berwenang.
7. Pastikan deployment Apps Script serta spreadsheet/Drive tidak memberikan izin baca/tulis lebih luas daripada kebutuhan aplikasi. Endpoint publik wajib memiliki autentikasi dan otorisasi per aksi yang benar.
8. Token sesi tidak boleh dikirim lewat query string. Gunakan HTTPS dan rotasi/revoke token saat logout, reset password, atau perubahan hak akses.
9. Karena token berada di `localStorage`, kerentanan XSS dapat membocorkan sesi. Lakukan escaping semua data dinamis, hindari HTML mentah dari input pengguna, dan pertimbangkan pendekatan sesi yang lebih tahan XSS bila arsitektur backend memungkinkan.
10. Terapkan prinsip minimisasi data, retensi yang jelas, backup, dan prosedur respons jika perangkat atau token hilang.

## Rilis yang aman

- Gunakan akun pengujian; jangan menggunakan data personal nyata saat verifikasi.
- Periksa kebijakan akses Apps Script dan spreadsheet/Drive secara terpisah.
- Uji permintaan langsung ke endpoint untuk memastikan aksi terlarang tetap ditolak walaupun dipanggil tanpa UI.
- Jangan menyebut deployment siap produksi sebelum backend Apps Script dan izin Google Workspace/Drive juga ditinjau.
