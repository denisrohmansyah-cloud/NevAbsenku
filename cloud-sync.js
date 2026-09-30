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
// Server version is discovered from bootstrap; no hard-coded version gate.
const EXPECTED_SERVER_VERSION = null;
let cloudServerVersion = null;
let cloudLastSyncAt = null;
let cloudLastError = null;
let cloudUnsynced = 0;        // explicit failed-write queue only
let cloudFlushing = false;
let cloudLastFlushAt = 0;
const CLOUD_POLL_MS = 30000;
const CLOUD_QUEUE_KEY = "nev_sync_queue_v13";


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

function readCloudQueue(){
    try{ const q=JSON.parse(localStorage.getItem(CLOUD_QUEUE_KEY)||"[]"); return Array.isArray(q)?q:[]; }catch(e){ return []; }
}
function writeCloudQueue(q){
    const clean=Array.isArray(q)?q.slice(-100):[];
    localStorage.setItem(CLOUD_QUEUE_KEY, JSON.stringify(clean));
    cloudUnsynced=clean.length;
    updateCloudBadge();
}
function queueIdentity(action,data){
    if(action.startsWith("save")) return action;
    return action+"|"+String(data?.id || ((data?.sessionId||"")+"|"+(data?.userId||"")) || Date.now());
}
function enqueueCloud(action,data){
    const q=readCloudQueue();
    const key=queueIdentity(action,data);
    const item={key,action,data,queuedAt:Date.now()};
    const idx=q.findIndex(x=>x.key===key);
    if(idx>=0) q[idx]=item; else q.push(item);
    writeCloudQueue(q);
}

