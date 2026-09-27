/**
 * =========================================================
 * NEV ABSENKU — Backend Terpusat (Google Sheets + Google Drive)
 * =========================================================
 * Tempel seluruh isi file ini ke Apps Script yang TERIKAT (bound)
 * pada Spreadsheet berikut, lalu deploy sebagai Web App:
 * https://docs.google.com/spreadsheets/d/1E-JqBubHJAl_ym7Z3_FHoNBRh5FIjTL_Mh1pqOMkY_A/edit
 *
 * CARA PASANG:
 * 1. Buka Spreadsheet di atas → menu Extensions/Ekstensi →
 *    Apps Script.
 * 2. Hapus kode contoh (myFunction) di editor, ganti dengan
 *    SELURUH isi file Code.gs ini.
 * 3. Klik Deploy → New deployment.
 *      - Select type: Web app
 *      - Description: bebas, mis. "NEV Absenku API"
 *      - Execute as: Me
 *      - Who has access: Anyone
 *    Klik Deploy, lalu izinkan (Authorize) akses yang diminta
 *    (Sheets & Drive milik Anda sendiri).
 * 4. Salin "Web app URL" yang muncul (diakhiri /exec).
 * 5. Tempel URL itu ke variabel CLOUD_SCRIPT_URL di file
 *    cloud-sync.js pada aplikasi web-nya.
 * 6. Sheet "Users", "Sessions", "Attendance", "Settings" akan
 *    dibuat otomatis (beserta header) saat pertama kali diakses.
 *    Folder Drive "NEV Absenku - Foto Selfie" juga dibuat
 *    otomatis untuk menyimpan foto.
 *
 * CATATAN KEAMANAN:
 * Web App ini diakses TANPA login (supaya bisa dipanggil dari
 * HP staf mana pun tanpa akun Google). Artinya siapa pun yang
 * tahu URL Web App-nya bisa membaca/menulis data. Jaga URL ini
 * agar tidak disebar sembarangan (sama seperti menjaga token QR).
 * =========================================================
 */

const SHEET_USERS = "Users";
const SHEET_SESSIONS = "Sessions";
const SHEET_ATTENDANCE = "Attendance";
const SHEET_SETTINGS = "Settings";
const SHEET_PERMITS = "Permits";
const DRIVE_FOLDER_NAME = "NEV Absenku - Foto Selfie";
const PERMIT_DRIVE_FOLDER_NAME = "NEV Absenku - Bukti Izin Sakit";

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


/* =========================================================
UTIL: SHEET <-> ARRAY OF OBJECTS
========================================================= */

