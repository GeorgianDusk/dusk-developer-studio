import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assembleStandaloneSigningEvidence } from "./assemble-standalone-signing-evidence.mjs";
import { runStandaloneCandidateLifecycle, validateStandaloneSelfTestResult } from "./companion-standalone-self-test.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";
import { createCandidatePackageManifest } from "./standalone-candidate-package-manifest.mjs";
import { createMacosStandaloneApp } from "./standalone-macos-app.mjs";
import { createSignedLauncherIndex } from "./standalone-signed-launcher-index.mjs";
import { expectedTargetIdentity, expectedWorkflowRef } from "./standalone-signing-evidence.mjs";
import { createStandaloneTargetEvidence } from "./standalone-target-evidence.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-standalone-rc-tooling-"));
const policy = JSON.parse(fs.readFileSync(path.join(process.cwd(), "config", "companion-standalone-signing-policy.json"), "utf8"));
const releaseTag = "studio-companion-v0.1.0-rc.1";
const commit = "b".repeat(40);
const repository = policy.canonical_repository;
const workflowRef = expectedWorkflowRef(policy, releaseTag);
const runId = "42";
const runAttempt = "1";
const runActor = "github:GeorgianDusk";
const targetCreatedAt = "2026-07-15T23:50:00Z";
const approvalReferenceUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/issues/42";
const clone = (value) => JSON.parse(JSON.stringify(value));

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

function launcherRecord(mode, name, contents) {
  const bytes = Buffer.from(contents);
  return { mode, name, bytes: bytes.length, sha256: sha(bytes) };
}

function receiptFixture(target, directory) {
  const suffix = target === "windows-x64" ? ".exe" : "";
  const safe = launcherRecord("safe", `dusk-developer-studio-safe-0.1.0-${target}-internal-rc${suffix}`, `unsigned-safe-${target}`);
  const localActions = launcherRecord("local-actions", `dusk-developer-studio-local-actions-0.1.0-${target}-internal-rc${suffix}`, `unsigned-actions-${target}`);
  const launchers = { safe, local_actions: localActions };
  const receipt = {
    schema_version: 3,
    status: "internal-nonpublication-rc",
    channel: "node-sea-in-process",
    target,
    version: "0.1.0",
    commit,
    embedded_release_fingerprint_sha256: "1".repeat(64),
    embedded_runtime_version: "24.18.0",
    contains_second_embedded_runtime: false,
    externalized_runtime: { path: target === "windows-x64" ? "runtime/node.exe" : "runtime/node", bytes_removed_from_bundle: 1, sha256: "2".repeat(64) },
    embedded_file_count: 1,
    embedded_release_bundle_bytes: 1,
    embedded_release_bundle_sha256: "3".repeat(64),
    postject_version: "1.0.0-alpha.6",
    platform_signature_status: target === "darwin-arm64" ? "adhoc-development-only" : "unsigned",
    embedded_payload_trust: {
      portable_manifest_signing_status: "unsigned-rc",
      standalone_platform_trust: "not-established",
      publication_eligible: false
    },
    launchers,
    unsigned_asset_index_sha256: sha(Buffer.from(`${JSON.stringify([safe, localActions], null, 2)}\n`)),
    executable: safe.name,
    executable_bytes: safe.bytes,
    executable_sha256: safe.sha256
  };
  return { receipt, file: writeJson(path.join(directory, "evidence", "prototype-receipt.json"), receipt) };
}

function lifecycleMode(mode, receipt) {
  return {
    schema_version: 1,
    mode,
    release: { product: "Dusk Developer Studio", version: receipt.version, commit: receipt.commit, channel: "portable" },
    bootstrap_succeeded: true,
    bootstrap_replay_denied: true,
    authenticated_session_verified: true,
    exact_release_parity_verified: true,
    capability_contract_verified: true,
    expected_studio_listening_endpoints: ["127.0.0.1:5173", "127.0.0.1:8788"],
    unexpected_studio_listening_endpoints: [],
    isolated_project_root_verified: true,
    studio_loopback_services_stopped: true
  };
}

const lifecycleChecks = {
  bootstrap_one_time_verified: true,
  authenticated_session_verified: true,
  safe_mode_local_action_denied: true,
  local_actions_preflight_verified: true,
  release_parity_verified: true,
  studio_listening_endpoints_verified: true,
  unexpected_studio_listening_ports_absent: true,
  isolated_user_data_roots_verified: true,
  studio_loopback_services_stopped: true,
  extraction_cleanup_verified: true,
  install_cleanup_verified: true,
  install_rollback_verified: true
};

