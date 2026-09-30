/**
 * =========================================================
 * NEV ABSENKU — Backend Terpusat v3
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

const CODE_VERSION = "secure-v7.6-account-management";
const ATTENDANCE_RESET_PROPERTY = "NEV_ATTENDANCE_RESET_AT";

const SHEET_USERS = "Users";
const SHEET_SESSIONS = "Sessions";
const SHEET_ATTENDANCE = "Attendance";
const SHEET_SETTINGS = "Settings";
const SHEET_PERMITS = "Permits";

const HEADERS = {
  Users: ["id", "name", "username", "password", "role", "division"],
  Sessions: ["id", "activity", "division", "date", "start", "end", "location", "notes",
             "creatorId", "creatorName", "creatorRole", "active", "createdAt", "token",
             "geoEnabled", "geoLat", "geoLng", "geoRadius"],
  Attendance: ["id", "sessionId", "token", "userId", "userName", "username", "activity",
               "division", "date", "checkIn", "status", "creatorId", "creatorRole",
               "lat", "lng", "photo", "permitId", "approvedFromPermit"],
  Settings: ["officeLat", "officeLng", "radius", "geofenceEnabled"],
  Permits: ["id", "sessionId", "sessionActivity", "sessionDivision", "sessionDate", "sessionLocation",
            "sessionCreatorId", "sessionCreatorRole", "userId", "userName", "username",
            "type", "reason", "photo", "status", "submittedAt",
            "reviewedBy", "reviewedByName", "reviewedAt", "reviewNote"]
};

const NUMERIC_COLS = ["lat", "lng", "geoLat", "geoLng", "geoRadius", "officeLat", "officeLng", "radius"];
const BOOL_COLS = ["active", "geofenceEnabled", "geoEnabled", "approvedFromPermit"];
const DATE_COLS = ["date", "sessionDate"];
const TIME_COLS = ["start", "end"];

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

function mergeObjectsById_(name,incoming){
  const current=sheetToObjects_(name);
  const byId={}, order=[];
  current.forEach(o=>{if(o.id){byId[o.id]=o;order.push(o.id);}});
  (incoming||[]).forEach(o=>{
    if(!o||!o.id)return;
    if(!byId[o.id])order.push(o.id);
    byId[o.id]=o;
  });
  objectsToSheet_(name,order.map(id=>byId[id]));
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

function seedUsers_(){
  const users=sheetToObjects_(SHEET_USERS);
  if(users.length)return users;

  const seed=[
    {id:"U001",name:"Denis Adityan Rohmansyah",username:"24101001",password:hashPassword_("123456"),role:"STAF",division:"Networking"},
    {id:"U002",name:"Admin HRD",username:"HRD001",password:hashPassword_("123456"),role:"HRD",division:null},
    {id:"U003",name:"Koor KP NEV",username:"KOORKP001",password:hashPassword_("123456"),role:"KOOR KP",division:"Networking"},
    {id:"U004",name:"Andi Staff",username:"24101002",password:hashPassword_("123456"),role:"STAF",division:"Cyber"},
    {id:"U005",name:"Budi Staff",username:"24101003",password:hashPassword_("123456"),role:"STAF",division:"Sysadmin"}
  ];
  objectsToSheet_(SHEET_USERS,seed);
  return seed;
}

const USERS_CACHE_KEY = "nev-users-cache-v1";
const USERS_CACHE_TTL = 300; // 5 menit

function invalidateUsersCache_(){
  CacheService.getScriptCache().remove(USERS_CACHE_KEY);
}

function getUsersCached_(){
  const cache=CacheService.getScriptCache();
  const cached=cache.get(USERS_CACHE_KEY);
  if(cached){
    try{return JSON.parse(cached);}catch(e){}
  }

  const users=seedUsers_();
  let changed=false;
  users.forEach(u=>{
    if(u.password && !isHashedPassword_(u.password)){
      u.password=hashPassword_(u.password);
      changed=true;
    }
  });
  if(changed) objectsToSheet_(SHEET_USERS,users);

  cache.put(USERS_CACHE_KEY,JSON.stringify(users),USERS_CACHE_TTL);
  return users;
}

// Backward-compatible alias. Semua autentikasi sekarang memakai cache.
function migratePlaintextPasswords_(){
  return getUsersCached_();
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
  const users=getUsersCached_();
  const user=users.find(u=>u.id===session.userId);
  if(!user){
    const err=new Error("Akun tidak ditemukan.");
    err.authExpired=true;
    throw err;
  }
  return user;
}

function createAuthToken_(user){
  const token=Utilities.getUuid().replace(/-/g,"")+Utilities.getUuid().replace(/-/g,"");
  CacheService.getScriptCache().put("nev-auth-"+token,JSON.stringify({userId:user.id}),21600);
  return token;
}

function requireActor_(body){
  return authUser_(body && body.authToken);
}

/* =========================================================
ACCESS FILTER
========================================================= */
function publicSession_(s){
  if(!s) return null;
  const out={...s};
  delete out.token;
  return out;
}

