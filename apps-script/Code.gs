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

const CODE_VERSION = "secure-v5.5-security-hardening";
const EARLY_OPEN_MIN = 15; // staf boleh mulai absen 15 menit sebelum jam mulai

const SHEET_USERS = "Users";
const SHEET_SESSIONS = "Sessions";
const SHEET_ATTENDANCE = "Attendance";
const SHEET_SETTINGS = "Settings";
const SHEET_PERMITS = "Permits";
const SHEET_WARNINGS = "Warnings";
const SHEET_AUDIT_LOG = "AuditLog";
const SHEET_EVALUATIONS = "StaffEvaluations";
const SHEET_CORRECTIONS = "AttendanceCorrections";

const HEADERS = {
  Users: ["id", "name", "username", "password", "role", "division"],
  Sessions: ["id", "activity", "division", "date", "start", "end", "location", "notes",
             "creatorId", "creatorName", "creatorRole", "active", "createdAt", "token",
             "geoEnabled", "geoLat", "geoLng", "geoRadius", "expireMinutes",
             "attendanceSubmitted", "submittedAt", "submittedBy", "submittedByName"],
  Attendance: ["id", "sessionId", "token", "userId", "userName", "username", "activity",
               "division", "date", "checkIn", "status", "creatorId", "creatorRole",
               "lat", "lng", "photo", "permitId", "approvedFromPermit"],
  Settings: ["officeLat", "officeLng", "radius", "geofenceEnabled"],
  Permits: ["id", "sessionId", "sessionActivity", "sessionDivision", "sessionDate", "sessionLocation",
            "sessionCreatorId", "sessionCreatorRole", "userId", "userName", "username",
            "type", "reason", "photo", "status", "submittedAt",
            "reviewedBy", "reviewedByName", "reviewedAt", "reviewNote"],
  Warnings: ["id", "number", "level", "targetId", "targetName", "targetUsername", "targetRole",
             "targetDivision", "reason", "action", "validUntil", "issuedBy", "issuedByName",
             "issuedAt", "readAt"]
};

const NUMERIC_COLS = ["lat", "lng", "geoLat", "geoLng", "geoRadius", "expireMinutes", "officeLat", "officeLng", "radius"];
const BOOL_COLS = ["active", "geofenceEnabled", "geoEnabled", "approvedFromPermit", "attendanceSubmitted"];
const DATE_COLS = ["date", "sessionDate", "validUntil"];
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
const TOKEN_RE     = /^NEV-ABS-[A-Za-z0-9_-]{4,4000}$/;
const DRIVE_URL_RE = /^https:\/\/drive\.google\.com\/file\/d\/[A-Za-z0-9_-]{10,100}\/view$/;
const DATA_IMG_RE  = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+\/=]+)$/;

const ATT_STATUS    = ["Hadir","Izin","Sakit","Dispen","Alpha"];
const PERMIT_STATUS = ["Menunggu","Disetujui","Ditolak"];
const PERMIT_TYPES  = ["Izin","Sakit","Dispen"];
const ROLES         = ["STAF","KOOR KP","HRD"];
const WARNING_LEVELS = ["SP1","SP2","SP3"];
const ROMAN_MONTHS   = ["I","II","III","IV","V","VI","VII","VIII","IX","X","XI","XII"];

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
/* Teks beberapa baris (alasan SP): baris baru dipertahankan, karakter kontrol lain dibuang. */
function multiline_(v,max){
  if(v===undefined || v===null) return null;
  const t=String(v).replace(/\r\n?/g,"\n").replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g," ").trim().slice(0,max||1000);
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

  const headers=HEADERS[name],lastRow=sheet.getLastRow(),lastCol=sheet.getLastColumn();
  if(lastRow===0 || (lastRow===1 && lastCol===0)){sheet.getRange(1,1,1,headers.length).setNumberFormat("@").setValues([headers]);sheet.setFrozenRows(1);return sheet;}
  const current=sheet.getRange(1,1,1,Math.max(lastCol,headers.length)).getDisplayValues()[0];
  if(current.slice(0,headers.length).join("|")!==headers.join("|")||current.slice(headers.length).some(v=>String(v||"").trim()!==""))
    throw new Error("Struktur sheet '"+name+"' tidak sesuai dengan versi backend. Data tidak diubah. Periksa header dan lakukan migrasi terencana setelah backup.");
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
  if(name===SHEET_SESSIONS) _sessMapCache = null;   // daftar sesi berubah: buang cache isSubmitted/isDraft
  if(name===SHEET_USERS) invalidateUsersCache_();
  const sheet=getSheet_(name),headers=HEADERS[name],rows=(list||[]).map(obj=>headers.map(h=>toCell_(obj[h])));
  const oldLastRow=sheet.getLastRow();
  if(rows.length){ensureRows_(sheet,rows.length+1);const range=sheet.getRange(2,1,rows.length,headers.length);range.setNumberFormat("@");range.setValues(rows);
    if(oldLastRow>rows.length+1)sheet.getRange(rows.length+2,1,oldLastRow-(rows.length+1),headers.length).clearContent();
  }else if(oldLastRow>=2)sheet.getRange(2,1,oldLastRow-1,headers.length).clearContent();
  if(name===SHEET_USERS)invalidateUsersCache_();
}

function ensureRows_(sheet,needed){
  const max=sheet.getMaxRows();
  if(max<needed) sheet.insertRowsAfter(max,needed-max);
}


