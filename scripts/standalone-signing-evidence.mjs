import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const TARGET_CONTRACT = {
  "windows-x64": {
    distribution_format: "pe-executable", signing_provider: "azure-artifact-signing", identity_field: "publisher_subject", runner_label: "windows-2025",
    required_checks: ["authenticode_valid", "timestamp_valid", "publisher_identity_verified", "fresh_runner_smoke_passed", "cleanup_verified", "malware_scan_passed", "rollback_verified"]
  },
  "linux-x64": {
    distribution_format: "elf-executable-with-sigstore-bundle", signing_provider: "sigstore-keyless", identity_field: "certificate_identity", runner_label: "ubuntu-24.04",
    required_checks: ["cosign_bundle_verified", "rekor_inclusion_verified", "workflow_identity_verified", "fresh_runner_smoke_passed", "cleanup_verified", "rollback_verified"]
  },
  "darwin-arm64": {
    distribution_format: "zip-with-stapled-app-bundle", signing_provider: "apple-developer-id-notary", identity_field: "apple_team_id", runner_label: "macos-14",
    required_checks: ["developer_id_valid", "hardened_runtime", "notarized", "ticket_stapled", "gatekeeper_assessed", "fresh_runner_smoke_passed", "cleanup_verified", "rollback_verified"]
  }
};

function releaseTagRegex(policy) {
  if (typeof policy?.release_tag_pattern !== "string" || policy.release_tag_pattern.length > 160 || !policy.release_tag_pattern.startsWith("^") || !policy.release_tag_pattern.endsWith("$")) return null;
  try { return new RegExp(policy.release_tag_pattern); } catch { return null; }
}

export function expectedTargetIdentity(policy, target, releaseTag) {
  const targetPolicy = policy?.targets?.[target];
  if (!targetPolicy) return "";
  if (targetPolicy.identity_template) {
    if (typeof targetPolicy.identity_template !== "string" || (targetPolicy.identity_template.match(/\{release_tag\}/g) ?? []).length !== 1) return "";
    return targetPolicy.identity_template.replace("{release_tag}", releaseTag);
  }
  return typeof targetPolicy.approved_identity === "string" ? targetPolicy.approved_identity : "";
}

export function expectedWorkflowRef(policy, releaseTag) {
  if (!policy?.canonical_repository || !policy?.workflow_path) return "";
  return `https://github.com/${policy.canonical_repository}/${policy.workflow_path}@refs/tags/${releaseTag}`;
}

export function evaluateStandaloneSigningReadiness(policy, options = {}) {
  const blockers = [];
  if (policy?.schema_version !== 2 || policy?.product !== "Dusk Developer Studio Local Standalone") blockers.push("Standalone signing policy schema is invalid.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy?.canonical_repository ?? "")) blockers.push("Canonical signing repository is invalid.");
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(policy?.workflow_path ?? "")) blockers.push("Signing workflow path is invalid.");
  if (!SAFE_NAME_RE.test(policy?.protected_environment ?? "")) blockers.push("Protected signing environment is invalid.");
  const tagRegex = releaseTagRegex(policy);
  if (!tagRegex) blockers.push("Release tag policy is invalid.");
  else if (!tagRegex.test(options.releaseTag ?? "")) blockers.push("Release tag does not match the signed-RC policy.");
  const transport = policy?.candidate_transport;
  if (transport?.enabled !== false || transport?.provider !== "none" || typeof transport?.blocker !== "string" || !transport.blocker.trim()) {
    blockers.push("Candidate transport policy must remain fail-closed until a private transport is implemented and reviewed.");
  } else {
    blockers.push(transport.blocker);
  }
  const requiredTargets = Object.keys(TARGET_CONTRACT).sort();
  const policyTargets = Object.keys(policy?.targets ?? {}).sort();
  if (JSON.stringify(requiredTargets) !== JSON.stringify(policyTargets)) blockers.push("Signing policy must cover the exact supported target set.");
  for (const target of requiredTargets) {
    const targetPolicy = policy?.targets?.[target];
    const contract = TARGET_CONTRACT[target];
    if (!targetPolicy) continue;
    if (targetPolicy.distribution_format !== contract.distribution_format || targetPolicy.signing_provider !== contract.signing_provider || targetPolicy.identity_field !== contract.identity_field) blockers.push(`${target} signing contract is invalid.`);
    if (policy?.runner_labels?.[target] !== contract.runner_label) blockers.push(`${target} runner label is not approved.`);
    if (!expectedTargetIdentity(policy, target, options.releaseTag ?? "")) blockers.push(`${target} platform identity is not configured.`);
    if (target === "linux-x64" && targetPolicy.approved_oidc_issuer !== "https://token.actions.githubusercontent.com") blockers.push("Linux OIDC issuer is not approved.");
    if (JSON.stringify(targetPolicy.required_checks) !== JSON.stringify(contract.required_checks)) blockers.push(`${target} required checks are invalid.`);
  }
  return { decision: blockers.length ? "blocked" : "ready", blockers };
}