function publicAttendance_(a){
  if(!a) return null;
  const out={...a};
  delete out.token;
  return out;
}

/* =========================================================
HISTORY RESET / AUTO ALPHA BOUNDARY
========================================================= */
function getAttendanceResetAt_(){
  const raw=PropertiesService.getScriptProperties().getProperty(ATTENDANCE_RESET_PROPERTY);
  const n=Number(raw||0);
  return isFinite(n) && n>0 ? n : 0;
}

function ensureAttendanceResetMarker_(){
  const props=PropertiesService.getScriptProperties();
  const current=sheetToObjects_(SHEET_ATTENDANCE);
  const existing=Number(props.getProperty(ATTENDANCE_RESET_PROPERTY)||0);
  if(current.length===0 && !existing){
    props.setProperty(ATTENDANCE_RESET_PROPERTY,String(Date.now()));
    return Date.now();
  }
  return existing;
}

function attendanceVisibleAfterReset_(a, resetAt){
  if(!resetAt) return true;
  const check=String(a && a.checkIn || "");
  const t=Date.parse(check);
  if(!isNaN(t)) return t>=resetAt;
  // Fallback untuk record lama yang tidak memiliki checkIn ISO.
  const d=String(a && a.date || "");
  const resetDate=Utilities.formatDate(new Date(resetAt),"Asia/Jakarta","yyyy-MM-dd");
  return d>=resetDate;
}

/* =========================================================
AUTO ALPHA
========================================================= */
function sessionHasEnded_(session, now){
  const d=String(session.date||"");
  const end=String(session.end||"");
  if(!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(end)) return false;
  return d < now.date || (d === now.date && end < now.time);
}

function ensureAutomaticAlpha_(){
  const now=wibNow_();
  const resetAt=ensureAttendanceResetMarker_();
  const sessions=sheetToObjects_(SHEET_SESSIONS);
  const users=sheetToObjects_(SHEET_USERS).filter(u=>u.role==="STAF");
  const attendance=sheetToObjects_(SHEET_ATTENDANCE);
  const existing=new Set(attendance.map(a=>String(a.sessionId)+"|"+String(a.userId)));
  const additions=[];

  sessions.forEach(session=>{
    // Jangan membuat Alpha dari sesi/riwayat yang dibuat sebelum history reset.
    if(resetAt){
      const created=Date.parse(String(session.createdAt||""));
      if(isNaN(created) || created < resetAt) return;
    }
    if(!sessionHasEnded_(session,now)) return;

    const eligible=users.filter(u=>
      session.division==="-" || String(u.division||"")===String(session.division||"")
    );

    eligible.forEach(user=>{
      const key=String(session.id)+"|"+String(user.id);
      if(existing.has(key)) return;

      additions.push({
        id:makeServerId_("ATT"),
        sessionId:session.id,
        token:null,
        userId:user.id,
        userName:user.name,
        username:user.username,
        activity:session.activity,
        division:session.division,
        date:session.date,
        checkIn:session.date+"T"+session.end+":00+07:00",
        status:"Alpha",
        creatorId:session.creatorId,
        creatorRole:session.creatorRole,
        lat:null,
        lng:null,
        photo:null,
        permitId:null,
        approvedFromPermit:false,
        autoAlpha:true
      });
      existing.add(key);
    });
  });

  if(additions.length){
    withLock_(()=>{
      const latest=sheetToObjects_(SHEET_ATTENDANCE);
      const latestKeys=new Set(latest.map(a=>String(a.sessionId)+"|"+String(a.userId)));
      const safeAdditions=additions.filter(a=>{
        const key=String(a.sessionId)+"|"+String(a.userId);
        if(latestKeys.has(key)) return false;
        latestKeys.add(key);
        return true;
      });
      if(safeAdditions.length) objectsToSheet_(SHEET_ATTENDANCE,latest.concat(safeAdditions));
    });
  }
  return additions.length;
}