/* =========================================================
AUDIT LOG — sheet terpisah; tidak mengubah header sheet lama.
Tidak menyimpan password, token, isi alasan, koordinat, atau URL foto.
========================================================= */
const AUDIT_HEADERS_ = ["timestamp","actorId","actorName","actorRole","actorDivision","action","entityType","entityId","summary"];
function auditEvent_(actor,action,entityType,entityId,summary){
  try{
    const ss=SpreadsheetApp.getActiveSpreadsheet();
    let sh=ss.getSheetByName(SHEET_AUDIT_LOG);
    if(!sh){
      sh=ss.insertSheet(SHEET_AUDIT_LOG);
      sh.getRange(1,1,1,AUDIT_HEADERS_.length).setNumberFormat("@").setValues([AUDIT_HEADERS_]);
      sh.setFrozenRows(1);
    }else{
      const lastCol=sh.getLastColumn();
      const current=lastCol?sh.getRange(1,1,1,Math.max(lastCol,AUDIT_HEADERS_.length)).getDisplayValues()[0]:[];
      if(sh.getLastRow()===0 || (sh.getLastRow()===1 && lastCol===0)){
        sh.getRange(1,1,1,AUDIT_HEADERS_.length).setNumberFormat("@").setValues([AUDIT_HEADERS_]);
        sh.setFrozenRows(1);
      }else if(current.slice(0,AUDIT_HEADERS_.length).join("|")!==AUDIT_HEADERS_.join("|") || current.slice(AUDIT_HEADERS_.length).some(v=>String(v||"").trim()!=="")){
        throw new Error("Header AuditLog tidak sesuai; audit event tidak ditulis agar data tidak tertimpa.");
      }
    }
    const row=[
      new Date().toISOString(),
      actor&&actor.id||"",
      str_(actor&&actor.name,100)||"",
      str_(actor&&actor.role,20)||"",
      str_(actor&&actor.division,40)||"",
      str_(action,60)||"unknown",
      str_(entityType,40)||"",
      str_(entityId,100)||"",
      str_(summary,240)||""
    ];
    sh.appendRow(row);
  }catch(err){
    // Audit logging tidak boleh membatalkan absensi/aksi utama yang telah berhasil.
    console.error("AuditLog write failed: "+String(err&&err.message||err));
    try{Logger.log("AuditLog write failed: "+String(err&&err.message||err));}catch(ignore){}
  }
}
function getAuditLog_(actor,data){
  if(actor.role!=="HRD")throw new Error("Hanya HRD yang dapat melihat AuditLog.");
  const limit=Math.max(1,Math.min(500,Number(data&&data.limit)||100));
  const ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(SHEET_AUDIT_LOG);
  if(!sh||sh.getLastRow()<2)return {ok:true,records:[]};
  const headers=AUDIT_HEADERS_,last=sh.getLastRow(),count=Math.min(limit,last-1),start=last-count+1;
  const values=sh.getRange(start,1,count,headers.length).getDisplayValues();
  return {ok:true,records:values.reverse().map(r=>{const o={};headers.forEach((h,i)=>o[h]=r[i]);return o;})};
}

const EVALUATION_HEADERS_ = ["id","staffId","staffName","staffUsername","division","period","discipline","responsibility","teamwork","initiative","performance","average","strengths","improvement","evaluatorId","evaluatorName","evaluatorRole","createdAt"];
function evaluationSheet_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();
  let sh=ss.getSheetByName(SHEET_EVALUATIONS);
  if(!sh){sh=ss.insertSheet(SHEET_EVALUATIONS);sh.getRange(1,1,1,EVALUATION_HEADERS_.length).setValues([EVALUATION_HEADERS_]);sh.setFrozenRows(1);}
  else {const actual=sh.getRange(1,1,1,Math.max(sh.getLastColumn(),EVALUATION_HEADERS_.length)).getDisplayValues()[0];if(actual.slice(0,EVALUATION_HEADERS_.length).join("|")!==EVALUATION_HEADERS_.join("|"))throw new Error("Header StaffEvaluations tidak sesuai. Data tidak diubah.");}
  return sh;
}
function getEvaluations_(actor){
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_EVALUATIONS);
  let all=[];
  if(sh&&sh.getLastRow()>1){const vals=sh.getRange(2,1,sh.getLastRow()-1,EVALUATION_HEADERS_.length).getValues();all=vals.map(row=>{const o={};EVALUATION_HEADERS_.forEach((h,i)=>o[h]=row[i] instanceof Date?row[i].toISOString():row[i]);return o;});}
  if(actor.role==="HRD")return {ok:true,records:all};
  if(actor.role==="KOOR KP")return {ok:true,records:all.filter(x=>x.division===actor.division)};
  if(actor.role==="STAF")return {ok:true,records:all.filter(x=>x.staffId===actor.id)};
  throw new Error("Akses ditolak.");
}
function submitEvaluation_(actor,data){
  if(actor.role!=="HRD"&&actor.role!=="KOOR KP")throw new Error("Hanya HRD atau Koor KP yang dapat menilai staf.");
  const staffId=String(data.staffId||"").trim(),period=String(data.period||"").trim().slice(0,40);
  if(!staffId||!period)throw new Error("Staf dan periode penilaian wajib diisi.");
  const staff=sheetToObjects_(SHEET_USERS).find(u=>u.id===staffId&&u.role==="STAF");
  if(!staff)throw new Error("Akun staf tidak ditemukan.");
  if(actor.role==="KOOR KP"&&staff.division!==actor.division)throw new Error("Koor KP hanya dapat menilai staf di divisinya.");
  const keys=["discipline","responsibility","teamwork","initiative","performance"],scores={};
  keys.forEach(k=>{const n=Number(data[k]);if(!Number.isInteger(n)||n<1||n>5)throw new Error("Setiap nilai harus bilangan bulat 1 sampai 5.");scores[k]=n;});
  const record={id:"EV-"+Utilities.getUuid(),staffId:staff.id,staffName:staff.name,staffUsername:staff.username,division:staff.division||"",period,discipline:scores.discipline,responsibility:scores.responsibility,teamwork:scores.teamwork,initiative:scores.initiative,performance:scores.performance,average:Number((keys.reduce((s,k)=>s+scores[k],0)/keys.length).toFixed(2)),strengths:str_(data.strengths,1000),improvement:str_(data.improvement,1000),evaluatorId:actor.id,evaluatorName:actor.name,evaluatorRole:actor.role,createdAt:new Date().toISOString()};
  evaluationSheet_().appendRow(EVALUATION_HEADERS_.map(h=>record[h]===undefined?"":record[h]));
  auditEvent_(actor,"evaluation.create","staff-evaluation",record.id,"Penilaian staf "+staff.name+" periode "+period+".");
  return {ok:true,record};
}


