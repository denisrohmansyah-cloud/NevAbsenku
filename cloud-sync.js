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
const CLOUD_DEAD_LETTER_KEY = "nev_cloud_dead_letter_v1";
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
let cloudQueueCorrupt = false;
let cloudDeadLettersCorrupt = false;
let cloudFlushing = false;
let cloudFlushPromise = null;
let cloudQueueRetryTimer = null;

const _localSave = save;

/* Foto bukti disimpan terpisah dari localStorage agar kuota cache absensi tidak cepat habis. */
const NEV_PHOTO_DB="nev-photo-store-v1";
const NEV_PHOTO_STORE="photos";
let nevPhotoDbPromise=null;
function openNevPhotoDB(){
  if(!("indexedDB" in window)) return Promise.reject(new Error("Browser tidak mendukung IndexedDB."));
  if(nevPhotoDbPromise) return nevPhotoDbPromise;
  nevPhotoDbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(NEV_PHOTO_DB,1);
    req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(NEV_PHOTO_STORE))db.createObjectStore(NEV_PHOTO_STORE);};
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error||new Error("Gagal membuka penyimpanan foto."));
  });
  return nevPhotoDbPromise;
}
function nevPhotoTransaction(mode,work){
  return openNevPhotoDB().then(db=>new Promise((resolve,reject)=>{
    const tx=db.transaction(NEV_PHOTO_STORE,mode),store=tx.objectStore(NEV_PHOTO_STORE);
    let result;
    try{result=work(store);}catch(e){reject(e);return;}
    tx.oncomplete=()=>resolve(result&&result.result!==undefined?result.result:result);
    tx.onerror=()=>reject(tx.error||new Error("Transaksi foto gagal."));
    tx.onabort=()=>reject(tx.error||new Error("Transaksi foto dibatalkan."));
  }));
}
function storeNevPhoto(key,dataUrl){return nevPhotoTransaction("readwrite",store=>store.put(dataUrl,key));}
function readNevPhoto(key){return nevPhotoTransaction("readonly",store=>store.get(key));}
function isNevPhotoRef(value){return typeof value==="string"&&value.startsWith("nev-photo://");}
async function getNevPhoto(value){
  if(!isNevPhotoRef(value)) return value||"";
  const key=value.slice("nev-photo://".length);
  return await readNevPhoto(key)||"";
}
let nevPhotoMigrationPromise=null;
function migrateNevLegacyPhotos(){
  if(nevPhotoMigrationPromise) return nevPhotoMigrationPromise;
  nevPhotoMigrationPromise=(async()=>{
    const keys=[DB.attendance,DB.permits];
    let moved=0;
    for(const key of keys){
      const raw=localStorage.getItem(key);
      if(!raw) continue;
      let rows;
      try{rows=JSON.parse(raw);}catch(e){throw new Error("Data "+key+" tidak dapat dibaca; migrasi foto dihentikan tanpa mengubah data.");}
      if(!Array.isArray(rows)) continue;
      let changed=false;
      const next=[];
      for(let n=0;n<rows.length;n++){
        const row=rows[n]&&typeof rows[n]==="object"?{...rows[n]}:rows[n];
        if(row&&typeof row.photo==="string"&&/^data:image\/(jpeg|png|webp);base64,/i.test(row.photo)){
          const photoKey=key+":"+String(row.id||n);
          await storeNevPhoto(photoKey,row.photo);
          row.photo="nev-photo://"+photoKey;
          changed=true;moved++;
        }
        next.push(row);
      }
      if(changed){
        // Commit the smaller metadata snapshot only after every original photo is safely in IndexedDB.
        localStorage.setItem(key,JSON.stringify(next));
        if(localStorage.getItem(key)!==JSON.stringify(next)) throw new Error("Verifikasi migrasi "+key+" gagal; data foto asli tetap tersedia di IndexedDB.");
      }
    }
    return moved;
  })().catch(err=>{nevPhotoMigrationPromise=null;console.error("Migrasi foto lokal:",err);throw err;});
  return nevPhotoMigrationPromise;
}
window.getNevPhoto=getNevPhoto;
window.isNevPhotoRef=isNevPhotoRef;
window.addEventListener("DOMContentLoaded",()=>{
  // Mulai migrasi lebih awal; login dan pemulihan sesi menunggu promise ini.
  migrateNevLegacyPhotos().catch(()=>{});
});


/* =========================================================
   RESET DATA LOKAL LAMA (sekali per perangkat)
   Menghapus cache absensi/sesi/izin lama beserta antrean sinkronisasi,
   supaya data lama tidak terkirim ulang ke server setelah data pusat dibersihkan.
   Ubah nilai DATA_EPOCH jika suatu saat perlu mengulang pembersihan.
========================================================= */
const DATA_EPOCH = "clean-2026-10-01b";
(function resetLocalOldData(){
    try{
        if(localStorage.getItem("nev_data_epoch") === DATA_EPOCH) return;

        // A version marker must never authorize deletion of attendance data.
        // Preserve caches whenever there are pending operations, recovery records,
        // malformed queue contents, or any local business records.
        const hasArrayData = key => {
            const raw = localStorage.getItem(key);
            if(raw === null) return false;
            const parsed = JSON.parse(raw);
            if(!Array.isArray(parsed)) return true; // unknown format: fail closed
            return parsed.length > 0;
        };
        const hasPending = key => {
            const raw = localStorage.getItem(key);
            if(raw === null) return false;
            const parsed = JSON.parse(raw);
            if(!Array.isArray(parsed)) return true; // corrupt queue: fail closed
            return parsed.length > 0;
        };

        const preserveData =
            hasPending(CLOUD_QUEUE_KEY) ||
            hasPending(CLOUD_DEAD_LETTER_KEY) ||
            hasArrayData(DB.sessions) ||
            hasArrayData(DB.attendance) ||
            hasArrayData(DB.permits);

        if(preserveData){
            console.warn("Migrasi cache ditunda: data lokal atau antrean pemulihan masih tersedia. Tidak ada data yang dihapus.");
            return;
        }

        // There is nothing to migrate or delete. Advance only the marker.
        // Explicit data purges must be performed by the authorized HRD flow.
        localStorage.setItem("nev_data_epoch", DATA_EPOCH);
    }catch(e){
        // Invalid/unreadable local data must never trigger destructive cleanup.
        console.warn("Migrasi cache ditunda demi keamanan data:", e);
    }
})();