function sessionsFor_(user){
  const all=sheetToObjects_(SHEET_SESSIONS);
  if(user.role==="HRD") return all.map(publicSession_);
  if(user.role==="KOOR KP") return all
    .filter(s=>s.activity==="Ngoprek" && s.division===user.division)
    .map(publicSession_);
  // STAF tidak perlu menerima token/QR atau seluruh database sesi.
  // Ia hanya membutuhkan sesi aktif untuk kalender/pengajuan izin.
  return all.filter(s=>s.active===true || String(s.active).toLowerCase()==="true").map(publicSession_);
}

function attendanceFor_(user){
  const resetAt=getAttendanceResetAt_();
  const all=sheetToObjects_(SHEET_ATTENDANCE).filter(a=>attendanceVisibleAfterReset_(a,resetAt));
  if(user.role==="HRD") return all.map(publicAttendance_);
  if(user.role==="KOOR KP") return all
    .filter(a=>a.activity==="Ngoprek" && a.division===user.division)
    .map(publicAttendance_);
  return all.filter(a=>a.userId===user.id).map(publicAttendance_);
}

function permitsFor_(user){
  const all=sheetToObjects_(SHEET_PERMITS);
  if(user.role==="HRD") return all;
  if(user.role==="KOOR KP") return all.filter(p=>p.sessionActivity==="Ngoprek" && p.sessionDivision===user.division);
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
  const match=String(base64DataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mime=match?match[1]:"image/jpeg";
  const raw=match?match[2]:base64DataUrl;
  const ext=(mime.split("/")[1]||"jpg").replace("jpeg","jpg");
  const safeName=String(fileNameHint||"photo").replace(/[^a-zA-Z0-9_-]/g,"_");
  const blob=Utilities.newBlob(Utilities.base64Decode(raw),mime,safeName+"."+ext);
  const file=getPhotoFolder_(kind).createFile(blob);
  try{file.setSharing(DriveApp.Access.ANYONE_WITH_LINK,DriveApp.Permission.VIEW);}catch(err){}
  return "https://drive.google.com/file/d/"+file.getId()+"/view";
}

function driveFileId_(url){
  const value=String(url||"").trim();
  let m=value.match(/[?&]id=([A-Za-z0-9_-]+)/);
  if(!m)m=value.match(/\/file\/d\/([A-Za-z0-9_-]+)/);
  return m&&m[1]?m[1]:null;
}

function canViewPhoto_(actor,fileId){
  if(actor.role==="HRD") return true;
  const att=sheetToObjects_(SHEET_ATTENDANCE).find(a=>driveFileId_(a.photo)===fileId);
  if(att){
    if(actor.role==="STAF") return String(att.userId)===String(actor.id);
    return actor.role==="KOOR KP" && att.activity==="Ngoprek" && att.division===actor.division;
  }
  const permit=sheetToObjects_(SHEET_PERMITS).find(p=>driveFileId_(p.photo)===fileId);
  if(permit){
    if(actor.role==="STAF") return String(permit.userId)===String(actor.id);
    return actor.role==="KOOR KP" && permit.sessionActivity==="Ngoprek" && permit.sessionDivision===actor.division;
  }
  return false;
}

function getPhotoData_(actor,fileId){
  if(!fileId) throw new Error("ID foto tidak ditemukan.");
  if(!canViewPhoto_(actor,fileId)) throw new Error("Akses foto ditolak.");
  let file;
  try{ file=DriveApp.getFileById(fileId); }catch(err){ throw new Error("File foto tidak ditemukan atau sudah dihapus."); }
  const blob=file.getBlob();
  const mime=blob.getContentType()||"image/jpeg";
  return {ok:true,mimeType:mime,data:Utilities.base64Encode(blob.getBytes())};
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

    if(action==="bootstrap"){
      // Hangatkan cache akun agar request login berikutnya tidak perlu membaca Sheets.
      getUsersCached_();
      return jsonResponse_({
        ok:true,
        version:CODE_VERSION,
        settings:settingsToObject_()
      });
    }

    if(action==="getSessionToken"){
      const user=authUser_(e.parameter && e.parameter.authToken);
      const sessionId=String(e.parameter && e.parameter.sessionId || "");
      const sessions=sheetToObjects_(SHEET_SESSIONS);
      const session=sessions.find(s=>s.id===sessionId);
      if(!session) throw new Error("QR/kegiatan tidak ditemukan.");
      const allowed = user.role==="HRD" ||
        (user.role==="KOOR KP" && session.activity==="Ngoprek" && session.division===user.division);
      if(!allowed) throw new Error("Akses ditolak untuk QR ini.");
      return jsonResponse_({ok:true, sessionId:session.id, token:String(session.token||"")});
    }

    if(action==="getPhoto"){
      const user=authUser_(e.parameter && e.parameter.authToken);
      const fileId=String(e.parameter && e.parameter.photoId || "");
      return jsonResponse_(getPhotoData_(user,fileId));
    }

    if(action==="getAll"){
      const user=authUser_(e.parameter && e.parameter.authToken);
      ensureAutomaticAlpha_();
      return jsonResponse_({
        ok:true,
        version:CODE_VERSION,
        user:safeUser_(user),
        users:usersFor_(user),
        sessions:sessionsFor_(user),
        attendance:attendanceFor_(user),
        settings:settingsToObject_(),
        permits:permitsFor_(user)
      });
    }

    return jsonResponse_({ok:false,error:"Action tidak dikenali: "+action});
  }catch(err){
    return failResponse_(err);
  }
}