const CORRECTION_HEADERS_=["id","attendanceId","sessionId","staffId","staffName","division","originalStatus","requestedStatus","originalCheckIn","requestedCheckIn","reason","status","submittedAt","reviewedBy","reviewedByName","reviewedAt","reviewNote"];
function correctionSheet_(){
  const ss=SpreadsheetApp.getActiveSpreadsheet();let sh=ss.getSheetByName(SHEET_CORRECTIONS);
  if(!sh){sh=ss.insertSheet(SHEET_CORRECTIONS);sh.getRange(1,1,1,CORRECTION_HEADERS_.length).setNumberFormat("@").setValues([CORRECTION_HEADERS_]);sh.setFrozenRows(1);}
  else{const n=sh.getLastColumn();const head=n?sh.getRange(1,1,1,Math.max(n,CORRECTION_HEADERS_.length)).getDisplayValues()[0]:[];if(head.slice(0,CORRECTION_HEADERS_.length).join("|")!==CORRECTION_HEADERS_.join("|"))throw new Error("Header AttendanceCorrections tidak sesuai. Data tidak diubah.");}
  return sh;
}
function correctionRows_(){
  const sh=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_CORRECTIONS);if(!sh||sh.getLastRow()<2)return[];
  return sh.getRange(2,1,sh.getLastRow()-1,CORRECTION_HEADERS_.length).getValues().map(row=>{const o={};CORRECTION_HEADERS_.forEach((k,i)=>o[k]=row[i] instanceof Date?row[i].toISOString():row[i]);return o;});
}
function getCorrectionRequests_(actor){
  const rows=correctionRows_();
  if(actor.role==="HRD")return {ok:true,records:rows};
  if(actor.role==="STAF")return {ok:true,records:rows.filter(x=>x.staffId===actor.id)};
  if(actor.role==="KOOR KP")return {ok:true,records:rows.filter(x=>x.division===actor.division)};
  throw new Error("Akses ditolak.");
}
function submitAttendanceCorrection_(actor,data){
  if(actor.role!=="STAF")throw new Error("Hanya STAF yang dapat mengajukan koreksi absensi.");
  const attendanceId=String(data.attendanceId||"").trim(),reason=str_(data.reason,500),requestedStatus=String(data.requestedStatus||"").trim(),requestedCheckIn=String(data.requestedCheckIn||"").trim();
  if(!attendanceId||reason.length<8)throw new Error("Pilih absensi dan berikan alasan minimal 8 karakter.");
  if(!["Hadir","Izin","Sakit","Dispen"].includes(requestedStatus))throw new Error("Status koreksi tidak valid.");
  if(requestedCheckIn&&!TIME_RE.test(requestedCheckIn))throw new Error("Format jam harus HH:MM.");
  return withLock_(()=>{
    const attendance=sheetToObjects_(SHEET_ATTENDANCE).find(x=>x.id===attendanceId&&x.userId===actor.id&&validAttendance_(x));
    if(!attendance)throw new Error("Data absensi tidak ditemukan atau bukan milik Anda.");
    if(correctionRows_().some(x=>x.attendanceId===attendanceId&&x.status==="Menunggu"))throw new Error("Masih ada pengajuan koreksi yang menunggu keputusan.");
    if(attendance.status===requestedStatus&&(!requestedCheckIn||attendance.checkIn===requestedCheckIn))throw new Error("Tidak ada perubahan yang diajukan.");
    const record={id:"CR-"+Utilities.getUuid(),attendanceId,sessionId:attendance.sessionId,staffId:actor.id,staffName:actor.name,division:actor.division||"",originalStatus:attendance.status,requestedStatus,originalCheckIn:attendance.checkIn||"",requestedCheckIn,reason,status:"Menunggu",submittedAt:new Date().toISOString(),reviewedBy:"",reviewedByName:"",reviewedAt:"",reviewNote:""};
    correctionSheet_().appendRow(CORRECTION_HEADERS_.map(k=>record[k]??""));
    auditEvent_(actor,"attendance.correction.submit","attendance-correction",record.id,"Pengajuan koreksi absensi dibuat.");
    return {ok:true,record};
  });
}
function reviewAttendanceCorrection_(actor,data){
  if(actor.role!=="HRD")throw new Error("Hanya HRD yang dapat memutuskan koreksi absensi.");
  const id=String(data.id||"").trim(),decision=String(data.decision||"").trim(),note=str_(data.reviewNote,500);
  if(!id||!["Disetujui","Ditolak"].includes(decision))throw new Error("Keputusan koreksi tidak valid.");
  return withLock_(()=>{
    const sh=correctionSheet_(),rows=correctionRows_(),idx=rows.findIndex(x=>x.id===id);
    if(idx<0)throw new Error("Pengajuan koreksi tidak ditemukan.");
    const req=rows[idx];if(req.status!=="Menunggu")throw new Error("Pengajuan ini sudah diproses.");
    if(decision==="Disetujui"){
      const all=sheetToObjects_(SHEET_ATTENDANCE),at=all.findIndex(x=>x.id===req.attendanceId&&x.userId===req.staffId);
      if(at<0)throw new Error("Data absensi asal sudah tidak tersedia; koreksi tidak diterapkan.");
      all[at].status=req.requestedStatus;if(req.requestedCheckIn)all[at].checkIn=req.requestedCheckIn;
      objectsToSheet_(SHEET_ATTENDANCE,all);
    }
    const row=idx+2,values={status:decision,reviewedBy:actor.id,reviewedByName:actor.name,reviewedAt:new Date().toISOString(),reviewNote:note};
    CORRECTION_HEADERS_.forEach((k,i)=>{if(Object.prototype.hasOwnProperty.call(values,k))sh.getRange(row,i+1).setValue(values[k]);});
    auditEvent_(actor,"attendance.correction."+decision.toLowerCase(),"attendance-correction",id,"Keputusan koreksi absensi: "+decision+".");
    return {ok:true,status:decision};
  });
}

