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

const CLOUD_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby5iQt8AxuGmH6Xup3QvLOU1Op8VxnM9vxt4eqBVTmn0lMSTpfvtdYBXSPVOs1fx3lDKQ/exec";

// Spreadsheet acuan (hanya untuk referensi/README — Apps Script yang
// benar-benar membaca/menulis ke sini harus di-bind ke spreadsheet ini):
// https://docs.google.com/spreadsheets/d/1E-JqBubHJAl_ym7Z3_FHoNBRh5FIjTL_Mh1pqOMkY_A/edit

const cloudSyncEnabled = typeof CLOUD_SCRIPT_URL === "string" && CLOUD_SCRIPT_URL.startsWith("http");

const CLOUD_ACTION_BY_KEY = {
    [DB.sessions]: "saveSessions",
    [DB.attendance]: "saveAttendance",
    [DB.settings]: "saveSettings",
    [DB.permits]: "savePermits"
};

let cloudPollTimer = null;
let cloudSyncBusy = false;

// Diagnostik sinkronisasi (ditampilkan sebagai lencana di pojok kiri bawah)
let cloudServerVersion = null;
let cloudLastSyncAt = null;
let cloudLastError = null;
let cloudUnsynced = 0;        // jumlah data lokal yang belum ada di server
let cloudFlushing = false;
let cloudLastFlushAt = 0;


/* =========================================================
OVERRIDE save() — setiap perubahan lokal ikut dikirim ke cloud
========================================================= */

const _localSave = save; // simpan referensi fungsi save() versi localStorage asli

// PENTING: pakai assignment biasa (function expression), BUKAN "function save(){}".
// Deklarasi "function save(){}" akan di-hoist ke atas SEBELUM baris di atas
// sempat berjalan, sehingga _localSave malah menyalin dirinya sendiri dan
// menyebabkan infinite recursion saat dipanggil.
save = function(key, data){
    sanitizeList(key, data); // pastikan tanggal/jam tidak pernah berbentuk ISO (…T17:00:00.000Z)
    _localSave(key, data);
    pushToCloud(key, data);
};

function sanitizeList(key, data){
    if(!Array.isArray(data)) return;
    data.forEach(o=>{
        if(!o) return;
        if(key === DB.sessions){ o.date = fixDateField(o.date); o.start = fixTimeField(o.start); o.end = fixTimeField(o.end); }
        if(key === DB.attendance){ o.date = fixDateField(o.date); }
        if(key === DB.permits){ o.sessionDate = fixDateField(o.sessionDate); }
    });
}

function getAuthToken(){
    return localStorage.getItem("nev_auth_token") || "";
}

function clearAuthSession(){
    localStorage.removeItem("nev_auth_token");
    localStorage.removeItem("nev_current_user");
}

function cloudPayload(action, data){
    const body = { action, data };
    if(action !== "login"){
        const token = getAuthToken();
        if(token) body.authToken = token;
    }
    return JSON.stringify(body);
}

