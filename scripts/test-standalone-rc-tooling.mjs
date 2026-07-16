import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleStandaloneSigningEvidence } from "./assemble-standalone-signing-evidence.mjs";
import { createMacosStandaloneApp } from "./standalone-macos-app.mjs";
import { expectedTargetIdentity } from "./standalone-signing-evidence.mjs";
import { createStandaloneTargetEvidence } from "./standalone-target-evidence.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-standalone-rc-tooling-"));
const policy = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "companion-standalone-signing-policy.json"), "utf8"));
const releaseTag = "studio-companion-v1.0.0-rc.1";
const commit = "b".repeat(40);
const clone = (value) => JSON.parse(JSON.stringify(value));

function writeReceipt(target, directory, executable, executableBytes, recordCommit = commit) {
  const receipt = {
    schema_version: 2,
    status: "private-nonpublication-prototype",
    channel: "node-sea-in-process",
    target,
    version: "0.1.0",
    commit: recordCommit,
    executable,
    executable_sha256: sha(executableBytes)
  };
  const file = path.join(directory, "prototype-receipt.json");
  fs.writeFileSync(file, JSON.stringify(receipt));
  return file;
}

try {
  const macInput = path.join(root, "mac-input");
  fs.mkdirSync(macInput);
  const macBytes = Buffer.from("unsigned macOS SEA");
  const macExecutable = path.join(macInput, "dusk-studio-darwin-arm64");
  fs.writeFileSync(macExecutable, macBytes);
  const macReceipt = writeReceipt("darwin-arm64", macInput, path.basename(macExecutable), macBytes);
  const appOutput = path.join(root, "mac-app");
  const app = createMacosStandaloneApp({ executable: macExecutable, buildReceipt: macReceipt, outDir: appOutput });
  assert.equal(app.receipt.bundle_id, "network.dusk.developer-studio");
  assert.equal(fs.readFileSync(app.executable, "utf8"), macBytes.toString());
  assert.match(fs.readFileSync(path.join(app.app, "Contents", "Info.plist"), "utf8"), /Dusk Developer Studio/);
  assert.match(fs.readFileSync(path.join(app.app, "Contents", "Info.plist"), "utf8"), /network\.dusk\.developer-studio/);
  assert.throws(() => createMacosStandaloneApp({ executable: macExecutable, buildReceipt: macReceipt, outDir: appOutput }), /already exists/);

  const tamperedReceipt = path.join(macInput, "tampered-receipt.json");
  fs.writeFileSync(tamperedReceipt, JSON.stringify({ ...JSON.parse(fs.readFileSync(macReceipt, "utf8")), executable_sha256: "0".repeat(64) }));
  assert.throws(() => createMacosStandaloneApp({ executable: macExecutable, buildReceipt: tamperedReceipt, outDir: path.join(root, "tampered-app") }), /does not match/);

  const records = {};
  const configuredPolicy = clone(policy);
  configuredPolicy.targets["windows-x64"].approved_identity = "CN=Dusk Network B.V.";
  configuredPolicy.targets["darwin-arm64"].approved_identity = "DUSKTEAM01";
  for (const target of ["windows-x64", "linux-x64", "darwin-arm64"]) {
    const directory = path.join(root, target);
    fs.mkdirSync(directory);
    const executableName = target === "windows-x64" ? "dusk-studio.exe" : "dusk-studio";
    const unsignedBytes = Buffer.from(`unsigned-${target}`);
    const receipt = writeReceipt(target, directory, executableName, unsignedBytes);
    const artifactName = target === "darwin-arm64" ? "dusk-studio-macos.zip" : executableName;
    const artifact = path.join(directory, artifactName);
    fs.writeFileSync(artifact, Buffer.from(`signed-${target}`));
    const targetPolicy = policy.targets[target];
    records[target] = createStandaloneTargetEvidence({
      policy: configuredPolicy,
      target,
      artifact,
      buildReceipt: receipt,
      releaseTag,
      identity: expectedTargetIdentity(configuredPolicy, target, releaseTag),
      oidcIssuer: targetPolicy.approved_oidc_issuer ?? "",
      passedChecks: targetPolicy.required_checks
    });
    assert.equal(records[target].artifact_sha256, sha(Buffer.from(`signed-${target}`)));
    assert.equal(records[target].unsigned_artifact_sha256, sha(unsignedBytes));
  }

  const assembled = assembleStandaloneSigningEvidence({ policy, records, runId: "42", createdAt: "2026-07-16T00:00:00Z" });
  assert.equal(assembled.release_tag, releaseTag);
  assert.equal(assembled.commit, commit);
  assert.deepEqual(Object.keys(assembled.targets), ["windows-x64", "linux-x64", "darwin-arm64"]);

  const mismatched = clone(records);
  mismatched["linux-x64"].commit = "c".repeat(40);
  assert.throws(() => assembleStandaloneSigningEvidence({ policy, records: mismatched, runId: "42" }), /one release candidate/);
  assert.throws(() => assembleStandaloneSigningEvidence({ policy, records, runId: "0" }), /run id is invalid/);
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log("Standalone signed-RC app, target-evidence, and assembly fixtures passed.");