function appendObject_(name,obj){
  if(name===SHEET_SESSIONS) _sessMapCache = null;
  if(name===SHEET_USERS) invalidateUsersCache_();
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
    // Status submit HANYA diubah lewat action submitSessionAttendance, bukan dari klien.
    attendanceSubmitted:false, submittedAt:null, submittedBy:null, submittedByName:null
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
  if(name===SHEET_PERMITS){
    order.forEach(id=>{
      const before=current.find(x=>x.id===id),after=byId[id];
      if(before&&after&&before.status!==after.status){
        auditEvent_(actor,"permit.review","permit",id,"Status pengajuan berubah dari "+before.status+" menjadi "+after.status+".");
      }
    });
  }
  if(incoming.length) auditEvent_(actor,"data.bulk_save",name,"","Permintaan simpan massal; record masuk: "+incoming.length+", dilewati: "+skipped+".");
  return skipped;
}

/* Cache daftar sesi selama satu eksekusi doPost (dibuang setiap kali sesi ditulis). */
let _sessMapCache = null;
function sessionMap_(){
  if(!_sessMapCache){
    const m={};
    sheetToObjects_(SHEET_SESSIONS).forEach(x=>{ if(x.id) m[x.id]=x; });
    _sessMapCache=m;
  }
  return _sessMapCache;
}
/* Sesi yang absensinya sudah di-submit Koor KP: terkunci untuk Koor, hanya HRD yang boleh ubah. */
function isSubmittedSession_(sessionId){
  const x=sessionMap_()[sessionId];
  return !!(x && x.attendanceSubmitted===true);
}
/* Sesi Koor KP yang belum di-submit: masih draft milik Koor, belum terlihat oleh HRD. */
function isDraftKoorSession_(sessionId){
  const x=sessionMap_()[sessionId];
  return !!(x && x.creatorRole==="KOOR KP" && x.attendanceSubmitted!==true);
}

function sessionPolicy_(old,clean,actor){
  if(actor.role==="KOOR KP"){
    if(old && old.creatorId!==actor.id) throw new Error("Koor KP tidak dapat mengubah sesi milik orang lain.");
    if(clean.creatorId!==actor.id || clean.activity!=="Ngoprek" || clean.division!==actor.division){
      throw new Error("Koor KP hanya dapat menyimpan sesi Ngoprek miliknya.");
    }
  }
  if(old){
    // Pemilik, peran pembuat, dan token tidak boleh diganti lewat edit.
    clean.creatorId=old.creatorId; clean.creatorName=old.creatorName;
    clean.creatorRole=old.creatorRole; clean.token=old.token;
    // Status aktif & submit hanya boleh berubah lewat action khusus (setSessionActive / submitSessionAttendance).
    // Tanpa ini, perangkat yang datanya basi bisa membalikkan QR yang sudah dinonaktifkan.
    clean.active=old.active;
    clean.attendanceSubmitted=old.attendanceSubmitted===true;
    clean.submittedAt=old.submittedAt||null; clean.submittedBy=old.submittedBy||null;
    clean.submittedByName=old.submittedByName||null;
  }else{
    // Sesi baru: pembuat selalu akun yang sedang login.
    clean.creatorId=actor.id; clean.creatorName=actor.name; clean.creatorRole=actor.role;
  }
  return clean;
}

function attendancePolicy_(old,clean,actor){
  if(old){clean.userId=old.userId;clean.sessionId=old.sessionId;}
  const session=findSession_(old?old.sessionId:clean.sessionId);
  if(!session)throw new Error("Absensi ditolak: sesi tidak ditemukan.");
  if(actor.role==="KOOR KP"){
    if(session.creatorId!==actor.id||session.activity!=="Ngoprek"||session.division!==actor.division)throw new Error("Koor KP hanya dapat mengelola absensi sesi Ngoprek miliknya pada divisinya.");
    if(old&&(old.creatorId!==actor.id||old.activity!=="Ngoprek"||old.division!==actor.division))throw new Error("Koor KP tidak berhak mengubah record absensi tersebut.");
    const target=sheetToObjects_(SHEET_USERS).find(u=>u.id===clean.userId);
    if(!target||target.role!=="STAF"||target.division!==actor.division)throw new Error("Absensi ditolak: peserta harus merupakan akun STAF pada divisi Koor KP.");
    clean.userName=target.name;clean.username=target.username;clean.activity=session.activity;clean.division=session.division;clean.date=session.date;clean.creatorId=session.creatorId;clean.creatorRole=session.creatorRole;clean.token=session.token;
    if(isSubmittedSession_(session.id))return old||null;
  }else if(actor.role==="HRD"&&isDraftKoorSession_(session.id))return old||null;
  return clean;
}

