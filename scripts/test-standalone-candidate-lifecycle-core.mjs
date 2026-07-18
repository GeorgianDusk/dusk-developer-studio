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
assert.match(
  source,
  /if \(rejectIfFound && waitForWindowsProcessTreeExit\(pid\)\) return true;[\s\S]*?return waitForWindowsProcessTreeExit\(pid\) && !rejectIfFound;/
);
assert.match(
  source,
  /The close event proves the exact root handle exited[\s\S]*?const descendants = windowsDescendantPids\(child\.pid\);/
);
assert.match(
  source,
  /if \(process\.platform === "win32"\) \{[\s\S]*?const descendants = windowsDescendantPids\(child\.pid\);[\s\S]*?\} else if \(!forceKillProcessGroup\(child\.pid, true\)\)/
);
const windowsProcessExistsSource = source.slice(
  source.indexOf("function windowsProcessExists"),
  source.indexOf("function waitForWindowsProcessTreeExit")
);
assert.match(windowsProcessExistsSource, /\$ErrorActionPreference='Stop'/);
assert.match(
  windowsProcessExistsSource,
  /Get-CimInstance Win32_Process -Filter "ProcessId = \$\{pid\}" -ErrorAction Stop/
);
assert.match(
  windowsProcessExistsSource,
  /if\(\$items\.Count -eq 0\)\{'false'\}elseif\(\$items\.Count -eq 1\)\{'true'\}else\{throw/
);
assert.doesNotMatch(windowsProcessExistsSource, /SilentlyContinue/);

if (process.platform === "win32") {
  await assert.doesNotReject(
    runCandidate(process.execPath, ["-e", ""], { ...process.env }, process.cwd())
  );
  const markerRoot = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-windows-detached-child-"));
  const detachedPidFile = path.join(markerRoot, "pid.txt");
  let detachedPid;
  try {
    await assert.rejects(
      runCandidate(process.execPath, [
        "-e",
        [
          'const { spawn } = require("node:child_process");',
          'const fs = require("node:fs");',
          'const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { detached: true, stdio: "ignore" });',
          'fs.writeFileSync(process.argv[1], String(child.pid), { flag: "wx" });',
          "child.unref();"
        ].join("\n"),
        detachedPidFile
      ], { ...process.env }, process.cwd()),
      (error) => error?.cleanupSafe === false
        && /left a live tracked descendant process/.test(error.message)
    );
    detachedPid = Number(fs.readFileSync(detachedPidFile, "utf8"));
    assert.equal(Number.isSafeInteger(detachedPid) && detachedPid > 0, true);
    process.kill(detachedPid, "SIGKILL");
    let detachedChildGone = false;
    const detachedChildDeadline = Date.now() + 5_000;
    while (Date.now() < detachedChildDeadline) {
      try {
        process.kill(detachedPid, 0);
        await delay(50);
      } catch (error) {
        detachedChildGone = error?.code === "ESRCH";
        break;
      }
    }
    assert.equal(detachedChildGone, true);
  } finally {
    if (detachedPid) {
      try { process.kill(detachedPid, "SIGKILL"); } catch { /* The process is already gone. */ }
    }
    fs.rmSync(markerRoot, { recursive: true, force: true });
  }
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
