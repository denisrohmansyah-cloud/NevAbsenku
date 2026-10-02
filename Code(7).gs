/**
 * =========================================================
 * NEV ABSENKU — Backend Terpusat v5 (hardening audit)
 * Google Sheets + Google Drive + autentikasi & pembatasan divisi
 * =========================================================
 *
 * Deploy sebagai Web App:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * SETELAH UPDATE:
 * Deploy -> Manage deployments -> Edit -> Version: New version -> Deploy.
 *
 * Password disimpan sebagai SHA-256 (format sha256$<hex>).
 * Password TIDAK pernah ditulis plaintext ke Google Sheets.
 * Data getAll difilter berdasarkan akun yang sedang login.
 */

const FOLDER_IDS = {
  selfie: "1-lQ2rFrCRYYqbmimYBtzReBEaG5hJVgr",
  permit: "1-9QaGXdIUrMT-BhhT8FvB3smfpwHq4vb",
  presensi: "1hpI3e8x4XonyO8wXJWdnnblo0KeKJFuF"
};

const FALLBACK_FOLDER_NAMES = {
  selfie: "NEV Absenku - Foto Selfie",
  permit: "NEV Absenku - Bukti Izin Sakit",
  presensi: "NEV Absenku - Foto Presensi"
};

const CODE_VERSION = "secure-v6";

const SHEET_USERS = "Users";
const SHEET_SESSIONS = "Sessions";
const SHEET_ATTENDANCE = "Attendance";
const SHEET_SETTINGS = "Settings";
const SHEET_PERMITS = "Permits";

const HEADERS = {
  Users: ["id", "name", "username", "password", "role", "division"],
  Sessions: ["id", "activity", "division", "date", "start", "end", "location", "notes",
             "creatorId", "creatorName", "creatorRole", "active", "createdAt", "token",
             "geoEnabled", "geoLat", "geoLng", "geoRadius", "expireMinutes",
             "attendanceSubmitted", "attendanceSubmittedAt", "attendanceSubmittedBy", "attendanceSubmittedByName"],
  Attendance: ["id", "sessionId", "token", "userId", "userName", "username", "activity",
               "division", "date", "checkIn", "status", "creatorId", "creatorRole",
               "lat", "lng", "photo", "permitId", "approvedFromPermit"],
  Settings: ["officeLat", "officeLng", "radius", "geofenceEnabled"],
  Permits: ["id", "sessionId", "sessionActivity", "sessionDivision", "sessionDate", "sessionLocation",
            "sessionCreatorId", "sessionCreatorRole", "userId", "userName", "username",
            "type", "reason", "photo", "status", "submittedAt",
            "reviewedBy", "reviewedByName", "reviewedAt", "reviewNote"]
};

const NUMERIC_COLS = ["lat", "lng", "geoLat", "geoLng", "geoRadius", "expireMinutes", "officeLat", "officeLng", "radius"];
const BOOL_COLS = ["active", "geofenceEnabled", "geoEnabled", "approvedFromPermit", "attendanceSubmitted"];
const DATE_COLS = ["date", "sessionDate"];
const TIME_COLS = ["start", "end"];

/* =========================================================
KEAMANAN: konstanta & validator input
Semua data dari klien dianggap TIDAK tepercaya. Field yang dipakai
di HTML/atribut (id, tanggal, jam, status, dll.) dipaksa mengikuti format ketat.
========================================================= */
const ID_RE        = /^[A-Za-z0-9_-]{1,64}$/;
const DATE_RE      = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE      = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_RE       = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})?$/;
const LABEL_RE     = /^[A-Za-z0-9 _.-]{1,40}$/;
const USERNAME_RE  = /^[A-Za-z0-9._-]{3,32}$/;
const TOKEN_RE     = /^(?:NEV-Q-[A-Za-z0-9]{8,20}|NEV-ABS-[A-Za-z0-9_-]{4,4000})$/;
const DRIVE_URL_RE = /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,100}\/view$/;
const DATA_IMG_RE  = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/;

const ATT_STATUS    = ["Hadir","Izin","Sakit","Dispen","Alpha"];
const PERMIT_STATUS = ["Menunggu","Disetujui","Ditolak"];
const PERMIT_TYPES  = ["Izin","Sakit","Dispen"];
const ROLES         = ["STAF","KOOR KP","HRD"];

const MAX_BODY_CHARS    = 6000000;   // batas satu request
const MAX_PHOTO_CHARS   = 3000000;   // batas satu foto (data URL base64)
const MAX_BATCH         = 5000;      // batas jumlah record per save-massal
const MIN_PASSWORD_LEN  = 8;
const LOGIN_MAX_FAIL    = 5;         // percobaan gagal per username
const LOGIN_LOCK_SEC    = 900;       // kunci 15 menit
const CHECKIN_GRACE_MIN = 10;        // toleransi setelah jam selesai (jaringan lambat)

function str_(v,max){
  if(v===undefined || v===null) return null;
  const t=String(v).replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,max||200);
  return t===""?null:t;
}
function idOk_(v){ return typeof v==="string" && ID_RE.test(v); }
function numOrNull_(v,min,max){
  if(v===null || v===undefined || v==="") return null;
  const n=Number(v);
  if(!isFinite(n) || n<min || n>max) return null;
  return n;
}
function boolOf_(v){ return v===true || String(v).toLowerCase()==="true"; }
function drivePhotoOrNull_(v){ return (typeof v==="string" && DRIVE_URL_RE.test(v)) ? v : null; }
function newId_(prefix){ return prefix+"-"+Date.now()+"-"+Math.floor(Math.random()*1000000); }

function nowWIB_(){
  const now=new Date();
  return {
    date:Utilities.formatDate(now,"Asia/Jakarta","yyyy-MM-dd"),
    time:Utilities.formatDate(now,"Asia/Jakarta","HH:mm"),
    iso:now.toISOString()
  };
}
function minutesToHHMM_(min){
  const m=((Math.round(min)%1440)+1440)%1440;
  return ("0"+Math.floor(m/60)).slice(-2)+":"+("0"+(m%60)).slice(-2);
}
function minutesOf_(hhmm){ const p=String(hhmm).split(":"); return Number(p[0])*60+Number(p[1]); }

function distanceMeters_(lat1,lng1,lat2,lng2){
  const R=6371000, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)*Math.sin(dLat/2)+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)*Math.sin(dLng/2);
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

function checkPassword_(password){
  const pw=String(password||"");
  if(pw.length<MIN_PASSWORD_LEN) throw new Error("Password minimal "+MIN_PASSWORD_LEN+" karakter.");
  if(pw.length>128) throw new Error("Password terlalu panjang (maksimal 128 karakter).");
  if(!/[A-Za-z]/.test(pw) || !/[0-9]/.test(pw)) throw new Error("Password harus mengandung huruf dan angka.");
}

/* =========================================================
UTIL SHEETS
========================================================= */
function tz_(){ return SpreadsheetApp.getActive().getSpreadsheetTimeZone(); }

