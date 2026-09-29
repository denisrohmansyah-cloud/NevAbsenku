# NEV Absenku — Security Fix V6

Perbaikan berdasarkan audit F1–F4:

- F1 Stored XSS: ID dan URL foto tidak lagi dipercaya sebagai HTML/URL arbitrer. ID record dibuat server-side. Rendering foto menggunakan URL yang di-allowlist. Inline ID JS di-escape.
- F2 Attendance forgery: server memvalidasi session, token QR harus sama persis dengan token pada server, status aktif, tanggal WIB, jam kegiatan, dan geofence server-side.
- F3 Permit self-approval: STAF tidak dapat mengubah status permit melalui save endpoint. Approval/rejection hanya melalui `reviewPermit` dan server memeriksa HRD/Koor KP + kepemilikan divisi.
- F4 Upsert by ID: sinkronisasi attendance tidak boleh membuat record baru melalui upsert umum. STAF dilarang memakai `saveAttendance`; Koor KP hanya dapat mengubah status record Ngoprek miliknya dan field identitas dipertahankan.
- Sinkronisasi otomatis tetap 30 detik.
- getAll tidak mengirim token QR. Token hanya diminta melalui `getSessionToken` setelah otorisasi.
- Token runtime tidak lagi ditulis kembali ke localStorage oleh cloud-sync.

## Deploy

1. Replace `Code.gs` pada Google Apps Script.
2. Deploy > Manage deployments > Edit > Version: New version > Deploy.
3. Upload `index.html`, `cloud-sync.js`, `geo-selfie.js`, `geo-selfie.css`, dan `nev-logo.png` ke hosting/GitHub Pages.
4. Hard refresh browser: Ctrl+Shift+R.
5. Di DevTools > Network, cek `getAll`: tidak boleh ada field `token` pada sessions/attendance.
6. Uji sebagai STAF: ubah token, tanggal/jam, koordinat, dan status permit dari DevTools. Server harus menolak.
7. Uji sebagai Koor KP: response hanya berisi Ngoprek milik divisinya.