/* Persetujuan izin: reviewer hanya boleh mengubah status + catatan.
   reviewedBy/At selalu diisi server dari akun yang login, bukan dari klien. */
function permitPolicy_(old,clean,actor){
  if(!old) return null; // reviewer tidak boleh membuat pengajuan baru
  if(actor.role==="KOOR KP" && old.sessionCreatorId!==actor.id){
    throw new Error("Koor KP hanya dapat mengelola pengajuan miliknya.");
  }
  if(clean.status===old.status && (clean.reviewNote||null)===(old.reviewNote||null)) return old;
  if(actor.role==="KOOR KP" && isSubmittedSession_(old.sessionId)) return old;   // sudah di-submit: hanya HRD
  if(actor.role==="HRD" && isDraftKoorSession_(old.sessionId)) return old;       // draft Koor belum diserahkan
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

/* Cache daftar user (5 menit) khusus untuk login & verifikasi token supaya tidak membaca
   sheet Users setiap request. Otomatis dibuang setiap kali sheet Users berubah. */
const USERS_CACHE_KEY = "nev-users-cache-v1";
function invalidateUsersCache_(){
  try{ CacheService.getScriptCache().remove(USERS_CACHE_KEY); }catch(e){}
}
function usersCached_(){
  const cache=CacheService.getScriptCache();
  try{
    const raw=cache.get(USERS_CACHE_KEY);
    if(raw) return JSON.parse(raw);
  }catch(e){}
  const users=migratePlaintextPasswords_();
  try{
    const json=JSON.stringify(users);
    if(json.length<90000) cache.put(USERS_CACHE_KEY,json,300);
  }catch(e){}
  return users;
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
  const users=usersCached_();
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
  if(user.role==="HRD") return all.filter(a=>!isDraftKoorSession_(a.sessionId));   // draft Koor belum terlihat
  if(user.role==="KOOR KP"){
    return all.filter(a=>a.creatorId===user.id && a.activity==="Ngoprek" && a.division===user.division);
  }
  return all.filter(a=>a.userId===user.id);
}

function permitsFor_(user){
  const all=sheetToObjects_(SHEET_PERMITS).filter(validPermit_);
  if(user.role==="HRD") return all.filter(p=>!isDraftKoorSession_(p.sessionId));
  if(user.role==="KOOR KP"){
    return all.filter(p=>p.sessionCreatorId===user.id && p.sessionActivity==="Ngoprek");
  }
  return all.filter(p=>p.userId===user.id);
}

/* HRD melihat semua SP; STAF/KOOR KP hanya SP yang ditujukan kepada dirinya. */
function warningsFor_(user){
  const all=sheetToObjects_(SHEET_WARNINGS).filter(w=>w.id && w.targetId);
  if(user.role==="HRD") return all;
  return all.filter(w=>w.targetId===user.id);
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
  // Semua foto privat; tampilan melalui action getPhoto yang memeriksa role dan kepemilikan.
  file.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);
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

/* Migrasi manual foto selfie/presensi lama ke PRIVATE. Tidak menghapus file. */
function privatkanFotoSelfieDanPresensi(){
  const result={selfie:0,presensi:0,failed:0};
  ["selfie","presensi"].forEach(function(kind){const files=getPhotoFolder_(kind).getFiles();while(files.hasNext()){const f=files.next();try{f.setSharing(DriveApp.Access.PRIVATE,DriveApp.Permission.NONE);result[kind]++;}catch(err){result.failed++;Logger.log("Gagal memprivatkan "+kind+" "+f.getId()+": "+err);}}});
  Logger.log("Migrasi akses foto selesai: "+JSON.stringify(result));return result;
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
    permits:permitsFor_(user),
    warnings:warningsFor_(user)
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
  auditEvent_(actor,"user.create","user",record.id,"Akun dibuat: "+record.username+" ("+record.role+")");
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
  auditEvent_(actor,"user.update","user",user.id,"Profil akun diperbarui; perubahan kredensial tidak dicatat.");
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
  auditEvent_(actor,"user.delete","user",target.id,"Akun dihapus: "+target.username);
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
  auditEvent_(actor,"data.purge","data","", "Permintaan penghapusan data; rows="+(opt.rows!==false)+", photos="+(opt.photos!==false)+".");
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
    if(session.attendanceSubmitted===true) throw new Error("Absensi sesi ini sudah disubmit ke HRD. Hanya HRD yang dapat menghapusnya.");
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_SESSIONS,sessions.filter(s=>s.id!==sessionId));
  objectsToSheet_(SHEET_ATTENDANCE,sheetToObjects_(SHEET_ATTENDANCE).filter(a=>a.sessionId!==sessionId));
  objectsToSheet_(SHEET_PERMITS,sheetToObjects_(SHEET_PERMITS).filter(p=>p.sessionId!==sessionId));
  auditEvent_(actor,"session.delete","session",sessionId,"Sesi beserta data terkait dihapus.");
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
    if(isSubmittedSession_(rec.sessionId)) throw new Error("Absensi sudah disubmit ke HRD. Hanya HRD yang dapat mengubahnya.");
  }else if(actor.role!=="HRD"){
    throw new Error("Akses ditolak.");
  }

  objectsToSheet_(SHEET_ATTENDANCE,list.filter(a=>a.id!==id));
  auditEvent_(actor,"attendance.delete","attendance",id,"Record absensi dihapus.");
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
  if(actor.role!=="STAF")throw new Error("Hanya STAF yang dapat mengirim absensi dirinya sendiri.");
  if(!data||!idOk_(data.sessionId))throw new Error("Data absensi tidak valid.");
  const lat=numOrNull_(data.lat,-90,90),lng=numOrNull_(data.lng,-180,180);
  return withLock_(function(){
    const session=sheetToObjects_(SHEET_SESSIONS).find(x=>x.id===data.sessionId);
    if(!session)throw new Error("Kegiatan tidak ditemukan di server.");
    if(session.active!==true||session.attendanceSubmitted===true)throw new Error("Kegiatan ini sudah ditutup.");
    if(!data.token||String(data.token)!==String(session.token))throw new Error("Token QR tidak cocok. Pindai ulang QR kegiatan.");
    if(session.division&&session.division!=="-"&&session.division!==actor.division)throw new Error("Kegiatan ini untuk divisi "+session.division+".");
    const dup=sheetToObjects_(SHEET_ATTENDANCE).filter(validAttendance_).find(r=>r.sessionId===session.id&&r.userId===actor.id);
    if(dup)return {ok:true,record:dup,duplicate:true};
    const now=nowWIB_();if(now.date!==session.date)throw new Error("QR belum atau sudah melewati tanggal kegiatan.");
    const nowMin=minutesOf_(now.time),startMin=minutesOf_(session.start),endMin=minutesOf_(session.end);
    const expire=Number(session.expireMinutes),expireAt=isFinite(expire)&&expire>0?startMin+expire:null;
    const limited=expireAt!==null&&expireAt<endMin,deadline=limited?expireAt:endMin+CHECKIN_GRACE_MIN;
    if(nowMin<startMin-EARLY_OPEN_MIN)throw new Error("QR belum aktif. Absensi dibuka pukul "+minutesToHHMM_(Math.max(0,startMin-EARLY_OPEN_MIN))+".");
    if(nowMin>deadline)throw new Error(limited?"QR sudah kadaluwarsa (batas pukul "+minutesToHHMM_(expireAt)+").":"Absensi hanya dapat dilakukan pukul "+session.start+" - "+session.end+".");
    const target=targetGeo_(session);
    if(target){if(lat===null||lng===null)throw new Error("Lokasi perangkat tidak terbaca. Aktifkan GPS lalu coba lagi.");const dist=distanceMeters_(lat,lng,target.lat,target.lng);if(dist>target.radius)throw new Error("Anda berada di luar radius "+target.label+" ("+Math.round(dist)+" m dari titik, batas "+target.radius+" m).");}
    const photoUrl=data.photo?savePhotoToDrive_(data.photo,(actor.username||"user")+"_"+session.date+"_"+Date.now(),"selfie"):null;
    const record={id:newId_("ATT"),sessionId:session.id,token:session.token,userId:actor.id,userName:actor.name,username:actor.username,activity:session.activity,division:session.division,date:session.date,checkIn:now.iso,status:"Hadir",creatorId:session.creatorId,creatorRole:session.creatorRole,lat:lat,lng:lng,photo:photoUrl,permitId:null,approvedFromPermit:false};
    try{appendObject_(SHEET_ATTENDANCE,record);}catch(err){if(photoUrl){const m=photoUrl.match(/\/file\/d\/([A-Za-z0-9_-]{10,100})\/view/);if(m){try{DriveApp.getFileById(m[1]).setTrashed(true);}catch(cleanupErr){Logger.log("Cleanup foto gagal: "+cleanupErr);}}}throw err;}
    auditEvent_(actor,"attendance.checkin","attendance",record.id,"Check-in berhasil untuk sesi "+session.id+".");
    return {ok:true,record:record};
  });
}