function getSheet_(name){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if(!sheet) sheet = ss.insertSheet(name);

  const headers = HEADERS[name];
  const current = sheet.getLastRow() > 0
    ? sheet.getRange(1, 1, 1, headers.length).getValues()[0]
    : [];
  if(current.join("|") !== headers.join("|")){
    sheet.getRange(1, 1, 1, headers.length).setNumberFormat("@").setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function toCell_(v){
  if(v === undefined || v === null) return "";
  return String(v);
}

function dateCellToString_(h, d){
  if(DATE_COLS.indexOf(h) >= 0) return Utilities.formatDate(d, tz_(), "yyyy-MM-dd");
  if(TIME_COLS.indexOf(h) >= 0){
    const base = new Date(1899, 11, 30, 0, 0, 0);
    const total = Math.round((d.getTime() - base.getTime()) / 60000) % 1440;
    const t = (total + 1440) % 1440;
    return ("0" + Math.floor(t / 60)).slice(-2) + ":" + ("0" + (t % 60)).slice(-2);
  }
  return d.toISOString();
}

function fromCell_(h, v){
  if(v instanceof Date) v = dateCellToString_(h, v);
  if(BOOL_COLS.indexOf(h) >= 0) return v === true || String(v).toLowerCase() === "true";
  if(v === "" || v === null || v === undefined) return null;
  if(NUMERIC_COLS.indexOf(h) >= 0){
    const n = Number(v);
    return isNaN(n) ? null : n;
  }
  return typeof v === "number" ? String(v) : v;
}

function sheetToObjects_(name){
  const sheet = getSheet_(name);
  if(sheet.getLastRow() < 2) return [];
  const headers = HEADERS[name];
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  return values.filter(row => row.some(cell => cell !== "" && cell !== null)).map(row=>{
    const obj = {};
    headers.forEach((h,i)=> obj[h] = fromCell_(h,row[i]));
    return obj;
  });
}

function objectsToSheet_(name, list){
  const sheet = getSheet_(name);
  const headers = HEADERS[name];
  if(sheet.getLastRow() >= 2){
    sheet.getRange(2,1,sheet.getLastRow()-1,headers.length).clearContent();
  }
  if(list && list.length){
    const rows = list.map(obj=>headers.map(h=>toCell_(obj[h])));
    ensureRows_(sheet, rows.length+1);
    const range = sheet.getRange(2,1,rows.length,headers.length);
    range.setNumberFormat("@");
    range.setValues(rows);
  }
}

function ensureRows_(sheet,needed){
  const max=sheet.getMaxRows();
  if(max<needed) sheet.insertRowsAfter(max,needed-max);
}

function appendObject_(name,obj){
  const sheet=getSheet_(name);
  const headers=HEADERS[name];
  ensureRows_(sheet,sheet.getLastRow()+1);
  const range=sheet.getRange(sheet.getLastRow()+1,1,1,headers.length);
  range.setNumberFormat("@");
  range.setValues([headers.map(h=>toCell_(obj[h]))]);
}

/* Sanitizer: mengembalikan record bersih, atau null jika formatnya tidak sah (record dilewati). */
function sanitizeSession_(s){
  if(!s || !idOk_(s.id) || !DATE_RE.test(String(s.date)) || !TIME_RE.test(String(s.start)) || !TIME_RE.test(String(s.end))) return null;
  if(!LABEL_RE.test(String(s.activity||"")) ) return null;
  const division=String(s.division||"-");
  if(division!=="-" && !LABEL_RE.test(division)) return null;
  const role=String(s.creatorRole||"");
  if(["HRD","KOOR KP"].indexOf(role)<0 || !idOk_(s.creatorId)) return null;
  const token=String(s.token||"");
  if(!TOKEN_RE.test(token)) return null;
  const geoEnabled=boolOf_(s.geoEnabled);
  return {
    id:s.id, activity:String(s.activity), division:division,
    date:String(s.date), start:String(s.start), end:String(s.end),
    location:str_(s.location,200)||"-", notes:str_(s.notes,500)||"-",
    creatorId:s.creatorId, creatorName:str_(s.creatorName,100), creatorRole:role,
    active:boolOf_(s.active),
    createdAt:(typeof s.createdAt==="string" && ISO_RE.test(s.createdAt))?s.createdAt:new Date().toISOString(),
    token:token,
    geoEnabled:geoEnabled,
    geoLat:geoEnabled?numOrNull_(s.geoLat,-90,90):null,
    geoLng:geoEnabled?numOrNull_(s.geoLng,-180,180):null,
    geoRadius:geoEnabled?numOrNull_(s.geoRadius,1,5000):null,
    expireMinutes:numOrNull_(s.expireMinutes,1,1440),
    attendanceSubmitted:boolOf_(s.attendanceSubmitted),
    attendanceSubmittedAt:(typeof s.attendanceSubmittedAt==="string" && ISO_RE.test(s.attendanceSubmittedAt))?s.attendanceSubmittedAt:null,
    attendanceSubmittedBy:idOk_(s.attendanceSubmittedBy)?s.attendanceSubmittedBy:null,
    attendanceSubmittedByName:str_(s.attendanceSubmittedByName,100)
  };
}

function sanitizeAttendance_(a){
  if(!a || !idOk_(a.id) || !idOk_(a.sessionId) || !idOk_(a.userId)) return null;
  if(!DATE_RE.test(String(a.date)) || ATT_STATUS.indexOf(String(a.status))<0) return null;
  if(!LABEL_RE.test(String(a.activity||""))) return null;
  const division=String(a.division||"-");
  if(division!=="-" && !LABEL_RE.test(division)) return null;
  if(!idOk_(a.creatorId) || ["HRD","KOOR KP"].indexOf(String(a.creatorRole))<0) return null;
  const token=a.token ? String(a.token) : null;
  return {
    id:a.id, sessionId:a.sessionId, token:(token && TOKEN_RE.test(token))?token:null,
    userId:a.userId, userName:str_(a.userName,100), username:str_(a.username,64),
    activity:String(a.activity), division:division, date:String(a.date),
    checkIn:(typeof a.checkIn==="string" && ISO_RE.test(a.checkIn))?a.checkIn:null,
    status:String(a.status), creatorId:a.creatorId, creatorRole:String(a.creatorRole),
    lat:numOrNull_(a.lat,-90,90), lng:numOrNull_(a.lng,-180,180),
    photo:drivePhotoOrNull_(a.photo),
    permitId:idOk_(a.permitId)?a.permitId:null,
    approvedFromPermit:boolOf_(a.approvedFromPermit)
  };
}

function sanitizePermit_(p){
  if(!p || !idOk_(p.id) || !idOk_(p.sessionId) || !idOk_(p.userId)) return null;
  if(PERMIT_TYPES.indexOf(String(p.type))<0 || PERMIT_STATUS.indexOf(String(p.status))<0) return null;
  return {
    id:p.id, sessionId:p.sessionId,
    sessionActivity:str_(p.sessionActivity,40), sessionDivision:str_(p.sessionDivision,40),
    sessionDate:DATE_RE.test(String(p.sessionDate))?String(p.sessionDate):null,
    sessionLocation:str_(p.sessionLocation,200),
    sessionCreatorId:idOk_(p.sessionCreatorId)?p.sessionCreatorId:null,
    sessionCreatorRole:str_(p.sessionCreatorRole,20),
    userId:p.userId, userName:str_(p.userName,100), username:str_(p.username,64),
    type:String(p.type), reason:str_(p.reason,1000), photo:drivePhotoOrNull_(p.photo),
    status:String(p.status),
    submittedAt:(typeof p.submittedAt==="string" && ISO_RE.test(p.submittedAt))?p.submittedAt:null,
    reviewedBy:idOk_(p.reviewedBy)?p.reviewedBy:null, reviewedByName:str_(p.reviewedByName,100),
    reviewedAt:(typeof p.reviewedAt==="string" && ISO_RE.test(p.reviewedAt))?p.reviewedAt:null,
    reviewNote:str_(p.reviewNote,300)
  };
}

/* Merge dengan kebijakan kepemilikan. policy(old, clean, actor) mengembalikan record yang
   boleh ditulis, null untuk melewati record, atau melempar error jika melanggar aturan role. */
function mergeSanitized_(name,incoming,actor,sanitize,policy){
  if(!Array.isArray(incoming)) throw new Error("Format data tidak valid.");
  if(incoming.length>MAX_BATCH) throw new Error("Data terlalu banyak dalam satu permintaan.");
  const current=sheetToObjects_(name);
  const byId={}, order=[];
  current.forEach(o=>{if(o.id){byId[o.id]=o;order.push(o.id);}});
  let skipped=0;
  incoming.forEach(raw=>{
    const clean=sanitize(raw);
    if(!clean){skipped++;return;}
    const old=byId[clean.id]||null;
    const out=policy(old,clean,actor);
    if(!out){skipped++;return;}
    if(!old) order.push(out.id);
    byId[out.id]=out;
  });
  objectsToSheet_(name,order.map(id=>byId[id]));
  return skipped;
}

function sessionPolicy_(old,clean,actor){
  if(actor.role==="KOOR KP"){
    if(old && old.creatorId!==actor.id) throw new Error("Koor KP tidak dapat mengubah sesi milik orang lain.");
    if(clean.creatorId!==actor.id || clean.activity!=="Ngoprek" || clean.division!==actor.division){
      throw new Error("Koor KP hanya dapat menyimpan sesi Ngoprek miliknya.");
    }
    // Setelah submit, Koor KP masih boleh mengaktifkan/nonaktifkan QR,
    // tetapi tidak boleh mengubah detail kegiatan atau data rekap.
    if(old && old.attendanceSubmitted===true){
      const sameDetails=["activity","division","date","start","end","location","notes","creatorId","creatorName","creatorRole","token","geoEnabled","geoLat","geoLng","geoRadius","expireMinutes"]
        .every(k=>String(clean[k]??"")===String(old[k]??""));
      if(!sameDetails) throw new Error("Rekap sudah disubmit. Koor KP hanya dapat mengaktifkan/nonaktifkan QR.");
      clean=Object.assign({},old,{active:!!clean.active});
      return clean;
    }
  }
  if(old){
    clean.creatorId=old.creatorId; clean.creatorName=old.creatorName;
    clean.creatorRole=old.creatorRole; clean.token=old.token;
    clean.attendanceSubmitted=!!old.attendanceSubmitted;
    clean.attendanceSubmittedAt=old.attendanceSubmittedAt||null;
    clean.attendanceSubmittedBy=old.attendanceSubmittedBy||null;
    clean.attendanceSubmittedByName=old.attendanceSubmittedByName||null;
  }else{
    clean.creatorId=actor.id; clean.creatorName=actor.name; clean.creatorRole=actor.role;
    clean.attendanceSubmitted=false; clean.attendanceSubmittedAt=null;
    clean.attendanceSubmittedBy=null; clean.attendanceSubmittedByName=null;
  }
  return clean;
}

function attendancePolicy_(old,clean,actor){
  if(actor.role==="KOOR KP"){
    const own=r=>r.creatorId===actor.id && r.activity==="Ngoprek" && r.division===actor.division;
    if(old && !own(old)) throw new Error("Koor KP hanya dapat mengubah absensi Ngoprek miliknya.");
    if(!own(clean)) throw new Error("Koor KP hanya dapat mengubah absensi Ngoprek miliknya.");
    const sessionId=String((old&&old.sessionId)||clean.sessionId||"");
    const session=findSession_(sessionId);
    if(session && session.attendanceSubmitted===true){
      throw new Error("Rekap Ngoprek sudah disubmit ke HRD. Koor KP tidak dapat mengedit absensi lagi.");
    }
  }
  if(old){ clean.userId=old.userId; clean.sessionId=old.sessionId; }
  return clean;
}

function submitNgoprek_(actor,sessionId){
  if(actor.role!=="KOOR KP") throw new Error("Hanya Koor KP yang dapat melakukan submit rekap Ngoprek.");
  if(!idOk_(sessionId)) throw new Error("ID kegiatan tidak valid.");
  return withLock_(function(){
    const sessions=sheetToObjects_(SHEET_SESSIONS);
    const session=sessions.find(s=>s.id===sessionId);
    if(!session) throw new Error("Kegiatan/QR tidak ditemukan.");
    if(session.creatorId!==actor.id || session.activity!=="Ngoprek" || session.division!==actor.division){
      throw new Error("Anda hanya dapat submit kegiatan Ngoprek milik Anda.");
    }
    if(session.attendanceSubmitted===true) return {ok:true,session:session,alreadySubmitted:true};
    session.attendanceSubmitted=true;
    session.attendanceSubmittedAt=new Date().toISOString();
    session.attendanceSubmittedBy=actor.id;
    session.attendanceSubmittedByName=actor.name;
    objectsToSheet_(SHEET_SESSIONS,sessions);
    return {ok:true,session:session};
  });
}

function resolveQR_(actor,token){
  if(actor.role!=="STAF") throw new Error("QR absensi hanya dapat digunakan oleh STAF.");
  const clean=String(token||"").trim();
  if(!TOKEN_RE.test(clean)) throw new Error("QR absensi tidak valid.");
  const session=sheetToObjects_(SHEET_SESSIONS).find(s=>String(s.token||"")===clean);
  if(!session) throw new Error("QR absensi tidak ditemukan atau sudah tidak berlaku.");
  if(session.active!==true) throw new Error("QR absensi sudah dinonaktifkan. Minta HRD atau Koor KP mengaktifkannya kembali.");
  if(session.division && session.division!=="-" && session.division!==actor.division){
    throw new Error("QR ini khusus untuk divisi "+session.division+".");
  }
  return {ok:true,session:session};
}

/* Persetujuan izin: reviewer hanya boleh mengubah status + catatan.
   reviewedBy/At selalu diisi server dari akun yang login, bukan dari klien. */
function permitPolicy_(old,clean,actor){
  if(!old) return null; // reviewer tidak boleh membuat pengajuan baru
  if(actor.role==="KOOR KP" && old.sessionCreatorId!==actor.id){
    throw new Error("Koor KP hanya dapat mengelola pengajuan miliknya.");
  }
  if(clean.status===old.status && (clean.reviewNote||null)===(old.reviewNote||null)) return old;
  const out=Object.assign({},old);
  out.status=clean.status;
  out.reviewNote=clean.reviewNote;
  if(clean.status==="Menunggu"){
    out.reviewedBy=null; out.reviewedByName=null; out.reviewedAt=null;
  }else{
    out.reviewedBy=actor.id; out.reviewedByName=actor.name; out.reviewedAt=new Date().toISOString();
  }
  return out;
}

function settingsToObject_(){
  const sheet=getSheet_(SHEET_SETTINGS);
  const headers=HEADERS.Settings;
  if(sheet.getLastRow()<2) return {officeLat:null,officeLng:null,radius:100,geofenceEnabled:false};
  const row=sheet.getRange(2,1,1,headers.length).getValues()[0];
  const obj={};
  headers.forEach((h,i)=>obj[h]=fromCell_(h,row[i]));
  return obj;
}

function objectToSettingsSheet_(obj){ objectsToSheet_(SHEET_SETTINGS,[obj||{}]); }

/* =========================================================
PASSWORD + AUTH
========================================================= */
function hashPassword_(password){
  const bytes=Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(password),
    Utilities.Charset.UTF_8
  );
  return "sha256$"+bytes.map(b=>{
    const v=(b<0?b+256:b).toString(16);
    return v.length===1?"0"+v:v;
  }).join("");
}

function isHashedPassword_(value){
  return typeof value==="string" && /^sha256\$[0-9a-f]{64}$/i.test(value);
}

function safeUser_(u){
  if(!u)return null;
  return {
    id:u.id, name:u.name, username:u.username,
    role:u.role, division:u.division || null
  };
}

function randomPassword_(){
  const chars="ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  let out="";
  for(let i=0;i<14;i++) out+=chars.charAt(Math.floor(Math.random()*chars.length));
  return out+"7a";
}

/* Jika sheet Users kosong, buat SATU akun HRD dengan password acak.
   Password hanya muncul di Execution log Apps Script (View -> Executions). TIDAK ada akun demo. */
function seedUsers_(){
  const users=sheetToObjects_(SHEET_USERS);
  if(users.length)return users;

  const pw=randomPassword_();
  const seed=[{id:"U-"+Date.now(),name:"Admin HRD",username:"HRD001",password:hashPassword_(pw),role:"HRD",division:null}];
  objectsToSheet_(SHEET_USERS,seed);
  Logger.log("AKUN HRD AWAL DIBUAT. Username: HRD001 | Password: "+pw+" | Segera ganti setelah login.");
  return seed;
}

/* Jalankan manual dari editor bila perlu membuat ulang/reset password HRD001. */
function resetPasswordHRD001(){
  const users=sheetToObjects_(SHEET_USERS);
  const pw=randomPassword_();
  let hrd=users.find(u=>String(u.username).toLowerCase()==="hrd001");
  if(hrd){ hrd.password=hashPassword_(pw); hrd.role="HRD"; hrd.division=null; }
  else{ users.push({id:"U-"+Date.now(),name:"Admin HRD",username:"HRD001",password:hashPassword_(pw),role:"HRD",division:null}); }
  objectsToSheet_(SHEET_USERS,users);
  Logger.log("Password HRD001 direset menjadi: "+pw+" (segera ganti setelah login)");
}

/* Jalankan manual: menampilkan akun yang MASIH memakai password default 123456. */
function cekAkunPasswordDefault(){
  const weak=hashPassword_("123456");
  const list=sheetToObjects_(SHEET_USERS).filter(u=>String(u.password)===weak).map(u=>u.username+" ("+u.role+")");
  Logger.log(list.length ? "MASIH PASSWORD DEFAULT: "+list.join(", ")+" -> segera ganti!" : "Tidak ada akun dengan password 123456.");
  return list;
}

function migratePlaintextPasswords_(){
  const users=seedUsers_();
  let changed=false;
  users.forEach(u=>{
    if(u.password && !isHashedPassword_(u.password)){
      u.password=hashPassword_(u.password);
      changed=true;
    }
  });
  if(changed) objectsToSheet_(SHEET_USERS,users);
  return users;
}

function authUser_(token){
  if(!token) throw new Error("Sesi login tidak ditemukan. Silakan login kembali.");
  const raw=CacheService.getScriptCache().get("nev-auth-"+token);
  if(!raw){
    const err=new Error("Sesi login telah berakhir. Silakan login kembali.");
    err.authExpired=true;
    throw err;
  }
  const session=JSON.parse(raw);
  const users=migratePlaintextPasswords_();
  const user=users.find(u=>u.id===session.userId);
  if(!user){
    const err=new Error("Akun tidak ditemukan.");
    err.authExpired=true;
    throw err;
  }
  // Token otomatis tidak berlaku bila password akun sudah diganti.
  if(!session.pv || session.pv!==pwFingerprint_(user)){
    CacheService.getScriptCache().remove("nev-auth-"+token);
    const err=new Error("Sesi login telah berakhir. Silakan login kembali.");
    err.authExpired=true;
    throw err;
  }
  return user;
}

function pwFingerprint_(user){ return String(user.password||"").slice(7,31); }

function createAuthToken_(user){
  const token=Utilities.getUuid().replace(/-/g,"")+Utilities.getUuid().replace(/-/g,"");
  CacheService.getScriptCache().put("nev-auth-"+token,JSON.stringify({userId:user.id,pv:pwFingerprint_(user)}),21600);
  return token;
}

function requireActor_(body){
  return authUser_(body && body.authToken);
}

/* =========================================================
ACCESS FILTER
========================================================= */
function sessionsFor_(user){
  const all=sheetToObjects_(SHEET_SESSIONS);
  if(user.role==="HRD") return all;
  if(user.role==="KOOR KP"){
    return all.filter(s=>s.creatorId===user.id && s.activity==="Ngoprek" && s.division===user.division);
  }
  // STAF: hanya sesi untuk divisinya (atau umum), TANPA token QR dan koordinat geofence.
  // Token hanya diperoleh dengan memindai QR di lokasi.
  return all
    .filter(s=>!s.division || s.division==="-" || s.division===user.division)
    .map(s=>Object.assign({},s,{token:null,geoLat:null,geoLng:null,geoRadius:null}));
}

/* Baris dari susunan kolom lama (tanpa userId/sessionId) dianggap rusak dan tidak dikirim ke aplikasi. */
function validAttendance_(a){ return !!(a && a.id && a.userId && a.sessionId); }
function validPermit_(p){ return !!(p && p.id && p.userId && p.sessionId); }

function attendanceFor_(user){
  const all=sheetToObjects_(SHEET_ATTENDANCE).filter(validAttendance_);
  if(user.role==="HRD"){
    const sessions=sheetToObjects_(SHEET_SESSIONS);
    const submitted={}; sessions.forEach(s=>{submitted[s.id]=s.attendanceSubmitted===true;});
    return all.filter(a=>!(a.activity==="Ngoprek" && a.creatorRole==="KOOR KP") || submitted[a.sessionId]===true);
  }
  if(user.role==="KOOR KP"){
    return all.filter(a=>a.creatorId===user.id && a.activity==="Ngoprek" && a.division===user.division);
  }
  return all.filter(a=>a.userId===user.id);
}

function permitsFor_(user){
  const all=sheetToObjects_(SHEET_PERMITS).filter(validPermit_);
  if(user.role==="HRD") return all;
  if(user.role==="KOOR KP"){
    return all.filter(p=>p.sessionCreatorId===user.id && p.sessionActivity==="Ngoprek");
  }
  return all.filter(p=>p.userId===user.id);
}

function usersFor_(user){
  const all=sheetToObjects_(SHEET_USERS);
  if(user.role==="HRD") return all.map(safeUser_);
  if(user.role==="KOOR KP"){
    return all.filter(u=>(u.id===user.id) || (u.role==="STAF" && u.division===user.division)).map(safeUser_);
  }
  return all.filter(u=>u.id===user.id).map(safeUser_);
}

/* =========================================================
DRIVE PHOTO
========================================================= */
function getPhotoFolder_(kind){
  try{
    return DriveApp.getFolderById(FOLDER_IDS[kind]);
  }catch(err){
    const name=FALLBACK_FOLDER_NAMES[kind];
    const folders=DriveApp.getFoldersByName(name);
    return folders.hasNext()?folders.next():DriveApp.createFolder(name);
  }
}

function savePhotoToDrive_(base64DataUrl,fileNameHint,kind){
  if(!base64DataUrl)return null;
  const text=String(base64DataUrl);
  if(text.length>MAX_PHOTO_CHARS) throw new Error("Ukuran foto terlalu besar (maksimal sekitar 2 MB).");
  const match=text.match(DATA_IMG_RE);
  if(!match) throw new Error("Format foto tidak didukung. Gunakan JPEG atau PNG.");
  const mime=match[1];
  const ext=mime==="image/png"?"png":"jpg";
  const safeName=String(fileNameHint||"photo").replace(/[^a-zA-Z0-9_-]/g,"_").slice(0,80);
  const blob=Utilities.newBlob(Utilities.base64Decode(match[2]),mime,safeName+"."+ext);
  const file=getPhotoFolder_(kind).createFile(blob);
  // Bukti izin/sakit bersifat sensitif: TIDAK dibuka lewat link. Ditampilkan lewat action getPhoto (dicek per role).
  // Selfie absensi tetap berbagi lewat link agar thumbnail tampil seperti sebelumnya.
  if(kind!=="permit"){
    try{file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);}catch(err){}
  }
  return "https://drive.google.com/file/d/"+file.getId()+"/view";
}

