/* =========================================================
   NEV ABSENKU — Sinkronisasi Terpusat (Google Sheets & Drive)
   -----------------------------------------------------------
   File terpisah, TIDAK mengubah tampilan lama. File ini membuat
   semua data (akun, sesi/QR, absensi, pengaturan kantor, dan
   FOTO selfie) benar-benar terpusat di satu Google Spreadsheet
   + Google Drive, bukan lagi tersimpan sendiri-sendiri di
   localStorage tiap HP/browser.

   CARA KERJA SINGKAT:
   1. Backend-nya adalah Google Apps Script (file Code.gs yang
      disertakan terpisah) yang di-deploy sebagai "Web App".
      Script itu membaca/menulis 4 sheet di Spreadsheet Anda:
      Users, Sessions, Attendance, Settings — dan menyimpan foto
      selfie sebagai file di sebuah folder Google Drive.
   2. File ini memanggil Web App tersebut lewat fetch():
      - Saat aplikasi dibuka: ambil semua data terbaru dari
        Google Sheets → isi ke localStorage (sebagai cache lokal
        supaya tampilan tetap instan/​responsif).
      - Setiap kali kode asli memanggil save(...), perubahan itu
        OTOMATIS ikut dikirim ke Google Sheets (lihat override
        fungsi save() di bawah).
      - Saat STAF absen (ambil selfie), foto diunggah ke Google
        Drive lebih dulu lewat Apps Script, baru linknya dicatat
        di Google Sheets (bukan base64 mentah).
      - Setiap ~20 detik, aplikasi menarik ulang data terbaru dari
        Google Sheets, supaya QR/absensi yang dibuat di HP lain
        ikut terlihat di perangkat ini.

   YANG PERLU ANDA ISI:
   Ganti CLOUD_SCRIPT_URL di bawah dengan URL "Web App" hasil
   deploy Apps Script Anda (lihat panduan di Code.gs / README).
   Selama URL belum diisi, aplikasi tetap berjalan seperti biasa
   memakai localStorage saja (tidak ada yang rusak).
========================================================= */

const CLOUD_SCRIPT_URL = "PASTE_URL_WEB_APP_APPS_SCRIPT_DI_SINI";

// Spreadsheet acuan (hanya untuk referensi/README — Apps Script yang
// benar-benar membaca/menulis ke sini harus di-bind ke spreadsheet ini):
// https://docs.google.com/spreadsheets/d/1E-JqBubHJAl_ym7Z3_FHoNBRh5FIjTL_Mh1pqOMkY_A/edit

const cloudSyncEnabled = typeof CLOUD_SCRIPT_URL === "string" && CLOUD_SCRIPT_URL.startsWith("http");

const CLOUD_ACTION_BY_KEY = {
    [DB.users]: "saveUsers",
    [DB.sessions]: "saveSessions",
    [DB.attendance]: "saveAttendance",
    [DB.settings]: "saveSettings",
    [DB.permits]: "savePermits"
};

let cloudPollTimer = null;
let cloudSyncBusy = false;


/* =========================================================
OVERRIDE save() — setiap perubahan lokal ikut dikirim ke cloud
========================================================= */

const _localSave = save; // simpan referensi fungsi save() versi localStorage asli

// PENTING: pakai assignment biasa (function expression), BUKAN "function save(){}".
// Deklarasi "function save(){}" akan di-hoist ke atas SEBELUM baris di atas
// sempat berjalan, sehingga _localSave malah menyalin dirinya sendiri dan
// menyebabkan infinite recursion saat dipanggil.
save = function(key, data){
    _localSave(key, data);
    pushToCloud(key, data);
};

