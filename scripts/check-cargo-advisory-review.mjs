import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateCargoAdvisoryReview } from "./cargo-advisory-review-core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policyPath = path.join(root, "config", "cargo-advisory-review.json");
const policy = JSON.parse(fs.readFileSync(policyPath, "utf8"));
const scanner = process.env.CARGO_AUDIT_BIN;
if (!scanner || !path.isAbsolute(scanner)) {
  throw new Error("CARGO_AUDIT_BIN must identify the exact installed cargo-audit binary.");
}
const scannerStat = fs.lstatSync(scanner);
if (!scannerStat.isFile() || scannerStat.isSymbolicLink()) {
  throw new Error("CARGO_AUDIT_BIN must be a regular file, not a link.");
}
const realRoot = fs.realpathSync(root);
const lockPath = path.resolve(realRoot, ...policy.lock_path.split("/"));
const realLockPath = fs.realpathSync(lockPath);
const relativeLock = path.relative(realRoot, realLockPath);
if (
  relativeLock === ""
  || relativeLock.startsWith(`..${path.sep}`)
  || path.isAbsolute(relativeLock)
) {
  throw new Error("Cargo advisory lock path escapes the repository.");
}
const lockStat = fs.lstatSync(lockPath);
if (!lockStat.isFile() || lockStat.isSymbolicLink()) {
  throw new Error("Cargo advisory scan requires a regular lockfile.");
}

const versionResult = spawnSync(scanner, ["--version"], {
  cwd: root,
  encoding: "utf8",
  timeout: 30_000,
  windowsHide: true
});
if (
  versionResult.error
  || versionResult.signal
  || versionResult.status !== 0
  || versionResult.stderr.trim() !== ""
) {
  throw new Error("Could not verify the cargo-audit scanner identity.");
}
const scannerVersion = versionResult.stdout.trim();
const auditResult = spawnSync(scanner, [
  "audit",
  "--file",
  realLockPath,
  "--json",
  "--color",
  "never"
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 10 * 1024 * 1024,
  timeout: 120_000,
  windowsHide: true
});
if (auditResult.error || auditResult.signal || auditResult.status !== 0) {
  throw new Error("The Cargo advisory scanner did not complete successfully.");
}
if (/(?:could not|unable to) update|failed to|fatal:|error:/iu.test(auditResult.stderr)) {
  throw new Error("The Cargo advisory scanner reported an incomplete database or registry update.");
}
let report;
try {
  report = JSON.parse(auditResult.stdout);
} catch {
  throw new Error("The Cargo advisory scanner returned malformed JSON.");
}
const result = validateCargoAdvisoryReview({
  lockBytes: fs.readFileSync(realLockPath),
  policy,
  report,
  scannerVersion
});
console.log(JSON.stringify(result, null, 2));
