# NEV Absenku V13.2 — Login Loading

Perubahan:
- Menambahkan spinner animasi pada tombol **Masuk**.
- Teks berubah menjadi **Memproses login...** saat request login berlangsung.
- Tombol dinonaktifkan sementara agar tidak terjadi klik/login ganda.
- Jika login berhasil, loader otomatis selesai ketika halaman login ditutup.
- Jika request tidak selesai, tombol otomatis kembali normal setelah 20 detik.

## Pemasangan
Ganti `index.html` di GitHub Pages dengan file `index.html` dari paket ini.

Tidak perlu mengubah `Code.gs` hanya untuk fitur ini.