function pushToCloud(key, data){
    if(!cloudSyncEnabled) return;
    const action = CLOUD_ACTION_BY_KEY[key];
    if(!action) return;

    fetch(CLOUD_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // hindari CORS preflight ke Apps Script
        body: JSON.stringify({ action, data })
    }).catch(err=>{
        console.error("Gagal sinkron ke Google Sheets:", err);
        toast("Gagal menyinkronkan data ke Google Sheets. Periksa koneksi internet.", "error");
    });
}


/* =========================================================
KIRIM KE APPS SCRIPT (dengan percobaan ulang & pesan error jelas)
Aman diulang: server menolak duplikat (id/sesi+user yang sama).
========================================================= */

async function cloudPost(action, data, retries){
    const maxRetry = retries ?? 1;
    let lastErr;

    for(let attempt=0; attempt<=maxRetry; attempt++){
        try{
            const res = await fetch(CLOUD_SCRIPT_URL, {
                method: "POST",
                headers: { "Content-Type": "text/plain;charset=utf-8" },
                body: JSON.stringify({ action, data })
            });
            const text = await res.text();

            let json;
            try{ json = JSON.parse(text); }
            catch(e){ throw new Error("Respons server bukan JSON (periksa deploy Apps Script & izin akses 'Anyone')."); }

            if(!json.ok){
                const serverErr = new Error(json.error || "Server menolak permintaan.");
                serverErr.fatal = true; // error dari server tidak akan sembuh dengan mengulang
                throw serverErr;
            }
            return json;
        }catch(err){
            lastErr = err;
            if(err.fatal) break;
            if(attempt < maxRetry) await new Promise(r=> setTimeout(r, 1500));
        }
    }
    throw lastErr;
}

function friendlyCloudError(err){
    const msg = String((err && err.message) || err || "");
    if(/failed to fetch|networkerror|load failed|network request failed/i.test(msg)){
        return "koneksi ke Google terputus atau terlalu lambat";
    }
    return msg.slice(0, 160) || "kesalahan tidak diketahui";
}


/* =========================================================
PEMBERSIH DATA DARI GOOGLE SHEETS
Sheets bisa mengubah teks "2026-09-28" / "08:00" menjadi Date, sehingga
kembali sebagai "2026-09-27T17:00:00.000Z". Dinormalkan lagi ke WIB.
========================================================= */

const _wibDate = new Intl.DateTimeFormat("en-CA", { timeZone:"Asia/Jakarta", year:"numeric", month:"2-digit", day:"2-digit" });
const _wibTime = new Intl.DateTimeFormat("en-GB", { timeZone:"Asia/Jakarta", hour:"2-digit", minute:"2-digit", hourCycle:"h23" });
const _isoDateTime = /^\d{4}-\d{2}-\d{2}T/;

function fixDateField(v){
    if(typeof v === "string" && _isoDateTime.test(v)){
        const d = new Date(v);
        if(!isNaN(d)) return _wibDate.format(d);
    }
    return v;
}

function fixTimeField(v){
    if(typeof v === "string" && _isoDateTime.test(v)){
        const d = new Date(v);
        if(!isNaN(d)) return _wibTime.format(d);
    }
    return v;
}

function sanitizeCloudData(json){
    (json.sessions || []).forEach(s=>{ s.date = fixDateField(s.date); s.start = fixTimeField(s.start); s.end = fixTimeField(s.end); });
    (json.attendance || []).forEach(a=>{ a.date = fixDateField(a.date); });
    (json.permits || []).forEach(p=>{ p.sessionDate = fixDateField(p.sessionDate); });
    return json;
}


/* =========================================================
AMBIL SEMUA DATA TERBARU DARI GOOGLE SHEETS
========================================================= */

