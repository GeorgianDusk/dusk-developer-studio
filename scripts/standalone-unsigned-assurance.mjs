import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";
import { exactKeys, regularFile } from "./standalone-candidate-lifecycle-core.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POLICY_PATH = path.join(ROOT, "config", "companion-unsigned-assurance-policy.json");
const TARGETS = ["windows-x64", "linux-x64", "darwin-arm64"];
const TARGET_SET = new Set(TARGETS);
const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const RUN_RE = /^[1-9][0-9]*$/;
const ACTOR_RE = /^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?(?:\[bot\])?$/;
const ASSURANCE_LEVEL = "unsigned-engineering-only";
const RETENTION_SCOPE = "workflow-owned-candidate-paths-only";
const CLEANUP_PATHS = Object.freeze({
  "windows-x64": Object.freeze({
    standard_user_root: "unsigned-windows-standard-user",
    runtime_archive: "node-v24.18.0-win-x64.zip",
    bundle_1: "unsigned-windows-bundle-1",
    bundle_2: "unsigned-windows-bundle-2",
    release_1: "unsigned-windows-release-1",
    release_2: "unsigned-windows-release-2",
    sea_1: "unsigned-windows-sea-1",
    sea_2: "unsigned-windows-sea-2",
    package_stage: "unsigned-windows-stage",
    install_root: "unsigned-windows-standard-user/installed-unsigned-windows",
    lifecycle_workspace: "unsigned-windows-standard-user/unsigned-lifecycle-windows",
    candidate_zip: "unsigned-windows-standard-user/unsigned-windows-engineering.zip"
  }),
  "linux-x64": Object.freeze({
    runtime_archive: "node-v24.18.0-linux-x64.tar.xz",
    bundle_1: "unsigned-linux-bundle-1",
    bundle_2: "unsigned-linux-bundle-2",
    release_1: "unsigned-linux-release-1",
    release_2: "unsigned-linux-release-2",
    sea_1: "unsigned-linux-sea-1",
    sea_2: "unsigned-linux-sea-2",
    package_stage: "unsigned-linux-stage",
    install_root: "installed-unsigned-linux",
    lifecycle_workspace: "unsigned-lifecycle-linux",
    candidate_zip: "unsigned-linux-engineering.zip"
  }),
  "darwin-arm64": Object.freeze({
    runtime_archive: "node-v24.18.0-darwin-arm64.tar.xz",
    bundle_1: "unsigned-macos-bundle-1",
    bundle_2: "unsigned-macos-bundle-2",
    release_1: "unsigned-macos-release-1",
    release_2: "unsigned-macos-release-2",
    sea_1: "unsigned-macos-sea-1",
    sea_2: "unsigned-macos-sea-2",
    app_bundle_root: "unsigned-macos-apps",
    package_stage: "unsigned-macos-stage",
    install_root: "installed-unsigned-macos",
    lifecycle_workspace: "unsigned-lifecycle-macos",
    candidate_zip: "unsigned-macos-engineering.zip"
  })
});
const MANIFEST_NAME = "unsigned-candidate-manifest.json";
const INDEX_NAME = "unsigned-launcher-index.json";
const RECEIPT_NAME = "evidence/prototype-receipt.json";
const MAC_APP_RECEIPT_NAME = "evidence/macos-app-receipt.json";
const MAC_APP_LAUNCHERS = Object.freeze({
  safe: Object.freeze({
    mode: "safe",
    app_name: "Dusk Developer Studio.app",
    bundle_id: "io.github.georgiandusk.dusk-developer-studio",
    executable_path: "Dusk Developer Studio.app/Contents/MacOS/dusk-studio"
  }),
  local_actions: Object.freeze({
    mode: "local-actions",
    app_name: "Dusk Developer Studio Local Actions.app",
    bundle_id: "io.github.georgiandusk.dusk-developer-studio.local-actions",
    executable_path: "Dusk Developer Studio Local Actions.app/Contents/MacOS/dusk-studio-local-actions"
  })
});
const LIFECYCLE_CHECKS = [
  "safe_mode_local_action_denied",
  "local_actions_preflight_verified",
  "release_parity_verified",
  "studio_listening_endpoints_verified",
  "unexpected_studio_listening_ports_absent",
  "isolated_user_data_roots_verified",
  "studio_loopback_services_stopped",
  "extraction_cleanup_verified",
  "install_cleanup_verified"
];
const REQUIRED_CHECKS = [
  "exact_checkout_verified",
  "frozen_dependencies_restored",
  "runtime_lock_verified",
  "dual_launchers_distinct",
  "two_build_reproducibility_verified",
  "runner_local_package_verified",
  "non_elevated_launch_verified",
  ...LIFECYCLE_CHECKS,
  "scoped_candidate_paths_absent_at_check"
];
const REQUIRED_LIMITATIONS = [
  "unsigned candidates have no publisher identity or platform trust",
  "build and lifecycle execution occur on the same ephemeral hosted runner",
  "no executable crosses a runner or receives download-integrity assurance",
  "SmartScreen Gatekeeper notarization and public reputation are not established",
  "malware scans cannot prove the absence of all malicious behavior",
  "the launch privilege guard prevents accidental elevation but is not OS containment against a hostile administrator or root user",
  "deliberately detached same-user tool daemons are outside the portable containment guarantee",
  "JSON records are bounded CI diagnostics, not authenticated publication evidence",
  "cleanup is a point-in-time check of exact workflow-owned candidate paths",
  "pull request code can change this lane and its validators, so the check is not an independent control"
];

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const digestFile = (file) => digest(fs.readFileSync(file));
const canonicalBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function readJsonFile(file, label) {
  const record = regularFile(file, label);
  const bytes = fs.readFileSync(record.resolved);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
  if (!bytes.equals(canonicalBytes(value))) throw new Error(`${label} is not canonical bounded JSON.`);
  return { file: record, bytes, value };
}

