/* =========================================================
   NEV ABSENKU V14.1 — CLOUD SYNC FIX
   Google Apps Script + Google Sheets + Google Drive

   Perbaikan V14.1:
   - polling cloud 30 detik
   - TIDAK menggunakan focus/visibility auto-refresh
   - cache-busting untuk bootstrap/getAll
   - tidak hard-code versi server secure-v3
   - login tidak diblokir hanya karena getAll gagal sementara
   - error sinkronisasi ditampilkan lebih jelas saat badge diklik
   - queue perubahan yang benar-benar gagal dikirim
   - mempertahankan upload selfie/bukti izin ke Drive
========================================================= */

const CLOUD_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby5iQt8AxuGmH6Xup3QvLOU1Op8VxnM9vxt4eqBVTmn0lMSTpfvtdYBXSPVOs1fx3lDKQ/exec";
const CLOUD_POLL_MS = 30000;
const CLOUD_QUEUE_KEY = "nev_cloud_queue_v14_1";
const cloudSyncEnabled = typeof CLOUD_SCRIPT_URL === "string" && CLOUD_SCRIPT_URL.startsWith("http");

const CLOUD_ACTION_BY_KEY = {
    [DB.sessions]: "saveSessions",
    [DB.attendance]: "saveAttendance",
    [DB.settings]: "saveSettings",
    [DB.permits]: "savePermits"
};

let cloudPollTimer = null;
let cloudSyncBusy = false;
let cloudServerVersion = null;
let cloudLastSyncAt = null;
let cloudLastError = null;
let cloudUnsynced = 0;
let cloudFlushing = false;

const _localSave = save;

function getAuthToken(){
    return localStorage.getItem("nev_auth_token") || "";
}

function clearAuthSession(){
    localStorage.removeItem("nev_auth_token");
    localStorage.removeItem("nev_current_user");
}

function cacheBust(url){
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now();
}

function cloudPayload(action, data){
    const body = { action, data };
    if(action !== "login"){
        const token = getAuthToken();
        if(token) body.authToken = token;
    }
    return JSON.stringify(body);
}

function getCloudQueue(){
    try{
        const q = JSON.parse(localStorage.getItem(CLOUD_QUEUE_KEY) || "[]");
        return Array.isArray(q) ? q : [];
    }catch(e){ return []; }
}

function setCloudQueue(q){
    try{ localStorage.setItem(CLOUD_QUEUE_KEY, JSON.stringify(q)); }
    catch(e){
        console.error("Queue cloud penuh/tidak dapat disimpan:", e);
        cloudLastError = "Queue sinkronisasi lokal penuh. Coba hapus cache aplikasi setelah data aman.";
    }
}

function queueCloudAction(action, data){
    if(!action || data === undefined) return;
    const q = getCloudQueue();
    // Satu antrean terbaru untuk setiap save-* action agar tidak menumpuk.
    const replaceable = ["saveSessions","saveAttendance","saveSettings","savePermits"].includes(action);
    if(replaceable){
        const idx = q.findIndex(x=>x.action===action);
        const item = { id:"Q-"+Date.now()+"-"+Math.random().toString(36).slice(2), action, data, createdAt:new Date().toISOString() };
        if(idx >= 0) q[idx] = item; else q.push(item);
    }else{
        q.push({ id:"Q-"+Date.now()+"-"+Math.random().toString(36).slice(2), action, data, createdAt:new Date().toISOString() });
    }
    setCloudQueue(q);
    cloudUnsynced = q.length;
    updateCloudBadge();
}

function removeCloudQueueItem(id){
    const q = getCloudQueue().filter(x=>x.id!==id);
    setCloudQueue(q);
    cloudUnsynced = q.length;
}

function friendlyCloudError(err){
    const msg = String((err && err.message) || err || "");
    if(/failed to fetch|networkerror|load failed|network request failed/i.test(msg)){
        return "koneksi ke Google terputus atau terlalu lambat";
    }
    if(/respons server bukan json/i.test(msg)){
        return "Web App Apps Script tidak mengembalikan JSON; periksa Deployment dan akses Anyone";
    }
    return msg.slice(0, 220) || "kesalahan tidak diketahui";
}