/* =========================================================
USER MANAGEMENT
========================================================= */
function createUser_(actor, data){
  if(actor.role!=="HRD" && actor.role!=="KOOR KP") throw new Error("Hanya HRD atau Koor KP yang dapat membuat akun.");

  const name=String(data.name||"").trim();
  const username=String(data.username||"").trim();
  const password=String(data.password||"");
  const role=String(data.role||"STAF").trim().toUpperCase();
  let division=String(data.division||"").trim();

  const allowedRoles=["STAF","KOOR KP","HRD"];
  if(!allowedRoles.includes(role)) throw new Error("Role akun tidak valid.");
  if(actor.role==="KOOR KP" && role!=="STAF") throw new Error("Koor KP hanya dapat membuat akun STAF.");
  if(!name || !username || !password) throw new Error("Nama, username/NIM, dan password wajib diisi.");

  // HRD tidak terikat divisi. Akun STAF dan KOOR KP wajib memiliki divisi.
  if(role==="HRD"){
    division=null;
  }else if(actor.role==="KOOR KP"){
    division=actor.division;
  }else if(!division){
    throw new Error("Divisi wajib diisi untuk akun STAF atau KOOR KP.");
  }

  const users=sheetToObjects_(SHEET_USERS);
  if(users.some(u=>String(u.username).toLowerCase()===username.toLowerCase())){
    throw new Error("NIM/username sudah digunakan.");
  }

  const record={
    id:"U-"+Date.now()+"-"+Math.floor(Math.random()*10000),
    name, username, password:hashPassword_(password),
    role, division
  };
  appendObject_(SHEET_USERS,record);
  invalidateUsersCache_();
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

  if(data.name!==undefined && String(data.name).trim()) user.name=String(data.name).trim();

  if(data.username!==undefined){
    const nextUsername=String(data.username).trim();
    if(!nextUsername) throw new Error("Username/NIM tidak boleh kosong.");
    if(nextUsername.toLowerCase()!==String(user.username||"").toLowerCase() &&
       users.some(u=>u.id!==user.id && String(u.username||"").toLowerCase()===nextUsername.toLowerCase())){
      throw new Error("NIM/username sudah digunakan.");
    }
    user.username=nextUsername;
  }

  if(actor.role==="HRD" && user.role!=="HRD" && data.division!==undefined){
    const nextDivision=String(data.division||"").trim();
    if(!nextDivision) throw new Error("Divisi wajib diisi untuk akun STAF atau KOOR KP.");
    user.division=nextDivision;
  }

  if(data.password) user.password=hashPassword_(String(data.password));

  objectsToSheet_(SHEET_USERS,users);
  invalidateUsersCache_();
  return safeUser_(user);
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
  invalidateUsersCache_();
  return {ok:true};
}