async function pushToCloud(key,data){
    if(!cloudSyncEnabled) return;
    const action=CLOUD_ACTION_BY_KEY[key];
    if(!action || !getAuthToken()) return;
    try{
        await cloudPost(action,data,1);
        cloudLastError=null;
        updateCloudBadge();
    }catch(err){
        console.error("Gagal sinkron ke Google Sheets:",err);
        if(!err?.fatal) enqueueCloud(action,data);
        cloudLastError=friendlyCloudError(err);
        updateCloudBadge();
    }
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
                cache: "no-store",
                body: cloudPayload(action, data)
            });
            const text = await res.text();

            let json;
            try{ json = JSON.parse(text); }
            catch(e){ throw new Error("Respons server bukan JSON (periksa deploy Apps Script & izin akses 'Anyone')."); }

            if(json && json.authExpired){
                const err = new Error(json.error || "Sesi login telah berakhir. Silakan login kembali.");
                err.fatal = true; err.authExpired = true;
                clearAuthSession();
                if(typeof currentUser !== "undefined") currentUser = null;
                throw err;
            }
            if(!json.ok){
                const serverErr = new Error(json.error || "Server menolak permintaan.");
                serverErr.fatal = true;
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


function forceLoginScreen(message){
    try{ if(typeof stopScanner==="function") stopScanner(); }catch(e){}
    if(typeof currentUser!=="undefined") currentUser=null;
    document.getElementById("app")?.classList.add("hidden");
    document.getElementById("loginScreen")?.classList.remove("hidden");
    updateCloudBadge();
    if(message && typeof toast==="function") toast(message,"error");
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
    const token=getAuthToken();
    if(!token) return false;
    try{
        const res=await fetch(`${CLOUD_SCRIPT_URL}?action=getAll&authToken=${encodeURIComponent(token)}&_=${Date.now()}`,{cache:"no-store"});
        const json=await res.json();
        if(json && json.authExpired){
            clearAuthSession();
            forceLoginScreen("Sesi login telah berakhir. Silakan login kembali.");
            return false;
        }
        if(!json || !json.ok) throw new Error((json&&json.error)||"Respons tidak valid");
        sanitizeCloudData(json);
        _localSave(DB.users,json.users||[]);
        _localSave(DB.sessions,json.sessions||[]);
        _localSave(DB.attendance,json.attendance||[]);
        _localSave(DB.settings,json.settings||{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
        _localSave(DB.permits,json.permits||[]);
        cloudUnsynced=readCloudQueue().length;
        cloudServerVersion=json.version||cloudServerVersion||null;
        cloudLastSyncAt=new Date();
        cloudLastError=null;
        updateCloudBadge();
        return true;
    }catch(err){
        if(err?.authExpired) forceLoginScreen("Sesi login telah berakhir. Silakan login kembali.");
        console.error("Gagal mengambil data dari Google Sheets:",err);
        cloudLastError=friendlyCloudError(err);
        updateCloudBadge();
        return false;
    }
}

async function flushCloudQueue(){
    if(cloudFlushing || !getAuthToken()) return false;
    const q=readCloudQueue();
    if(!q.length){ cloudUnsynced=0; updateCloudBadge(); return true; }
    cloudFlushing=true;
    let allOk=true;
    try{
        const keep=[];
        for(const item of q){
            try{ await cloudPost(item.action,item.data,1); }
            catch(e){ allOk=false; keep.push(item); }
        }
        writeCloudQueue(keep);
        if(keep.length===0) cloudLastError=null;
    }finally{ cloudFlushing=false; }
    return allOk;
}

function startCloudPolling(){
    if(!cloudSyncEnabled || cloudPollTimer) return;
    cloudPollTimer=setInterval(async()=>{
        if(cloudSyncBusy || !getAuthToken()) return;
        await flushCloudQueue();
        const ok=await fetchCloudAll();
        if(ok && currentUser) renderAll();
    }, CLOUD_POLL_MS);
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
        el.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;border:0;border-radius:999px;padding:8px 14px;font:600 12px Inter,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100vw - 24px);";
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
    await flushCloudQueue();
    const ok = await fetchCloudAll();
    if(ok && currentUser) renderAll();
    if(!silent) toast(ok ? "Data berhasil disegarkan dari Google Sheets." : "Gagal mengambil data dari Google Sheets.", ok ? "success" : "error");
}


/* =========================================================
OVERRIDE finalizeAttendance() — unggah foto ke Drive dulu,
baru catat absensi (beserta link foto) ke Google Sheets
========================================================= */

async function finalizeAttendance(session, token, location, photo){
    const attendance=load(DB.attendance);
    const duplicate=attendance.find(a=>a.sessionId===session.id && a.userId===currentUser.id);
    if(duplicate){ toast("Anda sudah melakukan absensi pada kegiatan ini.","error"); return; }
    const record={
        id:"ATT-"+Date.now(),sessionId:session.id,token:session.token,
        userId:currentUser.id,userName:currentUser.name,username:currentUser.username,
        activity:session.activity,division:session.division,date:session.date,
        checkIn:new Date().toISOString(),status:"Hadir",
        creatorId:session.creatorId,creatorRole:session.creatorRole,
        lat:location?location.lat:null,lng:location?location.lng:null,photo:photo||null
    };
    if(!cloudSyncEnabled){
        attendance.push(record); _localSave(DB.attendance,attendance);
        toast("Absensi tersimpan di perangkat ini (mode offline).","success");
        updateScannerStatus(`Tersimpan lokal saja: ${session.activity}. Belum terkirim ke server.`,"error");
        const manualInput=document.getElementById("manualToken"); if(manualInput) manualInput.value="";
        renderAll(); return;
    }
    cloudSyncBusy=true;
    toast("Mengunggah foto & menyimpan absensi ke Google Sheets...","normal");
    try{
        const json=await cloudPost("addAttendance",record,1);
        const saved=json.record||record;
        const list=load(DB.attendance).filter(a=>!(a.sessionId===saved.sessionId && a.userId===saved.userId));
        list.push(saved); _localSave(DB.attendance,list);
        toast(`Absensi ${session.activity} berhasil disimpan di Google Sheets.`,"success");
        updateScannerStatus(`Berhasil hadir: ${session.activity}${session.division!=="-"?" • "+session.division:""}`,"success");
        const manualInput=document.getElementById("manualToken"); if(manualInput) manualInput.value="";
        renderAll();
    }catch(err){
        console.error("Gagal menyimpan absensi ke Google Sheets:",err);
        if(!err?.fatal){
            _localSave(DB.attendance,[...attendance,record]);
            enqueueCloud("addAttendance",record);
            toast("Absensi tersimpan lokal dan akan dikirim ulang otomatis saat koneksi pulih.","success");
            renderAll();
        }else toast(`Gagal menyimpan absensi: ${friendlyCloudError(err)}.`,"error");
    }finally{ cloudSyncBusy=false; }
}


/* =========================================================
OVERRIDE submitPermit() — unggah foto bukti izin/sakit ke Drive
dulu, baru catat pengajuan (beserta link foto) ke Google Sheets
========================================================= */

async function submitPermit(event){
    event.preventDefault();
    const sessionId=document.getElementById("permitSession").value;
    const type=document.getElementById("permitType").value;
    const reason=document.getElementById("permitReason").value.trim();
    if(!sessionId){toast("Pilih kegiatan terlebih dahulu.","error");return;}
    if(!reason){toast("Alasan wajib diisi.","error");return;}
    if(!pendingPermitPhoto){toast("Lampirkan foto bukti terlebih dahulu.","error");return;}
    const session=load(DB.sessions).find(s=>s.id===sessionId);
    if(!session){toast("Kegiatan tidak ditemukan.","error");return;}
    if(session.date!==getTodayWIB()){toast("Pengajuan hanya dapat dibuat untuk kegiatan hari ini.","error");return;}
    if(session.division!=="-" && String(currentUser.division||"")!==String(session.division)){toast("Anda bukan anggota divisi kegiatan ini.","error");return;}
    const permit=buildPermitRecord(session,type,reason,pendingPermitPhoto);
    if(!cloudSyncEnabled){
        const permits=load(DB.permits); permits.push(permit); _localSave(DB.permits,permits);
        resetPermitForm(); renderPermitHistory();
        toast(`Pengajuan ${type} tersimpan lokal, menunggu persetujuan.`,"success"); return;
    }
    cloudSyncBusy=true; toast("Mengunggah foto bukti & mengirim pengajuan ke Google Sheets...","normal");
    try{
        const json=await cloudPost("addPermit",permit,1);
        const saved=json.record||permit;
        const list=load(DB.permits).filter(p=>p.id!==saved.id && !(p.sessionId===saved.sessionId && p.userId===saved.userId && p.status!=="Ditolak"));
        list.push(saved); _localSave(DB.permits,list);
        resetPermitForm(); renderPermitHistory();
        toast(`Pengajuan ${type} berhasil dikirim & tersimpan di Google Sheets.`,"success");
    }catch(err){
        console.error("Gagal mengirim pengajuan izin/sakit ke Google Sheets:",err);
        if(!err?.fatal){
            const list=load(DB.permits); if(!list.some(p=>p.id===permit.id)) list.push(permit);
            _localSave(DB.permits,list); enqueueCloud("addPermit",permit);
            resetPermitForm(); renderPermitHistory();
            toast("Pengajuan tersimpan lokal dan akan dikirim ulang otomatis saat koneksi pulih.","success");
        }else toast(`Gagal mengirim pengajuan: ${friendlyCloudError(err)}. Silakan coba lagi.`,"error");
    }finally{ cloudSyncBusy=false; }
}


(function(){
    if(!document.getElementById("nevLoginSpinStyle")){
        const st=document.createElement("style");
        st.id="nevLoginSpinStyle";
        st.textContent="@keyframes nevLoginSpin{to{transform:rotate(360deg)}}";
        document.head.appendChild(st);
    }
})();

/* =========================================================
FALLBACK FOTO GOOGLE DRIVE VIA APPS SCRIPT
========================================================= */
window.nevLoadPhotoProxy = async function(photo){
    const value=String(photo||"");
    let m=value.match(/[?&]id=([A-Za-z0-9_-]+)/);
    if(!m) m=value.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
    const fileId=m&&m[1];
    const token=getAuthToken();
    if(!fileId || !token) throw new Error("Foto atau sesi tidak valid.");
    const res=await fetch(`${CLOUD_SCRIPT_URL}?action=getPhoto&photoId=${encodeURIComponent(fileId)}&authToken=${encodeURIComponent(token)}&_=${Date.now()}`,{cache:"no-store"});
    const json=await res.json();
    if(json?.authExpired){ forceLoginScreen("Sesi login telah berakhir. Silakan login kembali."); throw new Error("Sesi login berakhir."); }
    if(!json?.ok || !json.data) throw new Error(json?.error||"Foto tidak dapat diambil.");
    return `data:${json.mimeType||"image/jpeg"};base64,${json.data}`;
};

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

async function bootWithCloudV13(){
    initializeDatabase();
    const savedToken=getAuthToken();
    const savedUser=localStorage.getItem("nev_current_user");
    try{
        const res=await fetch(`${CLOUD_SCRIPT_URL}?action=bootstrap&_=${Date.now()}`,{cache:"no-store"});
        const boot=await res.json();
        if(boot&&boot.ok){
            cloudServerVersion=boot.version||null;
            _localSave(DB.settings,boot.settings||{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
        }
    }catch(e){ console.warn("Bootstrap cloud gagal:",e); }
    if(savedToken && savedUser){
        try{
            currentUser=JSON.parse(savedUser);
            await flushCloudQueue();
            const ok=await fetchCloudAll();
            if(ok){
                const valid=(load(DB.users)||[]).find(u=>u.id===currentUser.id);
                if(valid){ currentUser=valid; localStorage.setItem("nev_current_user",JSON.stringify(valid)); document.getElementById("loginScreen")?.classList.add("hidden"); document.getElementById("app")?.classList.remove("hidden"); buildSidebar(); updateUserUI(); if(currentUser.role==="STAF")showPage("staf-dashboard"); else if(currentUser.role==="HRD")showPage("hrd-dashboard"); else showPage("koor-dashboard"); }
                else { clearAuthSession(); currentUser=null; }
            }
        }catch(e){ console.warn("Restore login gagal:",e); clearAuthSession(); currentUser=null; }
    }
    startCloudPolling();
    updateCloudBadge();
    if(currentUser) renderAll();
}


setInterval(updateCloudBadge, 2000);
bootWithCloudV13();