async function fetchCloudAll(){
    if(!cloudSyncEnabled) return false;
    try{
        const res = await fetch(`${CLOUD_SCRIPT_URL}?action=getAll`);
        const json = await res.json();
        if(!json || !json.ok) throw new Error((json && json.error) || "Respons tidak valid");
        sanitizeCloudData(json);

        _localSave(DB.users, json.users || []);
        _localSave(DB.sessions, json.sessions || []);
        _localSave(DB.attendance, json.attendance || []);
        _localSave(DB.settings, json.settings || { officeLat:null, officeLng:null, radius:100, geofenceEnabled:false });
        _localSave(DB.permits, json.permits || []);
        return true;
    }catch(err){
        console.error("Gagal mengambil data dari Google Sheets:", err);
        return false;
    }
}

function startCloudPolling(){
    if(!cloudSyncEnabled || cloudPollTimer) return;
    cloudPollTimer = setInterval(async ()=>{
        if(cloudSyncBusy) return; // jangan tumpang tindih saat sedang absen/upload foto
        const ok = await fetchCloudAll();
        if(ok && currentUser) renderAll();
    }, 20000);
}


/* =========================================================
OVERRIDE finalizeAttendance() — unggah foto ke Drive dulu,
baru catat absensi (beserta link foto) ke Google Sheets
========================================================= */

async function finalizeAttendance(session, token, location, photo){
    const attendance = load(DB.attendance);
    const duplicate = attendance.find(a=> a.sessionId===session.id && a.userId===currentUser.id);
    if(duplicate){
        toast("Anda sudah melakukan absensi pada kegiatan ini.", "error");
        return;
    }

    const record = {
        id: "ATT-"+Date.now(), sessionId: session.id, token: session.token,
        userId: currentUser.id, userName: currentUser.name, username: currentUser.username,
        activity: session.activity, division: session.division, date: session.date,
        checkIn: new Date().toISOString(), status: "Hadir",
        creatorId: session.creatorId, creatorRole: session.creatorRole,
        lat: location ? location.lat : null,
        lng: location ? location.lng : null,
        photo: photo || null // sementara masih base64, akan diganti link Drive di bawah
    };

    // Mode offline / URL Apps Script belum diisi: perilaku sama seperti sebelumnya.
    if(!cloudSyncEnabled){
        attendance.push(record);
        save(DB.attendance, attendance);
        toast(`Absensi ${session.activity} berhasil.`, "success");
        updateScannerStatus(`Berhasil hadir: ${session.activity}${session.division!=="-" ? " • "+session.division : ""}`, "success");
        const manualInput = document.getElementById("manualToken");
        if(manualInput) manualInput.value = "";
        renderAll();
        return;
    }

    cloudSyncBusy = true;
    toast("Mengunggah foto & menyimpan absensi ke Google Sheets...", "normal");

    try{
        const json = await cloudPost("addAttendance", record);

        const saved = json.record || record; // record.photo sudah berupa link Drive dari server
        const list = load(DB.attendance);
        list.push(saved);
        _localSave(DB.attendance, list); // cache lokal saja, sudah tersimpan di server

        toast(`Absensi ${session.activity} berhasil & tersimpan di Google Sheets.`, "success");
        updateScannerStatus(`Berhasil hadir: ${session.activity}${session.division!=="-" ? " • "+session.division : ""}`, "success");
        const manualInput = document.getElementById("manualToken");
        if(manualInput) manualInput.value = "";
        renderAll();
    }catch(err){
        console.error("Gagal menyimpan absensi ke Google Sheets:", err);
        toast(`Gagal menyimpan absensi: ${friendlyCloudError(err)}. Silakan coba lagi.`, "error");
    }finally{
        cloudSyncBusy = false;
    }
}


/* =========================================================
OVERRIDE submitPermit() — unggah foto bukti izin/sakit ke Drive
dulu, baru catat pengajuan (beserta link foto) ke Google Sheets
========================================================= */