/* =========================================================
DELETE
========================================================= */
function deleteSession_(actor,sessionId){
  const sessions=sheetToObjects_(SHEET_SESSIONS);
  const session=sessions.find(s=>s.id===sessionId);
  if(!session) throw new Error("Kegiatan/QR tidak ditemukan.");

  if(actor.role==="KOOR KP"){
    if(session.activity!=="Ngoprek" || session.division!==actor.division){
      throw new Error("Koor KP hanya dapat menghapus QR Ngoprek miliknya.");
    }
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_SESSIONS,sessions.filter(s=>s.id!==sessionId));
  objectsToSheet_(SHEET_ATTENDANCE,sheetToObjects_(SHEET_ATTENDANCE).filter(a=>a.sessionId!==sessionId));
  objectsToSheet_(SHEET_PERMITS,sheetToObjects_(SHEET_PERMITS).filter(p=>p.sessionId!==sessionId));
  return {ok:true};
}

function deleteAttendanceBulk_(actor,ids){
  if(!Array.isArray(ids) || !ids.length) throw new Error("Tidak ada data absensi yang dipilih.");

  const wanted=new Set(ids.map(v=>String(v||"").trim()).filter(Boolean));
  if(!wanted.size) throw new Error("ID absensi tidak valid.");

  const list=sheetToObjects_(SHEET_ATTENDANCE);

  if(actor.role!=="HRD" && actor.role!=="KOOR KP") throw new Error("Akses ditolak.");

  if(actor.role==="KOOR KP") {
    const unauthorized=list.find(a=>wanted.has(String(a.id||"")) &&
      (a.activity!=="Ngoprek" || a.division!==actor.division));
    if(unauthorized) throw new Error("Koor KP hanya dapat menghapus absensi Ngoprek dari divisinya sendiri.");
  }

  const remaining=list.filter(a=>!wanted.has(String(a.id||"")));
  const removed=list.length-remaining.length;
  objectsToSheet_(SHEET_ATTENDANCE,remaining);
  return {ok:true,removed:removed};
}

function deleteAttendance_(actor,id){
  const list=sheetToObjects_(SHEET_ATTENDANCE);
  const rec=list.find(a=>a.id===id);
  if(!rec) throw new Error("Data absensi tidak ditemukan.");

  if(actor.role==="KOOR KP"){
    if(rec.activity!=="Ngoprek" || rec.division!==actor.division){
      throw new Error("Koor KP hanya dapat menghapus absensi Ngoprek miliknya.");
    }
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_ATTENDANCE,list.filter(a=>a.id!==id));
  return {ok:true};
}

/* =========================================================
SECURE ATTENDANCE / PERMIT HELPERS
========================================================= */
function isFiniteNumber_(v){ return typeof v === "number" && isFinite(v); }

function haversineMeters_(lat1,lng1,lat2,lng2){
  const R=6371000;
  const toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.min(1,Math.sqrt(a)));
}

function wibNow_(){
  const now=new Date();
  return {
    date:Utilities.formatDate(now,"Asia/Jakarta","yyyy-MM-dd"),
    time:Utilities.formatDate(now,"Asia/Jakarta","HH:mm")
  };
}

function timeInWindow_(time,start,end){
  if(!/^\d{2}:\d{2}$/.test(String(start||"")) || !/^\d{2}:\d{2}$/.test(String(end||""))) return false;
  return String(time)>=String(start) && String(time)<=String(end);
}

function safePhotoValue_(photo){
  if(photo===null || photo===undefined || photo==="") return null;
  const value=String(photo).trim();
  if(/^data:image\/(jpeg|jpg|png|webp);base64,[A-Za-z0-9+/=]+$/i.test(value)) return value;
  if(/^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]+\/view(?:\?.*)?$/i.test(value)) return value;
  if(/^https:\/\/drive\.google\.com\/thumbnail\?id=[A-Za-z0-9_-]+(?:&.*)?$/i.test(value)) return value;
  throw new Error("Foto tidak valid.");
}

function makeServerId_(prefix){ return prefix+"-"+Date.now()+"-"+Utilities.getUuid().slice(0,8); }

