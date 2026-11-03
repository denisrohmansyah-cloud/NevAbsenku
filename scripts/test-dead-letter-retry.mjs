import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("cloud-sync.js", "utf8");
const start = source.indexOf("window.retryCloudDeadLetters=function(){");
const end = source.indexOf("\n};", start);
assert.notEqual(start, -1, "dead-letter retry function must exist");
assert.notEqual(end, -1, "dead-letter retry function must close");
const fnSource = source.slice(start, end + 3);

let queue = [];
let archive = [{ id: "DL-1", action: "addAttendance", data: { id: "ATT-1" }, createdAt: "2026-11-03T00:00:00.000Z" }];
let failArchiveClear = true;
let flushCount = 0;
const context = {
    window: {},
    getCloudDeadLetters: () => archive,
    getCloudQueue: () => queue,
    setCloudQueue: items => { queue = JSON.parse(JSON.stringify(items)); return true; },
    setCloudDeadLetters: items => {
        if (failArchiveClear && items.length === 0) return false;
        archive = JSON.parse(JSON.stringify(items));
        return true;
    },
    localStorage: { setItem() { throw new Error("direct writes should not be used"); } },
    cloudLastError: null,
    cloudUnsynced: 0,
    cloudQueueCorrupt: false,
    cloudDeadLettersCorrupt: false,
    updateCloudBadge() {},
    flushCloudQueue() { flushCount++; },
    toast() {},
    Date,
    Math
};
vm.runInNewContext(fnSource, context);

context.window.retryCloudDeadLetters();
assert.equal(queue.length, 1, "first retry should queue one operation");
assert.equal(queue[0].retryOf, "DL-1");
assert.equal(archive.length, 1, "failed archive clearing must preserve recovery source");

context.window.retryCloudDeadLetters();
assert.equal(queue.length, 1, "repeated retry must not duplicate the queued operation");
assert.equal(archive.length, 1, "archive remains until it can be cleared");

failArchiveClear = false;
context.window.retryCloudDeadLetters();
assert.equal(queue.length, 1, "successful retry preparation remains idempotent");
assert.equal(archive.length, 0, "archive clears only after queue is persisted");
assert.equal(flushCount, 1, "queue flush starts after archive is cleared");

console.log("PASS: dead-letter retry is idempotent when archive clearing fails.");
