import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";
import { expectedTargetIdentity, expectedWorkflowRef } from "./standalone-signing-evidence.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;
const GITHUB_ACTOR_RE = /^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const LIFECYCLE_CHECKS = new Set(["fresh_runner_smoke_passed", "install_cleanup_verified", "install_rollback_verified"]);
const LIFECYCLE_RESULT_KEYS = [
  "schema_version", "mode", "release", "bootstrap_succeeded", "bootstrap_replay_denied",
  "authenticated_session_verified", "exact_release_parity_verified", "capability_contract_verified",
  "expected_studio_listening_endpoints", "unexpected_studio_listening_endpoints", "isolated_project_root_verified",
  "studio_loopback_services_stopped"
];
const LIFECYCLE_CHECK_KEYS = [
  "bootstrap_one_time_verified", "authenticated_session_verified", "safe_mode_local_action_denied",
  "local_actions_preflight_verified", "release_parity_verified", "studio_listening_endpoints_verified",
  "unexpected_studio_listening_ports_absent", "isolated_user_data_roots_verified", "studio_loopback_services_stopped",
  "extraction_cleanup_verified", "install_cleanup_verified", "install_rollback_verified"
];
const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return { resolved, stat };
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const normalized = new Date(parsed).toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function validateFileRecord(value, label, mode) {
  exactKeys(value, mode ? ["mode", "name", "bytes", "sha256"] : ["name", "bytes", "sha256"], label);
  if ((mode && value.mode !== mode) || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,299}$/.test(value.name ?? "")
      || value.name.startsWith("/") || value.name.split("/").some((part) => !part || part === "." || part === "..")
      || !Number.isInteger(value.bytes) || value.bytes <= 0 || !SHA256_RE.test(value.sha256 ?? "")) {
    throw new Error(`${label} is invalid.`);
  }
}

function validateLifecycleMode(value, mode, receipt) {
  exactKeys(value, LIFECYCLE_RESULT_KEYS, `${mode} lifecycle mode`);
  exactKeys(value.release, ["product", "version", "commit", "channel"], `${mode} lifecycle release`);
  if (value.schema_version !== 1 || value.mode !== mode || value.release.product !== "Dusk Developer Studio"
      || value.release.version !== receipt.version || value.release.commit !== receipt.commit || value.release.channel !== "portable"
      || value.bootstrap_succeeded !== true || value.bootstrap_replay_denied !== true
      || value.authenticated_session_verified !== true || value.exact_release_parity_verified !== true
      || value.capability_contract_verified !== true || value.isolated_project_root_verified !== true
      || value.studio_loopback_services_stopped !== true
      || JSON.stringify(value.expected_studio_listening_endpoints) !== JSON.stringify(["127.0.0.1:5173", "127.0.0.1:8788"])
      || !Array.isArray(value.unexpected_studio_listening_endpoints) || value.unexpected_studio_listening_endpoints.length !== 0) {
    throw new Error(`${mode} lifecycle mode did not pass the exact candidate contract.`);
  }
}

function validateLifecycleReport(report, { target, receipt, packageRecord, receiptSha256 }) {
  exactKeys(report, [
    "schema_version", "target", "release", "candidate_package", "signed_launchers",
    "build_receipt_sha256", "unsigned_asset_index_sha256", "signed_launcher_index_sha256",
    "candidate_package_manifest_sha256", "modes", "checks"
  ], "Lifecycle report");
  exactKeys(report.release, ["version", "commit", "channel"], "Lifecycle release");
  exactKeys(report.signed_launchers, ["safe", "local_actions"], "Signed launcher inventory");
  validateFileRecord(report.signed_launchers.safe, "Signed safe launcher", "safe");
  validateFileRecord(report.signed_launchers.local_actions, "Signed local-actions launcher", "local-actions");
  validateFileRecord(report.candidate_package, "Lifecycle candidate package");
  exactKeys(report.modes, ["safe", "local_actions"], "Lifecycle modes");
  validateLifecycleMode(report.modes.safe, "safe", receipt);
  validateLifecycleMode(report.modes.local_actions, "local-actions", receipt);
  exactKeys(report.checks, LIFECYCLE_CHECK_KEYS, "Lifecycle checks");
  if (report.schema_version !== 1 || report.target !== target || report.release.version !== receipt.version
      || report.release.commit !== receipt.commit || report.release.channel !== "portable"
      || JSON.stringify(report.candidate_package) !== JSON.stringify(packageRecord)
      || report.build_receipt_sha256 !== receiptSha256
      || report.unsigned_asset_index_sha256 !== receipt.unsigned_asset_index_sha256
      || !SHA256_RE.test(report.signed_launcher_index_sha256 ?? "")
      || !SHA256_RE.test(report.candidate_package_manifest_sha256 ?? "")
      || report.signed_launchers.safe.sha256 === report.signed_launchers.local_actions.sha256
      || Object.values(report.checks).some((value) => value !== true)) {
    throw new Error("Lifecycle report is not bound to the exact candidate package.");
  }
}