function validateSessionForAttendance_(actor,data){
  const sessionId=String(data.sessionId||"");
  const suppliedToken=String(data.token||"").trim();
  if(!sessionId || !suppliedToken) throw new Error("Sesi absensi atau token QR tidak lengkap.");

  const session=sheetToObjects_(SHEET_SESSIONS).find(s=>String(s.id)===sessionId);
  if(!session) throw new Error("Kegiatan/QR tidak ditemukan.");
  if(!session.active) throw new Error("QR/kegiatan sudah tidak aktif.");
  if(String(session.token||"")!==suppliedToken) throw new Error("Token QR tidak valid atau sudah diubah.");

  const now=wibNow_();
  if(String(session.date)!==now.date) throw new Error("Absensi hanya dapat dilakukan pada tanggal kegiatan.");
  if(!timeInWindow_(now.time,session.start,session.end)) throw new Error("Absensi dilakukan di luar jam kegiatan.");

  const lat=Number(data.lat), lng=Number(data.lng);
  if(session.geoEnabled){
    if(!isFiniteNumber_(lat) || !isFiniteNumber_(lng)) throw new Error("Lokasi wajib dikirim untuk kegiatan ini.");
    if(!isFiniteNumber_(Number(session.geoLat)) || !isFiniteNumber_(Number(session.geoLng)) || !isFiniteNumber_(Number(session.geoRadius))){
      throw new Error("Konfigurasi geofence kegiatan tidak valid.");
    }
    const distance=haversineMeters_(lat,lng,Number(session.geoLat),Number(session.geoLng));
    if(distance>Number(session.geoRadius)) throw new Error("Anda berada di luar radius geofence kegiatan.");
  }
  return session;
}

function addAttendanceSecure_(actor,data){
  if(actor.role!=="STAF" || String(data.userId||"")!==String(actor.id)) throw new Error("Hanya STAF yang dapat mengirim absensinya sendiri.");
  const session=validateSessionForAttendance_(actor,data);
  const existing=sheetToObjects_(SHEET_ATTENDANCE).find(a=>String(a.sessionId)===String(session.id) && String(a.userId)===String(actor.id));
  if(existing) return {ok:true,record:publicAttendance_(existing),duplicate:true};

  const photo=safePhotoValue_(data.photo);
  const record={
    id:makeServerId_("ATT"), sessionId:session.id, token:session.token,
    userId:actor.id, userName:actor.name, username:actor.username,
    activity:session.activity, division:session.division, date:session.date,
    checkIn:new Date().toISOString(), status:"Hadir",
    creatorId:session.creatorId, creatorRole:session.creatorRole,
    lat:isFiniteNumber_(Number(data.lat)) ? Number(data.lat) : null,
    lng:isFiniteNumber_(Number(data.lng)) ? Number(data.lng) : null,
    photo:null, permitId:null, approvedFromPermit:false
  };
  if(photo) record.photo=savePhotoToDrive_(photo,actor.username+"_"+session.date+"_"+record.id,"selfie");
  appendObject_(SHEET_ATTENDANCE,record);
  return {ok:true,record:publicAttendance_(record)};
}

function addPermitSecure_(actor,data){
  if(actor.role!=="STAF" || String(data.userId||"")!==String(actor.id)) throw new Error("Akses ditolak.");
  const sessionId=String(data.sessionId||"");
  const session=sheetToObjects_(SHEET_SESSIONS).find(s=>String(s.id)===sessionId);
  if(!session) throw new Error("Kegiatan tidak ditemukan.");
  if(String(session.date)!==wibNow_().date) throw new Error("Pengajuan izin/sakit hanya dapat dibuat untuk kegiatan hari ini.");
  if(session.division!=="-" && String(actor.division||"")!==String(session.division)) throw new Error("Anda bukan anggota divisi kegiatan ini.");
  if(String(data.sessionActivity||session.activity)!==String(session.activity) || String(data.sessionDivision||session.division)!==String(session.division)) throw new Error("Data kegiatan tidak valid.");
  const type=String(data.type||"");
  if(type!=="Izin" && type!=="Sakit") throw new Error("Jenis pengajuan tidak valid.");
  const reason=String(data.reason||"").trim();
  if(!reason) throw new Error("Alasan wajib diisi.");
  const photo=safePhotoValue_(data.photo);
  if(!photo) throw new Error("Bukti foto wajib dilampirkan.");

  const existing=sheetToObjects_(SHEET_PERMITS).find(p=>String(p.sessionId)===sessionId && String(p.userId)===String(actor.id) && String(p.status)!=="Ditolak");
  if(existing) return {ok:true,record:existing,duplicate:true};

  const record={
    id:makeServerId_("PERMIT"), sessionId:session.id, sessionActivity:session.activity,
    sessionDivision:session.division, sessionDate:session.date, sessionLocation:session.location,
    sessionCreatorId:session.creatorId, sessionCreatorRole:session.creatorRole,
    userId:actor.id, userName:actor.name, username:actor.username,
    type, reason, photo:null, status:"Menunggu", submittedAt:new Date().toISOString(),
    reviewedBy:null, reviewedByName:null, reviewedAt:null, reviewNote:null
  };
  record.photo=savePhotoToDrive_(photo,actor.username+"_"+session.date+"_"+record.id,"permit");
  appendObject_(SHEET_PERMITS,record);
  return {ok:true,record:record};
}

