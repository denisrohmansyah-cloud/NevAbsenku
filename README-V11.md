# NEV Absenku V11 — Controlled Sync

Perbaikan:
- Login tetap cepat dan tidak menunggu getAll.
- Sinkronisasi otomatis tepat 30 detik sekali.
- Tidak ada refresh otomatis pada focus/visibilitychange.
- Tidak ada getAll tambahan setelah retry/pending upload.
- Pending sync hanya berasal dari POST yang benar-benar gagal, bukan hasil membandingkan seluruh localStorage dengan server.
- Queue pending disimpan di `nev_sync_queue_v11`.
- Satu item pending dicoba maksimal satu kali pada satu siklus. Jika gagal, menunggu siklus 30 detik berikutnya.
- Jika server sudah memiliki record, queue direkonsiliasi dan dihapus.

## Instalasi
1. Upload `cloud-sync.js` V11 dan `index.html` sesuai paket frontend.
2. `Code.gs` tidak wajib dideploy ulang hanya untuk perubahan queue/polling ini, kecuali versi backend berbeda.
3. Hard refresh: Ctrl+Shift+R.

## Pola request
Login: 1 request login + 1 getAll background setelah dashboard tampil.
Polling: 1 getAll setiap 30 detik.
Pending: POST hanya jika ada queue; tidak memicu getAll tambahan.
