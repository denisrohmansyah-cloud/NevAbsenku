import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("cloud-sync.js", "utf8");
const start = source.indexOf("function getCloudQueue(){");
const end = source.indexOf("\nfunction exportCloudDeadLetters()", start);
assert.notEqual(start, -1, "cloud queue storage helpers must exist");
assert.notEqual(end, -1, "cloud queue helper block must close");

const raw = source.slice(start, end);
const store = new Map([
  ["nev_cloud_queue_v14_1", "{broken-queue-json"],
  ["nev_cloud_dead_letter_v1", JSON.stringify([{ id: "DL-1", action: "addAttendance" }])]
]);
const localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); }
};
const context = {
  CLOUD_QUEUE_KEY: "nev_cloud_queue_v14_1",
  CLOUD_DEAD_LETTER_KEY: "nev_cloud_dead_letter_v1",
  cloudQueueCorrupt: false,
  cloudDeadLettersCorrupt: false,
  cloudLastError: null,
  localStorage,
  console,
  window: {}
};
vm.runInNewContext(raw, context);

assert.deepEqual(Array.from(context.getCloudQueue()), []);
assert.equal(context.cloudQueueCorrupt, true, "malformed queue must be explicitly flagged");
assert.equal(context.setCloudQueue([]), false, "malformed queue must not be overwritten");
assert.equal(store.get("nev_cloud_queue_v14_1"), "{broken-queue-json", "raw queue bytes must be retained");

assert.equal(context.getCloudDeadLetters().length, 1);
assert.equal(context.cloudDeadLettersCorrupt, false);

store.set("nev_cloud_dead_letter_v1", "{broken-archive-json");
assert.deepEqual(Array.from(context.getCloudDeadLetters()), []);
assert.equal(context.cloudDeadLettersCorrupt, true, "malformed recovery archive must be explicitly flagged");
assert.equal(context.setCloudDeadLetters([]), false, "malformed archive must not be overwritten");
assert.equal(store.get("nev_cloud_dead_letter_v1"), "{broken-archive-json", "raw archive bytes must be retained");

const applyStart = source.indexOf("function applyCloudAll(json){");
const applyEnd = source.indexOf("\nasync function fetchCloudAll()", applyStart);
const applySource = source.slice(applyStart, applyEnd);
assert.ok(applySource.includes("if(cloudQueueCorrupt || cloudDeadLettersCorrupt)"), "cloud bootstrap must stop before replacing local cache on corrupt recovery storage");

const purgeStart = source.indexOf("async function purgeCloudData(options){");
const purgeEnd = source.indexOf("\n/* =========================================================\n   OVERRIDE save()", purgeStart);
const purgeSource = source.slice(purgeStart, purgeEnd);
assert.ok(purgeSource.includes("setCloudDeadLetters([])"), "successful purge must clear stale dead-letter operations");
assert.ok(purgeSource.includes("cloudDeadLettersCorrupt"), "purge must reject unreadable recovery storage");

console.log("PASS: malformed sync storage is retained, cloud bootstrap fails closed, and purge clears stale recovery items.");