export function evaluateStandaloneSigningEvidence(policy, evidence) {
  const releaseTag = evidence?.release_tag ?? "";
  const readiness = evaluateStandaloneSigningReadiness(policy, { releaseTag });
  const blockers = [...readiness.blockers];
  if (policy?.publication_enabled !== true) blockers.push(policy?.publication_blocker || "Standalone publication is disabled.");
  if (evidence?.schema_version !== 2) blockers.push("Standalone signing evidence schema is invalid.");
  if (!COMMIT_RE.test(evidence?.commit ?? "")) blockers.push("Standalone evidence commit is invalid.");
  if (evidence?.repository !== policy?.canonical_repository) blockers.push("Standalone evidence repository is not canonical.");
  if (evidence?.workflow_ref !== expectedWorkflowRef(policy, releaseTag)) blockers.push("Standalone evidence workflow reference is not tag-bound.");
  if (!/^[1-9][0-9]*$/.test(String(evidence?.run_id ?? ""))) blockers.push("Standalone evidence workflow run id is invalid.");
  if (typeof evidence?.created_at !== "string" || !Number.isFinite(Date.parse(evidence.created_at))) blockers.push("Standalone evidence timestamp is invalid.");
  const requiredTargets = Object.keys(TARGET_CONTRACT).sort();
  const evidenceTargets = Object.keys(evidence?.targets ?? {}).sort();
  if (JSON.stringify(requiredTargets) !== JSON.stringify(evidenceTargets)) blockers.push("Standalone signing evidence must cover the exact required target set.");
  for (const target of requiredTargets) {
    const targetPolicy = policy?.targets?.[target];
    const record = evidence?.targets?.[target];
    if (!targetPolicy || !record) continue;
    if (record.target !== target || record.commit !== evidence.commit || record.release_tag !== releaseTag) blockers.push(`${target} release identity is inconsistent.`);
    if (!SAFE_NAME_RE.test(record.artifact_name ?? "") || !SHA256_RE.test(record.artifact_sha256 ?? "") || !Number.isSafeInteger(record.artifact_bytes) || record.artifact_bytes <= 0) blockers.push(`${target} artifact identity is invalid.`);
    if (!SHA256_RE.test(record.build_receipt_sha256 ?? "") || !SHA256_RE.test(record.unsigned_artifact_sha256 ?? "")) blockers.push(`${target} build receipt binding is invalid.`);
    if (record.distribution_format !== targetPolicy.distribution_format || record.signing_provider !== targetPolicy.signing_provider) blockers.push(`${target} distribution or signing provider is invalid.`);
    const expectedIdentity = expectedTargetIdentity(policy, target, releaseTag);
    if (!expectedIdentity || record[targetPolicy.identity_field] !== expectedIdentity) blockers.push(`${target} platform identity is not approved.`);
    if (targetPolicy.approved_oidc_issuer && record.oidc_issuer !== targetPolicy.approved_oidc_issuer) blockers.push(`${target} OIDC issuer is not approved.`);
    for (const check of targetPolicy.required_checks ?? []) if (record.checks?.[check] !== true) blockers.push(`${target} required check failed: ${check}.`);
  }
  return { decision: blockers.length ? "no-go" : "go", blockers: [...new Set(blockers)] };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
    let result;
    if (args.readiness) result = evaluateStandaloneSigningReadiness(policy, { releaseTag: args["release-tag"] });
    else {
      if (!args.evidence) throw new Error("Usage: node scripts/standalone-signing-evidence.mjs (--readiness --release-tag=<tag> | --evidence=<json>) [--report-only]");
      const evidence = JSON.parse(fs.readFileSync(path.resolve(args.evidence), "utf8"));
      result = evaluateStandaloneSigningEvidence(policy, evidence);
    }
    console.log(JSON.stringify(result, null, 2));
    if (!args["report-only"] && !["ready", "go"].includes(result.decision)) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : "Standalone signing evidence failed."); process.exitCode = 1; }
}
