import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync("cloud-sync.js", "utf8");
const start = source.indexOf('const DATA_EPOCH = "clean-2026-10-01b";');
const end = source.indexOf("})();", start);
assert.notEqual(start, -1, "DATA_EPOCH migration block must exist");
assert.notEqual(end, -1, "DATA_EPOCH migration IIFE must close");
const migration = source.slice(start, end + 4);

function runCase(initial) {
    const store = new Map(Object.entries(initial).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)]));
    const removed = [];
    const localStorage = {
        getItem(key) { return store.has(key) ? store.get(key) : null; },
        setItem(key, value) { store.set(key, String(value)); },
        removeItem(key) { removed.push(key); store.delete(key); }
    };
    const context = {
        DB: { sessions: "sessions", attendance: "attendance", permits: "permits" },
        CLOUD_QUEUE_KEY: "nev_cloud_queue_v14_1",
        CLOUD_DEAD_LETTER_KEY: "nev_cloud_dead_letter_v1",
        localStorage,
        console: { warn() {} }
    };
    vm.runInNewContext(migration, context);
    return { store, removed };
}

{
    const r = runCase({ nev_data_epoch: "old", nev_cloud_queue_v14_1: [{ action: "saveAttendance" }], attendance: [{ id: "a1" }] });
    assert.equal(r.store.get("nev_data_epoch"), "old");
    assert.ok(r.store.has("nev_cloud_queue_v14_1"));
    assert.ok(r.store.has("attendance"));
    assert.deepEqual(r.removed, []);
}
{
    const r = runCase({ nev_data_epoch: "old", nev_cloud_dead_letter_v1: [{ action: "addAttendance" }], sessions: [] });
    assert.equal(r.store.get("nev_data_epoch"), "old");
    assert.ok(r.store.has("nev_cloud_dead_letter_v1"));
    assert.deepEqual(r.removed, []);
}
{
    const r = runCase({ nev_data_epoch: "old", attendance: [{ id: "local-only" }], nev_cloud_queue_v14_1: [], nev_cloud_dead_letter_v1: [] });
    assert.equal(r.store.get("nev_data_epoch"), "old");
    assert.ok(r.store.has("attendance"));
    assert.deepEqual(r.removed, []);
}
{
    const r = runCase({ nev_data_epoch: "old", nev_cloud_queue_v14_1: "{broken-json", attendance: [] });
    assert.equal(r.store.get("nev_data_epoch"), "old");
    assert.deepEqual(r.removed, []);
}
{
    const r = runCase({ nev_data_epoch: "old", nev_cloud_queue_v14_1: [], nev_cloud_dead_letter_v1: [], sessions: [], attendance: [], permits: [] });
    assert.equal(r.store.get("nev_data_epoch"), "clean-2026-10-01b");
    assert.deepEqual(r.removed, [], "migration must not delete localStorage keys");
}

console.log("PASS: DATA_EPOCH migration preserves pending, archived, local-only, and malformed data.");