function pushToCloud(key, data){
    if(!cloudSyncEnabled) return;
    const action = CLOUD_ACTION_BY_KEY[key];
    if(!action) return;
    if(!getAuthToken()) return;

    fetch(CLOUD_SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" }, // hindari CORS preflight ke Apps Script
        body: cloudPayload(action, data)
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
                body: cloudPayload(action, data)
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

function isLegacyAttendanceRecord(a){
    return !a || !a.id || !a.userId || !a.sessionId ||
        !/^\d{4}-\d{2}-\d{2}$/.test(String(a.date||"")) ||
        !["Hadir","Izin","Sakit","Alpha"].includes(String(a.status||""));
}

async function removeLegacyAttendanceFromServer(records){
    if(!records.length || !getAuthToken()) return;
    // Hanya HRD yang boleh membersihkan data legacy. Untuk akun lain cukup disembunyikan.
    if(typeof currentUser === "undefined" || currentUser?.role !== "HRD") return;
    for(const rec of records.slice(0,50)){
        try{ await cloudPost("deleteAttendance", {attendanceId:rec.id}, 0); }
        catch(err){ console.warn("Legacy attendance belum dapat dihapus:", rec.id, err); }
    }
}

async function fetchCloudAll(){
    if(!cloudSyncEnabled) return false;
    try{
        const token=getAuthToken();
        if(!token) return false;
        const res=await fetch(`${CLOUD_SCRIPT_URL}?action=getAll&authToken=${encodeURIComponent(token)}&_=${Date.now()}`,{cache:"no-store"});
        const json=await res.json();
        if(json && json.authExpired){
            clearAuthSession();
            if(typeof currentUser!=="undefined") currentUser=null;
            return false;
        }
        if(!json || !json.ok) throw new Error((json&&json.error)||"Respons tidak valid");
        sanitizeCloudData(json);

        const serverAttendance=json.attendance||[];
        const legacy=serverAttendance.filter(isLegacyAttendanceRecord);
        const cleanAttendance=serverAttendance.filter(a=>!isLegacyAttendanceRecord(a));

        // Bersihkan cache lokal dari data legacy/malformed agar tidak muncul lagi.
        const localAttendance=(load(DB.attendance)||[]).filter(a=>!isLegacyAttendanceRecord(a));
        _localSave(DB.users,json.users||[]);
        _localSave(DB.sessions,json.sessions||[]);
        _localSave(DB.attendance,cleanAttendance);
        _localSave(DB.settings,json.settings||{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
        _localSave(DB.permits,json.permits||[]);

        cloudUnsynced=0;
        cloudServerVersion=json.version||null;
        cloudLastSyncAt=new Date();
        cloudLastError=null;
        updateCloudBadge();

        if(legacy.length) removeLegacyAttendanceFromServer(legacy);
        return true;
    }catch(err){
        console.error("Gagal mengambil data dari Google Sheets:",err);
        cloudLastError=String((err&&err.message)||err);
        updateCloudBadge();
        return false;
    }
}

/** Kirim ulang data lokal yang belum tersimpan di server (aman diulang: server menolak duplikat). */
async function flushUnsynced(att, per){
    if(cloudFlushing || Date.now() - cloudLastFlushAt < 30000) return;
    cloudFlushing = true;
    cloudLastFlushAt = Date.now();
    updateCloudBadge();
    try{
        for(const r of att){
            try{ await cloudPost("addAttendance", r, 1); }
            catch(e){ console.error("Kirim ulang absensi gagal:", e); }
        }
        for(const p of per){
            try{ await cloudPost("addPermit", p, 1); }
            catch(e){ console.error("Kirim ulang pengajuan gagal:", e); }
        }
    }finally{
        cloudFlushing = false;
    }
    const ok = await fetchCloudAll();
    if(ok && currentUser) renderAll();
}

function startCloudPolling(){
    if(!cloudSyncEnabled || cloudPollTimer) return;
    cloudPollTimer = setInterval(async ()=>{
        if(cloudSyncBusy) return;
        const ok = await fetchCloudAll();
        if(ok && currentUser) renderAll();
    }, 30000);
}


/* =========================================================
LENCANA STATUS SINKRONISASI (pojok kiri bawah)
Ketuk untuk menyegarkan data dari Google Sheets sekarang juga.
========================================================= */

function updateCloudBadge(){
    let el = document.getElementById("cloudBadge");
    if(typeof currentUser === "undefined" || !currentUser){ if(el) el.remove(); return; }

    if(!el){
        el = document.createElement("button");
        el.id = "cloudBadge";
        el.type = "button";
        el.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:9999;border:0;border-radius:999px;padding:8px 14px;font:600 12px Inter,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100vw - 24px);";
        el.onclick = ()=> manualCloudRefresh(false);
        document.body.appendChild(el);
    }

    let text, bg, fg = "#fff";
    if(!cloudSyncEnabled){
        text = "⚠ MODE OFFLINE: CLOUD_SCRIPT_URL di cloud-sync.js belum diisi — data TIDAK terkirim ke HRD"; bg = "#c62828";
    }else if(cloudUnsynced > 0){
        text = "⏳ " + cloudUnsynced + " data belum terkirim ke server — sedang dikirim ulang…"; bg = "#ef6c00";
    }else if(cloudLastError){
        text = "⚠ Gagal sinkron — ketuk untuk coba lagi"; bg = "#c62828";
    }else{

        const t = cloudLastSyncAt ? cloudLastSyncAt.toLocaleTimeString("id-ID") : "-";
        text = "☁ Tersinkron " + t + " · ketuk untuk segarkan"; bg = "#2e7d32";
    }
    el.textContent = text;
    el.style.background = bg;
    el.style.color = fg;
}

async function manualCloudRefresh(silent){
    if(!cloudSyncEnabled || cloudSyncBusy) return;
    const ok = await fetchCloudAll();
    if(ok && currentUser) renderAll();
    if(!silent) toast(ok ? "Data berhasil disegarkan dari Google Sheets." : "Gagal mengambil data dari Google Sheets.", ok ? "success" : "error");
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
        toast("Absensi hanya tersimpan di perangkat ini (mode offline) — BELUM terkirim ke HRD.", "error");
        updateScannerStatus(`Tersimpan lokal saja: ${session.activity}. Belum terkirim ke server.`, "error");
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

        // Verifikasi: tarik ulang dari Google Sheets & pastikan barisnya benar-benar ada.
        const refreshed = await fetchCloudAll();
        const list = load(DB.attendance);
        const found = list.some(a=> a.id===saved.id || (a.sessionId===saved.sessionId && a.userId===saved.userId));
        if(refreshed && !found){
            throw new Error("absensi terkirim tetapi belum terbaca di Google Sheets. Pastikan Code.gs sudah di-deploy ulang (New version)");
        }
        if(!found){
            list.push(saved);
            _localSave(DB.attendance, list); // fetch gagal: simpan di cache lokal saja
        }

        toast(`Absensi ${session.activity} berhasil & terverifikasi di Google Sheets.`, "success");
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
                <img src="nev-logo.png" class="nev-loader-logo" alt="NEV Evolution">
                <div class="nev-loader-title">NevAbsenku</div>
                <div class="nev-loader-subtitle">Menyiapkan sistem absensi...</div>
                <div class="nev-loader-dots"><span></span><span></span><span></span></div>
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
        const savedToken = getAuthToken();
        const savedUser = localStorage.getItem("nev_current_user");

        showCloudLoader(true);

        if(savedToken && savedUser){
            try{
                const user = JSON.parse(savedUser);
                currentUser = user;
                const ok = await fetchCloudAll();
                if(ok){
                    const valid = (load(DB.users) || []).find(u=>u.id===user.id);
                    if(valid){
                        currentUser = valid;
                        localStorage.setItem("nev_current_user", JSON.stringify(valid));
                        document.getElementById("loginScreen").classList.add("hidden");
                        document.getElementById("app").classList.remove("hidden");
                        buildSidebar();
                        updateUserUI();
                        if(currentUser.role==="STAF") showPage("staf-dashboard");
                        else if(currentUser.role==="HRD") showPage("hrd-dashboard");
                        else if(currentUser.role==="KOOR KP") showPage("koor-dashboard");
                    }else{
                        clearAuthSession();
                        currentUser = null;
                    }
                }else{
                    clearAuthSession();
                    currentUser = null;
                }
            }catch(e){
                clearAuthSession();
                currentUser = null;
            }
        }

        // Ambil versi/settings tanpa membuka data akun sebelum login.
        try{
            const res = await fetch(`${CLOUD_SCRIPT_URL}?action=bootstrap`);
            const boot = await res.json();
            if(boot && boot.ok){
                cloudServerVersion = boot.version || cloudServerVersion;
                _localSave(DB.settings, boot.settings || {officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
            }
        }catch(e){
            console.warn("Bootstrap cloud gagal:",e);
        }

        showCloudLoader(false);

        // Jika belum login, backend tetap menjadi sumber akun. Tidak membuat
        // daftar akun baru dari halaman login.
        if(!currentUser){
            initializeDatabase();
        }
    }else{
        initializeDatabase();
    }

    if(currentUser) renderAll();
    startCloudPolling();
}

setInterval(updateCloudBadge, 2000);
bootWithCloud();