/* Staf memindai QR berisi token pendek: server mengembalikan data kegiatan + status aktif dalam satu request. */
function resolveToken_(actor,data){
  if(actor.role!=="STAF") throw new Error("Hanya STAF yang dapat melakukan absensi.");
  const token=String(data && data.token || "");
  if(!TOKEN_RE.test(token)) throw new Error("Token QR tidak valid.");
  const s=sheetToObjects_(SHEET_SESSIONS).find(x=>String(x.token)===token);
  if(!s) throw new Error("Token QR tidak valid atau kegiatan sudah dihapus.");
  if(s.division && s.division!=="-" && s.division!==actor.division){
    throw new Error("Kegiatan ini untuk divisi "+s.division+".");
  }
  return {ok:true, session:{
    id:s.id, activity:s.activity, division:s.division, date:s.date, start:s.start, end:s.end,
    location:s.location, notes:s.notes, creatorId:s.creatorId, creatorName:s.creatorName, creatorRole:s.creatorRole,
    geoEnabled:s.geoEnabled===true, geoLat:s.geoLat, geoLng:s.geoLng, geoRadius:s.geoRadius,
    expireMinutes:s.expireMinutes, createdAt:s.createdAt,
    active:s.active===true, attendanceSubmitted:s.attendanceSubmitted===true
  }};
}

/* Staf mengecek status QR sebelum lanjut ke lokasi & selfie. Hanya mengembalikan aktif/tidak. */
function checkSession_(actor,data){
  const id=String(data && data.sessionId || "");
  if(!idOk_(id)) throw new Error("Data tidak valid.");
  const session=findSession_(id);
  if(!session) throw new Error("Kegiatan tidak ditemukan di server. Minta HRD/Koor memastikan QR sudah tersinkron.");
  if(!data.token || String(data.token)!==String(session.token)) throw new Error("Token QR tidak cocok. Pindai ulang QR kegiatan.");
  return {ok:true, active: session.active===true && session.attendanceSubmitted!==true};
}

