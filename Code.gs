/**
 * =========================================================
 * NEV ABSENKU — Backend Terpusat (Google Sheets + Google Drive)
 * =========================================================
 * Tempel seluruh isi file ini ke Apps Script yang TERIKAT (bound)
 * pada Spreadsheet Anda, lalu Deploy sebagai Web App:
 *   Execute as: Me   |   Who has access: Anyone
 *
 * SETELAH MENGUBAH KODE: Deploy -> Manage deployments -> ikon pensil ->
 * Version: "New version" -> Deploy. (Sekadar menyimpan kode TIDAK
 * memperbarui URL /exec yang sedang berjalan.)
 *
 * CATATAN KEAMANAN:
 * Web App diakses tanpa login (agar staf tanpa akun Google bisa absen).
 * Siapa pun yang tahu URL /exec bisa membaca/menulis data. Jaga URL-nya.
 * =========================================================
 */

/* ---------- Folder Google Drive tujuan foto ----------
 * ID diambil dari link folder: drive.google.com/drive/folders/<ID>
 * PENTING: bagikan tiap folder sebagai "Siapa saja yang memiliki link -> Viewer"
 * agar file di dalamnya bisa tampil di aplikasi (file baru mewarisi izin folder).
 */
const FOLDER_IDS = {
  selfie: "1-lQ2rFrCRYYqbmimYBtzReBEaG5hJVgr",   // NEV Absenku_Foto Selfie  -> selfie saat absen
  permit: "1-9QaGXdIUrMT-BhhT8FvB3smfpwHq4vb",   // NEV Absenku_Bukti Izin Sakit -> bukti izin/sakit
  presensi: "1hpI3e8x4XonyO8wXJWdnnblo0KeKJFuF"  // NEV Absenku_Foto Presensi -> (belum dipakai; tukar ID di atas jika ingin selfie absen masuk ke sini)
};

// Cadangan bila folder ID di atas tidak bisa diakses: dibuat otomatis dengan nama ini.
const FALLBACK_FOLDER_NAMES = {
  selfie: "NEV Absenku - Foto Selfie",
  permit: "NEV Absenku - Bukti Izin Sakit",
  presensi: "NEV Absenku - Foto Presensi"
};

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
UTIL: SHEET <-> ARRAY OF OBJECTS
Semua sel ditulis sebagai TEKS polos ("@") supaya Google Sheets tidak
mengubah "2026-09-28" / "08:00" / "123456" menjadi tanggal/jam/angka.
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

// Sel yang terlanjur menjadi Date (data lama) dikembalikan ke teks.
function dateCellToString_(h, d){
  if(DATE_COLS.indexOf(h) >= 0) return Utilities.formatDate(d, tz_(), "yyyy-MM-dd");
  if(TIME_COLS.indexOf(h) >= 0){
    // Nilai jam murni datang sebagai tanggal 1899; hitung menit sejak tengah malam.
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
  return values
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row=>{
      const obj = {};
      headers.forEach((h, i)=>{ obj[h] = fromCell_(h, row[i]); });
      return obj;
    });
}

function objectsToSheet_(name, list){
  const sheet = getSheet_(name);
  const headers = HEADERS[name];
  if(sheet.getLastRow() >= 2){
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  if(list && list.length){
    const rows = list.map(obj => headers.map(h => toCell_(obj[h])));
    ensureRows_(sheet, rows.length + 1);
    const range = sheet.getRange(2, 1, rows.length, headers.length);
    range.setNumberFormat("@");
    range.setValues(rows);
  }
}

function ensureRows_(sheet, needed){
  const max = sheet.getMaxRows();
  if(max < needed) sheet.insertRowsAfter(max, needed - max);
}

function appendObject_(name, obj){
  const sheet = getSheet_(name);
  const headers = HEADERS[name];
  const row = [headers.map(h => toCell_(obj[h]))];
  ensureRows_(sheet, sheet.getLastRow() + 1);
  const range = sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length);
  range.setNumberFormat("@");
  range.setValues(row);
}

function settingsToObject_(){
  const sheet = getSheet_(SHEET_SETTINGS);
  const headers = HEADERS.Settings;
  if(sheet.getLastRow() < 2){
    return { officeLat: null, officeLng: null, radius: 100, geofenceEnabled: false };
  }
  const row = sheet.getRange(2, 1, 1, headers.length).getValues()[0];
  const obj = {};
  headers.forEach((h, i)=>{ obj[h] = fromCell_(h, row[i]); });
  return obj;
}

function objectToSettingsSheet_(obj){
  objectsToSheet_(SHEET_SETTINGS, [obj || {}]);
}


/* =========================================================
UTIL: SIMPAN FOTO KE GOOGLE DRIVE
========================================================= */

