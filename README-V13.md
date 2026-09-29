# NEV Absenku V13

Ganti **cloud-sync.js** di GitHub Pages dengan versi V13.

Perubahan:
- Login tidak menunggu `getAll`; dashboard tampil setelah login berhasil.
- `getAll` berjalan di background.
- Polling otomatis tepat 30 detik.
- Tidak ada auto-refresh pada focus/visibility.
- Pending hanya berasal dari request yang benar-benar gagal.
- Queue pending dicoba tiap 30 detik.
- Tidak ada `getAll` tambahan setelah retry queue.
- `bootstrap` dibaca dengan cache-busting.
- Versi server dibaca otomatis dari `bootstrap`; tidak lagi membandingkan `secure-v3` secara hard-code.

## Update
1. Upload `cloud-sync.js` V13 ke GitHub Pages.
2. Tidak perlu mengganti `Code.gs` hanya untuk perubahan frontend V13.
3. Ctrl+Shift+R.
4. Login.

Catatan: V13 memakai Web App URL yang sudah digunakan aplikasi saat ini.