async function submitPermit(event){
    event.preventDefault();

    const sessionId = document.getElementById("permitSession").value;
    const type = document.getElementById("permitType").value;
    const reason = document.getElementById("permitReason").value.trim();

    if(!sessionId){ toast("Pilih kegiatan terlebih dahulu.", "error"); return; }
    if(!reason){ toast("Alasan wajib diisi.", "error"); return; }
    if(!pendingPermitPhoto){ toast("Lampirkan foto bukti terlebih dahulu.", "error"); return; }

    const sessions = load(DB.sessions);
    const session = sessions.find(s=>s.id===sessionId);
    if(!session){ toast("Kegiatan tidak ditemukan.", "error"); return; }

    const permit = buildPermitRecord(session, type, reason, pendingPermitPhoto);

    // Mode offline / URL Apps Script belum diisi: perilaku sama seperti sebelumnya.
    if(!cloudSyncEnabled){
        const permits = load(DB.permits);
        permits.push(permit);
        save(DB.permits, permits);
        resetPermitForm();
        renderPermitHistory();
        toast(`Pengajuan ${type} berhasil dikirim, menunggu persetujuan.`, "success");
        return;
    }

    cloudSyncBusy = true;
    toast("Mengunggah foto bukti & mengirim pengajuan ke Google Sheets...", "normal");

    try{
        const json = await cloudPost("addPermit", permit);

        const saved = json.record || permit; // record.photo sudah berupa link Drive dari server
        const list = load(DB.permits);
        list.push(saved);
        _localSave(DB.permits, list); // cache lokal saja, sudah tersimpan di server

        resetPermitForm();
        renderPermitHistory();
        toast(`Pengajuan ${type} berhasil dikirim & tersimpan di Google Sheets.`, "success");
    }catch(err){
        console.error("Gagal mengirim pengajuan izin/sakit ke Google Sheets:", err);
        toast(`Gagal mengirim pengajuan: ${friendlyCloudError(err)}. Silakan coba lagi.`, "error");
    }finally{
        cloudSyncBusy = false;
    }
}


/* =========================================================
LOADER SAAT MENGAMBIL DATA PERTAMA KALI
========================================================= */

function showCloudLoader(show){
    let el = document.getElementById("cloudLoader");
    if(show){
        if(!el){
            el = document.createElement("div");
            el.id = "cloudLoader";
            el.style.cssText = "position:fixed;inset:0;background:#101010;color:#fff;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:14px;z-index:99999;font-family:'Inter',sans-serif;text-align:center;padding:20px;";
            el.innerHTML = `
                <i class="fa-solid fa-cloud-arrow-down fa-2x" style="color:#e50914;"></i>
                <div>Menyinkronkan data dari Google Sheets...</div>
            `;
            document.body.appendChild(el);
        }
    } else if(el){
        el.remove();
    }
}


/* =========================================================
BOOT SEQUENCE
Urutan lama: initializeDatabase() lalu restoreLogin() dipanggil
langsung saat skrip utama dimuat. Sekarang keduanya ditunda dan
dijalankan di sini, SETELAH data terbaru dari Google Sheets
selesai diambil — supaya perangkat mana pun selalu mulai dengan
data terpusat yang sama, bukan data lokal yang mungkin basi.
========================================================= */

async function bootWithCloud(){
    if(cloudSyncEnabled){
        showCloudLoader(true);
        const ok = await fetchCloudAll();
        showCloudLoader(false);

        if(ok){
            const users = load(DB.users);
            if(!users || !users.length){
                // Spreadsheet masih kosong (pemakaian pertama kali): isi akun
                // demo bawaan secara lokal, lalu (lewat save() yang sudah
                // di-override) otomatis terkirim & tersimpan ke Google Sheets.
                localStorage.removeItem(DB.users);
                initializeDatabase();
            }else{
                initializeDatabase(); // hanya melengkapi sessions/attendance/settings bila perlu
            }
        }else{
            toast("Gagal terhubung ke Google Sheets. Sementara memakai data lokal (offline).", "error");
            initializeDatabase();
        }
    }else{
        initializeDatabase();
    }

    restoreLogin();
    startCloudPolling();
}

bootWithCloud();