function getPhotoFolder_(kind){
  try{
    return DriveApp.getFolderById(FOLDER_IDS[kind]);
  }catch(err){
    const name = FALLBACK_FOLDER_NAMES[kind];
    const folders = DriveApp.getFoldersByName(name);
    return folders.hasNext() ? folders.next() : DriveApp.createFolder(name);
  }
}

function savePhotoToDrive_(base64DataUrl, fileNameHint, kind){
  if(!base64DataUrl) return null;
  const match = String(base64DataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mime = match ? match[1] : "image/jpeg";
  const raw = match ? match[2] : base64DataUrl;
  const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg");
  const safeName = String(fileNameHint || "photo").replace(/[^a-zA-Z0-9_-]/g, "_");

  const blob = Utilities.newBlob(Utilities.base64Decode(raw), mime, safeName + "." + ext);
  const file = getPhotoFolder_(kind).createFile(blob);

  // Izin file mewarisi folder. Coba buka akses link juga, tapi jangan gagalkan
  // penyimpanan bila kebijakan akun/domain melarang berbagi publik.
  try{
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  }catch(err){
    console.warn("setSharing dilewati: " + err);
  }

  return "https://drive.google.com/file/d/" + file.getId() + "/view";
}


/* =========================================================
HELPER: LOCK, RESPONSE
========================================================= */

function withLock_(fn){
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try{ return fn(); } finally { lock.releaseLock(); }
}

function jsonResponse_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* =========================================================
doGet — ?action=getAll
========================================================= */

function doGet(e){
  try{
    const action = (e.parameter && e.parameter.action) || "getAll";
    if(action === "getAll"){
      return jsonResponse_({
        ok: true,
        users: sheetToObjects_(SHEET_USERS),
        sessions: sheetToObjects_(SHEET_SESSIONS),
        attendance: sheetToObjects_(SHEET_ATTENDANCE),
        settings: settingsToObject_(),
        permits: sheetToObjects_(SHEET_PERMITS)
      });
    }
    return jsonResponse_({ ok: false, error: "Action tidak dikenali: " + action });
  }catch(err){
    return jsonResponse_({ ok: false, error: String(err) });
  }
}


/* =========================================================
doPost — Body JSON: { action, data }
========================================================= */

// Tambah 1 baris (absensi / pengajuan). Foto diunggah DI LUAR kunci supaya
// banyak staf yang absen bersamaan tidak saling menunggu; aman diulang (idempoten).
function addRecord_(sheetName, record, photoKind, isDuplicate){
  const existing = sheetToObjects_(sheetName).filter(isDuplicate)[0];
  if(existing) return { ok: true, record: existing, duplicate: true };

  if(record.photo && String(record.photo).indexOf("data:") === 0){
    record.photo = savePhotoToDrive_(
      record.photo,
      (record.username || "user") + "_" + (record.date || record.sessionDate || "") + "_" + (record.id || Date.now()),
      photoKind
    );
  }

  return withLock_(function(){
    const again = sheetToObjects_(sheetName).filter(isDuplicate)[0];
    if(again) return { ok: true, record: again, duplicate: true };
    appendObject_(sheetName, record);
    return { ok: true, record: record };
  });
}

function doPost(e){
  try{
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch(action){

      case "saveUsers":
        withLock_(() => objectsToSheet_(SHEET_USERS, body.data));
        return jsonResponse_({ ok: true });

      case "saveSessions":
        withLock_(() => objectsToSheet_(SHEET_SESSIONS, body.data));
        return jsonResponse_({ ok: true });

      case "saveSettings":
        withLock_(() => objectToSettingsSheet_(body.data));
        return jsonResponse_({ ok: true });

      case "saveAttendance":
        // Field "photo" di sini sudah berupa link Drive (bukan base64).
        withLock_(() => objectsToSheet_(SHEET_ATTENDANCE, body.data));
        return jsonResponse_({ ok: true });

      case "savePermits":
        withLock_(() => objectsToSheet_(SHEET_PERMITS, body.data));
        return jsonResponse_({ ok: true });

      case "addAttendance": {
        const rec = body.data;
        return jsonResponse_(addRecord_(SHEET_ATTENDANCE, rec, "selfie",
          r => r.id === rec.id || (r.sessionId === rec.sessionId && r.userId === rec.userId)));
      }

      case "addPermit": {
        const rec = body.data;
        return jsonResponse_(addRecord_(SHEET_PERMITS, rec, "permit",
          r => r.id === rec.id ||
               (r.sessionId === rec.sessionId && r.userId === rec.userId && r.status !== "Ditolak")));
      }

      default:
        return jsonResponse_({ ok: false, error: "Action tidak dikenali: " + action });
    }
  }catch(err){
    return jsonResponse_({ ok: false, error: String(err) });
  }
}