function getSheet_(name){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if(!sheet){
    sheet = ss.insertSheet(name);
  }
  if(sheet.getLastRow() === 0){
    sheet.appendRow(HEADERS[name]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects_(name){
  const sheet = getSheet_(name);
  const values = sheet.getDataRange().getValues();
  if(values.length < 2) return [];
  const headers = values[0];
  return values.slice(1)
    .filter(row => row.some(cell => cell !== "" && cell !== null))
    .map(row=>{
      const obj = {};
      headers.forEach((h, i)=>{
        let v = row[i];
        if(h === "active" || h === "geofenceEnabled" || h === "geoEnabled" || h === "approvedFromPermit"){
          v = (v === true || v === "TRUE" || v === "true");
        } else if(v === ""){
          v = null;
        }
        obj[h] = v;
      });
      return obj;
    });
}

function objectsToSheet_(name, list){
  const sheet = getSheet_(name);
  const headers = HEADERS[name];
  sheet.clearContents();
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  if(list && list.length){
    const rows = list.map(obj => headers.map(h => (obj[h] === undefined || obj[h] === null) ? "" : obj[h]));
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }
}

function settingsToObject_(){
  const sheet = getSheet_(SHEET_SETTINGS);
  const values = sheet.getDataRange().getValues();
  const headers = HEADERS.Settings;
  if(values.length < 2){
    return { officeLat: null, officeLng: null, radius: 100, geofenceEnabled: false };
  }
  const row = values[1];
  const obj = {};
  headers.forEach((h, i)=>{
    let v = row[i];
    if(h === "geofenceEnabled") v = (v === true || v === "TRUE" || v === "true");
    if((h === "officeLat" || h === "officeLng" || h === "radius") && v === "") v = null;
    obj[h] = v;
  });
  return obj;
}

function objectToSettingsSheet_(obj){
  const sheet = getSheet_(SHEET_SETTINGS);
  const headers = HEADERS.Settings;
  sheet.clearContents();
  sheet.appendRow(headers);
  sheet.setFrozenRows(1);
  sheet.appendRow(headers.map(h => (obj[h] === undefined || obj[h] === null) ? "" : obj[h]));
}


/* =========================================================
UTIL: SIMPAN FOTO SELFIE KE GOOGLE DRIVE
========================================================= */

function getOrCreatePhotoFolder_(folderName){
  const folders = DriveApp.getFoldersByName(folderName);
  if(folders.hasNext()) return folders.next();
  return DriveApp.createFolder(folderName);
}

function savePhotoToDrive_(base64DataUrl, fileNameHint, folderName){
  if(!base64DataUrl) return null;
  const match = String(base64DataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  const mime = match ? match[1] : "image/jpeg";
  const rawBase64 = match ? match[2] : base64DataUrl;
  const ext = (mime.split("/")[1] || "jpg").replace("jpeg", "jpg");

  const safeName = String(fileNameHint || "photo").replace(/[^a-zA-Z0-9_-]/g, "_");
  const blob = Utilities.newBlob(Utilities.base64Decode(rawBase64), mime, `${safeName}.${ext}`);

  const folder = getOrCreatePhotoFolder_(folderName || DRIVE_FOLDER_NAME);
  const file = folder.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // Format link yang bisa langsung dipakai sebagai <img src="...">
  return `https://drive.google.com/uc?export=view&id=${file.getId()}`;
}


/* =========================================================
RESPONSE HELPER
========================================================= */

function jsonResponse_(obj){
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


/* =========================================================
doGet — AMBIL SEMUA DATA (dipanggil saat aplikasi dibuka)
?action=getAll
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
doPost — SIMPAN PERUBAHAN
Body JSON: { action: "...", data: ... }
========================================================= */

function doPost(e){
  const lock = LockService.getScriptLock();
  lock.waitLock(30000); // hindari tabrakan tulis saat banyak orang absen bersamaan

  try{
    const body = JSON.parse(e.postData.contents);
    const action = body.action;

    switch(action){

      case "saveUsers":
        objectsToSheet_(SHEET_USERS, body.data);
        return jsonResponse_({ ok: true });

      case "saveSessions":
        objectsToSheet_(SHEET_SESSIONS, body.data);
        return jsonResponse_({ ok: true });

      case "saveSettings":
        objectToSettingsSheet_(body.data);
        return jsonResponse_({ ok: true });

      case "saveAttendance":
        // Overwrite penuh (dipakai saat HRD/Koor mengedit status kehadiran).
        // Field "photo" di sini seharusnya sudah berupa link Drive, bukan base64.
        objectsToSheet_(SHEET_ATTENDANCE, body.data);
        return jsonResponse_({ ok: true });

      case "savePermits":
        // Overwrite penuh (dipakai saat HRD/Koor menyetujui/menolak pengajuan).
        // Field "photo" di sini seharusnya sudah berupa link Drive, bukan base64.
        objectsToSheet_(SHEET_PERMITS, body.data);
        return jsonResponse_({ ok: true });

      case "addPermit": {
        // Dipakai saat STAF mengajukan Izin/Sakit: foto bukti (base64) diunggah
        // ke Drive dulu, baru satu baris pengajuan ditambahkan ke sheet Permits.
        const record = body.data;
        if(record.photo && String(record.photo).startsWith("data:")){
          record.photo = savePhotoToDrive_(
            record.photo,
            `${record.username || "user"}_${record.sessionDate || ""}_${record.id || Date.now()}`,
            PERMIT_DRIVE_FOLDER_NAME
          );
        }
        const list = sheetToObjects_(SHEET_PERMITS);
        list.push(record);
        objectsToSheet_(SHEET_PERMITS, list);
        return jsonResponse_({ ok: true, record: record });
      }

      case "addAttendance": {
        // Dipakai saat STAF absen: foto (base64) diunggah ke Drive dulu,
        // baru satu baris absensi ditambahkan ke sheet Attendance.
        const record = body.data;
        if(record.photo && String(record.photo).startsWith("data:")){
          record.photo = savePhotoToDrive_(
            record.photo,
            `${record.username || "user"}_${record.date || ""}_${record.id || Date.now()}`,
            DRIVE_FOLDER_NAME
          );
        }
        const list = sheetToObjects_(SHEET_ATTENDANCE);
        list.push(record);
        objectsToSheet_(SHEET_ATTENDANCE, list);
        return jsonResponse_({ ok: true, record: record });
      }

      default:
        return jsonResponse_({ ok: false, error: "Action tidak dikenali: " + action });
    }
  }catch(err){
    return jsonResponse_({ ok: false, error: String(err) });
  }finally{
    lock.releaseLock();
  }
}