export function createStandaloneTargetEvidence({
  policy, target, candidatePackage, buildReceipt, lifecycleReport, releaseTag, identity, oidcIssuer = "", passedChecks = [],
  repository, workflowRef, runId, runAttempt, runActor, createdAt = new Date().toISOString()
}) {
  if (!TARGETS.has(target) || !policy?.targets?.[target]) throw new Error("Unsupported standalone evidence target.");
  const packageFile = regularFile(candidatePackage, "Candidate package");
  if (packageFile.stat.size <= 0 || path.extname(packageFile.resolved).toLowerCase() !== ".zip") {
    throw new Error("Candidate package must be a non-empty ZIP.");
  }
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptFile.resolved, "utf8"));
  validateStandaloneBuildReceipt(receipt, target);
  const expectedPackageName = `dusk-developer-studio-${receipt.version}-${target}-internal-rc.zip`;
  if (path.basename(packageFile.resolved) !== expectedPackageName) throw new Error("Candidate package name does not bind its version and target.");
  const receiptSha256 = digestFile(receiptFile.resolved);
  const packageRecord = {
    name: path.basename(packageFile.resolved),
    bytes: packageFile.stat.size,
    sha256: digestFile(packageFile.resolved)
  };
  const lifecycleFile = regularFile(lifecycleReport, "Lifecycle report");
  const lifecycleBytes = fs.readFileSync(lifecycleFile.resolved);
  const lifecycle = JSON.parse(lifecycleBytes.toString("utf8"));
  const canonicalLifecycleBytes = Buffer.from(`${JSON.stringify(lifecycle, null, 2)}\n`);
  if (!lifecycleBytes.equals(canonicalLifecycleBytes)) throw new Error("Lifecycle report must use the canonical bounded JSON encoding.");
  validateLifecycleReport(lifecycle, { target, receipt, packageRecord, receiptSha256 });

  const targetPolicy = policy.targets[target];
  let tagRegex;
  try { tagRegex = new RegExp(policy.release_tag_pattern); } catch { throw new Error("Signing policy release-tag pattern is invalid."); }
  if (!tagRegex.test(releaseTag ?? "")) throw new Error("Release tag does not match the signing policy.");
  if (!String(releaseTag).startsWith(`studio-companion-v${receipt.version}-rc.`)) throw new Error("Release tag version does not match the candidate build receipt.");
  if (repository !== policy.canonical_repository) throw new Error("Target evidence repository is not canonical.");
  if (workflowRef !== expectedWorkflowRef(policy, releaseTag)) throw new Error("Target evidence workflow reference is not tag-bound.");
  if (!/^[1-9][0-9]*$/.test(String(runId ?? ""))) throw new Error("Target evidence workflow run id is invalid.");
  if (!/^[1-9][0-9]*$/.test(String(runAttempt ?? ""))) throw new Error("Target evidence workflow run attempt is invalid.");
  if (!GITHUB_ACTOR_RE.test(runActor ?? "")) throw new Error("Target evidence workflow actor is invalid.");
  if (!validTimestamp(createdAt)) throw new Error("Target evidence creation time is invalid.");
  const expectedIdentity = expectedTargetIdentity(policy, target, releaseTag);
  if (!expectedIdentity || identity !== expectedIdentity) throw new Error("Target platform identity does not match the signing policy.");
  if (targetPolicy.approved_oidc_issuer && oidcIssuer !== targetPolicy.approved_oidc_issuer) throw new Error("Target OIDC issuer does not match the signing policy.");
  const allowedChecks = new Set(targetPolicy.required_checks ?? []);
  if (new Set(passedChecks).size !== passedChecks.length) throw new Error("Target evidence contains a duplicate check.");
  if (passedChecks.some((check) => !allowedChecks.has(check))) throw new Error("Target evidence contains an unknown check.");
  for (const check of LIFECYCLE_CHECKS) {
    if (!allowedChecks.has(check) || !passedChecks.includes(check)) throw new Error(`Target evidence is missing lifecycle-backed check ${check}.`);
  }
  const checks = Object.fromEntries([...allowedChecks].map((check) => [check, passedChecks.includes(check)]));
  return {
    schema_version: 3,
    target,
    repository,
    workflow_ref: workflowRef,
    run_id: String(runId),
    run_attempt: String(runAttempt),
    run_actor: runActor,
    created_at: createdAt,
    release_tag: releaseTag,
    version: receipt.version,
    commit: receipt.commit,
    candidate_package: packageRecord,
    signed_launchers: lifecycle.signed_launchers,
    build_receipt_sha256: receiptSha256,
    unsigned_asset_index_sha256: receipt.unsigned_asset_index_sha256,
    signed_launcher_index_sha256: lifecycle.signed_launcher_index_sha256,
    candidate_package_manifest_sha256: lifecycle.candidate_package_manifest_sha256,
    unsigned_launchers: receipt.launchers,
    distribution_format: targetPolicy.distribution_format,
    signing_provider: targetPolicy.signing_provider,
    [targetPolicy.identity_field]: identity,
    ...(targetPolicy.approved_oidc_issuer ? { oidc_issuer: oidcIssuer } : {}),
    lifecycle_report: lifecycle,
    lifecycle_report_sha256: digestFile(lifecycleFile.resolved),
    checks
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    for (const name of [
      "target", "candidate-package", "build-receipt", "lifecycle-report", "release-tag", "identity", "repository",
      "workflow-ref", "run-id", "run-attempt", "run-actor", "out"
    ]) {
      if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
    const record = createStandaloneTargetEvidence({
      policy,
      target: args.target,
      candidatePackage: args["candidate-package"],
      buildReceipt: args["build-receipt"],
      lifecycleReport: args["lifecycle-report"],
      releaseTag: args["release-tag"],
      identity: args.identity,
      oidcIssuer: args["oidc-issuer"] ?? "",
      passedChecks: String(args.checks ?? "").split(",").filter(Boolean),
      repository: args.repository,
      workflowRef: args["workflow-ref"],
      runId: args["run-id"],
      runAttempt: args["run-attempt"],
      runActor: args["run-actor"],
      createdAt: args["created-at"] ?? new Date().toISOString()
    });
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "recorded", target: record.target, candidate_package_sha256: record.candidate_package.sha256, output: path.resolve(args.out) }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Standalone target evidence failed.");
    process.exitCode = 1;
  }
}