/* Aktif/nonaktifkan QR. Dilakukan atomik di server (satu field saja), bukan lewat save-massal. */
function setSessionActive_(actor,data){
  const id=String(data && data.sessionId || "");
  if(!idOk_(id)) throw new Error("Data tidak valid.");
  const active=boolOf_(data.active);
  return withLock_(function(){
    const list=sheetToObjects_(SHEET_SESSIONS);
    const session=list.find(x=>x.id===id);
    if(!session) throw new Error("Kegiatan/QR tidak ditemukan.");
    if(actor.role==="KOOR KP"){
      if(session.creatorId!==actor.id || session.activity!=="Ngoprek" || session.division!==actor.division){
        throw new Error("Koor KP hanya dapat mengubah QR Ngoprek miliknya.");
      }
      if(session.attendanceSubmitted===true){
        throw new Error("Absensi sesi ini sudah disubmit ke HRD. Hanya HRD yang dapat mengaktifkan kembali QR.");
      }
    }else if(actor.role!=="HRD"){
      throw new Error("Akses ditolak.");
    }
    session.active=active;
    objectsToSheet_(SHEET_SESSIONS,list);
    _sessMapCache=null;
    auditEvent_(actor,active?"session.activate":"session.deactivate","session",session.id,"Status QR diubah.");
    return {ok:true, active:active};
  });
}