function safePackagePath(value, label) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
      || normalized.split("/").some((part) => !part || part === "." || part === "..")
      || !/^[\x20-\x7e]+$/.test(normalized)) {
    throw new Error(`${label} package path is unsafe.`);
  }
  return normalized;
}

function validateBooleanObject(value, expectedKeys, label) {
  exactKeys(value, expectedKeys, label);
  if (Object.values(value).some((item) => item !== true)) throw new Error(`${label} did not pass every check.`);
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  return new Date(parsed).toISOString().replace(".000Z", "Z") === value.replace(".000Z", "Z");
}

export function loadUnsignedAssurancePolicy() {
  return JSON.parse(fs.readFileSync(POLICY_PATH, "utf8"));
}

export function validateUnsignedAssurancePolicy(policy, runtimeLock, packageJson) {
  exactKeys(policy, [
    "schema_version", "product", "assurance_level", "workflow_path", "node_version", "pnpm_version",
    "same_runner", "clean_machine", "platform_trust", "publication_eligible", "retention_scope",
    "scoped_candidate_paths_absent_at_check", "cleanup_paths", "runner_labels", "required_checks",
    "limitations"
  ], "Unsigned assurance policy");
  exactKeys(policy.cleanup_paths, TARGETS, "Unsigned assurance cleanup path inventory");
  exactKeys(policy.runner_labels, TARGETS, "Unsigned assurance runner labels");
  if (policy.schema_version !== 1 || policy.product !== "Dusk Developer Studio Local Standalone"
      || policy.assurance_level !== ASSURANCE_LEVEL
      || policy.workflow_path !== ".github/workflows/studio-companion-unsigned-assurance.yml"
      || policy.node_version !== runtimeLock?.runtime?.version
      || policy.pnpm_version !== String(packageJson?.packageManager ?? "").replace(/^pnpm@/, "")
      || policy.same_runner !== true || policy.clean_machine !== false || policy.platform_trust !== false
      || policy.publication_eligible !== false || policy.retention_scope !== RETENTION_SCOPE
      || policy.scoped_candidate_paths_absent_at_check !== true
      || JSON.stringify(policy.cleanup_paths) !== JSON.stringify(CLEANUP_PATHS)
      || JSON.stringify(policy.runner_labels) !== JSON.stringify({
        "windows-x64": "windows-2025",
        "linux-x64": "ubuntu-24.04",
        "darwin-arm64": "macos-15"
      })
      || JSON.stringify(policy.required_checks) !== JSON.stringify(REQUIRED_CHECKS)
      || JSON.stringify(policy.limitations) !== JSON.stringify(REQUIRED_LIMITATIONS)) {
    throw new Error("Unsigned assurance policy identity or fail-closed trust state is invalid.");
  }
  return policy;
}

function validateLauncherRecord(record, mode, label) {
  exactKeys(record, ["mode", "name", "bytes", "sha256"], label);
  const name = safePackagePath(record.name, label);
  if (record.mode !== mode || !Number.isSafeInteger(record.bytes) || record.bytes <= 0
      || record.bytes > 1_000_000_000 || !SHA256_RE.test(record.sha256 ?? "")) {
    throw new Error(`${label} is invalid.`);
  }
  return name;
}

function validateMacosAppReceipt(appReceipt, receipt) {
  exactKeys(appReceipt, [
    "schema_version", "version", "commit", "launchers", "bundle_id", "app_name",
    "executable_path", "unsigned_sea_sha256"
  ], "macOS app receipt");
  exactKeys(appReceipt.launchers, ["safe", "local_actions"], "macOS app receipt launchers");
  for (const key of ["safe", "local_actions"]) {
    const observed = appReceipt.launchers[key];
    const expected = MAC_APP_LAUNCHERS[key];
    exactKeys(observed, [
      "mode", "app_name", "bundle_id", "executable_path", "unsigned_sea_sha256"
    ], `macOS ${expected.mode} app receipt`);
    if (observed.mode !== expected.mode || observed.app_name !== expected.app_name
        || observed.bundle_id !== expected.bundle_id
        || observed.executable_path !== expected.executable_path
        || observed.unsigned_sea_sha256 !== receipt.launchers[key].sha256) {
      throw new Error(`macOS ${expected.mode} app receipt is not bound to its SEA launcher.`);
    }
  }
  const safe = appReceipt.launchers.safe;
  if (appReceipt.schema_version !== 2 || appReceipt.version !== receipt.version
      || appReceipt.commit !== receipt.commit || appReceipt.bundle_id !== safe.bundle_id
      || appReceipt.app_name !== safe.app_name
      || appReceipt.executable_path !== safe.executable_path
      || appReceipt.unsigned_sea_sha256 !== safe.unsigned_sea_sha256) {
    throw new Error("macOS app receipt identity does not match the standalone build receipt.");
  }
  return appReceipt;
}

