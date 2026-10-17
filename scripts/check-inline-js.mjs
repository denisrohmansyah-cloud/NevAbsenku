import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const htmlPath = "index.html";
const html = readFileSync(htmlPath, "utf8");
const blocks = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
  .filter((match) => !/\bsrc\s*=/i.test(match[1]) && match[2].trim().length > 0);

if (blocks.length === 0) {
  console.error("No inline JavaScript blocks found in index.html.");
  process.exit(1);
}

const tempDir = mkdtempSync(join(tmpdir(), "nev-inline-js-"));
let failed = false;

try {
  blocks.forEach((match, index) => {
    const file = join(tempDir, `inline-${index + 1}.js`);
    writeFileSync(file, match[2], "utf8");

    const result = spawnSync(process.execPath, ["--check", file], {
      encoding: "utf8",
    });

    if (result.status !== 0) {
      failed = true;
      console.error(`Syntax error in inline JavaScript block #${index + 1}.`);
      if (result.stderr) console.error(result.stderr.trim());
      if (result.stdout) console.error(result.stdout.trim());
    }
  });
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}

if (failed) process.exit(1);
console.log(`Syntax check passed for ${blocks.length} inline JavaScript block(s).`);
