import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const html=fs.readFileSync("index.html","utf8");
const priority=fs.readFileSync("priority-suite.js","utf8");
const backend=fs.readFileSync("apps-script/Code.gs","utf8");
const cloud=fs.readFileSync("cloud-sync.js","utf8");

function extract(source,startNeedle,endNeedle,label){
  const start=source.indexOf(startNeedle);
  const end=source.indexOf(endNeedle,start);
  assert.notEqual(start,-1,label+" start exists");
  assert.notEqual(end,-1,label+" end exists");
  return source.slice(start,end);
}

// 1. One Alpha eligibility rule across dashboard, calendar, recap and HRD report.
const alphaStart=html.indexOf("function isAlphaEligibleSession(s){");
const alphaEnd=html.indexOf("\n}",alphaStart);
assert.notEqual(alphaStart,-1,"Alpha helper exists");
assert.notEqual(alphaEnd,-1,"Alpha helper closes");
const alphaCode=html.slice(alphaStart,alphaEnd+2);
const alphaContext={
  isDraftKoorSession:s=>s.draft===true,
  isSessionEnded:s=>s.ended===true,
  isDeactivatedSession:s=>s.deactivated===true
};
vm.runInNewContext(alphaCode,alphaContext);
assert.equal(alphaContext.isAlphaEligibleSession({draft:true,ended:true}),false,
  "draft Koor KP session must never generate Alpha");
assert.equal(alphaContext.isAlphaEligibleSession({ended:false,deactivated:false}),false,
  "unfinished active session must not generate Alpha");
assert.equal(alphaContext.isAlphaEligibleSession({ended:true}),true,
  "ended session must generate Alpha");
assert.equal(alphaContext.isAlphaEligibleSession({deactivated:true}),true,
  "deactivated past/today session may generate Alpha");
for(const [needle,label] of [
  ["if(!isAlphaEligibleSession(s)) return;","implicit/dashboard and report/recap"],
  ["if(!rec&&isAlphaEligibleSession(s))status=\"Alpha\";","staff calendar"],
]) assert.ok(html.includes(needle),label+" uses shared Alpha rule");
assert.ok(priority.includes('ss.filter(s=>String(s.date||"").startsWith(period)&&isAlphaEligibleSession(s))'),
  "monthly analytics excludes sessions that are not Alpha-eligible");
assert.ok(priority.includes('async function withBusyButton(button,label,task)'),
  "attendance-correction actions must provide a reusable busy guard");
assert.ok(priority.includes('withBusyButton(button,"Mengirim..."'),
  "correction submission must reject repeat clicks while saving");
assert.ok(priority.includes('withBusyButton(b,"Memproses..."'),
  "correction review must reject repeat clicks while saving");

// 2. New session creator identity must be derived from the authenticated actor.
const policy=extract(backend,"function sessionPolicy_(old,clean,actor){","\nfunction attendancePolicy_", "sessionPolicy");
const policyContext={};
vm.runInNewContext(policy,policyContext);
const forged={id:"S-1",creatorId:"FAKE",creatorName:"Fake",creatorRole:"KOOR KP",
  activity:"Kegiatan",division:"-",attendanceSubmitted:true,submittedAt:"x",submittedBy:"x",submittedByName:"x"};
policyContext.sessionPolicy_(null,forged,{id:"HRD-1",name:"HRD Aktif",role:"HRD"});
assert.equal(forged.creatorId,"HRD-1");
assert.equal(forged.creatorName,"HRD Aktif");
assert.equal(forged.creatorRole,"HRD",
  "HRD-created session must not be forgeable as an unsubmitted Koor KP draft");
assert.equal(forged.attendanceSubmitted,false);
assert.equal(forged.submittedAt,null);

const koor={id:"S-2",creatorId:"KOOR-1",creatorName:"Koor",creatorRole:"HRD",
  activity:"Ngoprek",division:"Networking",attendanceSubmitted:false};
policyContext.sessionPolicy_(null,koor,{id:"KOOR-1",name:"Koor",role:"KOOR KP",division:"Networking"});
assert.equal(koor.creatorId,"KOOR-1");
assert.equal(koor.creatorRole,"KOOR KP");

// 3. Failed permit append must clean up newly uploaded Drive photo and use session data read in lock.
const addPermit=extract(backend,"function addPermit_(actor,data){","\n/* =========================================================\nSURAT PERINGATAN", "addPermit");
const photoUrl="https://drive.google.com/file/d/FILE1234567890/view";
let trashed=[],savedRecord=null,mode="success";
const latestSession={id:"SES-1",division:"Networking",date:"2026-11-03",
  activity:"Ngoprek",location:"Lab",creatorId:"KOOR-1",creatorRole:"KOOR KP"};
