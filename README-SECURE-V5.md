# NEV Absenku Secure V5

Perubahan:
- Sinkronisasi otomatis setiap 30 detik.
- Tidak ada token QR di response `getAll`.
- Tidak ada token absensi di response `getAll`.
- Token QR hanya diambil melalui `getSessionToken` setelah otorisasi.
- STAF tidak menerima seluruh database sesi; hanya sesi aktif.
- Koor KP dibatasi server + cache browser hanya ke divisinya sendiri.
- Dashboard Koor KP menyembunyikan kartu divisi lain.
- Versi backend: `secure-v5`.

## Wajib deploy
1. Ganti seluruh isi Apps Script dengan `Code.gs`.
2. Deploy > Manage deployments > Edit > Version: New version > Deploy.
3. Pastikan URL `/exec` pada `cloud-sync.js` adalah deployment yang baru.
4. Upload `index.html`, `cloud-sync.js`, `geo-selfie.js`, `geo-selfie.css`, `nev-logo.png`.
5. Hard refresh: Ctrl+Shift+R.

## Pemeriksaan Network
Request `getAll` seharusnya TIDAK memiliki:
- `sessions[].token`
- `attendance[].token`

Request `getSessionToken` hanya muncul saat HRD/Koor KP membuka QR tertentu.
