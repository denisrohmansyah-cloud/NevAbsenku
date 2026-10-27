import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const html = readFileSync("index.html", "utf8");
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter((match) => !/\bsrc\s*=/i.test(match[1]) && match[2].trim().length > 0);

if (blocks.length === 0) {
  console.error("No inline JavaScript blocks found in index.html.");
  process.exit(1);
}

let failed = false;

blocks.forEach((match, index) => {
  // Module mode permits top-level await used by the application's inline script.
  const result = spawnSync(process.execPath, ["--check", "--input-type=module"], {
    input: match[2],
    encoding: "utf8",
  });

  if (result.status !== 0) {
    failed = true;
    console.error("Syntax error in inline JavaScript block #" + (index + 1) + ".");
    if (result.stderr) console.error(result.stderr.trim());
    if (result.stdout) console.error(result.stdout.trim());
  }
});

if (failed) process.exit(1);
console.log("Syntax check passed for " + blocks.length + " inline JavaScript block(s).");