function getAuthToken(){
    return localStorage.getItem("nev_auth_token") || "";
}

function clearAuthSession(){
    localStorage.removeItem("nev_auth_token");
    localStorage.removeItem("nev_current_user");
}

/* =========================================================
   SESI LOGIN — bertahan saat halaman di-refresh
   - Aplikasi ditampilkan langsung dari cache lokal (tanpa menunggu jaringan).
   - Halaman terakhir yang dibuka ikut dipulihkan.
   - Logout paksa HANYA terjadi bila server menyatakan sesi berakhir
     (authExpired). Jaringan lambat/offline tidak lagi me-logout pengguna.
========================================================= */
const LAST_PAGE_KEY = "nev_last_page";
const ROLE_HOME_PAGE = { "STAF":"staf-dashboard", "HRD":"hrd-dashboard", "KOOR KP":"koor-dashboard" };

function readSavedLogin(){
    if(!getAuthToken()) return null;
    try{
        const user = JSON.parse(localStorage.getItem("nev_current_user") || "null");
        if(user && user.id && ROLE_HOME_PAGE[user.role]) return user;
    }catch(e){}
    return null;
}

function endRestoringState(){
    document.documentElement.classList.remove("nev-restoring");
}

// Dipanggil saat server menolak token (kedaluwarsa / dicabut / password diganti).
function handleSessionExpired(message){
    const wasInApp = (typeof currentUser !== "undefined" && !!currentUser) ||
        !document.getElementById("app")?.classList.contains("hidden");
    clearAuthSession();
    if(typeof currentUser !== "undefined") currentUser = null;
    try{ if(typeof stopScanner === "function") stopScanner(); }catch(e){}
    document.getElementById("app")?.classList.add("hidden");
    document.getElementById("loginScreen")?.classList.remove("hidden");
    ["loginUsername","loginPassword"].forEach(id=>{ const el=document.getElementById(id); if(el) el.value=""; });
    document.getElementById("cloudBadge")?.remove();
    endRestoringState();
    if(wasInApp && typeof toast === "function"){
        toast(message || "Sesi login berakhir. Silakan login kembali.", "error");
    }
}

// Ingat halaman terakhir yang berhasil dibuka (per akun) supaya refresh tidak kembali ke dashboard.
const _origShowPage = showPage;
showPage = function(page){
    _origShowPage(page);
    try{
        if(currentUser && document.getElementById("page-"+page)?.classList.contains("active")){
            localStorage.setItem(LAST_PAGE_KEY, JSON.stringify({ uid: currentUser.id, page }));
        }
    }catch(e){}
};

function restoreSessionUI(user){
    currentUser = user;
    document.getElementById("loginScreen")?.classList.add("hidden");
    document.getElementById("app")?.classList.remove("hidden");
    buildSidebar();
    updateUserUI();

    const home = ROLE_HOME_PAGE[user.role];
    let page = home;
    try{
        const last = JSON.parse(localStorage.getItem(LAST_PAGE_KEY) || "null");
        // Hanya pakai halaman terakhir bila milik akun ini dan ada di menu role-nya (tanpa toast akses ditolak).
        if(last && last.uid === user.id && last.page &&
           document.querySelector('.menu-item[data-page="'+last.page+'"]')) page = last.page;
    }catch(e){}
    showPage(page);
}