/* Koor KP menyerahkan absensi satu sesi Ngoprek ke HRD. Setelah ini Koor tidak bisa mengubahnya lagi. */
function submitSessionAttendance_(actor,data){
  if(actor.role!=="KOOR KP") throw new Error("Hanya Koor KP yang dapat men-submit absensi Ngoprek.");
  const id=String(data && data.sessionId || "");
  if(!idOk_(id)) throw new Error("Data tidak valid.");
  return withLock_(function(){
    const list=sheetToObjects_(SHEET_SESSIONS);
    const session=list.find(x=>x.id===id);
    if(!session) throw new Error("Kegiatan tidak ditemukan.");
    if(session.creatorId!==actor.id || session.activity!=="Ngoprek" || session.division!==actor.division){
      throw new Error("Koor KP hanya dapat men-submit sesi Ngoprek miliknya.");
    }
    if(session.attendanceSubmitted!==true){
      session.attendanceSubmitted=true;
      session.submittedAt=new Date().toISOString();
      session.submittedBy=actor.id;
      session.submittedByName=actor.name;
      session.active=false;   // QR ditutup supaya tidak ada absen baru yang masuk setelah data diserahkan
      objectsToSheet_(SHEET_SESSIONS,list);
      _sessMapCache=null;
      auditEvent_(actor,"attendance.submit","session",session.id,"Absensi sesi diserahkan ke HRD.");
    }
    return {ok:true, session:{
      id:session.id, active:session.active, attendanceSubmitted:true,
      submittedAt:session.submittedAt, submittedBy:session.submittedBy, submittedByName:session.submittedByName
    }};
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

  return withLock_(function(){
    const currentSession=sheetToObjects_(SHEET_SESSIONS).find(x=>x.id===data.sessionId);
    if(!currentSession||currentSession.id!==session.id||currentSession.division!==session.division)throw new Error("Kegiatan berubah atau tidak tersedia. Muat ulang lalu ajukan kembali.");
    const dup=sheetToObjects_(SHEET_PERMITS).filter(validPermit_).find(r=>r.sessionId===session.id&&r.userId===actor.id&&r.status!=="Ditolak");
    if(dup)return {ok:true,record:dup,duplicate:true};
    const photoUrl=data.photo?savePhotoToDrive_(data.photo,(actor.username||"user")+"_"+session.date+"_"+Date.now(),"permit"):null;
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
    auditEvent_(actor,"permit.create","permit",record.id,"Pengajuan "+record.type+" dibuat untuk sesi "+record.sessionId+".");
    return {ok:true,record:record};
  });
}

/* =========================================================
SURAT PERINGATAN (SP)
Hanya HRD yang menerbitkan/mencabut. Penerima hanya menandai "dibaca".
Semua field penerima diambil dari sheet Users di server, bukan dari klien.
========================================================= */
function nextWarningNumber_(){
  const now=new Date();
  const year=Number(Utilities.formatDate(now,"Asia/Jakarta","yyyy"));
  const month=Number(Utilities.formatDate(now,"Asia/Jakarta","M"));
  let max=0;
  sheetToObjects_(SHEET_WARNINGS).forEach(w=>{
    const m=String(w.number||"").match(/^(\d+)\/SP\/NEV\/[IVX]+\/(\d{4})$/);
    if(m && Number(m[2])===year) max=Math.max(max,Number(m[1]));
  });
  return ("00"+(max+1)).slice(-3)+"/SP/NEV/"+ROMAN_MONTHS[month-1]+"/"+year;
}

function issueWarning_(actor,data){
  if(actor.role!=="HRD") throw new Error("Hanya HRD yang dapat menerbitkan SP.");
  if(!data || !idOk_(data.id)) throw new Error("Data SP tidak valid.");
  if(!idOk_(data.targetId)) throw new Error("Penerima SP tidak valid.");
  const level=String(data.level||"");
  if(WARNING_LEVELS.indexOf(level)<0) throw new Error("Tingkat SP harus SP1, SP2, atau SP3.");
  const reason=multiline_(data.reason,1000);
  if(!reason) throw new Error("Alasan SP wajib diisi.");
  const action=multiline_(data.action,500);
  let validUntil=null;
  if(data.validUntil){
    if(!DATE_RE.test(String(data.validUntil))) throw new Error("Tanggal berlaku tidak valid.");
    validUntil=String(data.validUntil);
  }

  const target=sheetToObjects_(SHEET_USERS).find(u=>u.id===data.targetId);
  if(!target) throw new Error("Penerima tidak ditemukan.");
  if(target.role!=="STAF" && target.role!=="KOOR KP") throw new Error("SP hanya dapat diberikan kepada STAF atau Koor KP.");

  return withLock_(function(){
    // Pengiriman ulang dengan id yang sama (jaringan lambat) tidak menerbitkan SP dobel.
    const dup=sheetToObjects_(SHEET_WARNINGS).find(w=>w.id===data.id);
    if(dup) return {ok:true,record:dup,duplicate:true};

    const record={
      id:data.id, number:nextWarningNumber_(), level:level,
      targetId:target.id, targetName:target.name, targetUsername:target.username,
      targetRole:target.role, targetDivision:target.division||null,
      reason:reason, action:action, validUntil:validUntil,
      issuedBy:actor.id, issuedByName:actor.name, issuedAt:new Date().toISOString(), readAt:null
    };
    appendObject_(SHEET_WARNINGS,record);
    auditEvent_(actor,"warning.issue","warning",record.id,"Surat peringatan "+record.level+" diterbitkan kepada "+target.username+".");
    return {ok:true,record:record};
  });
}

function markWarningRead_(actor,data){
  const id=String(data && data.id || "");
  if(!idOk_(id)) throw new Error("Data tidak valid.");
  return withLock_(function(){
    const list=sheetToObjects_(SHEET_WARNINGS);
    const w=list.find(x=>x.id===id);
    if(!w) throw new Error("SP tidak ditemukan.");
    if(w.targetId!==actor.id) throw new Error("Akses ditolak.");
    if(!w.readAt){
      w.readAt=new Date().toISOString();
      objectsToSheet_(SHEET_WARNINGS,list);
      auditEvent_(actor,"warning.read","warning",id,"Penerima membaca surat peringatan.");
    }
    return {ok:true,readAt:w.readAt};
  });
}

function deleteWarning_(actor,data){
  if(actor.role!=="HRD") throw new Error("Hanya HRD yang dapat mencabut SP.");
  const id=String(data && data.id || "");
  if(!idOk_(id)) throw new Error("Data tidak valid.");
  return withLock_(function(){
    const list=sheetToObjects_(SHEET_WARNINGS);
    if(!list.some(x=>x.id===id)) throw new Error("SP tidak ditemukan.");
    objectsToSheet_(SHEET_WARNINGS,list.filter(x=>x.id!==id));
    auditEvent_(actor,"warning.revoke","warning",id,"Surat peringatan dicabut.");
    return {ok:true};
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

      const users=usersCached_();
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
      auditEvent_(user,"auth.login","auth",user.id,"Login berhasil.");
      const resp={ok:true,authToken:authToken,user:safeUser_(user)};
      // Kirim data awal sekaligus supaya klien tidak perlu request getAll kedua setelah login.
      try{ resp.all=getAllFor_(user); }catch(e){}
      return jsonResponse_(resp);
    }

    if(action==="logout"){
      if(body.authToken){
        try{const raw=CacheService.getScriptCache().get("nev-auth-"+String(body.authToken));if(raw){const session=JSON.parse(raw),u=usersCached_().find(x=>x.id===session.userId);if(u)auditEvent_(u,"auth.logout","auth",u.id,"Logout.");}}catch(ignore){}
        CacheService.getScriptCache().remove("nev-auth-"+String(body.authToken));
      }
      return jsonResponse_({ok:true});
    }

    const actor=requireActor_(body);
    const data=body.data || {};

    switch(action){
      case "getAll":
        return jsonResponse_(getAllFor_(actor));

      case "getPhoto":
        return jsonResponse_(getPhoto_(actor,data));

      case "getAuditLog":
        return jsonResponse_(getAuditLog_(actor,data));

      case "getEvaluations":
        return jsonResponse_(getEvaluations_(actor));

      case "submitEvaluation":
        return jsonResponse_(withLock_(()=>submitEvaluation_(actor,data)));

      case "getCorrectionRequests":
        return jsonResponse_(getCorrectionRequests_(actor));

      case "submitAttendanceCorrection":
        return jsonResponse_(submitAttendanceCorrection_(actor,data));

      case "reviewAttendanceCorrection":
        return jsonResponse_(reviewAttendanceCorrection_(actor,data));

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
        auditEvent_(actor,"settings.update","settings","","Pengaturan lokasi/radius kantor diperbarui.");
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

      case "checkSession":
        return jsonResponse_(checkSession_(actor,data));

      case "resolveToken":
        return jsonResponse_(resolveToken_(actor,data));

      case "setSessionActive":
        return jsonResponse_(setSessionActive_(actor,data));

      case "submitSessionAttendance":
        return jsonResponse_(submitSessionAttendance_(actor,data));

      case "addAttendance":
        return jsonResponse_(addAttendance_(actor,data));

      case "addPermit":
        return jsonResponse_(addPermit_(actor,data));

      case "issueWarning":
        return jsonResponse_(issueWarning_(actor,data));

      case "markWarningRead":
        return jsonResponse_(markWarningRead_(actor,data));

      case "deleteWarning":
        return jsonResponse_(deleteWarning_(actor,data));

      default:
        return jsonResponse_({ok:false,error:"Action tidak dikenali: "+action});
    }
  }catch(err){
    return failResponse_(err);
  }
}
