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

const CODE_VERSION = "secure-v4";

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
    if(name===SHEET_SESSIONS && byId[o.id] && byId[o.id].token && !o.token){
      o.token=byId[o.id].token;
    }
    if(name===SHEET_ATTENDANCE && byId[o.id] && byId[o.id].token && !o.token){
      o.token=byId[o.id].token;
    }
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

// DATA SENSITIF TIDAK PERNAH DIKIRIM PADA GETALL.
// Token QR adalah credential yang memungkinkan absensi, sehingga hanya
// diberikan lewat action getSessionToken setelah otorisasi di server.
function safeSession_(s){
  if(!s)return null;
  const out=Object.assign({},s);
  delete out.token;
  return out;
}

function safeAttendance_(a){
  if(!a)return null;
  const out=Object.assign({},a);
  delete out.token;
  return out;
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
function sessionsFor_(user){
  const all=sheetToObjects_(SHEET_SESSIONS);
  if(user.role==="HRD") return all.map(safeSession_);
  if(user.role==="KOOR KP"){
    return all
      .filter(s=>s.creatorId===user.id && s.activity==="Ngoprek" && s.division===user.division)
      .map(safeSession_);
  }
  // STAF tetap menerima metadata sesi untuk menu kegiatan/izin, tetapi
  // token QR tidak pernah ikut dalam response. Token dibaca dari QR yang
  // dipindai atau diminta hanya oleh pembuat QR yang berwenang.
  return all.map(safeSession_);
}

function attendanceFor_(user){
  const all=sheetToObjects_(SHEET_ATTENDANCE);
  if(user.role==="HRD") return all.map(safeAttendance_);
  if(user.role==="KOOR KP"){
    return all
      .filter(a=>a.creatorId===user.id && a.activity==="Ngoprek" && a.division===user.division)
      .map(safeAttendance_);
  }
  return all.filter(a=>a.userId===user.id).map(safeAttendance_);
}

function permitsFor_(user){
  const all=sheetToObjects_(SHEET_PERMITS);
  if(user.role==="HRD") return all;
  if(user.role==="KOOR KP"){
    return all.filter(p=>p.sessionCreatorId===user.id && p.sessionActivity==="Ngoprek" && p.sessionDivision===user.division);
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
      migratePlaintextPasswords_();
      return jsonResponse_({
        ok:true,
        version:CODE_VERSION,
        settings:settingsToObject_()
      });
    }

    if(action==="getSessionToken"){
      const user=authUser_(e.parameter && e.parameter.authToken);
      const sessionId=String(e.parameter && e.parameter.sessionId || "");
      const session=sheetToObjects_(SHEET_SESSIONS).find(s=>s.id===sessionId);
      if(!session) throw new Error("Sesi/QR tidak ditemukan.");
      if(user.role==="HRD"){
        return jsonResponse_({ok:true, sessionId:session.id, token:session.token});
      }
      if(user.role==="KOOR KP" && session.creatorId===user.id && session.activity==="Ngoprek" && session.division===user.division){
        return jsonResponse_({ok:true, sessionId:session.id, token:session.token});
      }
      throw new Error("Akses ditolak untuk token QR ini.");
    }

    if(action==="getAll"){
      const user=authUser_(e.parameter && e.parameter.authToken);
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
  let division=String(data.division||"").trim();

  if(!name || !username || !password || !division) throw new Error("Nama, NIM, password, dan divisi wajib diisi.");
  if(actor.role==="KOOR KP") division=actor.division;
  if(!division) throw new Error("Divisi wajib diisi.");
  if(data.role && data.role!=="STAF") throw new Error("Akun yang dibuat melalui menu ini hanya boleh STAF.");

  const users=sheetToObjects_(SHEET_USERS);
  if(users.some(u=>String(u.username).toLowerCase()===username.toLowerCase())){
    throw new Error("NIM/username sudah digunakan.");
  }

  const record={
    id:"U-"+Date.now()+"-"+Math.floor(Math.random()*10000),
    name, username, password:hashPassword_(password),
    role:"STAF", division
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

  if(data.name!==undefined && String(data.name).trim()) user.name=String(data.name).trim();
  if(actor.role==="HRD" && user.role==="STAF" && data.division) user.division=String(data.division).trim();
  if(data.password) user.password=hashPassword_(String(data.password));

  objectsToSheet_(SHEET_USERS,users);
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
    if(session.creatorId!==actor.id || session.activity!=="Ngoprek" || session.division!==actor.division){
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

function deleteAttendance_(actor,id){
  const list=sheetToObjects_(SHEET_ATTENDANCE);
  const rec=list.find(a=>a.id===id);
  if(!rec) throw new Error("Data absensi tidak ditemukan.");

  if(actor.role==="KOOR KP"){
    if(rec.creatorId!==actor.id || rec.activity!=="Ngoprek" || rec.division!==actor.division){
      throw new Error("Koor KP hanya dapat menghapus absensi Ngoprek miliknya.");
    }
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_ATTENDANCE,list.filter(a=>a.id!==id));
  return {ok:true};
}

/* =========================================================
ATTENDANCE / PERMIT HELPERS
========================================================= */
function addRecord_(sheetName,record,photoKind,isDuplicate,actor){
  const existing=sheetToObjects_(sheetName).filter(isDuplicate)[0];
  if(existing)return {ok:true,record:existing,duplicate:true};

  if(record.photo && String(record.photo).indexOf("data:")===0){
    record.photo=savePhotoToDrive_(
      record.photo,
      (record.username||"user")+"_"+(record.date||record.sessionDate||"")+"_"+(record.id||Date.now()),
      photoKind
    );
  }

  return withLock_(function(){
    const again=sheetToObjects_(sheetName).filter(isDuplicate)[0];
    if(again)return {ok:true,record:again,duplicate:true};
    appendObject_(sheetName,record);
    return {ok:true,record:record};
  });
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

      const users=migratePlaintextPasswords_();
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

      case "deleteAttendance":
        return jsonResponse_(withLock_(()=>deleteAttendance_(actor,String(data.attendanceId||""))));

      case "saveSessions":{
        if(actor.role==="STAF") throw new Error("STAF tidak dapat mengubah sesi.");
        const incoming=data;
        if(actor.role==="KOOR KP"){
          incoming.forEach(s=>{
            if(s.creatorId!==actor.id || s.activity!=="Ngoprek" || s.division!==actor.division){
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

      case "saveAttendance":{
        if(actor.role==="STAF"){
          if((data||[]).some(a=>a.userId!==actor.id)) throw new Error("STAF hanya dapat menyimpan absensinya sendiri.");
        }else if(actor.role==="KOOR KP"){
          if((data||[]).some(a=>a.creatorId!==actor.id || a.activity!=="Ngoprek" || a.division!==actor.division)){
            throw new Error("Koor KP hanya dapat mengubah absensi Ngoprek miliknya.");
          }
        }else if(actor.role!=="HRD"){
          throw new Error("Akses ditolak.");
        }
        withLock_(()=>mergeObjectsById_(SHEET_ATTENDANCE,data));
        return jsonResponse_({ok:true});
      }

      case "savePermits":{
        if(actor.role==="STAF"){
          if((data||[]).some(p=>p.userId!==actor.id)) throw new Error("Akses ditolak.");
        }else if(actor.role==="KOOR KP"){
          if((data||[]).some(p=>p.sessionCreatorId!==actor.id)) throw new Error("Koor KP hanya dapat mengelola pengajuan miliknya.");
        }else if(actor.role!=="HRD"){
          throw new Error("Akses ditolak.");
        }
        withLock_(()=>mergeObjectsById_(SHEET_PERMITS,data));
        return jsonResponse_({ok:true});
      }

      case "addAttendance":{
        if(actor.role!=="STAF" || data.userId!==actor.id) throw new Error("Hanya STAF yang dapat mengirim absensi dirinya sendiri.");
        return jsonResponse_(addRecord_(SHEET_ATTENDANCE,data,"selfie",
          r=>r.id===data.id || (r.sessionId===data.sessionId && r.userId===data.userId),actor));
      }

      case "addPermit":{
        if(actor.role!=="STAF" || data.userId!==actor.id) throw new Error("Akses ditolak.");
        return jsonResponse_(addRecord_(SHEET_PERMITS,data,"permit",
          r=>r.id===data.id || (r.sessionId===data.sessionId && r.userId===data.userId && r.status!=="Ditolak"),actor));
      }

      default:
        return jsonResponse_({ok:false,error:"Action tidak dikenali: "+action});
    }
  }catch(err){
    return failResponse_(err);
  }
}