// Pastikan kunci data lokal ada tanpa menyemai akun demo (akun asli datang dari getAll).
function ensureLocalDefaults(user){
    if(!localStorage.getItem(DB.users)) _localSave(DB.users, [user]);
    if(!localStorage.getItem(DB.sessions)) _localSave(DB.sessions, []);
    if(!localStorage.getItem(DB.attendance)) _localSave(DB.attendance, []);
    const st = load(DB.settings);
    if(!st || Array.isArray(st)) _localSave(DB.settings, {officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
}

function cacheBust(url){
    return url + (url.indexOf("?") >= 0 ? "&" : "?") + "_ts=" + Date.now();
}

/* Batasi waktu request + pembacaan body. Apps Script kadang menggantung tanpa
   mengembalikan response; antrean harus mendapat timeout lalu retry terkontrol. */
async function fetchCloudText(url,options,timeoutMs){
    const timeout=Number(timeoutMs)||25000;
    const controller=typeof AbortController!=="undefined"?new AbortController():null;
    let timedOut=false,timer=null;
    if(controller) timer=setTimeout(()=>{timedOut=true;controller.abort();},timeout);
    try{
        const requestOptions=Object.assign({},options||{});
        if(controller) requestOptions.signal=controller.signal;
        const response=await fetch(url,requestOptions);
        const text=await response.text();
        if(!response.ok){
            const error=new Error("HTTP "+response.status+(response.statusText?" "+response.statusText:""));
            if(isTransientCloudError(error)) error.retryable=true;
            else error.fatal=true;
            throw error;
        }
        return {response,text};
    }catch(error){
        if(timedOut || (controller&&controller.signal.aborted)){
            const timeoutError=new Error("Request ke Google Apps Script melewati batas "+Math.max(1,Math.ceil(timeout/1000))+" detik.");
            timeoutError.retryable=true;
            throw timeoutError;
        }
        throw error;
    }finally{
        if(timer!==null) clearTimeout(timer);
    }
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
        const raw=localStorage.getItem(CLOUD_QUEUE_KEY);
        const q=raw===null?[]:JSON.parse(raw);
        if(!Array.isArray(q)) throw new Error("format antrean bukan array");
        cloudQueueCorrupt=false;
        return q;
    }catch(e){
        cloudQueueCorrupt=true;
        cloudLastError="Format antrean sinkronisasi lokal rusak. Data asli dikunci agar tidak tertimpa; ekspor data pemulihan sebelum memperbaiki penyimpanan.";
        console.error("Antrean cloud tidak dapat dibaca; penulisan dan sinkronisasi dihentikan:",e);
        return [];
    }
}

function setCloudQueue(q){
    // Jangan pernah menimpa isi mentah antrean yang gagal diparse.
    if(cloudQueueCorrupt) return false;
    try{
        const serialized=JSON.stringify(q);
        localStorage.setItem(CLOUD_QUEUE_KEY,serialized);
        return localStorage.getItem(CLOUD_QUEUE_KEY)===serialized;
    }catch(e){
        console.error("Queue cloud penuh/tidak dapat disimpan:", e);
        cloudLastError = "Queue sinkronisasi lokal penuh. Perubahan belum aman untuk dikirim.";
        return false;
    }
}

function getCloudDeadLetters(){
    try{
        const raw=localStorage.getItem(CLOUD_DEAD_LETTER_KEY);
        const items=raw===null?[]:JSON.parse(raw);
        if(!Array.isArray(items)) throw new Error("format arsip bukan array");
        cloudDeadLettersCorrupt=false;
        return items;
    }catch(e){
        cloudDeadLettersCorrupt=true;
        cloudLastError="Format arsip pemulihan sinkronisasi rusak. Data asli dikunci agar tidak tertimpa; ekspor data pemulihan sebelum memperbaiki penyimpanan.";
        console.error("Arsip cloud tidak dapat dibaca; penulisan dan sinkronisasi dihentikan:",e);
        return [];
    }
}
function setCloudDeadLetters(items){
    if(cloudDeadLettersCorrupt) return false;
    try{localStorage.setItem(CLOUD_DEAD_LETTER_KEY,JSON.stringify(items));return true;}
    catch(e){cloudLastError="Arsip gagal sinkron tidak dapat disimpan. Antrean asli dipertahankan.";console.error(e);return false;}
}

function exportCloudRecoveryData(){
    const payload={
        exportedAt:new Date().toISOString(),
        queueRaw:localStorage.getItem(CLOUD_QUEUE_KEY),
        deadLettersRaw:localStorage.getItem(CLOUD_DEAD_LETTER_KEY),
        localData:{}
    };
    [DB.users,DB.sessions,DB.attendance,DB.settings,DB.permits,DB.warnings].forEach(key=>{
        payload.localData[key]=localStorage.getItem(key);
    });
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="nev-absenku-pemulihan-lokal.json";
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    if(typeof toast==="function") toast("Salinan antrean mentah dan data lokal berhasil diekspor.","success");
}
window.exportCloudRecoveryData=exportCloudRecoveryData;
function archiveCloudQueueItem(item,error){
    const archive=getCloudDeadLetters();
    // Satu item antrean hanya boleh memiliki satu arsip, termasuk bila penghapusan
    // dari antrean aktif gagal dan flush berikutnya mencoba mengarsipkannya lagi.
    const existing=archive.find(x=>x && x.id===item.id);
    if(!existing){
        archive.push({...item,failedAt:new Date().toISOString(),failureReason:friendlyCloudError(error)});
        if(!setCloudDeadLetters(archive))return false;
    }
    // Jangan menganggap arsip selesai bila item aktif belum benar-benar terhapus.
    // Jika gagal, item tetap ada di kedua tempat dan deduplikasi di atas mencegah
    // arsip membengkak pada percobaan berikutnya.
    return removeCloudQueueItem(item.id);
}
function exportCloudDeadLetters(){
    const items=getCloudDeadLetters();
    if(!items.length){if(typeof toast==="function")toast("Tidak ada data gagal yang perlu diekspor.","normal");return;}
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),items},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),a=document.createElement("a");
    a.href=url;a.download="nev-absenku-data-gagal-sinkronisasi.json";
    document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url);
    if(typeof toast==="function")toast("Arsip data gagal sinkronisasi berhasil diekspor.","success");
}
window.exportCloudDeadLetters=exportCloudDeadLetters;
window.retryCloudDeadLetters=function(){
    const archived=getCloudDeadLetters();
    if(cloudQueueCorrupt || cloudDeadLettersCorrupt){
        cloudLastError="Pemulihan dihentikan karena antrean/arsip lokal tidak dapat dibaca. Ekspor data pemulihan terlebih dahulu.";
        updateCloudBadge();
        if(typeof toast==="function") toast(cloudLastError,"error");
        return;
    }
    if(!archived.length){if(typeof toast==="function")toast("Tidak ada data untuk dicoba ulang.","normal");return;}
    const queue=getCloudQueue();
    // Gunakan retryOf sebagai kunci idempotensi lokal. Jika penghapusan arsip gagal,
    // klik ulang tidak boleh menambahkan salinan kedua dari item yang sama.
    archived.forEach(item=>{
        if(!item || !item.action) return;
        const sourceId=item.id||null;
        const alreadyQueued=sourceId && queue.some(q=>q && q.retryOf===sourceId);
        if(alreadyQueued) return;
        queue.push({
            id:sourceId ? "Q-RETRY-"+sourceId : ("Q-RETRY-"+Date.now()+"-"+Math.random().toString(36).slice(2)),
            action:item.action,
            data:item.data,
            createdAt:item.createdAt||new Date().toISOString(),
            retryOf:sourceId
        });
    });
    if(!setCloudQueue(queue)){cloudLastError="Antrean penuh; arsip pemulihan tetap disimpan.";updateCloudBadge();return;}
    if(!setCloudDeadLetters([])){cloudLastError="Antrean dibuat tetapi arsip belum dapat dibersihkan. Percobaan ulang aman dilakukan kembali.";updateCloudBadge();return;}
    cloudUnsynced=queue.length;updateCloudBadge();flushCloudQueue();
};