export function createUnsignedLauncherIndex({
  target, safeLauncher, localActionsLauncher, safeName, localActionsName, buildReceipt,
  macosAppReceipt
}) {
  if (!TARGET_SET.has(target)) throw new Error("Unsupported unsigned assurance target.");
  const receiptRecord = readJsonFile(buildReceipt, "Standalone build receipt");
  const receipt = validateStandaloneBuildReceipt(receiptRecord.value, target);
  const appReceipt = target === "darwin-arm64"
    ? validateMacosAppReceipt(
      readJsonFile(macosAppReceipt, "macOS app receipt").value,
      receipt
    )
    : undefined;
  const fileRecord = (file, name, mode) => {
    const candidate = regularFile(file, `${mode} unsigned launcher`);
    return {
      mode,
      name: safePackagePath(name, `${mode} unsigned launcher`),
      bytes: candidate.stat.size,
      sha256: digestFile(candidate.resolved)
    };
  };
  const launchers = {
    safe: fileRecord(safeLauncher, safeName, "safe"),
    local_actions: fileRecord(localActionsLauncher, localActionsName, "local-actions")
  };
  for (const [key, expectedMode] of [["safe", "safe"], ["local_actions", "local-actions"]]) {
    const observed = launchers[key];
    const expected = receipt.launchers[key];
    const expectedName = appReceipt
      ? appReceipt.launchers[key].executable_path
      : `launchers/${expected.name}`;
    if (expected?.mode !== expectedMode || observed.name !== expectedName
        || observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) {
      throw new Error(`${expectedMode} unsigned launcher is not bound to the standalone build receipt.`);
    }
  }
  if (launchers.safe.name === launchers.local_actions.name
      || launchers.safe.sha256 === launchers.local_actions.sha256) {
    throw new Error("Unsigned assurance requires two distinct mode-bound launchers.");
  }
  return {
    schema_version: 1,
    assurance_level: ASSURANCE_LEVEL,
    target,
    version: receipt.version,
    commit: receipt.commit,
    unsigned_asset_index_sha256: receipt.unsigned_asset_index_sha256,
    platform_trust: false,
    publication_eligible: false,
    launchers
  };
}

export function validateUnsignedLauncherIndex(index, { target, receipt, root }) {
  exactKeys(index, [
    "schema_version", "assurance_level", "target", "version", "commit",
    "unsigned_asset_index_sha256", "platform_trust", "publication_eligible", "launchers"
  ], "Unsigned launcher index");
  exactKeys(index.launchers, ["safe", "local_actions"], "Unsigned launcher inventory");
  const safeName = validateLauncherRecord(index.launchers.safe, "safe", "Safe unsigned launcher");
  const actionsName = validateLauncherRecord(
    index.launchers.local_actions, "local-actions", "Local-actions unsigned launcher"
  );
  const appReceipt = target === "darwin-arm64"
    ? validateMacosAppReceipt(
      readJsonFile(
        path.join(root, ...MAC_APP_RECEIPT_NAME.split("/")),
        "macOS app receipt"
      ).value,
      receipt
    )
    : undefined;
  if (index.schema_version !== 1 || index.assurance_level !== ASSURANCE_LEVEL || index.target !== target
      || index.version !== receipt.version || index.commit !== receipt.commit
      || index.unsigned_asset_index_sha256 !== receipt.unsigned_asset_index_sha256
      || index.platform_trust !== false || index.publication_eligible !== false
      || safeName === actionsName || index.launchers.safe.sha256 === index.launchers.local_actions.sha256) {
    throw new Error("Unsigned launcher index overstates trust or has inconsistent identity.");
  }
  for (const [record, name] of [
    [index.launchers.safe, safeName],
    [index.launchers.local_actions, actionsName]
  ]) {
    const file = regularFile(path.join(root, ...name.split("/")), `${record.mode} unsigned launcher`);
    if (file.stat.size !== record.bytes || digestFile(file.resolved) !== record.sha256) {
      throw new Error(`${record.mode} unsigned launcher does not match its index.`);
    }
  }
  for (const [key, expectedMode] of [["safe", "safe"], ["local_actions", "local-actions"]]) {
    const observed = index.launchers[key];
    const expected = receipt.launchers[key];
    const expectedName = appReceipt
      ? appReceipt.launchers[key].executable_path
      : `launchers/${expected.name}`;
    if (expected?.mode !== expectedMode || observed.name !== expectedName
        || observed.bytes !== expected.bytes || observed.sha256 !== expected.sha256) {
      throw new Error(`${expectedMode} unsigned launcher is not bound to the standalone build receipt.`);
    }
  }
  return index;
}