const permitContext={
  SHEET_SESSIONS:"Sessions",
  SHEET_PERMITS:"Permits",
  PERMIT_TYPES:["Izin","Sakit","Dispen"],
  idOk_:v=>!!v,
  str_:(v,n)=>String(v||"").slice(0,n),
  withLock_:fn=>fn(),
  sheetToObjects_:(name)=>name==="Sessions"?[latestSession]:[],
  validPermit_:()=>true,
  savePhotoToDrive_:()=>photoUrl,
  trashNewPhoto_:url=>{
    const id=String(url).match(/\/file\/d\/([^/]+)\//)?.[1];
    if(id) trashed.push({id,value:true});
  },
  newId_:()=>"PERMIT-1",
  appendObject_:(name,record)=>{
    if(mode==="fail")throw new Error("simulated Sheets write failure");
    savedRecord=record;
  },
  DriveApp:{getFileById:id=>({setTrashed:value=>trashed.push({id,value})})},
  Logger:{log(){}},
  auditEvent_(){}
};
vm.runInNewContext(addPermit,permitContext);
const actor={id:"STAF-1",name:"Staf",username:"staf01",role:"STAF",division:"Networking"};
const request={sessionId:"SES-1",type:"Izin",reason:"Keperluan keluarga",photo:"data:image/jpeg;base64,AA=="};
mode="fail";
assert.throws(()=>permitContext.addPermit_(actor,request),/simulated Sheets write failure/);
assert.deepEqual(trashed,[{id:"FILE1234567890",value:true}],
  "newly uploaded permit photo must be trashed when Sheets append fails");
mode="success";trashed=[];
const saved=permitContext.addPermit_(actor,request);
assert.equal(saved.ok,true);
assert.equal(savedRecord.sessionDate,latestSession.date,
  "permit record must use latest session data read inside lock");
assert.equal(savedRecord.sessionActivity,latestSession.activity);

// 3b. Slow Drive uploads must happen before the Script Lock; a rejected write
// cleans the freshly created private file rather than leaving it orphaned.
assert.ok(addPermit.indexOf("const photoUrl=savePhotoToDrive_") < addPermit.indexOf("return withLock_"),
  "permit photo upload must not run while the Script Lock is held");
const addAttendanceForLock=extract(backend,"function addAttendance_(actor,data){","\n/* Staf memindai QR", "addAttendanceForLock");
assert.ok(addAttendanceForLock.indexOf("const photoUrl=savePhotoToDrive_") < addAttendanceForLock.indexOf("return withLock_"),
  "attendance selfie upload must not run while the Script Lock is held");
assert.ok(backend.includes('if(!lock.tryLock(5000))'),
  "lock acquisition must fail quickly so the client queue can retry with backoff");

// 4. Apps Script calls must have an abortable deadline and timeout must be retryable.
const fetchHelper=extract(cloud,"async function fetchCloudText(url,options,timeoutMs){",
  "\nfunction cloudPayload", "fetchCloudText");
assert.ok(fetchHelper.includes("controller.abort()"),"timeout aborts hanging fetch/body read");
const timeoutContext={
  AbortController,
  setTimeout,
  clearTimeout,
  fetch:(url,options)=>new Promise((resolve,reject)=>{
    options.signal.addEventListener("abort",()=>reject(new Error("aborted")));
  }),
  isTransientCloudError:err=>/http 429|http 5\d\d/.test(String(err.message||err))
};
vm.runInNewContext(fetchHelper,timeoutContext);
await assert.rejects(
  timeoutContext.fetchCloudText("https://example.invalid",{method:"POST"},5),
  err=>/melewati batas 1 detik/.test(err.message)&&err.retryable===true
);

// 5. Approved/rejected permits are terminal and cannot be reopened by stale snapshots.
const permitPolicy=extract(backend,"function permitPolicy_(old,clean,actor){","\nfunction settingsToObject_", "permitPolicy");
const policyPermitContext={isSubmittedSession_:()=>false,isDraftKoorSession_:()=>false};
vm.runInNewContext(permitPolicy,policyPermitContext);
const approved={id:"P-1",sessionId:"S-1",sessionCreatorId:"KOOR-1",status:"Disetujui",reviewNote:null,reviewedBy:"HRD-1"};
const stale={...approved,status:"Menunggu",reviewNote:null};
const preserved=policyPermitContext.permitPolicy_(approved,stale,{id:"HRD-1",role:"HRD"});
assert.equal(preserved.status,"Disetujui","approved permit must not be reopened by stale save snapshot");
const pending={id:"P-2",sessionId:"S-2",sessionCreatorId:"KOOR-1",status:"Menunggu",reviewNote:null};
const approvedNow=policyPermitContext.permitPolicy_(pending,{...pending,status:"Disetujui",reviewNote:null},{id:"HRD-1",name:"HRD",role:"HRD"});
assert.equal(approvedNow.status,"Disetujui");
assert.equal(approvedNow.reviewedBy,"HRD-1");

// 6. Server enforces evidence and date constraints even if a browser bypasses UI.
const addAttendance=extract(backend,"function addAttendance_(actor,data){","\n/* Staf memindai QR", "addAttendance");
const addPermitBackend=extract(backend,"function addPermit_(actor,data){","\n/* =========================================================\nSURAT PERINGATAN", "addPermit");
const evalBackend=extract(backend,"function submitEvaluation_(actor,data){","\nconst CORRECTION_HEADERS_", "submitEvaluation");
assert.ok(addAttendance.includes("if(!data.photo)"),"server must require selfie before writing attendance");
assert.ok(addPermitBackend.includes("if(!data.photo)"),"server must require permit proof before writing request");
assert.ok(evalBackend.includes("if(!DATE_RE.test(period))"),"server must validate evaluation date format");
assert.ok(cloud.includes("fetchCloudText(cacheBust(`${CLOUD_SCRIPT_URL}?action=bootstrap`)"),
  "startup bootstrap must use the timeout-protected request helper");

console.log("PASS: Alpha eligibility, session identity, photo cleanup, terminal permit reviews, server-side proof/date checks, and cloud timeouts.");