function queueCloudAction(action, data){
    if(!action || data === undefined) return null;
    // Baca kedua storage sebelum mutasi supaya format rusak terdeteksi fail-closed.
    getCloudQueue();
    getCloudDeadLetters();
    if(cloudQueueCorrupt || cloudDeadLettersCorrupt){
        updateCloudBadge();
        return null;
    }
    const q=getCloudQueue();
    const replaceable=["saveSessions","saveAttendance","saveSettings","savePermits"].includes(action);
    const item={id:"Q-"+Date.now()+"-"+Math.random().toString(36).slice(2),action,data,createdAt:new Date().toISOString()};
    if(replaceable){
        const idx=q.findIndex(x=>x.action===action);
        if(idx>=0)q[idx]=item;else q.push(item);
    }else q.push(item);
    if(!setCloudQueue(q)) return null;
    cloudUnsynced=q.length;
    updateCloudBadge();
    // Verify persisted queue before allowing caller to proceed.
    return getCloudQueue().some(x=>x.id===item.id)?item.id:null;
}

function removeCloudQueueItem(id){
    const q=getCloudQueue().filter(x=>x.id!==id);
    if(!setCloudQueue(q)) return false;
    cloudUnsynced=q.length;
    return true;
}

function friendlyCloudError(err){
    const msg = String((err && err.message) || err || "");
    if(/failed to fetch|networkerror|load failed|network request failed|err_network|err_connection/i.test(msg)){
        return "Browser gagal menyelesaikan request ke endpoint Google Apps Script. Ini tidak otomatis berarti internet perangkat putus; periksa respons/deployment endpoint.";
    }
    if(/respons server bukan json/i.test(msg)){
        return "Endpoint Apps Script mengembalikan respons non-JSON. Periksa akses Web App, URL deployment, dan apakah endpoint masih aktif.";
    }
    if(/batas waktu penguncian habis|lock.*timeout/i.test(msg)){
        return "Google Apps Script gagal memperoleh LockService tepat waktu.";
    }
    return msg.slice(0, 220) || "kesalahan tidak diketahui";
}

// Semua request ke Apps Script dalam satu tab dijalankan berurutan.
// Ini mencegah getAll dan beberapa operasi save saling menumpuk.
let cloudRequestTail = Promise.resolve();
function serializeCloudRequest(task){
    const run = cloudRequestTail.then(task, task);
    cloudRequestTail = run.then(()=>undefined, ()=>undefined);
    return run;
}
function isTransientCloudError(err){
    const msg=String((err && err.message) || err || "");
    return /batas waktu penguncian habis|lock.*timeout|try again|temporar|server busy|too many requests|service invoked too many times|failed to fetch|networkerror|load failed|network request failed|err_network|err_connection|timed? ?out|timeout|http 429|http 5\d\d/i.test(msg);
}

function queueActionLabel(action){
    const labels={
        saveSessions:"perubahan kegiatan",
        saveAttendance:"perubahan data absensi",
        saveSettings:"perubahan pengaturan",
        savePermits:"perubahan data izin",
        addAttendance:"pengiriman absensi",
        addPermit:"pengajuan izin"
    };
    return labels[action]||String(action||"operasi sinkronisasi");
}

function rememberCloudQueueFailure(item,err){
    const message=friendlyCloudError(err);
    const q=getCloudQueue();
    const index=q.findIndex(x=>x && x.id===item.id);
    if(index>=0){
        q[index]={...q[index],lastError:message,lastAttemptAt:new Date().toISOString(),attemptCount:(Number(q[index].attemptCount)||0)+1};
        setCloudQueue(q);
    }
    cloudLastError=queueActionLabel(item.action)+": "+message;
    updateCloudBadge();
}

async function cloudPost(action, data, retries){
    const maxRetry = retries ?? 1;
    let lastErr;

    for(let attempt=0; attempt<=maxRetry; attempt++){
        try{
            return await serializeCloudRequest(async()=>{
                const {response:res,text} = await fetchCloudText(cacheBust(CLOUD_SCRIPT_URL), {
                    method:"POST",
                    cache:"no-store",
                    headers:{"Content-Type":"text/plain;charset=utf-8"},
                    body:cloudPayload(action,data)
                },25000);
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
                    const message=(json && json.error) || (res.status ? "HTTP "+res.status : "Server menolak permintaan.");
                    const e = new Error(message);
                    if(isTransientCloudError(e)) e.retryable = true;
                    else e.fatal = true;
                    throw e;
                }
                if(["saveAttendance","saveSessions","savePermits"].includes(action) && Number(json.skipped||0)>0){
                    const e=new Error("Server melewati "+Number(json.skipped)+" record pada "+action+". Data lokal dipertahankan untuk pemeriksaan.");
                    e.fatal=true;
                    e.partial=true;
                    throw e;
                }
                if(action==="saveAttendance" && json.ignored){
                    const e=new Error("Server mengabaikan penyimpanan massal absensi untuk role STAF. Gunakan endpoint addAttendance.");
                    e.fatal=true;
                    throw e;
                }
                return json;
            });
        }catch(err){
            lastErr = err;
            if(err.authExpired) handleSessionExpired(err.message);
            if(!err.fatal && !err.retryable && isTransientCloudError(err)) err.retryable=true;
            if(err.fatal) break;
            if(attempt < maxRetry){
                const delay=err.retryable ? 1800 : 900;
                await new Promise(r=>setTimeout(r,delay));
            }
        }
    }
    throw lastErr || new Error("Cloud request gagal.");
}

/* =========================================================
   HAPUS DATA ABSENSI (HRD) — sesi, absensi, izin/sakit + foto di Drive
   Akun pengguna dan lokasi/radius kantor TIDAK ikut terhapus.
========================================================= */
async function purgeCloudData(options){
    getCloudQueue();
    getCloudDeadLetters();
    if(cloudQueueCorrupt || cloudDeadLettersCorrupt){
        throw new Error("Purge dibatalkan: antrean/arsip sinkronisasi lokal rusak dan belum dapat diverifikasi. Ekspor data pemulihan terlebih dahulu.");
    }
    const json = await cloudPost("purgeData", options || {}, 0);

    // Arsip gagal juga dapat berisi absensi lama. Hapus bersama queue setelah
    // server mengonfirmasi purge agar retry manual tidak menghidupkan data lama.
    const queueCleared=setCloudQueue([]);
    const archiveCleared=setCloudDeadLetters([]);
    if(!queueCleared || !archiveCleared){
        cloudLastError="Server telah menjalankan purge, tetapi penyimpanan antrean lokal belum berhasil dibersihkan. Jangan klik retry arsip; ekspor data pemulihan dan periksa perangkat ini.";
        updateCloudBadge();
        throw new Error(cloudLastError);
    }
    cloudUnsynced = 0;
    [DB.sessions, DB.attendance, DB.permits].forEach(k=> _localSave(k, []));
    updateCloudBadge();
    return json;
}