async function cloudPost(action, data, retries){
    const maxRetry = retries ?? 1;
    let lastErr;

    for(let attempt=0; attempt<=maxRetry; attempt++){
        try{
            const res = await fetch(cacheBust(CLOUD_SCRIPT_URL), {
                method:"POST",
                cache:"no-store",
                headers:{"Content-Type":"text/plain;charset=utf-8"},
                body:cloudPayload(action,data)
            });
            const text = await res.text();
            let json;
            try{ json = JSON.parse(text); }
            catch(e){ throw new Error("Respons server bukan JSON. Periksa Deployment Apps Script dan akses 'Anyone'."); }

            if(json && json.authExpired){
                const e = new Error(json.error || "Sesi login sudah kedaluwarsa.");
                e.authExpired = true;
                e.fatal = true;
                throw e;
            }
            if(!json || !json.ok){
                const e = new Error((json && json.error) || (res.status ? "HTTP "+res.status : "Server menolak permintaan."));
                e.fatal = true;
                throw e;
            }
            return json;
        }catch(err){
            lastErr = err;
            if(err.authExpired){
                clearAuthSession();
                if(typeof currentUser !== "undefined") currentUser = null;
            }
            if(err.fatal) break;
            if(attempt < maxRetry) await new Promise(r=>setTimeout(r,1500));
        }
    }
    throw lastErr || new Error("Cloud request gagal.");
}

/* =========================================================
   OVERRIDE save()
========================================================= */
save = function(key,data){
    sanitizeList(key,data);
    _localSave(key,data);
    pushToCloud(key,data);
};

function sanitizeList(key,data){
    if(!Array.isArray(data)) return;
    data.forEach(o=>{
        if(!o) return;
        if(key===DB.sessions){ o.date=fixDateField(o.date); o.start=fixTimeField(o.start); o.end=fixTimeField(o.end); }
        if(key===DB.attendance){ o.date=fixDateField(o.date); }
        if(key===DB.permits){ o.sessionDate=fixDateField(o.sessionDate); }
    });
}

function pushToCloud(key,data){
    if(!cloudSyncEnabled || !getAuthToken()) return;
    const action = CLOUD_ACTION_BY_KEY[key];
    if(!action) return;
    cloudPost(action,data,1).then(()=>{
        cloudLastError=null;
        cloudUnsynced=getCloudQueue().length;
        updateCloudBadge();
    }).catch(err=>{
        if(err.authExpired) return;
        console.error("Gagal sinkron ke Google Sheets:",err);
        queueCloudAction(action,data);
        cloudLastError=friendlyCloudError(err);
        updateCloudBadge();
    });
}

/* =========================================================
   NORMALISASI TANGGAL/JAM WIB
========================================================= */
const _wibDate = new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jakarta",year:"numeric",month:"2-digit",day:"2-digit"});
const _wibTime = new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Jakarta",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
const _isoDateTime = /^\d{4}-\d{2}-\d{2}T/;

function fixDateField(v){
    if(typeof v==="string" && _isoDateTime.test(v)){
        const d=new Date(v); if(!isNaN(d)) return _wibDate.format(d);
    }
    return v;
}
function fixTimeField(v){
    if(typeof v==="string" && _isoDateTime.test(v)){
        const d=new Date(v); if(!isNaN(d)) return _wibTime.format(d);
    }
    return v;
}
function sanitizeCloudData(json){
    (json.sessions||[]).forEach(s=>{s.date=fixDateField(s.date);s.start=fixTimeField(s.start);s.end=fixTimeField(s.end);});
    (json.attendance||[]).forEach(a=>{a.date=fixDateField(a.date);});
    (json.permits||[]).forEach(p=>{p.sessionDate=fixDateField(p.sessionDate);});
    return json;
}

