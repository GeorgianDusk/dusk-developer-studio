import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  forceKillProcessGroup,
  runCandidate
} from "./standalone-candidate-lifecycle-core.mjs";

const source = fs.readFileSync("scripts/standalone-candidate-lifecycle-core.mjs", "utf8");
assert.match(source, /return error[?][.]code === "ESRCH" && !rejectIfFound;/);

if (process.platform === "win32") {
  const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
    stdio: "ignore",
    windowsHide: true
  });
  await new Promise((resolve, reject) => {
    child.once("spawn", resolve);
    child.once("error", reject);
  });
  await delay(100);
  try {
    assert.equal(forceKillProcessGroup(child.pid), true);
  } finally {
    try { child.kill("SIGKILL"); } catch { /* The process was already confirmed gone. */ }
  }
} else {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-lifecycle-process-group-"));
  const candidate = path.join(root, "leave-child.cjs");
  try {
    fs.writeFileSync(candidate, [
      'const { spawn } = require("node:child_process");',
      'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
      "child.unref();"
    ].join("\n"));
    await assert.rejects(
      runCandidate(process.execPath, [candidate], { ...process.env }, root),
      /left a live tracked process group/
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

console.log("Standalone candidate tracked-process shutdown contract passed.");