/* =========================================================
   OVERRIDE save()
========================================================= */
save = function(key,data){
    sanitizeList(key,data);
    _localSave(key,data);
    try{ window.dispatchEvent(new Event("nev-cloud-updated")); }catch(e){}
    return pushToCloud(key,data);
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
    if(!cloudSyncEnabled || !getAuthToken()) return Promise.resolve(false);
    const action=CLOUD_ACTION_BY_KEY[key];
    if(!action) return Promise.resolve(false);
    const queuedId=queueCloudAction(action,data);
    if(!queuedId){
        const err=new Error("Perubahan tersimpan lokal, tetapi antrean sinkronisasi gagal disimpan. Jangan refresh atau tutup halaman sebelum mengekspor/menyalin data lokal.");
        cloudLastError=err.message;
        updateCloudBadge();
        return Promise.reject(err);
    }
    return flushCloudQueue().then(()=>{
        const pending=getCloudQueue().some(x=>x.id===queuedId || x.action===action);
        const archived=getCloudDeadLetters().find(x=>x.id===queuedId);
        if(archived) throw new Error(archived.failureReason || "Server menolak data. Data dipertahankan di arsip pemulihan.");
        if(pending) throw new Error("Perubahan tersimpan di perangkat, tetapi masih menunggu sinkronisasi ke server.");
        cloudLastError=null;
        cloudUnsynced=getCloudQueue().length;
        updateCloudBadge();
        return true;
    }).catch(err=>{
        cloudLastError=friendlyCloudError(err);
        updateCloudBadge();
        throw err;
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
// Menyimpan hasil getAll (atau data awal dari login) ke penyimpanan lokal.
function applyCloudAll(json){
    sanitizeCloudData(json);
    // Jangan menimpa key lokal yang masih memiliki perubahan tertunda.
    // Rekonsiliasi record-level memerlukan kontrak revision dari backend; untuk sementara
    // pertahankan snapshot lokal pada key tersebut sampai antrean selesai diproses.
    // Snapshot cloud hanya boleh mengganti cache suatu domain bila tidak ada
    // perubahan lokal yang belum terselesaikan (queue maupun dead-letter).
    // Jika ada perubahan tertunda, pertahankan seluruh domain tersebut; kontrak
    // backend belum menyediakan revision untuk merge record-level yang aman.
    const queued=getCloudQueue();
    const archived=getCloudDeadLetters();
    if(cloudQueueCorrupt || cloudDeadLettersCorrupt){
        cloudLastError=cloudQueueCorrupt
            ? "Antrean lokal rusak; seluruh cache lokal dipertahankan."
            : "Arsip pemulihan rusak; seluruh cache lokal dipertahankan.";
        updateCloudBadge();
        return;
    }
    const pending=new Set();
    [...queued,...archived].forEach(item=>{
        if(item && item.action) pending.add(item.action);
    });
    const preserve=new Set();
    Object.keys(CLOUD_ACTION_BY_KEY).forEach(key=>{
        if(pending.has(CLOUD_ACTION_BY_KEY[key])) preserve.add(key);
    });
    if(pending.has("addAttendance")) preserve.add(DB.attendance);
    if(pending.has("addPermit")) preserve.add(DB.permits);

    _localSave(DB.users,json.users||[]);
    if(!preserve.has(DB.sessions)) _localSave(DB.sessions,json.sessions||[]);
    if(!preserve.has(DB.attendance)) _localSave(DB.attendance,json.attendance||[]);
    if(!preserve.has(DB.settings)) _localSave(DB.settings,json.settings||{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
    if(!preserve.has(DB.permits)) _localSave(DB.permits,json.permits||[]);
    _localSave(DB.warnings,json.warnings||[]);

    cloudServerVersion=json.version||null;
    cloudLastSyncAt=new Date();
    cloudLastError=null;
    cloudUnsynced=getCloudQueue().length;
    updateCloudBadge();
    try{ window.dispatchEvent(new Event("nev-cloud-updated")); }catch(e){}
}

async function fetchCloudAll(){
    if(!cloudSyncEnabled) return false;
    const token=getAuthToken();
    if(!token) return false;
    try{
        const json=await serializeCloudRequest(async()=>{
            const {response:res,text}=await fetchCloudText(cacheBust(CLOUD_SCRIPT_URL),{
                method:"POST",
                cache:"no-store",
                headers:{"Content-Type":"text/plain;charset=utf-8"},
                body:cloudPayload("getAll",{})
            },25000);
            let parsed;
            try{parsed=JSON.parse(text);}catch(e){throw new Error("Respons getAll bukan JSON. Periksa Deployment Apps Script dan akses 'Anyone'.");}
            if(parsed && parsed.authExpired){
                handleSessionExpired(parsed.error||"Sesi login kedaluwarsa. Silakan login kembali.");
                throw new Error(parsed.error||"Sesi login kedaluwarsa.");
            }
            if(!parsed || !parsed.ok){
                const e=new Error((parsed&&parsed.error)||("HTTP "+(res.status||"?")));
                if(isTransientCloudError(e))e.retryable=true;
                throw e;
            }
            return parsed;
        });
        applyCloudAll(json);
        if(cloudQueueCorrupt || cloudDeadLettersCorrupt) return false;

        if(cloudUnsynced){
            const flushed=await flushCloudQueue();
            if(!flushed || getCloudQueue().length){
                if(!cloudLastError) cloudLastError="Masih ada data yang belum berhasil disinkronkan.";
                updateCloudBadge();
                return false;
            }
        }
        return true;
    }catch(err){
        console.error("Gagal mengambil data dari Google Sheets:",err);
        cloudLastError=friendlyCloudError(err);
        updateCloudBadge();
        return false;
    }
}

function scheduleCloudQueueRetry(){
    if(cloudQueueRetryTimer || !getAuthToken()) return;
    const pending=getCloudQueue();
    if(!pending.length || cloudQueueCorrupt || cloudDeadLettersCorrupt) return;
    const attempts=Number(pending[0].attemptCount)||0;
    // Retry otomatis dengan jeda bertahap agar lock Apps Script tidak makin padat.
    const delay=Math.min(30000,2000*Math.pow(2,Math.min(attempts,4)));
    cloudQueueRetryTimer=setTimeout(()=>{
        cloudQueueRetryTimer=null;
        flushCloudQueue();
    },delay);
}

async function hydrateQueuedPhotoRefs(action,data){
    if(!data || typeof data!=="object") return data;
    const clone=Array.isArray(data)?data.map(item=>item&&typeof item==="object"?{...item}:item):{...data};
    const rows=Array.isArray(clone)?clone:[clone];
    for(const row of rows){
        if(row && typeof row.photo==="string" && isNevPhotoRef(row.photo)){
            const restored=await getNevPhoto(row.photo);
            if(!restored) throw Object.assign(new Error("Foto antrean tidak ditemukan di IndexedDB; data antrean dipertahankan untuk pemulihan."),{fatal:true});
            row.photo=restored;
        }
    }
    return clone;
}

async function flushCloudQueue(){
    if(cloudQueueRetryTimer){clearTimeout(cloudQueueRetryTimer);cloudQueueRetryTimer=null;}
    if(!getAuthToken()) return false;
    getCloudQueue();
    getCloudDeadLetters();
    if(cloudQueueCorrupt || cloudDeadLettersCorrupt) return false;
    if(cloudFlushing) return cloudFlushPromise || false;
    cloudFlushing=true;
    cloudFlushPromise=(async()=>{
        while(true){
            const q=getCloudQueue();
            if(!q.length) return true;
            const item=q[0];
            try{
                // Queue menyimpan referensi foto ringkas; pulihkan Base64 hanya di memori saat request.
                const outboundData=await hydrateQueuedPhotoRefs(item.action,item.data);
                const result=await cloudPost(item.action,outboundData,1);
                if(result && result.ignored) throw Object.assign(new Error("Server mengabaikan operasi "+item.action+"."),{fatal:true});
                if(!removeCloudQueueItem(item.id)){
                    cloudLastError="Server menerima data, tetapi antrean lokal gagal diperbarui. Perlu verifikasi sebelum retry.";
                    break;
                }
            }catch(err){
                if(err.authExpired) break;
                console.error("Queue cloud gagal:",err);
                if(err.fatal){
                    if(archiveCloudQueueItem(item,err)){
                        cloudLastError=queueActionLabel(item.action)+" ditolak server dan dipindahkan ke arsip pemulihan: "+friendlyCloudError(err);
                    }else{
                        rememberCloudQueueFailure(item,err);
                        cloudLastError="Server menolak data, tetapi antrean tetap dipertahankan karena arsip gagal disimpan. "+friendlyCloudError(err);
                    }
                }else{
                    // Jangan biarkan antrean tertahan tanpa penyebab. Error transport,
                    // timeout, atau respons tidak dikenal tetap disimpan untuk retry aman.
                    rememberCloudQueueFailure(item,err);
                }
                break;
            }
        }
        return getCloudQueue().length===0;
    })();
    try{
        return await cloudFlushPromise;
    }finally{
        cloudFlushing=false;
        cloudFlushPromise=null;
        cloudUnsynced=getCloudQueue().length;
        if(!cloudUnsynced && !getCloudDeadLetters().length && !cloudQueueCorrupt && !cloudDeadLettersCorrupt){
            cloudLastError=null;
        }else if(cloudUnsynced && !cloudQueueCorrupt && !cloudDeadLettersCorrupt){
            scheduleCloudQueueRetry();
        }
        updateCloudBadge();
    }
}

/* =========================================================
   LOGIN — cepat, sinkronisasi cloud berjalan setelah dashboard tampil
========================================================= */
window.login = async function(event){
    if(event && event.preventDefault) event.preventDefault();
    if(typeof setLoginLoading==="function") setLoginLoading(true);
    try{
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

        // Server kini mengirim data awal bersama respons login: tidak perlu request getAll kedua.
        if(result.all && result.all.ok){
            applyCloudAll(result.all);
            if(typeof renderAll==="function") renderAll();
            if(cloudUnsynced) flushCloudQueue();
        }else{
            // Server lama (belum diperbarui): ambil data di latar belakang agar tombol login tidak menunggu.
            fetchCloudAll().then(ok=>{
                if(ok && typeof renderAll==="function") renderAll();
                else if(!ok) toast("Login berhasil, sinkron data tertunda. Ketuk status Cloud.","error");
            });
        }
        if(typeof consumePendingAttendance==="function") consumePendingAttendance();
    }catch(err){
        console.error("Login error:",err);
        toast("Login gagal: "+friendlyCloudError(err),"error");
    }
    }finally{
        if(typeof setLoginLoading==="function") setLoginLoading(false);
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
        el.style.cssText="position:fixed;right:12px;bottom:12px;left:auto;z-index:9999;border:0;border-radius:999px;padding:8px 14px;font:600 12px Inter,sans-serif;cursor:pointer;box-shadow:0 2px 10px rgba(0,0,0,.3);max-width:calc(100vw - 24px);";
        el.onclick=()=>{
            getCloudQueue();getCloudDeadLetters();
            if(cloudQueueCorrupt || cloudDeadLettersCorrupt){exportCloudRecoveryData();return;}
            if(getCloudDeadLetters().length){exportCloudDeadLetters();return;}
            manualCloudRefresh(false);
        }; document.body.appendChild(el);
    }
    let text,bg;
    getCloudQueue();getCloudDeadLetters();
    if(cloudQueueCorrupt || cloudDeadLettersCorrupt){text="⚠ Data pemulihan rusak — ketuk untuk ekspor";bg="#b71c1c";}
    else if(!cloudSyncEnabled){text="⚠ CLOUD OFFLINE";bg="#c62828";}
    else if(cloudFlushing){
        const first=getCloudQueue()[0];
        text="⏳ Menyinkronkan"+(cloudUnsynced>1?" ("+cloudUnsynced+")":"...");
        if(el) el.title=(first?queueActionLabel(first.action):"Data sedang dikirim")+" — tunggu konfirmasi server";
        bg="#ef6c00";
    }
    else if(cloudUnsynced>0){
        const first=getCloudQueue()[0];
        const action=first?queueActionLabel(first.action):"data tertunda";
        const reason=first&&(first.lastError||"");
        text="⏳ "+cloudUnsynced+" data menunggu sinkronisasi";
        if(el) el.title=action+(reason?" — "+reason:" — sistem akan mencoba ulang otomatis");
        bg="#ef6c00";
    }
    else if(getCloudDeadLetters().length){text="⚠ "+getCloudDeadLetters().length+" data gagal — ketuk untuk ekspor";bg="#c62828";}
    else if(cloudLastError){text="⚠ Gagal sinkron — ketuk untuk detail/retry";bg="#c62828";}
    else{const t=cloudLastSyncAt?cloudLastSyncAt.toLocaleTimeString("id-ID"):"-";text="☁ Tersinkron "+t+" · ketuk untuk segarkan";bg="#2e7d32";}
    if(!cloudUnsynced && el) el.title=cloudLastError||"Data tersinkron. Klik untuk menyegarkan.";
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
   NOTIFIKASI GAGAL ABSENSI — singkat & tidak dobel
========================================================= */
function shortAttendError(err){
    const msg = String((err && err.message) || err || "");
    const rules = [
        [/sudah melakukan absensi/i, "Sudah absen di kegiatan ini."],
        [/luar radius/i, () => { const m = msg.match(/\((\d+)\s*m dari titik, batas (\d+)/i); return m ? `Di luar radius (${m[1]} m, batas ${m[2]} m).` : "Di luar radius lokasi."; }],
        [/lokasi perangkat tidak terbaca/i, "Lokasi tidak terbaca. Aktifkan GPS."],
        [/belum aktif/i, "QR belum aktif."],
        [/kadaluwarsa|melewati tanggal|hanya dapat dilakukan pukul/i, "Waktu absensi sudah lewat."],
        [/token qr/i, "QR tidak cocok. Pindai ulang."],
        [/dinonaktifkan|sudah ditutup/i, "QR dinonaktifkan oleh HRD/Koor KP."],
        [/untuk divisi/i, "Bukan untuk divisi Anda."],
        [/tidak ditemukan/i, "Kegiatan tidak ditemukan."],
        [/foto/i, "Foto bermasalah. Ambil ulang."],
        [/sesi login|login kembali/i, "Sesi habis. Login ulang."],
        [/failed to fetch|network|koneksi/i, "Koneksi lambat/terputus."]
    ];
    for(const [re,out] of rules){
        if(re.test(msg)) return typeof out==="function" ? out() : out;
    }
    return msg.length > 60 ? msg.slice(0,57) + "..." : (msg || "Absensi gagal.");
}

// Satu notifikasi saja per kegagalan (pesan sama dalam 4 detik tidak ditampilkan ulang).
let _lastFailToast = { msg:"", at:0 };
function failToast(msg){
    const now = Date.now();
    if(_lastFailToast.msg === msg && now - _lastFailToast.at < 4000) return;
    _lastFailToast = { msg, at: now };
    toast(msg, "error");
}

/* =========================================================
   ATTENDANCE + FOTO DRIVE
========================================================= */
async function finalizeAttendance(session,token,location,photo){
    const attendance=load(DB.attendance);
    const duplicate=attendance.find(a=>a.sessionId===session.id&&a.userId===currentUser.id);
    if(duplicate){failToast("Sudah absen di kegiatan ini.");return;}

    const record={
        id:"ATT-"+Date.now(),sessionId:session.id,token:session.token,userId:currentUser.id,
        userName:currentUser.name,username:currentUser.username,activity:session.activity,
        division:session.division,date:session.date,checkIn:new Date().toISOString(),status:"Hadir",
        creatorId:session.creatorId,creatorRole:session.creatorRole,lat:location?location.lat:null,
        lng:location?location.lng:null,photo:photo||null
    };

    if(!cloudSyncEnabled){
        attendance.push(record);_localSave(DB.attendance,attendance);
        failToast("Tersimpan di perangkat saja, belum terkirim.");
        const manualInput=document.getElementById("manualToken");if(manualInput)manualInput.value="";
        renderAll();return;
    }

    cloudSyncBusy=true; // tanpa toast "mengunggah..." — tombol Kirim sudah menampilkan status loading
    try{
        const json=await cloudPost("addAttendance",record,1);
        const saved=json.record||record;
        // Tampilkan hasil langsung dari respons server; tidak menunggu getAll (data penuh menyusul di latar belakang).
        const list=load(DB.attendance)||[];
        if(!list.some(a=>a.id===saved.id||(a.sessionId===saved.sessionId&&a.userId===saved.userId))) list.push(saved);
        _localSave(DB.attendance,list);
        toast("Absensi berhasil.","success");
        updateScannerStatus(`Berhasil hadir: ${session.activity}${session.division!=="-"?" • "+session.division:""}`,"success");
        const manualInput=document.getElementById("manualToken");if(manualInput)manualInput.value="";
        renderAll();
        setTimeout(()=>{ fetchCloudAll().then(ok=>{ if(ok && currentUser) renderAll(); }); }, 1500);
    }catch(err){
        console.error("Gagal menyimpan absensi:",err);
        if(err && err.fatal){
            const reason=shortAttendError(err);
            failToast("Absensi ditolak: "+reason);
            updateScannerStatus("Absensi ditolak: "+reason,"error");
            return;
        }
        const list=load(DB.attendance)||[];
        record.syncPending=true;
        if(!list.some(a=>a.id===record.id)) list.push(record);
        _localSave(DB.attendance,list);
        queueCloudAction("addAttendance",record);
        cloudLastError=friendlyCloudError(err);updateCloudBadge();
        failToast("Koneksi lambat. Absensi disimpan sementara.");
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
        if(err && err.fatal){
            toast("Pengajuan ditolak: "+friendlyCloudError(err),"error");
            return;
        }
        permit.syncPending=true;_localSave(DB.permits,(load(DB.permits)||[]).concat([permit]));
        queueCloudAction("addPermit",permit);cloudLastError=friendlyCloudError(err);updateCloudBadge();
        toast(`Pengajuan disimpan sementara. Gagal sinkron: ${friendlyCloudError(err)}.`,"error");
    }finally{cloudSyncBusy=false;}
}

/* =========================================================
   BOOT
========================================================= */
// "Membangunkan" Apps Script di latar belakang + memastikan pengaturan lokal punya nilai awal.
async function wakeCloudBootstrap(){
    try{
        const {text}=await fetchCloudText(cacheBust(`${CLOUD_SCRIPT_URL}?action=bootstrap`),{cache:"no-store"},12000);
        const boot=JSON.parse(text);
        if(boot&&boot.ok){
            cloudServerVersion=boot.version||null;
            // Lokasi/radius kantor baru diterima setelah login (getAll), bukan dari endpoint publik.
            if(!load(DB.settings) || Array.isArray(load(DB.settings))){
                _localSave(DB.settings,{officeLat:null,officeLng:null,radius:100,geofenceEnabled:false});
            }
        }
    }catch(e){
        cloudLastError=friendlyCloudError(e);console.warn("Bootstrap cloud gagal:",e);updateCloudBadge();
    }
}

async function bootWithCloud(){
    // Reveal cached UI before potentially expensive legacy-photo migration.
    // The migration still completes before any cloud snapshot can replace local data.
    const savedUser = readSavedLogin();
    if(!cloudSyncEnabled){
        if(savedUser){
            ensureLocalDefaults(savedUser);
            try{
                restoreSessionUI(savedUser);
                if(typeof renderAll==="function") renderAll();
            }catch(e){ console.error("Pemulihan tampilan sesi gagal:",e); }
        }else{
            initializeDatabase();
        }
        endRestoringState();
        updateCloudBadge();
        startCloudPolling();
        try{ await migrateNevLegacyPhotos(); }catch(photoErr){
            cloudLastError="Migrasi foto lokal belum selesai: "+friendlyCloudError(photoErr);
            console.error(cloudLastError);
            updateCloudBadge();
        }
        return;
    }

    // Sisa sesi yang setengah tersimpan (token tanpa user, atau sebaliknya) dibersihkan.
    if(!savedUser && (getAuthToken() || localStorage.getItem("nev_current_user"))) clearAuthSession();

    if(savedUser){
        // 1) Tampilkan aplikasi dari cache lokal tanpa menunggu IndexedDB / jaringan.
        ensureLocalDefaults(savedUser);
        try{
            restoreSessionUI(savedUser);
            if(typeof renderAll==="function") renderAll();
        }catch(e){
            console.error("Pemulihan tampilan sesi gagal:",e);
        }
    }else{
        initializeDatabase();
    }
    endRestoringState();
    updateCloudBadge();

    // Bangunkan Apps Script paralel dengan migrasi lokal.
    wakeCloudBootstrap();
    try{ await migrateNevLegacyPhotos(); }catch(photoErr){
        cloudLastError="Migrasi foto lokal belum selesai: "+friendlyCloudError(photoErr);
        console.error(cloudLastError);
        updateCloudBadge();
    }

    startCloudPolling();
    if(!savedUser) return;

    // 2) Validasi sesi ke server hanya setelah migrasi lokal aman.
    const ok = await fetchCloudAll();
    if(ok){
        if(!currentUser) return;
        const fresh=(load(DB.users)||[]).find(u=>u.id===savedUser.id);
        if(fresh){
            const roleChanged = fresh.role !== currentUser.role;
            currentUser=fresh;
            localStorage.setItem("nev_current_user",JSON.stringify(fresh));
            updateUserUI();
            if(roleChanged && ROLE_HOME_PAGE[fresh.role]){ buildSidebar(); showPage(ROLE_HOME_PAGE[fresh.role]); }
        }
        if(typeof renderAll==="function") renderAll();
        if(typeof consumePendingAttendance==="function") consumePendingAttendance();
    }
    // ok=false: token yang ditolak ditangani handleSessionExpired(); gangguan sementara
    // tidak menutup UI lokal dan tetap ditampilkan melalui badge sinkronisasi.
    updateCloudBadge();
}
setInterval(updateCloudBadge,5000);
bootWithCloud();


/* =========================================================
   FOTO PRIVAT (bukti izin/sakit)
   File di Drive tidak dibuka lewat link. Foto diambil lewat server
   (dicek per role) lalu ditampilkan sebagai data URL dan disimpan di memori.
========================================================= */
const privatePhotoCache = new Map();

function privateFileId(url){
    const m = String(url || "").match(/\/file\/d\/([A-Za-z0-9_-]{10,100})\//);
    return m ? m[1] : null;
}

async function fetchPrivatePhoto(url){
    const id = privateFileId(url);
    if(!id) throw new Error("Foto tidak valid.");
    if(privatePhotoCache.has(id)) return privatePhotoCache.get(id);
    const json = await cloudPost("getPhoto", { fileId:id }, 1);
    privatePhotoCache.set(id, json.dataUrl);
    return json.dataUrl;
}

let privatePhotoBusy = false;
async function hydratePrivatePhotos(){
    if(privatePhotoBusy) return;
    privatePhotoBusy = true;
    try{
        let el;
        while((el = document.querySelector("img[data-private-photo]:not([data-private-state])"))){
            el.setAttribute("data-private-state","loading");
            try{
                el.src = await fetchPrivatePhoto(el.getAttribute("data-private-photo"));
                el.setAttribute("data-private-state","done");
            }catch(err){
                el.setAttribute("data-private-state","error");
                el.alt = "Foto tidak tersedia";
            }
        }
    }finally{ privatePhotoBusy = false; }
}

new MutationObserver(()=>{ clearTimeout(window.__phTimer); window.__phTimer = setTimeout(hydratePrivatePhotos, 60); })
    .observe(document.documentElement, { childList:true, subtree:true });