/* =========================================================
   GET ALL
========================================================= */
async function fetchCloudAll(){
    if(!cloudSyncEnabled) return false;
    const token=getAuthToken();
    if(!token) return false;
    try{
        const res=await fetch(cacheBust(`${CLOUD_SCRIPT_URL}?action=getAll&authToken=${encodeURIComponent(token)}`),{cache:"no-store"});
        const text=await res.text();
        let json;
        try{json=JSON.parse(text);}catch(e){throw new Error("Respons getAll bukan JSON. Periksa Deployment Apps Script dan akses 'Anyone'.");}
        if(json && json.authExpired){
            clearAuthSession();
            if(typeof currentUser!=="undefined") currentUser=null;
            throw new Error(json.error||"Sesi login kedaluwarsa.");
        }
        if(!json || !json.ok) throw new Error((json&&json.error)||("HTTP "+(res.status||"?")));
        sanitizeCloudData(json);

        _localSave(DB.users,json.users||[]);
        _localSave(DB.sessions,json.sessions||[]);
        _localSave(DB.attendance,json.attendance||[]);
        _localSave(DB.settings,json.settings||{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
        _localSave(DB.permits,json.permits||[]);

        cloudServerVersion=json.version||null;
        cloudLastSyncAt=new Date();
        cloudLastError=null;
        cloudUnsynced=getCloudQueue().length;
        updateCloudBadge();

        if(cloudUnsynced) await flushCloudQueue();
        return true;
    }catch(err){
        console.error("Gagal mengambil data dari Google Sheets:",err);
        cloudLastError=friendlyCloudError(err);
        updateCloudBadge();
        return false;
    }
}

async function flushCloudQueue(){
    if(cloudFlushing || !getAuthToken()) return;
    const q=getCloudQueue();
    if(!q.length){cloudUnsynced=0;updateCloudBadge();return;}
    cloudFlushing=true;
    try{
        for(const item of q.slice()){
            try{
                await cloudPost(item.action,item.data,1);
                removeCloudQueueItem(item.id);
            }catch(err){
                if(err.authExpired) break;
                console.error("Queue cloud gagal:",err);
            }
        }
    }finally{
        cloudFlushing=false;
        cloudUnsynced=getCloudQueue().length;
        updateCloudBadge();
    }
}

/* =========================================================
   LOGIN — cepat, sinkronisasi cloud berjalan setelah dashboard tampil
========================================================= */
const _indexLogin = (typeof window.login === "function") ? window.login : null;
window.login = async function(event){
    if(event && event.preventDefault) event.preventDefault();
    const username=(document.getElementById("loginUsername")?.value||"").trim();
    const password=document.getElementById("loginPassword")?.value||"";
    try{
        const result=await cloudPost("login",{username,password,role:loginRole},1);
        if(!result || !result.ok || !result.user){
            toast(result?.error||"Username, password, atau role tidak sesuai.","error");
            return;
        }
        currentUser=result.user;
        if(result.authToken) localStorage.setItem("nev_auth_token",result.authToken);
        localStorage.setItem("nev_current_user",JSON.stringify(currentUser));

        document.getElementById("loginScreen")?.classList.add("hidden");
        document.getElementById("app")?.classList.remove("hidden");
        buildSidebar(); updateUserUI();
        if(currentUser.role==="STAF") showPage("staf-dashboard");
        else if(currentUser.role==="HRD") showPage("hrd-dashboard");
        else if(currentUser.role==="KOOR KP") showPage("koor-dashboard");
        updateCloudBadge();

        // Jangan gagalkan login hanya karena getAll sedang timeout/gagal.
        const synced=await fetchCloudAll();
        if(!synced){
            toast("Login berhasil. Sinkronisasi pusat sementara gagal; coba ketuk status Cloud.","error");
        }else if(typeof renderAll==="function"){
            renderAll();
        }
    }catch(err){
        console.error("Login error:",err);
        toast("Login gagal: "+friendlyCloudError(err),"error");
    }
};

/* =========================================================
   BADGE DIAGNOSIS
========================================================= */
function updateCloudBadge(){
    let el=document.getElementById("cloudBadge");
    if(typeof currentUser==="undefined" || !currentUser){if(el)el.remove();return;}
    if(!el){
        el=document.createElement("button"); el.id="cloudBadge"; el.type="button";
        el.style.cssText="position:fixed;left:12px;bottom:12px;z-index:9999;border:0;border-radius:999px;padding:8px 14px;font:600 12px Inter,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100vw - 24px);";
        el.onclick=()=>manualCloudRefresh(false); document.body.appendChild(el);
    }
    let text,bg;
    if(!cloudSyncEnabled){text="⚠ CLOUD OFFLINE";bg="#c62828";}
    else if(cloudUnsynced>0){text="⏳ "+cloudUnsynced+" antrean sinkronisasi";bg="#ef6c00";}
    else if(cloudLastError){text="⚠ Gagal sinkron — ketuk untuk detail/retry";bg="#c62828";}
    else{const t=cloudLastSyncAt?cloudLastSyncAt.toLocaleTimeString("id-ID"):"-";text="☁ Tersinkron "+t+" · ketuk untuk segarkan";bg="#2e7d32";}
    el.textContent=text;el.style.background=bg;el.style.color="#fff";
}

async function manualCloudRefresh(silent){
    if(!cloudSyncEnabled || cloudSyncBusy) return;
    const ok=await fetchCloudAll();
    if(ok && currentUser && typeof renderAll==="function") renderAll();
    if(!silent){
        if(ok) toast("Data berhasil disegarkan dari Google Sheets.","success");
        else toast("Gagal sinkron: "+(cloudLastError||"alasan tidak diketahui"),"error");
    }
}

function startCloudPolling(){
    if(!cloudSyncEnabled || cloudPollTimer) return;
    cloudPollTimer=setInterval(async()=>{
        if(cloudSyncBusy || !getAuthToken()) return;
        const ok=await fetchCloudAll();
        if(ok && currentUser && typeof renderAll==="function") renderAll();
    },CLOUD_POLL_MS);
}

/* =========================================================
   ATTENDANCE + FOTO DRIVE
========================================================= */
async function finalizeAttendance(session,token,location,photo){
    const attendance=load(DB.attendance);
    const duplicate=attendance.find(a=>a.sessionId===session.id&&a.userId===currentUser.id);
    if(duplicate){toast("Anda sudah melakukan absensi pada kegiatan ini.","error");return;}

    const record={
        id:"ATT-"+Date.now(),sessionId:session.id,token:session.token,userId:currentUser.id,
        userName:currentUser.name,username:currentUser.username,activity:session.activity,
        division:session.division,date:session.date,checkIn:new Date().toISOString(),status:"Hadir",
        creatorId:session.creatorId,creatorRole:session.creatorRole,lat:location?location.lat:null,
        lng:location?location.lng:null,photo:photo||null
    };

    if(!cloudSyncEnabled){
        attendance.push(record);_localSave(DB.attendance,attendance);
        toast("Absensi hanya tersimpan di perangkat ini — BELUM terkirim ke HRD.","error");
        updateScannerStatus(`Tersimpan lokal saja: ${session.activity}. Belum terkirim ke server.`,"error");
        const manualInput=document.getElementById("manualToken");if(manualInput)manualInput.value="";
        renderAll();return;
    }

    cloudSyncBusy=true;toast("Mengunggah foto & menyimpan absensi ke Google Sheets...","normal");
    try{
        const json=await cloudPost("addAttendance",record,1);
        const saved=json.record||record;
        const refreshed=await fetchCloudAll();
        const list=load(DB.attendance)||[];
        const found=list.some(a=>a.id===saved.id||(a.sessionId===saved.sessionId&&a.userId===saved.userId));
        if(!found) list.push(saved);
        if(!refreshed) _localSave(DB.attendance,list);
        toast(`Absensi ${session.activity} berhasil & tersimpan di Google Sheets.` ,"success");
        updateScannerStatus(`Berhasil hadir: ${session.activity}${session.division!=="-"?" • "+session.division:""}`,"success");
        const manualInput=document.getElementById("manualToken");if(manualInput)manualInput.value="";
        renderAll();
    }catch(err){
        console.error("Gagal menyimpan absensi:",err);
        const list=load(DB.attendance)||[];
        record.syncPending=true;
        if(!list.some(a=>a.id===record.id)) list.push(record);
        _localSave(DB.attendance,list);
        queueCloudAction("addAttendance",record);
        cloudLastError=friendlyCloudError(err);updateCloudBadge();
        toast(`Absensi disimpan sementara. Gagal sinkron: ${friendlyCloudError(err)}.`,"error");
    }finally{cloudSyncBusy=false;}
}

/* =========================================================
   PERMIT + FOTO DRIVE
========================================================= */
async function submitPermit(event){
    event.preventDefault();
    const sessionId=document.getElementById("permitSession").value;
    const type=document.getElementById("permitType").value;
    const reason=document.getElementById("permitReason").value.trim();
    if(!sessionId){toast("Pilih kegiatan terlebih dahulu.","error");return;}
    if(!reason){toast("Alasan wajib diisi.","error");return;}
    if(!pendingPermitPhoto){toast("Lampirkan foto bukti terlebih dahulu.","error");return;}
    const sessions=load(DB.sessions); const session=sessions.find(s=>s.id===sessionId);
    if(!session){toast("Kegiatan tidak ditemukan.","error");return;}
    const permit=buildPermitRecord(session,type,reason,pendingPermitPhoto);

    if(!cloudSyncEnabled){
        const permits=load(DB.permits);permits.push(permit);_localSave(DB.permits,permits);
        resetPermitForm();renderPermitHistory();toast(`Pengajuan ${type} berhasil dikirim, menunggu persetujuan.`,"success");return;
    }

    cloudSyncBusy=true;toast("Mengunggah foto bukti & mengirim pengajuan ke Google Sheets...","normal");
    try{
        const json=await cloudPost("addPermit",permit,1); const saved=json.record||permit;
        const list=load(DB.permits)||[];
        if(!list.some(p=>p.id===saved.id)) list.push(saved);
        _localSave(DB.permits,list);
        resetPermitForm();renderPermitHistory();toast(`Pengajuan ${type} berhasil dikirim & tersimpan di Google Sheets.`,"success");
    }catch(err){
        console.error("Gagal mengirim pengajuan:",err);
        permit.syncPending=true;_localSave(DB.permits,(load(DB.permits)||[]).concat([permit]));
        queueCloudAction("addPermit",permit);cloudLastError=friendlyCloudError(err);updateCloudBadge();
        toast(`Pengajuan disimpan sementara. Gagal sinkron: ${friendlyCloudError(err)}.`,"error");
    }finally{cloudSyncBusy=false;}
}

/* =========================================================
   BOOT
========================================================= */
async function bootWithCloud(){
    if(!cloudSyncEnabled){initializeDatabase();startCloudPolling();return;}

    showCloudLoader(true);
    try{
        // Bootstrap tanpa auth: hanya untuk settings + versi server.
        try{
            const res=await fetch(cacheBust(`${CLOUD_SCRIPT_URL}?action=bootstrap`),{cache:"no-store"});
            const text=await res.text(); const boot=JSON.parse(text);
            if(boot&&boot.ok){
                cloudServerVersion=boot.version||null;
                _localSave(DB.settings,boot.settings||{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
            }
        }catch(e){
            cloudLastError=friendlyCloudError(e);console.warn("Bootstrap cloud gagal:",e);updateCloudBadge();
        }

        const savedToken=getAuthToken();
        const savedUser=localStorage.getItem("nev_current_user");
        if(savedToken&&savedUser){
            try{
                currentUser=JSON.parse(savedUser);
                const ok=await fetchCloudAll();
                if(ok){
                    const valid=(load(DB.users)||[]).find(u=>u.id===currentUser.id);
                    if(valid){
                        currentUser=valid;localStorage.setItem("nev_current_user",JSON.stringify(valid));
                        document.getElementById("loginScreen")?.classList.add("hidden");
                        document.getElementById("app")?.classList.remove("hidden");
                        buildSidebar();updateUserUI();
                        if(currentUser.role==="STAF")showPage("staf-dashboard");
                        else if(currentUser.role==="HRD")showPage("hrd-dashboard");
                        else if(currentUser.role==="KOOR KP")showPage("koor-dashboard");
                    }else{clearAuthSession();currentUser=null;}
                }
            }catch(e){
                console.warn("Restore login cloud gagal:",e);
                // Jangan menghapus sesi hanya karena network timeout.
            }
        }
        if(!currentUser) initializeDatabase();
    }finally{
        showCloudLoader(false);
    }
    if(currentUser && typeof renderAll==="function") renderAll();
    updateCloudBadge();
    startCloudPolling();
}

setInterval(updateCloudBadge,5000);
bootWithCloud();