function canReviewPermit_(actor,permit){
  if(actor.role==="HRD") return true;
  return actor.role==="KOOR KP" && permit.sessionActivity==="Ngoprek" && permit.sessionDivision===actor.division;
}

function reviewPermitSecure_(actor,data){
  const permitId=String(data.permitId||"");
  const decision=String(data.decision||"");
  if(decision!=="Disetujui" && decision!=="Ditolak") throw new Error("Keputusan tidak valid.");
  const permits=sheetToObjects_(SHEET_PERMITS);
  const permit=permits.find(p=>String(p.id)===permitId);
  if(!permit) throw new Error("Pengajuan tidak ditemukan.");
  if(!canReviewPermit_(actor,permit)) throw new Error("Akses ditolak.");
  if(permit.status!=="Menunggu"){
    if(permit.status===decision) return {ok:true,permit:permit,attendance:null,duplicate:true};
    throw new Error("Pengajuan ini sudah diproses.");
  }

  permit.status=decision;
  permit.reviewedBy=actor.id;
  permit.reviewedByName=actor.name;
  permit.reviewedAt=new Date().toISOString();
  permit.reviewNote=String(data.reviewNote||"").trim() || null;
  objectsToSheet_(SHEET_PERMITS,permits);

  let attendance=null;
  if(decision==="Disetujui"){
    const list=sheetToObjects_(SHEET_ATTENDANCE);
    attendance=list.find(a=>String(a.sessionId)===String(permit.sessionId) && String(a.userId)===String(permit.userId));
    if(attendance){
      attendance.status=permit.type;
      attendance.photo=permit.photo;
      attendance.permitId=permit.id;
      attendance.approvedFromPermit=true;
    }else{
      attendance={
        id:makeServerId_("ATT"), sessionId:permit.sessionId, token:null,
        userId:permit.userId, userName:permit.userName, username:permit.username,
        activity:permit.sessionActivity, division:permit.sessionDivision, date:permit.sessionDate,
        checkIn:permit.submittedAt, status:permit.type,
        creatorId:permit.sessionCreatorId, creatorRole:permit.sessionCreatorRole,
        lat:null,lng:null,photo:permit.photo,permitId:permit.id,approvedFromPermit:true
      };
      list.push(attendance);
    }
    objectsToSheet_(SHEET_ATTENDANCE,list);
  }
  return {ok:true,permit:permit,attendance:attendance?publicAttendance_(attendance):null};
}

function mergeAuthorizedAttendance_(actor,incoming){
  if(actor.role==="STAF") throw new Error("STAF tidak dapat mengubah absensi melalui sinkronisasi umum.");
  const current=sheetToObjects_(SHEET_ATTENDANCE);
  const sessions=sheetToObjects_(SHEET_SESSIONS);
  const users=sheetToObjects_(SHEET_USERS);
  const byId={}; current.forEach(r=>{if(r.id)byId[r.id]=r;});
  (incoming||[]).forEach(raw=>{
    if(!raw) return;
    const status=String(raw.status||"");
    if(["Hadir","Izin","Sakit","Alpha"].indexOf(status)<0) throw new Error("Status absensi tidak valid.");
    const old=raw.id ? byId[raw.id] : null;
    if(old){
      if(actor.role==="KOOR KP" && !(old.activity==="Ngoprek" && old.division===actor.division)) throw new Error("Koor KP tidak dapat mengubah absensi di luar divisinya.");
      old.status=status;
      byId[old.id]=old;
      return;
    }

    const session=sessions.find(s=>String(s.id)===String(raw.sessionId));
    const user=users.find(u=>String(u.id)===String(raw.userId) && u.role==="STAF");
    if(!session || !user) throw new Error("Sesi atau staf untuk absensi manual tidak ditemukan.");
    if(actor.role==="KOOR KP" && !(session.activity==="Ngoprek" && session.division===actor.division)) throw new Error("Koor KP hanya dapat menambah absensi Ngoprek miliknya.");
    if(session.division!=="-" && String(user.division||"")!==String(session.division)) throw new Error("Staf bukan anggota divisi kegiatan.");

    const duplicate=current.find(a=>String(a.sessionId)===String(session.id) && String(a.userId)===String(user.id));
    if(duplicate){ duplicate.status=status; byId[duplicate.id]=duplicate; return; }

    const record={
      id:makeServerId_("ATT"), sessionId:session.id, token:null,
      userId:user.id, userName:user.name, username:user.username,
      activity:session.activity, division:session.division, date:session.date,
      checkIn:new Date().toISOString(), status,
      creatorId:session.creatorId, creatorRole:session.creatorRole,
      lat:null,lng:null,photo:null,permitId:null,approvedFromPermit:false,
      markedManuallyBy:actor.id
    };
    byId[record.id]=record;
  });
  withLock_(()=>objectsToSheet_(SHEET_ATTENDANCE,Object.values(byId)));
}