/* Jalankan manual sekali: cabut akses link dari foto bukti izin/sakit yang sudah ada. */
function privatkanFotoIzin(){
  const files=getPhotoFolder_("permit").getFiles();
  let n=0;
  while(files.hasNext()){
    const f=files.next();
    try{ f.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE); n++; }catch(err){ Logger.log("Gagal: "+f.getName()+" "+err); }
  }
  Logger.log("Foto bukti izin dibuat privat: "+n);
}

/* Proxy foto privat: hanya untuk pihak yang berhak melihat record terkait. */
function getPhoto_(actor,data){
  const id=String(data.fileId||"");
  if(!/^[A-Za-z0-9_-]{10,100}$/.test(id)) throw new Error("ID foto tidak valid.");
  const url="https://drive.google.com/file/d/"+id+"/view";

  const permit=sheetToObjects_(SHEET_PERMITS).filter(validPermit_).find(p=>p.photo===url);
  const att=permit?null:sheetToObjects_(SHEET_ATTENDANCE).filter(validAttendance_).find(a=>a.photo===url);
  if(!permit && !att) throw new Error("Foto tidak ditemukan.");

  let allowed=false;
  if(actor.role==="HRD") allowed=true;
  else if(actor.role==="KOOR KP"){
    allowed=permit ? permit.sessionCreatorId===actor.id
                   : (att.creatorId===actor.id && att.activity==="Ngoprek" && att.division===actor.division);
  }else{
    allowed=(permit||att).userId===actor.id;
  }
  if(!allowed) throw new Error("Akses ditolak.");

  const blob=DriveApp.getFileById(id).getBlob();
  const bytes=blob.getBytes();
  if(bytes.length>4*1024*1024) throw new Error("Foto terlalu besar untuk ditampilkan.");
  return {ok:true,dataUrl:"data:"+blob.getContentType()+";base64,"+Utilities.base64Encode(bytes)};
}

