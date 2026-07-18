import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assembleUnsignedAssuranceEvidence,
  createCleanupReceipt,
  createPlatformObservations,
  createUnsignedLauncherIndex,
  createUnsignedPackageManifest,
  createUnsignedTargetEvidence,
  loadUnsignedAssurancePolicy,
  validateUnsignedAssurancePolicy,
  validateUnsignedLauncherIndex,
  verifyUnsignedPackageManifest,
  verifyUnsignedReproducibility
} from "./standalone-unsigned-assurance.mjs";
import {
  createStandaloneCandidateZip,
  safeExtractStandaloneCandidateZip
} from "./standalone-safe-zip-extract.mjs";

const sha = (value) => createHash("sha256").update(value).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const clone = (value) => JSON.parse(JSON.stringify(value));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-unsigned-assurance-"));
const policy = loadUnsignedAssurancePolicy();
const runtimeLock = JSON.parse(fs.readFileSync("config/companion-runtime-lock.json", "utf8"));
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const commit = "a".repeat(40);
const version = packageJson.version;

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, jsonBytes(value), { flag: "wx" });
  return file;
}

function launcherRecord(mode, name, contents) {
  const bytes = Buffer.from(contents);
  return { mode, name, bytes: bytes.length, sha256: sha(bytes) };
}

function receiptFixture(target, directory) {
  const suffix = target === "windows-x64" ? ".exe" : "";
  const safe = launcherRecord(
    "safe",
    `dusk-developer-studio-safe-${version}-${target}-internal-rc${suffix}`,
    `safe-${target}`
  );
  const localActions = launcherRecord(
    "local-actions",
    `dusk-developer-studio-local-actions-${version}-${target}-internal-rc${suffix}`,
    `actions-${target}`
  );
  const receipt = {
    schema_version: 3,
    status: "internal-nonpublication-rc",
    channel: "node-sea-in-process",
    target,
    version,
    commit,
    embedded_release_fingerprint_sha256: "1".repeat(64),
    embedded_runtime_version: runtimeLock.runtime.version,
    contains_second_embedded_runtime: false,
    externalized_runtime: {
      path: target === "windows-x64" ? "runtime/node.exe" : "runtime/node",
      bytes_removed_from_bundle: 1,
      sha256: "2".repeat(64)
    },
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
    launchers: { safe, local_actions: localActions },
    unsigned_asset_index_sha256: sha(jsonBytes([safe, localActions])),
    executable: safe.name,
    executable_bytes: safe.bytes,
    executable_sha256: safe.sha256
  };
  return {
    receipt,
    file: writeJson(path.join(directory, "evidence", "prototype-receipt.json"), receipt)
  };
}