/* =========================================================
POST
========================================================= */
function doPost(e){
  try{
    const body=JSON.parse(e.postData.contents||"{}");
    const action=body.action;

    // Login tidak membutuhkan auth token.
    if(action==="login"){
      const username=String(body.data && body.data.username || "").trim();
      const password=String(body.data && body.data.password || "");
      const role=String(body.data && body.data.role || "");

      const users=getUsersCached_();
      const hash=hashPassword_(password);
      const user=users.find(u=>
        String(u.username).toLowerCase()===username.toLowerCase() &&
        String(u.role)===role &&
        String(u.password)===hash
      );
      if(!user) return jsonResponse_({ok:false,error:"Username, password, atau role tidak sesuai."});

      const authToken=createAuthToken_(user);
      return jsonResponse_({ok:true,authToken:authToken,user:safeUser_(user)});
    }

    const actor=requireActor_(body);
    const data=body.data || {};

    switch(action){
      case "createUser":
        return jsonResponse_({ok:true,user:withLock_(()=>createUser_(actor,data))});

      case "updateUser":
        return jsonResponse_({ok:true,user:withLock_(()=>updateUser_(actor,data))});

      case "deleteUser":
        return jsonResponse_(withLock_(()=>deleteUser_(actor,data)));

      case "deleteSession":
        return jsonResponse_(withLock_(()=>deleteSession_(actor,String(data.sessionId||""))));

      case "resetAttendanceHistory":{
        if(actor.role!=="HRD") throw new Error("Hanya HRD yang dapat menghapus seluruh riwayat absensi.");
        return jsonResponse_(withLock_(()=>{
          objectsToSheet_(SHEET_ATTENDANCE,[]);
          PropertiesService.getScriptProperties().setProperty(ATTENDANCE_RESET_PROPERTY,String(Date.now()));
          return {ok:true,resetAt:Date.now()};
        }));
      }

      case "deleteAttendance":
        return jsonResponse_(withLock_(()=>deleteAttendance_(actor,String(data.attendanceId||""))));

      case "deleteAttendanceBulk":
        return jsonResponse_(withLock_(()=>deleteAttendanceBulk_(actor,data.attendanceIds||[])));

      case "saveSessions":{
        if(actor.role==="STAF") throw new Error("STAF tidak dapat mengubah sesi.");
        const incoming=data;
        if(actor.role==="KOOR KP"){
          incoming.forEach(s=>{
            if(s.activity!=="Ngoprek" || s.division!==actor.division){
              throw new Error("Koor KP hanya dapat menyimpan sesi Ngoprek miliknya.");
            }
          });
        }
        withLock_(()=>mergeObjectsById_(SHEET_SESSIONS,incoming));
        return jsonResponse_({ok:true});
      }

      case "saveSettings":
        if(actor.role!=="HRD") throw new Error("Hanya HRD yang dapat mengubah lokasi/radius kantor.");
        withLock_(()=>objectToSettingsSheet_(data));
        return jsonResponse_({ok:true});

      case "saveAttendance":
        mergeAuthorizedAttendance_(actor,data);
        return jsonResponse_({ok:true});

      case "savePermits":
        throw new Error("Pengajuan izin/sakit harus dibuat melalui endpoint resmi.");

      case "addAttendance":
        return jsonResponse_(withLock_(()=>addAttendanceSecure_(actor,data)));

      case "addPermit":
        return jsonResponse_(withLock_(()=>addPermitSecure_(actor,data)));

      case "reviewPermit":
        return jsonResponse_(withLock_(()=>reviewPermitSecure_(actor,data)));

      default:
        return jsonResponse_({ok:false,error:"Action tidak dikenali: "+action});
    }
  }catch(err){
    return failResponse_(err);
  }
}
