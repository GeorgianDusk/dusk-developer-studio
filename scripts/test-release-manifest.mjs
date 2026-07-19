import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateReleaseManifest, writeReleaseManifest } from "./release-metadata.mjs";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-studio-release-"));
try {
  fs.mkdirSync(path.join(root, "apps", "studio", "dist"), { recursive: true });
  fs.mkdirSync(path.join(root, "data", "dusk"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "9.9.9" }));
  fs.writeFileSync(path.join(root, "data", "dusk", "source-freshness.json"), JSON.stringify({ expires_at: "2026-08-03" }));
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "index.html"), "release fixture");
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "assurance-receipt.json"), "{}\n");
  const complete = { dependencyAudit: "passed", secretScan: "passed", browserMatrix: "passed", sourceAccess: "passed", liveSmoke: "passed" };
  const { manifest } = writeReleaseManifest(root, { environment: "staging", ...complete, now: new Date("2026-07-14T12:00:00Z") });
  assert.equal(validateReleaseManifest(root, manifest).artifactCount, 2);
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "index.html"), "tampered fixture");
  assert.throws(() => validateReleaseManifest(root, manifest), /parity/);
  fs.writeFileSync(path.join(root, "apps", "studio", "dist", "index.html"), "release fixture");
  assert.throws(() => writeReleaseManifest(root, { environment: "production", ...complete, secretScan: "not-run", now: new Date("2026-07-14T12:00:00Z") }), /secret_scan/);
  assert.throws(() => writeReleaseManifest(root, { environment: "production", ...complete, sourceAccess: "failed", now: new Date("2026-07-14T12:00:00Z") }), /source_access/);
  assert.throws(() => writeReleaseManifest(root, { environment: "production", ...complete, liveSmoke: "not-run", now: new Date("2026-07-14T12:00:00Z") }), /live_smoke/);
  assert.throws(() => writeReleaseManifest(root, { environment: "production", ...complete, now: new Date("2026-09-01T12:00:00Z") }), /freshness/);
  assert.throws(() => validateReleaseManifest(root, { ...manifest, environment: "production", assurance: Object.fromEntries(Object.keys(manifest.assurance).map((key) => [key, "passed"])), dependency_audit: "passed", commit: "a".repeat(40) + "-dirty" }), /clean full Git commit/);
  execFileSync("git", ["init"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.name", "Release Fixture"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["config", "user.email", "release-fixture@example.invalid"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["add", "."], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: root, stdio: "ignore" });
  const fixtureCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const previousOverride = process.env.DUSK_STUDIO_RELEASE_COMMIT;
  try {
    process.env.DUSK_STUDIO_RELEASE_COMMIT = "f".repeat(40);
    assert.throws(() => writeReleaseManifest(root, { environment: "production", ...complete, now: new Date("2026-07-14T12:00:00Z") }), /must match/);
    process.env.DUSK_STUDIO_RELEASE_COMMIT = fixtureCommit;
    assert.equal(writeReleaseManifest(root, { environment: "production", ...complete, now: new Date("2026-07-14T12:00:00Z") }).manifest.commit, fixtureCommit);
    assert.throws(() => writeReleaseManifest(root, { environment: "production", ...complete, now: new Date("2026-07-14T12:00:00Z") }), /clean committed/);
  } finally {
    if (previousOverride === undefined) delete process.env.DUSK_STUDIO_RELEASE_COMMIT;
    else process.env.DUSK_STUDIO_RELEASE_COMMIT = previousOverride;
  }
  console.log("Release manifest parity and fail-closed fixtures passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