function lifecycleMode(mode) {
  return {
    schema_version: 1,
    mode,
    release: { product: "Dusk Developer Studio", version, commit, channel: "portable" },
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
  safe_mode_local_action_denied: true,
  local_actions_preflight_verified: true,
  release_parity_verified: true,
  studio_listening_endpoints_verified: true,
  unexpected_studio_listening_ports_absent: true,
  isolated_user_data_roots_verified: true,
  studio_loopback_services_stopped: true,
  extraction_cleanup_verified: true,
  install_cleanup_verified: true
};
const platformChecks = {
  "windows-x64": [
    "host_target_verified", "publisher_signature_absent", "defender_scan_command_completed"
  ],
  "linux-x64": [
    "host_target_verified", "detached_trust_artifacts_absent", "elf_x64_verified",
    "nx_stack_verified", "special_mode_absent"
  ],
  "darwin-arm64": [
    "host_target_verified", "adhoc_integrity_verified", "gatekeeper_rejected_unsigned"
  ]
};

try {
  assert.equal(validateUnsignedAssurancePolicy(policy, runtimeLock, packageJson), policy);
  const overstated = clone(policy);
  overstated.publication_eligible = true;
  assert.throws(
    () => validateUnsignedAssurancePolicy(overstated, runtimeLock, packageJson),
    /fail-closed trust state/
  );
  for (const mutation of [
    (value) => { value.retention_scope = "machine-wide"; },
    (value) => { value.scoped_candidate_paths_absent_at_check = false; },
    (value) => { value.required_checks = value.required_checks.slice(1); },
    (value) => { value.limitations = value.limitations.slice(1); }
  ]) {
    const invalid = clone(policy);
    mutation(invalid);
    assert.throws(
      () => validateUnsignedAssurancePolicy(invalid, runtimeLock, packageJson),
      /fail-closed trust state/
    );
  }
  assert.throws(
    () => createPlatformObservations("windows-x64", platformChecks["windows-x64"].slice(1)),
    /every exact reviewed check/
  );
  assert.throws(
    () => createPlatformObservations(
      "linux-x64",
      [...platformChecks["linux-x64"]].reverse()
    ),
    /every exact reviewed check/
  );
  assert.throws(
    () => createPlatformObservations(
      "darwin-arm64",
      [...platformChecks["darwin-arm64"], "unexpected"]
    ),
    /every exact reviewed check/
  );

  const stage = path.join(temp, "stage");
  fs.mkdirSync(path.join(stage, "launchers"), { recursive: true });
  const fixture = receiptFixture("windows-x64", stage);
  const safe = path.join(stage, "launchers", fixture.receipt.launchers.safe.name);
  const actions = path.join(stage, "launchers", fixture.receipt.launchers.local_actions.name);
  fs.writeFileSync(safe, "safe-windows-x64");
  fs.writeFileSync(actions, "actions-windows-x64");
  const index = createUnsignedLauncherIndex({
    target: "windows-x64",
    safeLauncher: safe,
    localActionsLauncher: actions,
    safeName: `launchers/${path.basename(safe)}`,
    localActionsName: `launchers/${path.basename(actions)}`,
    buildReceipt: fixture.file
  });
  const indexFile = writeJson(path.join(stage, "unsigned-launcher-index.json"), index);
  assert.equal(
    validateUnsignedLauncherIndex(index, {
      target: "windows-x64",
      receipt: fixture.receipt,
      root: stage
    }),
    index
  );
  const substituted = path.join(temp, "substituted.exe");
  fs.writeFileSync(substituted, "different executable");
  assert.throws(
    () => createUnsignedLauncherIndex({
      target: "windows-x64",
      safeLauncher: substituted,
      localActionsLauncher: actions,
      safeName: `launchers/${path.basename(safe)}`,
      localActionsName: `launchers/${path.basename(actions)}`,
      buildReceipt: fixture.file
    }),
    /not bound to the standalone build receipt/
  );

  const macStage = path.join(temp, "mac-stage");
  const macFixture = receiptFixture("darwin-arm64", macStage);
  const macSafeName = "Dusk Developer Studio.app/Contents/MacOS/dusk-studio";
  const macActionsName = "Dusk Developer Studio Local Actions.app/Contents/MacOS/dusk-studio-local-actions";
  const macSafe = path.join(macStage, ...macSafeName.split("/"));
  const macActions = path.join(macStage, ...macActionsName.split("/"));
  fs.mkdirSync(path.dirname(macSafe), { recursive: true });
  fs.mkdirSync(path.dirname(macActions), { recursive: true });
  fs.writeFileSync(macSafe, "safe-darwin-arm64");
  fs.writeFileSync(macActions, "actions-darwin-arm64");
  const macLaunchers = {
    safe: {
      mode: "safe",
      app_name: "Dusk Developer Studio.app",
      bundle_id: "io.github.georgiandusk.dusk-developer-studio",
      executable_path: macSafeName,
      unsigned_sea_sha256: macFixture.receipt.launchers.safe.sha256
    },
    local_actions: {
      mode: "local-actions",
      app_name: "Dusk Developer Studio Local Actions.app",
      bundle_id: "io.github.georgiandusk.dusk-developer-studio.local-actions",
      executable_path: macActionsName,
      unsigned_sea_sha256: macFixture.receipt.launchers.local_actions.sha256
    }
  };
  const macAppReceipt = {
    schema_version: 2,
    version,
    commit,
    launchers: macLaunchers,
    bundle_id: macLaunchers.safe.bundle_id,
    app_name: macLaunchers.safe.app_name,
    executable_path: macLaunchers.safe.executable_path,
    unsigned_sea_sha256: macLaunchers.safe.unsigned_sea_sha256
  };
  const macAppReceiptFile = writeJson(
    path.join(macStage, "evidence", "macos-app-receipt.json"),
    macAppReceipt
  );
  const macIndex = createUnsignedLauncherIndex({
    target: "darwin-arm64",
    safeLauncher: macSafe,
    localActionsLauncher: macActions,
    safeName: macSafeName,
    localActionsName: macActionsName,
    buildReceipt: macFixture.file,
    macosAppReceipt: macAppReceiptFile
  });
  assert.equal(macIndex.launchers.safe.name, macSafeName);
  assert.equal(macIndex.launchers.local_actions.name, macActionsName);
  assert.equal(
    validateUnsignedLauncherIndex(macIndex, {
      target: "darwin-arm64",
      receipt: macFixture.receipt,
      root: macStage
    }),
    macIndex
  );
  const badMacAppReceipt = clone(macAppReceipt);
  badMacAppReceipt.launchers.safe.executable_path = "Dusk Developer Studio.app/Contents/MacOS/wrong";
  const badMacAppReceiptFile = writeJson(
    path.join(temp, "bad-macos-app-receipt.json"),
    badMacAppReceipt
  );
  assert.throws(
    () => createUnsignedLauncherIndex({
      target: "darwin-arm64",
      safeLauncher: macSafe,
      localActionsLauncher: macActions,
      safeName: macSafeName,
      localActionsName: macActionsName,
      buildReceipt: macFixture.file,
      macosAppReceipt: badMacAppReceiptFile
    }),
    /not bound to its SEA launcher/
  );

  const manifest = createUnsignedPackageManifest({
    root: stage,
    target: "windows-x64",
    buildReceipt: fixture.file,
    launcherIndex: indexFile
  });
  const manifestFile = writeJson(path.join(stage, "unsigned-candidate-manifest.json"), manifest);
  assert.deepEqual(
    verifyUnsignedPackageManifest({
      root: stage,
      target: "windows-x64",
      buildReceipt: fixture.file,
      launcherIndex: indexFile,
      manifestFile
    }),
    manifest
  );

  const archive = path.join(temp, "unsigned-engineering.zip");
  await createStandaloneCandidateZip({
    root: stage,
    target: "windows-x64",
    ephemeralRoot: temp,
    output: archive,
    profile: "unsigned-engineering"
  });
  const extracted = path.join(temp, "extracted");
  await safeExtractStandaloneCandidateZip({
    archive,
    target: "windows-x64",
    ephemeralRoot: temp,
    output: extracted,
    profile: "unsigned-engineering"
  });
  verifyUnsignedPackageManifest({
    root: extracted,
    target: "windows-x64",
    buildReceipt: path.join(extracted, "evidence", "prototype-receipt.json"),
    launcherIndex: path.join(extracted, "unsigned-launcher-index.json"),
    manifestFile: path.join(extracted, "unsigned-candidate-manifest.json")
  });

  const secondReceipt = writeJson(path.join(temp, "second-receipt.json"), fixture.receipt);
  const reproducibility = verifyUnsignedReproducibility({
    target: "windows-x64",
    firstReceipt: fixture.file,
    secondReceipt
  });
  assert.equal(reproducibility.verified, true);
  const changedReceipt = clone(fixture.receipt);
  changedReceipt.commit = "b".repeat(40);
  const changedReceiptFile = writeJson(path.join(temp, "changed-receipt.json"), changedReceipt);
  assert.throws(
    () => verifyUnsignedReproducibility({
      target: "windows-x64",
      firstReceipt: fixture.file,
      secondReceipt: changedReceiptFile
    }),
    /not byte-reproducible/
  );

  const cleanupNegativeRoot = path.join(temp, "cleanup-negative");
  fs.mkdirSync(cleanupNegativeRoot);
  const cleanupNegativePaths = Object.entries(policy.cleanup_paths["windows-x64"])
    .map(([id, relative]) => ({ id, path: path.join(cleanupNegativeRoot, relative) }));
  fs.writeFileSync(cleanupNegativePaths[0].path, "still present");
  assert.throws(
    () => createCleanupReceipt({
      target: "windows-x64",
      scopeRoot: cleanupNegativeRoot,
      paths: cleanupNegativePaths
    }),
    /cleanup is incomplete/
  );
  fs.unlinkSync(cleanupNegativePaths[0].path);
  assert.deepEqual(
    createCleanupReceipt({
      target: "windows-x64",
      scopeRoot: cleanupNegativeRoot,
      paths: cleanupNegativePaths
    }).path_ids,
    Object.keys(policy.cleanup_paths["windows-x64"])
  );
  assert.throws(
    () => createCleanupReceipt({
      target: "windows-x64",
      scopeRoot: cleanupNegativeRoot,
      paths: cleanupNegativePaths.slice(1)
    }),
    /does not enumerate every exact/
  );
  const substitutedCleanup = clone(cleanupNegativePaths);
  substitutedCleanup[0].path = path.join(cleanupNegativeRoot, "absent-substitute");
  assert.throws(
    () => createCleanupReceipt({
      target: "windows-x64",
      scopeRoot: cleanupNegativeRoot,
      paths: substitutedCleanup
    }),
    /does not match its canonical/
  );

  const records = {};
  let firstTargetInput;
  const workflowRef = "GeorgianDusk/dusk-developer-studio/.github/workflows/studio-companion-unsigned-assurance.yml@refs/pull/1/merge";
  for (const target of ["windows-x64", "linux-x64", "darwin-arm64"]) {
    const targetRoot = path.join(temp, "records", target);
    const lifecycle = {
      schema_version: 1,
      assurance_level: "unsigned-engineering-only",
      target,
      same_runner: true,
      clean_machine: false,
      platform_trust: false,
      publication_eligible: false,
      candidate_package: { name: `${target}.zip`, bytes: 1, sha256: "4".repeat(64) },
      release: { version, commit, channel: "portable" },
      launchers: index.launchers,
      build_receipt_sha256: reproducibility.receipt_sha256,
      unsigned_launcher_index_sha256: sha(jsonBytes(index)),
      unsigned_candidate_manifest_sha256: sha(jsonBytes(manifest)),
      modes: { safe: lifecycleMode("safe"), local_actions: lifecycleMode("local-actions") },
      checks: lifecycleChecks
    };
    const lifecycleFile = writeJson(path.join(targetRoot, "lifecycle.json"), lifecycle);
    const targetReproducibility = {
      ...reproducibility,
      target
    };
    const reproducibilityFile = writeJson(
      path.join(targetRoot, "reproducibility.json"),
      targetReproducibility
    );
    const observationsFile = writeJson(
      path.join(targetRoot, "platform.json"),
      createPlatformObservations(target, platformChecks[target])
    );
    const absentPaths = Object.entries(policy.cleanup_paths[target])
      .map(([id, relative]) => ({ id, path: path.join(targetRoot, relative) }));
    const cleanupFile = writeJson(
      path.join(targetRoot, "cleanup.json"),
      createCleanupReceipt({ target, scopeRoot: targetRoot, paths: absentPaths })
    );
    const targetInput = {
      policy,
      target,
      lifecycleReport: lifecycleFile,
      reproducibilityReport: reproducibilityFile,
      platformObservations: observationsFile,
      cleanupReceipt: cleanupFile,
      repository: "GeorgianDusk/dusk-developer-studio",
      workflowRef,
      runId: "42",
      runAttempt: "1",
      runActor: "github:dependabot[bot]",
      expectedCommit: commit,
      passedChecks: policy.required_checks,
      createdAt: "2026-07-18T12:00:00Z"
    };
    if (!firstTargetInput) firstTargetInput = targetInput;
    records[target] = createUnsignedTargetEvidence(targetInput);
  }
  assert.throws(
    () => createUnsignedTargetEvidence({
      ...firstTargetInput,
      passedChecks: policy.required_checks.slice(1)
    }),
    /identity, provenance, or cleanup state/
  );
  assert.throws(
    () => createUnsignedTargetEvidence({
      ...firstTargetInput,
      expectedCommit: "b".repeat(40)
    }),
    /overstates its assurance/
  );
  const aggregate = assembleUnsignedAssuranceEvidence({
    policy,
    records,
    expectedCommit: commit,
    createdAt: "2026-07-18T12:10:00Z"
  });
  assert.equal(aggregate.publication_eligible, false);
  assert.equal(aggregate.platform_trust, false);
  assert.equal(aggregate.clean_machine, false);
  assert.equal(aggregate.retention_scope, "workflow-owned-candidate-paths-only");
  assert.equal(aggregate.scoped_candidate_paths_absent_at_check, true);
  const falseClaim = clone(records);
  falseClaim["linux-x64"].publication_eligible = true;
  assert.throws(
    () => assembleUnsignedAssuranceEvidence({
      policy,
      records: falseClaim,
      expectedCommit: commit,
      createdAt: "2026-07-18T12:10:00Z"
    }),
    /overstates its assurance/
  );
  assert.throws(
    () => assembleUnsignedAssuranceEvidence({
      policy,
      records,
      expectedCommit: "b".repeat(40),
      createdAt: "2026-07-18T12:10:00Z"
    }),
    /overstates its assurance/
  );
  for (const mutation of [
    (value) => { value["linux-x64"].retention_scope = "machine-wide"; },
    (value) => { value["linux-x64"].scoped_candidate_paths_absent_at_check = false; },
    (value) => { value["linux-x64"].platform_observations.elf_x64_verified = false; },
    (value) => { value["linux-x64"].checks.exact_checkout_verified = false; }
  ]) {
    const invalid = clone(records);
    mutation(invalid);
    assert.throws(
      () => assembleUnsignedAssuranceEvidence({
        policy,
        records: invalid,
        expectedCommit: commit,
        createdAt: "2026-07-18T12:10:00Z"
      })
    );
  }

  console.log("Unsigned launcher, package, lifecycle-evidence, and fail-closed fixtures passed.");
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