function withLock_(fn){
  const lock=LockService.getScriptLock();
  lock.waitLock(30000);
  try{return fn();}finally{lock.releaseLock();}
}

function jsonResponse_(obj){
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function failResponse_(err){
  return jsonResponse_({
    ok:false,
    error:String(err && err.message || err),
    authExpired:!!(err && err.authExpired)
  });
}

/* =========================================================
GET
========================================================= */
function doGet(e){
  try{
    const action=(e.parameter && e.parameter.action)||"bootstrap";

    // Bootstrap publik hanya memberi versi. Lokasi/radius kantor baru dikirim setelah login.
    if(action==="bootstrap"){
      migratePlaintextPasswords_();
      return jsonResponse_({ok:true,version:CODE_VERSION});
    }

    // getAll via GET sudah dihentikan: token auth tidak boleh berada di URL (masuk log & riwayat browser).
    if(action==="getAll"){
      return jsonResponse_({ok:false,error:"Gunakan versi aplikasi terbaru (muat ulang halaman dengan Ctrl+Shift+R)."});
    }

    return jsonResponse_({ok:false,error:"Action tidak dikenali: "+action});
  }catch(err){
    return failResponse_(err);
  }
}

function getAllFor_(user){
  return {
    ok:true,
    version:CODE_VERSION,
    user:safeUser_(user),
    users:usersFor_(user),
    sessions:sessionsFor_(user),
    attendance:attendanceFor_(user),
    settings:settingsToObject_(),
    permits:permitsFor_(user)
  };
}

/* =========================================================
USER MANAGEMENT
========================================================= */
function createUser_(actor, data){
  if(actor.role!=="HRD" && actor.role!=="KOOR KP") throw new Error("Hanya HRD atau Koor KP yang dapat membuat akun.");

  const name=String(data.name||"").trim();
  const username=String(data.username||"").trim();
  const password=String(data.password||"");
  let role=String(data.role||"STAF").trim().toUpperCase();
  let division=String(data.division||"").trim();

  if(!name || !username || !password) throw new Error("Nama, username/NIM, dan password wajib diisi.");
  if(name.length>100) throw new Error("Nama terlalu panjang (maksimal 100 karakter).");
  if(!USERNAME_RE.test(username)) throw new Error("Username/NIM hanya boleh huruf, angka, titik, garis bawah, atau strip (3-32 karakter).");
  checkPassword_(password);

  const allowedRoles=["STAF","KOOR KP","HRD"];
  if(!allowedRoles.includes(role)) throw new Error("Role tidak valid.");
  if(division && !LABEL_RE.test(division)) throw new Error("Divisi tidak valid.");

  // HRD dapat membuat ketiga jenis akun.
  // Koor KP hanya dapat membuat STAF dan divisinya mengikuti akun Koor KP.
  if(actor.role==="KOOR KP"){
    if(role!=="STAF") throw new Error("Koor KP hanya dapat membuat akun STAF.");
    division=actor.division;
  }

  // Akun HRD tidak memiliki divisi. STAF dan KOOR KP wajib memiliki divisi.
  if(role==="HRD"){
    division=null;
  }else if(!division){
    throw new Error("Divisi wajib diisi untuk akun STAF atau KOOR KP.");
  }

  const users=sheetToObjects_(SHEET_USERS);
  if(users.some(u=>String(u.username).toLowerCase()===username.toLowerCase())){
    throw new Error("Username/NIM sudah digunakan.");
  }

  const record={
    id:"U-"+Date.now()+"-"+Math.floor(Math.random()*10000),
    name, username, password:hashPassword_(password),
    role, division
  };
  appendObject_(SHEET_USERS,record);
  return safeUser_(record);
}

function updateUser_(actor,data){
  const targetId=String(data.targetId||"");
  const users=migratePlaintextPasswords_();
  const user=users.find(u=>u.id===targetId);
  if(!user) throw new Error("Akun tidak ditemukan.");

  if(actor.role==="KOOR KP"){
    if(user.id!==actor.id && (user.role!=="STAF" || user.division!==actor.division)) throw new Error("Koor KP hanya dapat mengedit STAF di divisinya.");
  }else if(actor.role!=="HRD"){
    if(user.id!==actor.id) throw new Error("Akses ditolak.");
  }

  const oldName=user.name, oldUsername=user.username;
  if(data.name!==undefined && String(data.name).trim()){
    const nm=String(data.name).trim();
    if(nm.length>100) throw new Error("Nama terlalu panjang (maksimal 100 karakter).");
    user.name=nm;
  }

  // HRD dapat mengubah username/NIM, role, dan divisi.
  if(actor.role==="HRD"){
    if(data.username!==undefined){
      const newUsername=String(data.username).trim();
      if(!newUsername) throw new Error("Username/NIM wajib diisi.");
      if(newUsername!==user.username && !USERNAME_RE.test(newUsername)) throw new Error("Username/NIM hanya boleh huruf, angka, titik, garis bawah, atau strip (3-32 karakter).");
      const duplicate=users.some(u=>u.id!==user.id && String(u.username).toLowerCase()===newUsername.toLowerCase());
      if(duplicate) throw new Error("Username/NIM sudah digunakan oleh akun lain.");
      user.username=newUsername;
    }

    let newRole=user.role;
    if(data.role!==undefined && String(data.role).trim()) newRole=String(data.role).trim().toUpperCase();
    if(!["STAF","KOOR KP","HRD"].includes(newRole)) throw new Error("Role tidak valid.");
    if(user.id===actor.id && newRole!==user.role) throw new Error("Role akun Anda sendiri tidak dapat diubah.");
    user.role=newRole;

    if(newRole==="HRD"){
      user.division=null;
    }else{
      const newDivision=String(data.division!==undefined ? data.division : user.division || "").trim();
      if(!newDivision) throw new Error("Divisi wajib diisi untuk akun STAF atau KOOR KP.");
      if(!LABEL_RE.test(newDivision)) throw new Error("Divisi tidak valid.");
      user.division=newDivision;
    }
  }else if(actor.role==="KOOR KP"){
    // Koor KP tidak boleh memindahkan role/divisi STAF.
    // (Perbaikan bug: saat Koor mengedit akunnya SENDIRI, role & divisi tidak boleh berubah.)
    if(user.id!==actor.id){
      user.role="STAF";
      user.division=actor.division;
    }
    if(data.username!==undefined){
      const newUsername=String(data.username).trim();
      if(!newUsername) throw new Error("Username/NIM wajib diisi.");
      if(newUsername!==user.username && !USERNAME_RE.test(newUsername)) throw new Error("Username/NIM hanya boleh huruf, angka, titik, garis bawah, atau strip (3-32 karakter).");
      const duplicate=users.some(u=>u.id!==user.id && String(u.username).toLowerCase()===newUsername.toLowerCase());
      if(duplicate) throw new Error("Username/NIM sudah digunakan oleh akun lain.");
      user.username=newUsername;
    }
  }

  if(data.password){
    checkPassword_(data.password);
    user.password=hashPassword_(String(data.password)); // token login lama otomatis tidak berlaku
  }

  objectsToSheet_(SHEET_USERS,users);

  // Nama & Username/NIM tersimpan juga di riwayat absensi dan izin.
  // Disinkronkan supaya rekap/pencarian memakai data terbaru.
  if(user.name!==oldName || user.username!==oldUsername){
    syncUserIdentity_(user);
  }
  return safeUser_(user);
}

function syncUserIdentity_(user){
  [SHEET_ATTENDANCE,SHEET_PERMITS].forEach(function(name){
    const list=sheetToObjects_(name);
    let changed=false;
    list.forEach(function(r){
      if(r.userId===user.id && (r.userName!==user.name || r.username!==user.username)){
        r.userName=user.name; r.username=user.username; changed=true;
      }
    });
    if(changed) objectsToSheet_(name,list);
  });
}

function deleteUser_(actor,data){
  const id=String(data.targetId||"");
  const users=sheetToObjects_(SHEET_USERS);
  const target=users.find(u=>u.id===id);
  if(!target) throw new Error("Akun tidak ditemukan.");
  if(target.id===actor.id) throw new Error("Akun yang sedang login tidak dapat dihapus.");

  if(actor.role==="KOOR KP"){
    if(target.role!=="STAF" || target.division!==actor.division) throw new Error("Akses ditolak.");
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_USERS,users.filter(u=>u.id!==id));
  return {ok:true};
}

/* =========================================================
HAPUS DATA ABSENSI (reset)
-----------------------------------------------------------
Mengosongkan sheet Sessions, Attendance, Permits dan memindahkan
semua foto di folder Drive ke Trash (bisa dipulihkan 30 hari).
Sheet Users dan Settings TIDAK disentuh.
========================================================= */
function clearSheetRows_(name){
  const sheet=getSheet_(name);
  const last=sheet.getLastRow();
  if(last>=2){
    // Seluruh kolom dibersihkan (bukan hanya sebanyak HEADERS) supaya sisa
    // data dari susunan kolom lama ikut hilang.
    const range=sheet.getRange(2,1,last-1,Math.max(sheet.getMaxColumns(),HEADERS[name].length));
    range.clearContent();
    range.setNumberFormat("@");
  }
}

function trashFolderFiles_(kind,deadline){
  let count=0, finished=true;
  try{
    const files=getPhotoFolder_(kind).getFiles();
    while(files.hasNext()){
      if(Date.now()>deadline){ finished=false; break; }
      files.next().setTrashed(true);
      count++;
    }
  }catch(err){ console.error("Hapus foto "+kind+" gagal:",err); finished=false; }
  return {count:count,finished:finished};
}

function purgeData_(actor,data){
  if(actor.role!=="HRD") throw new Error("Hanya HRD yang dapat menghapus data absensi.");
  const opt=data||{};
  const result={ok:true,photosTrashed:0,photosFinished:true};

  if(opt.rows!==false){
    clearSheetRows_(SHEET_ATTENDANCE);
    clearSheetRows_(SHEET_PERMITS);
    clearSheetRows_(SHEET_SESSIONS);
  }

  if(opt.photos!==false){
    const deadline=Date.now()+4*60*1000; // sisakan waktu sebelum batas 6 menit Apps Script
    ["selfie","permit","presensi"].forEach(function(kind){
      const r=trashFolderFiles_(kind,deadline);
      result.photosTrashed+=r.count;
      if(!r.finished) result.photosFinished=false;
    });
  }
  return result;
}

/* CARA PALING PASTI: di editor Apps Script pilih fungsi "resetDataAbsensi" lalu klik Run.
   Pertama kali akan meminta izin Google Drive; setujui. Hasil tampil di Execution log.
   Jika foto sangat banyak dan log menyebut photosFinished=false, jalankan sekali lagi. */
function resetDataAbsensi(){
  const fakeHrd={role:"HRD"};
  const r=withLock_(function(){ return purgeData_(fakeHrd,{}); });
  Logger.log("RESET SELESAI: "+JSON.stringify(r));
  return r;
}

/* =========================================================
DELETE
========================================================= */
function deleteSession_(actor,sessionId){
  const sessions=sheetToObjects_(SHEET_SESSIONS);
  const session=sessions.find(s=>s.id===sessionId);
  if(!session) throw new Error("Kegiatan/QR tidak ditemukan.");

  if(actor.role==="KOOR KP"){
    if(session.creatorId!==actor.id || session.activity!=="Ngoprek" || session.division!==actor.division){
      throw new Error("Koor KP hanya dapat menghapus QR Ngoprek miliknya.");
    }
    if(session.attendanceSubmitted===true) throw new Error("Rekap sudah disubmit ke HRD. Koor KP tidak dapat menghapus kegiatan lagi.");
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_SESSIONS,sessions.filter(s=>s.id!==sessionId));
  objectsToSheet_(SHEET_ATTENDANCE,sheetToObjects_(SHEET_ATTENDANCE).filter(a=>a.sessionId!==sessionId));
  objectsToSheet_(SHEET_PERMITS,sheetToObjects_(SHEET_PERMITS).filter(p=>p.sessionId!==sessionId));
  return {ok:true};
}

function deleteAttendance_(actor,id){
  const list=sheetToObjects_(SHEET_ATTENDANCE);
  const rec=list.find(a=>a.id===id);
  if(!rec) throw new Error("Data absensi tidak ditemukan.");

  if(actor.role==="KOOR KP"){
    if(rec.creatorId!==actor.id || rec.activity!=="Ngoprek" || rec.division!==actor.division){
      throw new Error("Koor KP hanya dapat menghapus absensi Ngoprek miliknya.");
    }
    const session=findSession_(rec.sessionId);
    if(session && session.attendanceSubmitted===true) throw new Error("Rekap sudah disubmit ke HRD. Koor KP tidak dapat menghapus absensi lagi.");
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_ATTENDANCE,list.filter(a=>a.id!==id));
  return {ok:true};
}

/* =========================================================
ABSENSI & IZIN OLEH STAF (divalidasi penuh di server)
========================================================= */
function findSession_(sessionId){
  return sheetToObjects_(SHEET_SESSIONS).find(s=>s.id===sessionId) || null;
}

function targetGeo_(session){
  if(session.geoEnabled && session.geoLat!=null && session.geoLng!=null){
    return {lat:session.geoLat,lng:session.geoLng,radius:session.geoRadius||100,label:"lokasi kegiatan"};
  }
  const st=settingsToObject_();
  if(st.geofenceEnabled && st.officeLat!=null && st.officeLng!=null){
    return {lat:st.officeLat,lng:st.officeLng,radius:st.radius||100,label:"lokasi kantor"};
  }
  return null;
}

function addAttendance_(actor,data){
  if(actor.role!=="STAF") throw new Error("Hanya STAF yang dapat mengirim absensi dirinya sendiri.");
  if(!data || !idOk_(data.sessionId)) throw new Error("Data absensi tidak valid.");

  const session=findSession_(data.sessionId);
  if(!session) throw new Error("Kegiatan tidak ditemukan di server. Minta HRD/Koor memastikan QR sudah tersinkron.");
  if(session.active!==true) throw new Error("Kegiatan ini sudah dinonaktifkan.");
  if(!data.token || String(data.token)!==String(session.token)) throw new Error("Token QR tidak cocok. Pindai ulang QR kegiatan.");
  if(session.division && session.division!=="-" && session.division!==actor.division){
    throw new Error("Kegiatan ini untuk divisi "+session.division+".");
  }

  // Waktu memakai jam SERVER (WIB), bukan jam perangkat.
  const now=nowWIB_();
  if(now.date!==session.date) throw new Error("QR belum atau sudah melewati tanggal kegiatan.");
  const nowMin=minutesOf_(now.time);
  const startMin=minutesOf_(session.start), endMin=minutesOf_(session.end);
  const openMin=Math.max(0,startMin-15);
  const expire=Number(session.expireMinutes);
  const expireAt=(isFinite(expire) && expire>0) ? startMin+expire : null;
  const limitedByExpiry=(expireAt!==null && expireAt<endMin);
  // Jika masa berlaku QR diatur lebih singkat dari durasi kegiatan, batasnya ketat (tanpa toleransi).
  const deadlineMin=limitedByExpiry ? expireAt : endMin+CHECKIN_GRACE_MIN;
  if(nowMin<openMin) throw new Error("Absensi baru dapat dilakukan 15 menit sebelum jam mulai ("+minutesToHHMM_(openMin)+").");
  if(nowMin>deadlineMin){
    if(limitedByExpiry) throw new Error("QR sudah kadaluwarsa (batas pukul "+minutesToHHMM_(expireAt)+").");
    throw new Error("Absensi hanya dapat dilakukan pukul "+session.start+" - "+session.end+".");
  }

  // Geofence dipaksa di server berdasarkan konfigurasi sesi/kantor yang tersimpan.
  const lat=numOrNull_(data.lat,-90,90), lng=numOrNull_(data.lng,-180,180);
  const target=targetGeo_(session);
  if(target){
    if(lat===null || lng===null) throw new Error("Lokasi perangkat tidak terbaca. Aktifkan GPS lalu coba lagi.");
    const dist=distanceMeters_(lat,lng,target.lat,target.lng);
    if(dist>target.radius) throw new Error("Anda berada di luar radius "+target.label+" ("+Math.round(dist)+" m dari titik, batas "+target.radius+" m).");
  }

  let photoUrl=null;
  if(data.photo){
    photoUrl=savePhotoToDrive_(data.photo,(actor.username||"user")+"_"+session.date+"_"+Date.now(),"selfie");
  }

  return withLock_(function(){
    const dup=sheetToObjects_(SHEET_ATTENDANCE).filter(validAttendance_)
      .find(r=>r.sessionId===session.id && r.userId===actor.id);
    if(dup) return {ok:true,record:dup,duplicate:true};

    // Semua field penting diisi dari server/sesi, bukan dari klien.
    const record={
      id:newId_("ATT"), sessionId:session.id, token:session.token,
      userId:actor.id, userName:actor.name, username:actor.username,
      activity:session.activity, division:session.division, date:session.date,
      checkIn:now.iso, status:"Hadir",
      creatorId:session.creatorId, creatorRole:session.creatorRole,
      lat:lat, lng:lng, photo:photoUrl, permitId:null, approvedFromPermit:false
    };
    appendObject_(SHEET_ATTENDANCE,record);
    return {ok:true,record:record};
  });
}

function addPermit_(actor,data){
  if(actor.role!=="STAF") throw new Error("Akses ditolak.");
  if(!data || !idOk_(data.sessionId)) throw new Error("Data pengajuan tidak valid.");
  const type=String(data.type||"");
  if(PERMIT_TYPES.indexOf(type)<0) throw new Error("Jenis pengajuan harus Izin, Sakit, atau Dispen.");
  const reason=str_(data.reason,1000);
  if(!reason) throw new Error("Alasan wajib diisi.");

  const session=findSession_(data.sessionId);
  if(!session) throw new Error("Kegiatan tidak ditemukan di server.");
  if(session.division && session.division!=="-" && session.division!==actor.division){
    throw new Error("Kegiatan ini untuk divisi "+session.division+".");
  }

  let photoUrl=null;
  if(data.photo){
    photoUrl=savePhotoToDrive_(data.photo,(actor.username||"user")+"_"+session.date+"_"+Date.now(),"permit");
  }

  return withLock_(function(){
    const dup=sheetToObjects_(SHEET_PERMITS).filter(validPermit_)
      .find(r=>r.sessionId===session.id && r.userId===actor.id && r.status!=="Ditolak");
    if(dup) return {ok:true,record:dup,duplicate:true};

    const record={
      id:newId_("PERMIT"), sessionId:session.id,
      sessionActivity:session.activity, sessionDivision:session.division,
      sessionDate:session.date, sessionLocation:session.location,
      sessionCreatorId:session.creatorId, sessionCreatorRole:session.creatorRole,
      userId:actor.id, userName:actor.name, username:actor.username,
      type:type, reason:reason, photo:photoUrl,
      status:"Menunggu", submittedAt:new Date().toISOString(),
      reviewedBy:null, reviewedByName:null, reviewedAt:null, reviewNote:null
    };
    appendObject_(SHEET_PERMITS,record);
    return {ok:true,record:record};
  });
}

/* =========================================================
POST
========================================================= */
function loginKey_(username){
  return "nev-fail-"+Utilities.base64EncodeWebSafe(String(username).toLowerCase()).slice(0,120);
}

function doPost(e){
  try{
    const raw=(e.postData && e.postData.contents) || "{}";
    if(raw.length>MAX_BODY_CHARS) throw new Error("Data yang dikirim terlalu besar.");
    const body=JSON.parse(raw);
    const action=body.action;

    // Login tidak membutuhkan auth token, tetapi dibatasi percobaannya.
    if(action==="login"){
      const username=String(body.data && body.data.username || "").trim().slice(0,64);
      const password=String(body.data && body.data.password || "").slice(0,200);
      const role=String(body.data && body.data.role || "");

      const cache=CacheService.getScriptCache();
      const key=loginKey_(username);
      const fails=Number(cache.get(key)||0);
      if(fails>=LOGIN_MAX_FAIL){
        return jsonResponse_({ok:false,error:"Terlalu banyak percobaan login gagal. Coba lagi dalam "+Math.round(LOGIN_LOCK_SEC/60)+" menit."});
      }

      const users=migratePlaintextPasswords_();
      const hash=hashPassword_(password);
      const user=users.find(u=>
        String(u.username).toLowerCase()===username.toLowerCase() &&
        String(u.role)===role &&
        String(u.password)===hash
      );
      if(!user){
        cache.put(key,String(fails+1),LOGIN_LOCK_SEC);
        return jsonResponse_({ok:false,error:"Username, password, atau role tidak sesuai."});
      }

      cache.remove(key);
      const authToken=createAuthToken_(user);
      return jsonResponse_({ok:true,authToken:authToken,user:safeUser_(user)});
    }

    if(action==="logout"){
      if(body.authToken) CacheService.getScriptCache().remove("nev-auth-"+String(body.authToken));
      return jsonResponse_({ok:true});
    }

    const actor=requireActor_(body);
    const data=body.data || {};

    switch(action){
      case "getAll":
        return jsonResponse_(getAllFor_(actor));

      case "getPhoto":
        return jsonResponse_(getPhoto_(actor,data));

      case "createUser":
        return jsonResponse_({ok:true,user:withLock_(()=>createUser_(actor,data))});

      case "updateUser":
        return jsonResponse_({ok:true,user:withLock_(()=>updateUser_(actor,data))});

      case "deleteUser":
        return jsonResponse_(withLock_(()=>deleteUser_(actor,data)));

      case "purgeData":
        return jsonResponse_(withLock_(()=>purgeData_(actor,data)));

      case "deleteSession":
        return jsonResponse_(withLock_(()=>deleteSession_(actor,String(data.sessionId||""))));

      case "deleteAttendance":
        return jsonResponse_(withLock_(()=>deleteAttendance_(actor,String(data.attendanceId||""))));

      case "resolveQR":
        return jsonResponse_(resolveQR_(actor,String(data.token||"")));

      case "submitNgoprek":
        return jsonResponse_(submitNgoprek_(actor,String(data.sessionId||"")));

      case "saveSessions":{
        if(actor.role==="STAF") throw new Error("STAF tidak dapat mengubah sesi.");
        const skipped=withLock_(()=>mergeSanitized_(SHEET_SESSIONS,data,actor,sanitizeSession_,sessionPolicy_));
        return jsonResponse_({ok:true,skipped:skipped});
      }

      case "saveSettings":{
        if(actor.role!=="HRD") throw new Error("Hanya HRD yang dapat mengubah lokasi/radius kantor.");
        const clean={
          officeLat:numOrNull_(data.officeLat,-90,90),
          officeLng:numOrNull_(data.officeLng,-180,180),
          radius:numOrNull_(data.radius,1,5000) || 100,
          geofenceEnabled:boolOf_(data.geofenceEnabled)
        };
        withLock_(()=>objectToSettingsSheet_(clean));
        return jsonResponse_({ok:true});
      }

      case "saveAttendance":{
        // STAF mengirim absensi hanya lewat addAttendance (divalidasi server). Simpan-massal diabaikan.
        if(actor.role==="STAF") return jsonResponse_({ok:true,ignored:true});
        if(actor.role!=="HRD" && actor.role!=="KOOR KP") throw new Error("Akses ditolak.");
        const skipped=withLock_(()=>mergeSanitized_(SHEET_ATTENDANCE,data,actor,sanitizeAttendance_,attendancePolicy_));
        return jsonResponse_({ok:true,skipped:skipped});
      }

      case "savePermits":{
        // STAF mengajukan izin hanya lewat addPermit. Persetujuan hanya oleh HRD/Koor.
        if(actor.role==="STAF") return jsonResponse_({ok:true,ignored:true});
        if(actor.role!=="HRD" && actor.role!=="KOOR KP") throw new Error("Akses ditolak.");
        const skipped=withLock_(()=>mergeSanitized_(SHEET_PERMITS,data,actor,sanitizePermit_,permitPolicy_));
        return jsonResponse_({ok:true,skipped:skipped});
      }

      case "addAttendance":
        return jsonResponse_(addAttendance_(actor,data));

      case "addPermit":
        return jsonResponse_(addPermit_(actor,data));

      default:
        return jsonResponse_({ok:false,error:"Action tidak dikenali: "+action});
    }
  }catch(err){
    return failResponse_(err);
  }
}