try {
  const validatedReceipt = receiptFixture("windows-x64", path.join(root, "receipt-validation")).receipt;
  assert.equal(validateStandaloneBuildReceipt(validatedReceipt, "windows-x64"), validatedReceipt);
  const overstatedTrust = clone(validatedReceipt);
  overstatedTrust.embedded_payload_trust.publication_eligible = true;
  assert.throws(() => validateStandaloneBuildReceipt(overstatedTrust, "windows-x64"), /overstates candidate trust/);
  const staleRuntime = clone(validatedReceipt);
  staleRuntime.embedded_runtime_version = "24.11.0";
  assert.throws(() => validateStandaloneBuildReceipt(staleRuntime, "windows-x64"), /frozen toolchain/);
  const forgedAssetIndex = clone(validatedReceipt);
  forgedAssetIndex.unsigned_asset_index_sha256 = "f".repeat(64);
  assert.throws(() => validateStandaloneBuildReceipt(forgedAssetIndex, "windows-x64"), /exact dual-launcher asset index/);
  const extendedReceipt = { ...clone(validatedReceipt), unexpected: true };
  assert.throws(() => validateStandaloneBuildReceipt(extendedReceipt, "windows-x64"), /unexpected shape/);

  const macInput = path.join(root, "mac-input");
  fs.mkdirSync(macInput);
  const macReceiptFixture = receiptFixture("darwin-arm64", macInput);
  const macSafe = path.join(macInput, macReceiptFixture.receipt.launchers.safe.name);
  const macActions = path.join(macInput, macReceiptFixture.receipt.launchers.local_actions.name);
  fs.writeFileSync(macSafe, "unsigned-safe-darwin-arm64");
  fs.writeFileSync(macActions, "unsigned-actions-darwin-arm64");
  const appOutput = path.join(root, "mac-app");
  const app = createMacosStandaloneApp({
    safeExecutable: macSafe,
    localActionsExecutable: macActions,
    buildReceipt: macReceiptFixture.file,
    outDir: appOutput
  });
  assert.equal(app.receipt.schema_version, 2);
  assert.equal(app.receipt.launchers.safe.bundle_id, "io.github.georgiandusk.dusk-developer-studio");
  assert.equal(app.receipt.launchers.local_actions.bundle_id, "io.github.georgiandusk.dusk-developer-studio.local-actions");
  assert.equal(fs.readFileSync(app.executable, "utf8"), "unsigned-safe-darwin-arm64");
  assert.equal(fs.readFileSync(app.localActionsExecutable, "utf8"), "unsigned-actions-darwin-arm64");
  assert.throws(() => createMacosStandaloneApp({
    safeExecutable: macSafe,
    buildReceipt: macReceiptFixture.file,
    outDir: path.join(root, "mac-app-missing-actions")
  }), /macOS local-actions SEA executable is required/);
  assert.throws(() => createMacosStandaloneApp({
    safeExecutable: macSafe,
    localActionsExecutable: macActions,
    buildReceipt: macReceiptFixture.file,
    outDir: appOutput
  }), /already exists/);

  const configuredPolicy = clone(policy);
  configuredPolicy.targets["windows-x64"].approved_identity = "CN=Independent Developer";
  configuredPolicy.targets["darwin-arm64"].approved_identity = "TEAMID0001";
  const records = {};
  for (const target of ["windows-x64", "linux-x64", "darwin-arm64"]) {
    const directory = path.join(root, target);
    const stage = path.join(directory, "stage");
    fs.mkdirSync(path.join(stage, "launchers"), { recursive: true });
    const targetReceiptFixture = receiptFixture(target, stage);
    const safeName = target === "darwin-arm64"
      ? "Dusk Developer Studio.app/Contents/MacOS/dusk-studio"
      : `launchers/${target === "windows-x64" ? "dusk-studio-safe.exe" : "dusk-studio-safe"}`;
    const actionsName = target === "darwin-arm64"
      ? "Dusk Developer Studio Local Actions.app/Contents/MacOS/dusk-studio-local-actions"
      : `launchers/${target === "windows-x64" ? "dusk-studio-local-actions.exe" : "dusk-studio-local-actions"}`;
    const safeFile = path.join(stage, ...safeName.split("/"));
    const actionsFile = path.join(stage, ...actionsName.split("/"));
    fs.mkdirSync(path.dirname(safeFile), { recursive: true });
    fs.mkdirSync(path.dirname(actionsFile), { recursive: true });
    fs.writeFileSync(safeFile, `signed-safe-${target}`);
    fs.writeFileSync(actionsFile, `signed-actions-${target}`);
    let safeAttestation;
    let actionsAttestation;
    if (target === "linux-x64") {
      safeAttestation = path.join(stage, "attestations", "safe.sigstore.json");
      actionsAttestation = path.join(stage, "attestations", "local-actions.sigstore.json");
      fs.mkdirSync(path.dirname(safeAttestation), { recursive: true });
      fs.writeFileSync(safeAttestation, "{}");
      fs.writeFileSync(actionsAttestation, "{}");
    }
    const index = createSignedLauncherIndex({
      target,
      safeLauncher: safeFile,
      localActionsLauncher: actionsFile,
      safeName,
      localActionsName: actionsName,
      buildReceipt: targetReceiptFixture.file,
      safeAttestation,
      localActionsAttestation: actionsAttestation
    });
    const indexFile = writeJson(path.join(stage, "signed-launcher-index.json"), index);
    if (target === "darwin-arm64") {
      for (const launcher of [safeName, actionsName]) {
        const appRoot = launcher.slice(0, launcher.indexOf("/Contents/MacOS/"));
        writeJson(path.join(stage, appRoot, "Contents", "Info.plist"), { fixture: true });
        writeJson(path.join(stage, appRoot, "Contents", "_CodeSignature", "CodeResources"), { fixture: true });
        writeJson(path.join(stage, appRoot, "Contents", "CodeResources"), { stapled: true });
      }
      writeJson(path.join(stage, "evidence", "macos-app-receipt.json"), { fixture: true });
      writeJson(path.join(stage, "evidence", "notarization.json"), { status: "Accepted" });
    }
    const packageManifest = createCandidatePackageManifest({
      root: stage,
      target,
      buildReceipt: targetReceiptFixture.file,
      signedLauncherIndex: indexFile
    });
    const packageManifestFile = writeJson(path.join(stage, "candidate-package-manifest.json"), packageManifest);
    const candidatePackage = path.join(directory, `dusk-developer-studio-0.1.0-${target}-internal-rc.zip`);
    fs.writeFileSync(candidatePackage, `candidate-package-${target}`);
    const packageStat = fs.statSync(candidatePackage);
    const lifecycle = {
      schema_version: 1,
      target,
      release: { version: targetReceiptFixture.receipt.version, commit, channel: "portable" },
      candidate_package: { name: path.basename(candidatePackage), bytes: packageStat.size, sha256: sha(fs.readFileSync(candidatePackage)) },
      signed_launchers: index.launchers,
      build_receipt_sha256: sha(fs.readFileSync(targetReceiptFixture.file)),
      unsigned_asset_index_sha256: targetReceiptFixture.receipt.unsigned_asset_index_sha256,
      signed_launcher_index_sha256: sha(fs.readFileSync(indexFile)),
      candidate_package_manifest_sha256: sha(fs.readFileSync(packageManifestFile)),
      modes: { safe: lifecycleMode("safe", targetReceiptFixture.receipt), local_actions: lifecycleMode("local-actions", targetReceiptFixture.receipt) },
      checks: lifecycleChecks
    };
    const lifecycleFile = writeJson(path.join(directory, "lifecycle.json"), lifecycle);
    const targetPolicy = configuredPolicy.targets[target];
    records[target] = createStandaloneTargetEvidence({
      policy: configuredPolicy,
      target,
      candidatePackage,
      buildReceipt: targetReceiptFixture.file,
      lifecycleReport: lifecycleFile,
      releaseTag,
      identity: expectedTargetIdentity(configuredPolicy, target, releaseTag),
      oidcIssuer: targetPolicy.approved_oidc_issuer ?? "",
      passedChecks: targetPolicy.required_checks,
      repository,
      workflowRef,
      runId,
      runAttempt,
      runActor,
      createdAt: targetCreatedAt
    });
    assert.equal(records[target].schema_version, 3);
    assert.equal(records[target].candidate_package.sha256, lifecycle.candidate_package.sha256);
    assert.equal(records[target].signed_launcher_index_sha256, lifecycle.signed_launcher_index_sha256);
    assert.deepEqual(records[target].lifecycle_report, lifecycle);
  }

  const assembled = assembleStandaloneSigningEvidence({
    policy: configuredPolicy,
    records,
    runId,
    runAttempt,
    runActor,
    approvalReferenceUrl,
    createdAt: "2026-07-16T00:00:00Z"
  });
  assert.equal(assembled.release_tag, releaseTag);
  assert.equal(assembled.commit, commit);
  assert.deepEqual(Object.keys(assembled.targets), ["windows-x64", "linux-x64", "darwin-arm64"]);

  const mismatched = clone(records);
  mismatched["linux-x64"].commit = "c".repeat(40);
  assert.throws(() => assembleStandaloneSigningEvidence({ policy: configuredPolicy, records: mismatched, runId, runAttempt, runActor, approvalReferenceUrl }), /one release candidate/);
  assert.throws(() => assembleStandaloneSigningEvidence({ policy: configuredPolicy, records, runId: "0", runAttempt, runActor, approvalReferenceUrl }), /run id is invalid/);

  const badLifecycle = clone(JSON.parse(fs.readFileSync(path.join(root, "windows-x64", "lifecycle.json"), "utf8")));
  badLifecycle.checks.install_cleanup_verified = false;
  const badLifecycleFile = writeJson(path.join(root, "windows-x64", "bad-lifecycle.json"), badLifecycle);
  assert.throws(() => createStandaloneTargetEvidence({
    policy: configuredPolicy,
    target: "windows-x64",
    candidatePackage: path.join(root, "windows-x64", "dusk-developer-studio-0.1.0-windows-x64-internal-rc.zip"),
    buildReceipt: path.join(root, "windows-x64", "stage", "evidence", "prototype-receipt.json"),
    lifecycleReport: badLifecycleFile,
    releaseTag,
    identity: configuredPolicy.targets["windows-x64"].approved_identity,
    passedChecks: configuredPolicy.targets["windows-x64"].required_checks,
    repository,
    workflowRef,
    runId,
    runAttempt,
    runActor,
    createdAt: targetCreatedAt
  }), /not bound|did not pass/);

  const expectedMode = lifecycleMode("safe", { version: "0.1.0", commit });
  assert.deepEqual(validateStandaloneSelfTestResult(expectedMode, { mode: "safe", release: { version: "0.1.0", commit } }), expectedMode);
  assert.throws(() => validateStandaloneSelfTestResult({ ...expectedMode, unexpected_studio_listening_endpoints: ["127.0.0.1:9999"] }, {
    mode: "safe", release: { version: "0.1.0", commit }
  }), /invalid/);

  const unexpectedStage = path.join(root, "unexpected-stage");
  fs.cpSync(path.join(root, "windows-x64", "stage"), unexpectedStage, { recursive: true });
  fs.rmSync(path.join(unexpectedStage, "candidate-package-manifest.json"));
  fs.writeFileSync(path.join(unexpectedStage, "unexpected.txt"), "must be rejected");
  assert.throws(() => createCandidatePackageManifest({
    root: unexpectedStage,
    target: "windows-x64",
    buildReceipt: path.join(unexpectedStage, "evidence", "prototype-receipt.json"),
    signedLauncherIndex: path.join(unexpectedStage, "signed-launcher-index.json")
  }), /unexpected inventory/);

  const symlinkStage = path.join(root, "symlink-stage");
  fs.cpSync(path.join(root, "windows-x64", "stage"), symlinkStage, { recursive: true });
  fs.rmSync(path.join(symlinkStage, "candidate-package-manifest.json"));
  try {
    fs.symlinkSync(path.join(symlinkStage, "launchers"), path.join(symlinkStage, "linked-launchers"), "junction");
    assert.throws(() => createCandidatePackageManifest({
      root: symlinkStage,
      target: "windows-x64",
      buildReceipt: path.join(symlinkStage, "evidence", "prototype-receipt.json"),
      signedLauncherIndex: path.join(symlinkStage, "signed-launcher-index.json")
    }), /symlink|reparse/);
  } catch (error) {
    if (error?.code !== "EPERM") throw error;
  }

  const hostTarget = process.platform === "win32" ? "windows-x64"
    : process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64" : "linux-x64";
  await assert.rejects(runStandaloneCandidateLifecycle({
    target: hostTarget,
    ephemeralRoot: root,
    cleanupRoot: root,
    workspace: path.join(root, "workspace-unsafe"),
    output: path.join(root, "unsafe.json")
  }), /Cleanup root/);
  const collisionCleanup = path.join(root, "installed-collision");
  fs.mkdirSync(collisionCleanup);
  const collisionOutput = path.join(root, "collision.json");
  fs.writeFileSync(collisionOutput, "{}");
  await assert.rejects(runStandaloneCandidateLifecycle({
    target: hostTarget,
    ephemeralRoot: root,
    cleanupRoot: collisionCleanup,
    workspace: path.join(root, "workspace-collision"),
    output: collisionOutput
  }), /must not already exist/);

  console.log("Standalone dual-launcher package, lifecycle, target-evidence, and adversarial fixtures passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
