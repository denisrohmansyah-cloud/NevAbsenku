# NEV Absenku V15.1 READY

Perbaikan dari V15:
- Memasukkan kembali `nev-logo.png` yang sebelumnya tidak ikut paket.
- Tombol STAF/HRD/KOOR KP diberi `type="button"` agar tidak pernah dianggap tombol submit.
- Handler login/role dibuat eksplisit global untuk kompatibilitas GitHub Pages.
- Tetap memakai Web App Apps Script yang sama.
- Tidak mengganti `Code.gs`.

Upload semua file berikut ke root repository GitHub Pages:
- index.html
- cloud-sync.js
- geo-selfie.js
- geo-selfie.css
- nev-logo.png

README ini hanya panduan; tidak wajib di-upload.

Setelah upload:
1. Commit changes.
2. Tunggu GitHub Pages selesai deploy.
3. Buka situs dengan Ctrl+Shift+R.
4. Jika masih memakai cache lama, buka DevTools > Network > centang Disable cache lalu reload.
5. Uji klik STAF, HRD, dan Koor KP; tombol aktif harus berpindah.
6. Uji login HRD.

Code.gs tidak perlu di-deploy ulang untuk patch frontend ini.