function inventory(root, skipManifest) {
  const files = [];
  const folded = new Set();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length) {
    const item = pending.pop();
    const stat = fs.lstatSync(item.absolute);
    if (stat.isSymbolicLink()) throw new Error(`Unsigned package contains a symlink or reparse entry: ${item.relative || "."}.`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(item.absolute).sort().reverse()) {
        const relative = safePackagePath(item.relative ? `${item.relative}/${name}` : name, "Unsigned package");
        pending.push({ absolute: path.join(item.absolute, name), relative });
      }
    } else if (stat.isFile()) {
      if (item.relative === MANIFEST_NAME && skipManifest) continue;
      if (item.relative === MANIFEST_NAME) throw new Error(`${MANIFEST_NAME} must not exist before creation.`);
      const key = item.relative.toLowerCase();
      if (folded.has(key)) throw new Error(`Unsigned package contains a case-colliding path: ${item.relative}.`);
      folded.add(key);
      files.push({ path: item.relative, bytes: stat.size, sha256: digestFile(item.absolute) });
    } else {
      throw new Error(`Unsigned package contains a non-regular entry: ${item.relative}.`);
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function expectedInventory(target, index) {
  const required = new Set([
    RECEIPT_NAME,
    INDEX_NAME,
    index.launchers.safe.name,
    index.launchers.local_actions.name
  ]);
  if (target === "darwin-arm64") {
    for (const launcher of [index.launchers.safe.name, index.launchers.local_actions.name]) {
      const marker = "/Contents/MacOS/";
      const at = launcher.indexOf(marker);
      if (at <= 0 || !launcher.slice(0, at).endsWith(".app")) {
        throw new Error("Unsigned macOS launcher is not inside an app bundle.");
      }
      required.add(`${launcher.slice(0, at)}/Contents/Info.plist`);
    }
    required.add(MAC_APP_RECEIPT_NAME);
  }
  return required;
}

function createManifestValue({ root, target, buildReceipt, launcherIndex, verification }) {
  if (!TARGET_SET.has(target)) throw new Error("Unsupported unsigned package target.");
  const packageRoot = path.resolve(root);
  const stat = fs.lstatSync(packageRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Unsigned package root must be a regular directory.");
  const receiptRecord = readJsonFile(buildReceipt, "Standalone build receipt");
  const receipt = validateStandaloneBuildReceipt(receiptRecord.value, target);
  const indexRecord = readJsonFile(launcherIndex, "Unsigned launcher index");
  const index = validateUnsignedLauncherIndex(indexRecord.value, { target, receipt, root: packageRoot });
  if (path.relative(packageRoot, receiptRecord.file.resolved).replaceAll("\\", "/") !== RECEIPT_NAME
      || path.relative(packageRoot, indexRecord.file.resolved).replaceAll("\\", "/") !== INDEX_NAME) {
    throw new Error("Unsigned package control metadata is not at its fixed path.");
  }
  const files = inventory(packageRoot, verification);
  const expected = expectedInventory(target, index);
  const actual = new Set(files.map((record) => record.path));
  if (expected.size !== actual.size || [...expected].some((name) => !actual.has(name))) {
    throw new Error("Unsigned package contains a missing or unexpected inventory entry.");
  }
  return {
    schema_version: 1,
    assurance_level: ASSURANCE_LEVEL,
    target,
    version: receipt.version,
    commit: receipt.commit,
    platform_trust: false,
    publication_eligible: false,
    unsigned_launcher_index_sha256: digestFile(indexRecord.file.resolved),
    files
  };
}

export function createUnsignedPackageManifest(options) {
  return createManifestValue({ ...options, verification: false });
}

export function verifyUnsignedPackageManifest({ root, target, buildReceipt, launcherIndex, manifestFile }) {
  const manifest = regularFile(manifestFile, "Unsigned candidate manifest");
  if (manifest.resolved !== path.join(path.resolve(root), MANIFEST_NAME)) {
    throw new Error("Unsigned candidate manifest is not at the package root.");
  }
  const expected = createManifestValue({
    root, target, buildReceipt, launcherIndex, verification: true
  });
  const observed = readJsonFile(manifest.resolved, "Unsigned candidate manifest").value;
  if (JSON.stringify(observed) !== JSON.stringify(expected)) {
    throw new Error("Unsigned package inventory or digest does not match its manifest.");
  }
  return observed;
}

function validateMode(value, mode, release) {
  exactKeys(value, [
    "schema_version", "mode", "release", "bootstrap_succeeded", "bootstrap_replay_denied",
    "authenticated_session_verified", "exact_release_parity_verified", "capability_contract_verified",
    "expected_studio_listening_endpoints", "unexpected_studio_listening_endpoints",
    "isolated_project_root_verified", "studio_loopback_services_stopped"
  ], `${mode} unsigned lifecycle mode`);
  exactKeys(value.release, ["product", "version", "commit", "channel"], `${mode} unsigned lifecycle release`);
  if (value.schema_version !== 1 || value.mode !== mode || value.release.product !== "Dusk Developer Studio"
      || value.release.version !== release.version || value.release.commit !== release.commit
      || value.release.channel !== "portable" || value.bootstrap_succeeded !== true
      || value.bootstrap_replay_denied !== true || value.authenticated_session_verified !== true
      || value.exact_release_parity_verified !== true || value.capability_contract_verified !== true
      || value.isolated_project_root_verified !== true || value.studio_loopback_services_stopped !== true
      || JSON.stringify(value.expected_studio_listening_endpoints) !== JSON.stringify(["127.0.0.1:5173", "127.0.0.1:8788"])
      || !Array.isArray(value.unexpected_studio_listening_endpoints)
      || value.unexpected_studio_listening_endpoints.length !== 0) {
    throw new Error(`${mode} unsigned lifecycle mode is invalid.`);
  }
}

export function validateUnsignedLifecycleReport(report, target) {
  exactKeys(report, [
    "schema_version", "assurance_level", "target", "same_runner", "clean_machine",
    "platform_trust", "publication_eligible", "candidate_package", "release",
    "launchers", "build_receipt_sha256", "unsigned_launcher_index_sha256",
    "unsigned_candidate_manifest_sha256", "modes", "checks"
  ], "Unsigned lifecycle report");
  exactKeys(report.release, ["version", "commit", "channel"], "Unsigned lifecycle release");
  exactKeys(report.candidate_package, ["name", "bytes", "sha256"], "Unsigned lifecycle package");
  exactKeys(report.launchers, ["safe", "local_actions"], "Unsigned lifecycle launchers");
  exactKeys(report.modes, ["safe", "local_actions"], "Unsigned lifecycle modes");
  validateLauncherRecord(report.launchers.safe, "safe", "Unsigned lifecycle safe launcher");
  validateLauncherRecord(report.launchers.local_actions, "local-actions", "Unsigned lifecycle local-actions launcher");
  validateBooleanObject(report.checks, LIFECYCLE_CHECKS, "Unsigned lifecycle checks");
  validateMode(report.modes.safe, "safe", report.release);
  validateMode(report.modes.local_actions, "local-actions", report.release);
  if (report.schema_version !== 1 || report.assurance_level !== ASSURANCE_LEVEL || report.target !== target
      || report.same_runner !== true || report.clean_machine !== false || report.platform_trust !== false
      || report.publication_eligible !== false || !VERSION_RE.test(report.release.version ?? "")
      || !COMMIT_RE.test(report.release.commit ?? "") || report.release.channel !== "portable"
      || !Number.isSafeInteger(report.candidate_package.bytes) || report.candidate_package.bytes <= 0
      || !SHA256_RE.test(report.candidate_package.sha256 ?? "")
      || !SHA256_RE.test(report.build_receipt_sha256 ?? "")
      || !SHA256_RE.test(report.unsigned_launcher_index_sha256 ?? "")
      || !SHA256_RE.test(report.unsigned_candidate_manifest_sha256 ?? "")
      || report.launchers.safe.sha256 === report.launchers.local_actions.sha256) {
    throw new Error("Unsigned lifecycle report identity or trust state is invalid.");
  }
  return report;
}

export function verifyUnsignedReproducibility({ target, firstReceipt, secondReceipt }) {
  const first = readJsonFile(firstReceipt, "First build receipt").value;
  const second = readJsonFile(secondReceipt, "Second build receipt").value;
  validateStandaloneBuildReceipt(first, target);
  validateStandaloneBuildReceipt(second, target);
  if (!canonicalBytes(first).equals(canonicalBytes(second))) {
    throw new Error("Unsigned build attempts are not byte-reproducible at the receipt and launcher-digest boundary.");
  }
  return {
    schema_version: 1,
    target,
    version: first.version,
    commit: first.commit,
    verified: true,
    receipt_sha256: digest(canonicalBytes(first)),
    safe_launcher_sha256: first.launchers.safe.sha256,
    local_actions_launcher_sha256: first.launchers.local_actions.sha256
  };
}

export function createCleanupReceipt({ target, scopeRoot, paths }) {
  if (!TARGET_SET.has(target) || !Array.isArray(paths)) {
    throw new Error("Unsigned cleanup receipt paths are invalid.");
  }
  const expectedPaths = CLEANUP_PATHS[target];
  const expectedIds = Object.keys(expectedPaths);
  const root = path.resolve(scopeRoot);
  const rootStat = fs.lstatSync(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Unsigned cleanup scope root must be an existing directory.");
  }
  const records = paths.map((record) => {
    exactKeys(record, ["id", "path"], "Unsigned cleanup path");
    const resolved = path.resolve(record.path);
    const relative = path.relative(root, resolved);
    if (typeof record.id !== "string"
        || !Object.prototype.hasOwnProperty.call(expectedPaths, record.id)
        || !relative || relative === ".."
        || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error("Unsigned cleanup path escapes its workflow-owned scope.");
    }
    const expected = path.join(root, expectedPaths[record.id]);
    const comparable = (value) => process.platform === "win32" ? value.toLowerCase() : value;
    if (comparable(resolved) !== comparable(expected)) {
      throw new Error("Unsigned cleanup path does not match its canonical workflow-owned path.");
    }
    return { id: record.id, resolved };
  });
  if (JSON.stringify(records.map((record) => record.id)) !== JSON.stringify(expectedIds)
      || new Set(records.map((record) => process.platform === "win32"
        ? record.resolved.toLowerCase()
        : record.resolved)).size !== records.length) {
    throw new Error("Unsigned cleanup receipt does not enumerate every exact workflow-owned path.");
  }
  const retained = records.filter((record) => {
    try {
      fs.lstatSync(record.resolved);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  });
  if (retained.length) throw new Error(`Unsigned candidate cleanup is incomplete: ${retained.length} scoped paths remain.`);
  return {
    schema_version: 1,
    target,
    retention_scope: RETENTION_SCOPE,
    scoped_candidate_paths_absent_at_check: true,
    path_ids: expectedIds
  };
}

function platformObservationKeys(target) {
  if (target === "windows-x64") {
    return [
      "host_target_verified", "publisher_signature_absent", "defender_scan_command_completed"
    ];
  }
  if (target === "linux-x64") {
    return [
      "host_target_verified", "detached_trust_artifacts_absent", "elf_x64_verified",
      "nx_stack_verified", "special_mode_absent"
    ];
  }
  return ["host_target_verified", "adhoc_integrity_verified", "gatekeeper_rejected_unsigned"];
}

export function createPlatformObservations(target, passedChecks) {
  if (!TARGET_SET.has(target)) throw new Error("Unsupported platform-observation target.");
  const required = platformObservationKeys(target);
  if (!Array.isArray(passedChecks) || JSON.stringify(passedChecks) !== JSON.stringify(required)) {
    throw new Error("Unsigned platform observations require every exact reviewed check.");
  }
  return Object.fromEntries(required.map((key) => [key, true]));
}

function validateUnsignedTargetEvidenceRecord(record, { policy, target, expectedCommit }) {
  exactKeys(record, [
    "schema_version", "assurance_level", "repository", "workflow_ref", "run_id", "run_attempt",
    "run_actor", "created_at", "target", "version", "commit", "same_runner", "clean_machine",
    "platform_trust", "publication_eligible", "retention_scope",
    "scoped_candidate_paths_absent_at_check",
    "cleanup_path_ids", "candidate_package",
    "launchers", "build_receipt_sha256", "unsigned_launcher_index_sha256",
    "unsigned_candidate_manifest_sha256", "lifecycle_report_sha256", "reproducibility",
    "platform_observations", "checks", "limitations"
  ], `${target} unsigned target evidence`);
  exactKeys(record.candidate_package, ["name", "bytes", "sha256"], `${target} candidate package`);
  exactKeys(record.launchers, ["safe", "local_actions"], `${target} launcher evidence`);
  validateLauncherRecord(record.launchers.safe, "safe", `${target} safe launcher evidence`);
  validateLauncherRecord(
    record.launchers.local_actions, "local-actions", `${target} local-actions launcher evidence`
  );
  exactKeys(record.reproducibility, [
    "schema_version", "target", "version", "commit", "verified", "receipt_sha256",
    "safe_launcher_sha256", "local_actions_launcher_sha256"
  ], `${target} reproducibility evidence`);
  validateBooleanObject(
    record.platform_observations,
    platformObservationKeys(target),
    `${target} platform observations`
  );
  validateBooleanObject(record.checks, policy.required_checks, `${target} unsigned target checks`);
  const packageName = safePackagePath(record.candidate_package.name, `${target} candidate package`);
  if (packageName.includes("/") || !packageName.toLowerCase().endsWith(".zip")
      || record.schema_version !== 1 || record.assurance_level !== ASSURANCE_LEVEL
      || record.repository !== "GeorgianDusk/dusk-developer-studio"
      || typeof record.workflow_ref !== "string"
      || !record.workflow_ref.startsWith(
        "GeorgianDusk/dusk-developer-studio/.github/workflows/studio-companion-unsigned-assurance.yml@"
      )
      || !RUN_RE.test(record.run_id ?? "") || !RUN_RE.test(record.run_attempt ?? "")
      || !ACTOR_RE.test(record.run_actor ?? "") || !validTimestamp(record.created_at)
      || record.target !== target || !VERSION_RE.test(record.version ?? "")
      || !COMMIT_RE.test(record.commit ?? "") || !COMMIT_RE.test(expectedCommit ?? "")
      || record.commit !== expectedCommit || record.same_runner !== true
      || record.clean_machine !== false || record.platform_trust !== false
      || record.publication_eligible !== false || record.retention_scope !== RETENTION_SCOPE
      || record.scoped_candidate_paths_absent_at_check !== true
      || JSON.stringify(record.cleanup_path_ids)
        !== JSON.stringify(Object.keys(policy.cleanup_paths[target]))
      || !Number.isSafeInteger(record.candidate_package.bytes)
      || record.candidate_package.bytes <= 0 || !SHA256_RE.test(record.candidate_package.sha256 ?? "")
      || !SHA256_RE.test(record.build_receipt_sha256 ?? "")
      || !SHA256_RE.test(record.unsigned_launcher_index_sha256 ?? "")
      || !SHA256_RE.test(record.unsigned_candidate_manifest_sha256 ?? "")
      || !SHA256_RE.test(record.lifecycle_report_sha256 ?? "")
      || record.launchers.safe.sha256 === record.launchers.local_actions.sha256
      || record.reproducibility.schema_version !== 1
      || record.reproducibility.target !== target
      || record.reproducibility.version !== record.version
      || record.reproducibility.commit !== record.commit
      || record.reproducibility.verified !== true
      || record.reproducibility.receipt_sha256 !== record.build_receipt_sha256
      || record.reproducibility.safe_launcher_sha256 !== record.launchers.safe.sha256
      || record.reproducibility.local_actions_launcher_sha256
        !== record.launchers.local_actions.sha256
      || JSON.stringify(record.limitations) !== JSON.stringify(policy.limitations)) {
    throw new Error(`${target} unsigned target evidence overstates its assurance or is invalid.`);
  }
  return record;
}

export function createUnsignedTargetEvidence({
  policy, target, lifecycleReport, reproducibilityReport, platformObservations, cleanupReceipt,
  repository, workflowRef, runId, runAttempt, runActor, expectedCommit,
  passedChecks,
  createdAt = new Date().toISOString()
}) {
  if (!TARGET_SET.has(target)) throw new Error("Unsupported unsigned evidence target.");
  const lifecycleRecord = readJsonFile(lifecycleReport, "Unsigned lifecycle report");
  const lifecycle = validateUnsignedLifecycleReport(lifecycleRecord.value, target);
  const reproducibility = readJsonFile(reproducibilityReport, "Unsigned reproducibility report").value;
  exactKeys(reproducibility, [
    "schema_version", "target", "version", "commit", "verified", "receipt_sha256",
    "safe_launcher_sha256", "local_actions_launcher_sha256"
  ], "Unsigned reproducibility report");
  const observations = readJsonFile(platformObservations, "Unsigned platform observations").value;
  validateBooleanObject(observations, platformObservationKeys(target), "Unsigned platform observations");
  const cleanup = readJsonFile(cleanupReceipt, "Unsigned cleanup receipt").value;
  exactKeys(cleanup, [
    "schema_version", "target", "retention_scope", "scoped_candidate_paths_absent_at_check",
    "path_ids"
  ], "Unsigned cleanup receipt");
  if (reproducibility.schema_version !== 1 || reproducibility.target !== target
      || reproducibility.version !== lifecycle.release.version || reproducibility.commit !== lifecycle.release.commit
      || reproducibility.verified !== true || reproducibility.receipt_sha256 !== lifecycle.build_receipt_sha256
      || reproducibility.safe_launcher_sha256 !== lifecycle.launchers.safe.sha256
      || reproducibility.local_actions_launcher_sha256 !== lifecycle.launchers.local_actions.sha256
      || cleanup.schema_version !== 1 || cleanup.target !== target
      || cleanup.retention_scope !== RETENTION_SCOPE
      || cleanup.scoped_candidate_paths_absent_at_check !== true
      || JSON.stringify(cleanup.path_ids) !== JSON.stringify(Object.keys(policy.cleanup_paths[target]))
      || JSON.stringify(passedChecks) !== JSON.stringify(policy.required_checks)
      || repository !== "GeorgianDusk/dusk-developer-studio"
      || typeof workflowRef !== "string"
      || !workflowRef.startsWith("GeorgianDusk/dusk-developer-studio/.github/workflows/studio-companion-unsigned-assurance.yml@")
      || !RUN_RE.test(String(runId)) || !RUN_RE.test(String(runAttempt))
      || !ACTOR_RE.test(runActor ?? "") || !validTimestamp(createdAt)) {
    throw new Error("Unsigned target evidence identity, provenance, or cleanup state is invalid.");
  }
  const checks = Object.fromEntries(passedChecks.map((check) => [check, true]));
  return validateUnsignedTargetEvidenceRecord({
    schema_version: 1,
    assurance_level: ASSURANCE_LEVEL,
    repository,
    workflow_ref: workflowRef,
    run_id: String(runId),
    run_attempt: String(runAttempt),
    run_actor: runActor,
    created_at: createdAt,
    target,
    version: lifecycle.release.version,
    commit: lifecycle.release.commit,
    same_runner: true,
    clean_machine: false,
    platform_trust: false,
    publication_eligible: false,
    retention_scope: RETENTION_SCOPE,
    scoped_candidate_paths_absent_at_check: true,
    cleanup_path_ids: cleanup.path_ids,
    candidate_package: lifecycle.candidate_package,
    launchers: lifecycle.launchers,
    build_receipt_sha256: lifecycle.build_receipt_sha256,
    unsigned_launcher_index_sha256: lifecycle.unsigned_launcher_index_sha256,
    unsigned_candidate_manifest_sha256: lifecycle.unsigned_candidate_manifest_sha256,
    lifecycle_report_sha256: digest(lifecycleRecord.bytes),
    reproducibility,
    platform_observations: observations,
    checks,
    limitations: policy.limitations
  }, { policy, target, expectedCommit });
}

export function assembleUnsignedAssuranceEvidence({
  policy, records, expectedCommit, createdAt = new Date().toISOString()
}) {
  if (!COMMIT_RE.test(expectedCommit ?? "")) {
    throw new Error("Unsigned aggregate expected commit is invalid.");
  }
  exactKeys(records, TARGETS, "Unsigned target evidence set");
  const values = TARGETS.map((target) => records[target]);
  for (const [index, record] of values.entries()) {
    const target = TARGETS[index];
    validateUnsignedTargetEvidenceRecord(record, { policy, target, expectedCommit });
  }
  for (const field of ["repository", "workflow_ref", "run_id", "run_attempt", "run_actor", "version", "commit"]) {
    if (new Set(values.map((record) => record[field])).size !== 1) {
      throw new Error(`Unsigned target evidence has inconsistent ${field}.`);
    }
  }
  if (!validTimestamp(createdAt)) throw new Error("Unsigned aggregate creation time is invalid.");
  return {
    schema_version: 1,
    assurance_level: ASSURANCE_LEVEL,
    repository: values[0].repository,
    workflow_ref: values[0].workflow_ref,
    run_id: values[0].run_id,
    run_attempt: values[0].run_attempt,
    run_actor: values[0].run_actor,
    created_at: createdAt,
    version: values[0].version,
    commit: values[0].commit,
    same_runner: true,
    clean_machine: false,
    platform_trust: false,
    publication_eligible: false,
    retention_scope: RETENTION_SCOPE,
    scoped_candidate_paths_absent_at_check: true,
    cleanup_path_ids: Object.fromEntries(TARGETS.map((target) => [
      target, Object.keys(policy.cleanup_paths[target])
    ])),
    targets: Object.fromEntries(TARGETS.map((target) => [target, records[target]])),
    limitations: policy.limitations
  };
}

function writeNewJson(file, value) {
  fs.writeFileSync(path.resolve(file), canonicalBytes(value), { flag: "wx", mode: 0o600 });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    const operation = String(args.operation ?? "");
    const policy = loadUnsignedAssurancePolicy();
    const runtimeLock = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "companion-runtime-lock.json"), "utf8"));
    const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    validateUnsignedAssurancePolicy(policy, runtimeLock, packageJson);
    if (operation === "policy") {
      console.log(JSON.stringify({ status: "valid", assurance_level: policy.assurance_level }, null, 2));
    } else if (operation === "index") {
      for (const name of ["target", "safe-launcher", "local-actions-launcher", "safe-name", "local-actions-name", "build-receipt", "out"]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      if (args.target === "darwin-arm64" && !args["macos-app-receipt"]) {
        throw new Error("Missing --macos-app-receipt.");
      }
      writeNewJson(args.out, createUnsignedLauncherIndex({
        target: args.target,
        safeLauncher: args["safe-launcher"],
        localActionsLauncher: args["local-actions-launcher"],
        safeName: args["safe-name"],
        localActionsName: args["local-actions-name"],
        buildReceipt: args["build-receipt"],
        macosAppReceipt: args["macos-app-receipt"]
      }));
    } else if (operation === "manifest") {
      for (const name of ["root", "target", "build-receipt", "launcher-index", "out"]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      if (path.resolve(args.out) !== path.join(path.resolve(args.root), MANIFEST_NAME)) {
        throw new Error(`Unsigned manifest output must be ${MANIFEST_NAME} at the package root.`);
      }
      writeNewJson(args.out, createUnsignedPackageManifest({
        root: args.root,
        target: args.target,
        buildReceipt: args["build-receipt"],
        launcherIndex: args["launcher-index"]
      }));
    } else if (operation === "reproducibility") {
      for (const name of ["target", "first-receipt", "second-receipt", "out"]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      writeNewJson(args.out, verifyUnsignedReproducibility({
        target: args.target,
        firstReceipt: args["first-receipt"],
        secondReceipt: args["second-receipt"]
      }));
    } else if (operation === "cleanup") {
      for (const name of ["target", "scope-root", "paths", "out"]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      writeNewJson(args.out, createCleanupReceipt({
        target: args.target,
        scopeRoot: args["scope-root"],
        paths: String(args.paths).split("|").filter(Boolean).map((record) => {
          const delimiter = record.indexOf("=");
          if (delimiter <= 0 || delimiter === record.length - 1) {
            throw new Error("Unsigned cleanup path records must use id=path.");
          }
          return { id: record.slice(0, delimiter), path: record.slice(delimiter + 1) };
        })
      }));
    } else if (operation === "platform-observations") {
      for (const name of ["target", "checks", "out"]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      writeNewJson(args.out, createPlatformObservations(
        args.target,
        String(args.checks).split(",").filter(Boolean)
      ));
    } else if (operation === "target-evidence") {
      for (const name of [
        "target", "lifecycle-report", "reproducibility-report", "platform-observations",
        "cleanup-receipt", "repository", "workflow-ref", "run-id", "run-attempt", "run-actor",
        "expected-commit", "checks", "out"
      ]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      writeNewJson(args.out, createUnsignedTargetEvidence({
        policy,
        target: args.target,
        lifecycleReport: args["lifecycle-report"],
        reproducibilityReport: args["reproducibility-report"],
        platformObservations: args["platform-observations"],
        cleanupReceipt: args["cleanup-receipt"],
        repository: args.repository,
        workflowRef: args["workflow-ref"],
        runId: args["run-id"],
        runAttempt: args["run-attempt"],
        runActor: args["run-actor"],
        expectedCommit: args["expected-commit"],
        passedChecks: String(args.checks).split(",").filter(Boolean)
      }));
    } else if (operation === "aggregate") {
      for (const name of ["records", "expected-commit", "out"]) {
        if (!args[name]) throw new Error(`Missing --${name}.`);
      }
      const directory = path.resolve(args.records);
      const names = fs.readdirSync(directory).sort();
      const expected = TARGETS.map((target) => `${target}.json`).sort();
      if (JSON.stringify(names) !== JSON.stringify(expected)) throw new Error("Unsigned evidence directory has an unexpected inventory.");
      const records = Object.fromEntries(TARGETS.map((target) => [
        target, readJsonFile(path.join(directory, `${target}.json`), `${target} evidence`).value
      ]));
      writeNewJson(args.out, assembleUnsignedAssuranceEvidence({
        policy,
        records,
        expectedCommit: args["expected-commit"]
      }));
    } else {
      throw new Error("Unsupported unsigned assurance operation.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Unsigned assurance tooling failed.");
    process.exitCode = 1;
  }
}

export {
  ASSURANCE_LEVEL,
  INDEX_NAME as UNSIGNED_INDEX_NAME,
  MANIFEST_NAME as UNSIGNED_MANIFEST_NAME,
  RECEIPT_NAME as UNSIGNED_RECEIPT_NAME
};
