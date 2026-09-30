# NEV Absenku V14.9.2

Perubahan:
- Menu Manajemen Akun HRD sekarang memiliki pilihan Role: STAF, HRD, KOOR KP.
- Jika role HRD dipilih, Divisi tidak diperlukan.
- Jika role STAF/KOOR KP dipilih, Divisi wajib.
- Koor KP tetap hanya dapat membuat STAF dan otomatis menggunakan divisinya.
- Tombol "Hapus Semua Tampil" tetap dihilangkan dari Rekap Absensi.

## Penting
Frontend V14.9.2 mengirim nilai role ke backend. Agar HRD benar-benar dapat membuat akun HRD/KOOR KP, terapkan `Code.gs-ROLE-PATCH.txt` pada Code.gs deployment yang sedang aktif.

Jangan mengganti seluruh Code.gs aktif dengan file Code.gs lama jika deployment Anda saat ini sudah menggunakan secure-v6-fast-login.

### Fitur perubahan divisi STAF oleh HRD
- HRD dapat membuka menu **Manajemen Akun** lalu menekan tombol edit pada akun STAF.
- HRD dapat mengubah **Nama**, **Divisi**, dan **Password**.
- Divisi yang tersedia: **Networking, Cyber, Sysadmin**.
- Perubahan divisi hanya memengaruhi data akun/absensi berikutnya; riwayat absensi lama tetap menyimpan divisi ketika absensi tersebut dilakukan.
- Backend `updateUser_` pada Code.gs yang aktif sudah mendukung perubahan `division` untuk HRD.
