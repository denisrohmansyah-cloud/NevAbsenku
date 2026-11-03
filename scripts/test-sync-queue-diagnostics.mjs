import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync("cloud-sync.js","utf8");
const transientStart=source.indexOf("function isTransientCloudError(err){");
const transientEnd=source.indexOf("\nfunction queueActionLabel",transientStart);
assert.notEqual(transientStart,-1);
assert.notEqual(transientEnd,-1);
const context={};
vm.runInNewContext(source.slice(transientStart,transientEnd),context);

assert.equal(context.isTransientCloudError(new Error("Failed to fetch")),true,
  "browser transport failure should be retryable even when device internet is otherwise available");
assert.equal(context.isTransientCloudError(new Error("NetworkError when attempting to fetch resource")),true);
assert.equal(context.isTransientCloudError(new Error("Request timed out")),true);
assert.equal(context.isTransientCloudError(new Error("Respons server bukan JSON")),false,
  "invalid JSON should stay visible as a separate endpoint/response error");

const rememberStart=source.indexOf("function queueActionLabel(action){");
const rememberEnd=source.indexOf("\n\nasync function cloudPost",rememberStart);
assert.notEqual(rememberStart,-1);
assert.notEqual(rememberEnd,-1);
let queue=[{id:"Q-1",action:"addAttendance",data:{id:"ATT-1"}}];
let badgeUpdates=0;
const recovery={
  getCloudQueue:()=>queue,
  setCloudQueue:q=>{queue=JSON.parse(JSON.stringify(q));return true;},
  friendlyCloudError:err=>"Endpoint Apps Script tidak mengembalikan JSON.",
  updateCloudBadge:()=>{badgeUpdates++;},
  Date,
  Number,
  String
};
vm.runInNewContext(source.slice(rememberStart,rememberEnd),recovery);
recovery.rememberCloudQueueFailure(queue[0],new Error("bad response"));
assert.equal(queue[0].lastError,"Endpoint Apps Script tidak mengembalikan JSON.");
assert.equal(queue[0].attemptCount,1);
assert.ok(queue[0].lastAttemptAt);
assert.equal(badgeUpdates,1);
assert.equal(recovery.queueActionLabel("addAttendance"),"pengiriman absensi");

const flushStart=source.indexOf("async function flushCloudQueue(){");
const flushEnd=source.indexOf("\n/* =========================================================\n   LOGIN",flushStart);
const flush=source.slice(flushStart,flushEnd);
assert.ok(flush.includes("rememberCloudQueueFailure(item,err)"),
  "failed retry must persist the cause on the queued item");
assert.ok(flush.includes("getCloudQueue().length"),
  "queue must remain pending until server confirms the operation");
assert.ok(source.includes("el.title=action+(reason?"),
  "badge tooltip must show operation type and last failure");

console.log("PASS: transport failures retry, endpoint errors remain diagnosable, and queue failures persist their reason.");
