import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { cli } from "./companion-core.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const SAFE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
const GITHUB_ACTOR_RE = /^github:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const MAX_EVIDENCE_BYTES = 4 * 1024 * 1024;
const MAX_SIGNING_RUN_DURATION_MS = 6 * 60 * 60 * 1000;
const POLICY_KEYS = [
  "schema_version", "product", "channel", "canonical_repository", "workflow_path", "protected_environment",
  "release_tag_pattern", "publication_enabled", "publication_blocker", "same_user_tool_boundary", "candidate_transport",
  "publication_evidence_contract", "payload_trust", "runner_labels", "targets"
];
const SAME_USER_BOUNDARY_CONTROLS = [
  "separate-safe-and-local-actions-launchers",
  "privileged-launch-rejected",
  "exact-command-and-argument-allowlist",
  "no-user-controlled-or-arbitrary-shell-surface",
  "minimal-secret-stripped-child-environment",
  "bounded-time-output-concurrency-and-studio-managed-filesystem-effects",
  "tracked-direct-and-ordinary-process-group-termination",
  "studio-listener-recheck-and-fixed-port-closure",
  "machine-wide-process-cleanup-not-claimed",
  "public-companion-binaries-disabled"
];
const SAME_USER_BOUNDARY_REVISIT_TRIGGERS = [
  "public-companion-binary-publication",
  "arbitrary-project-command-execution",
  "package-install-or-update-capability",
  "expanded-tool-allowlist",
  "administrator-or-service-capability",
  "same-user-tool-security-incident"
];
const PUBLICATION_GATES = [
  "security_review",
  "support_incident_route",
  "compatibility",
  "rollback_revocation",
  "reputation_quarantine",
  "monitoring_revisit",
  "explicit_approval"
];
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
const PAYLOAD_TRUST_CONTRACT = {
  platform_signed_assets: "each-launcher-or-app-bundle-only",
  outer_zip_authentication: "not-established-until-reviewed-transport-binds-package-digest",
  embedded_portable_payload: "internal-unsigned-release-candidate",
  binding: "exact-build-receipt-unsigned-asset-index-and-package-manifest",
  portable_directory_ed25519_publication_satisfied: false
};
const TARGET_CONTRACT = {
  "windows-x64": {
    distribution_format: "zip-with-two-authenticode-executables", signing_provider: "azure-artifact-signing", identity_field: "publisher_subject", runner_label: "windows-2025",
    required_checks: ["authenticode_valid", "timestamp_valid", "publisher_identity_verified", "fresh_runner_smoke_passed", "install_cleanup_verified", "malware_scan_passed", "install_rollback_verified"]
  },
  "linux-x64": {
    distribution_format: "zip-with-two-elf-launchers-and-sigstore-bundles", signing_provider: "sigstore-keyless", identity_field: "certificate_identity", runner_label: "ubuntu-24.04",
    required_checks: ["cosign_bundle_verified", "rekor_inclusion_verified", "workflow_identity_verified", "fresh_runner_smoke_passed", "install_cleanup_verified", "install_rollback_verified"]
  },
  "darwin-arm64": {
    distribution_format: "zip-with-two-stapled-app-bundles", signing_provider: "apple-developer-id-notary", identity_field: "apple_team_id", runner_label: "macos-15",
    required_checks: ["developer_id_valid", "hardened_runtime", "notarized", "ticket_stapled", "gatekeeper_assessed", "fresh_runner_smoke_passed", "install_cleanup_verified", "install_rollback_verified"]
  }
};

function releaseTagRegex(policy) {
  if (typeof policy?.release_tag_pattern !== "string" || policy.release_tag_pattern.length > 160 || !policy.release_tag_pattern.startsWith("^") || !policy.release_tag_pattern.endsWith("$")) return null;
  try { return new RegExp(policy.release_tag_pattern); } catch { return null; }
}

function versionFromReleaseTag(releaseTag) {
  return typeof releaseTag === "string" ? releaseTag.match(/^studio-companion-v(\d+\.\d+\.\d+)-rc\.\d+$/)?.[1] ?? "" : "";
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

function unique(values) {
  return [...new Set(values)];
}

function exactKeys(value, expected, label, blockers) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    blockers.push(`${label} must be an object.`);
    return false;
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) blockers.push(`${label} fields are invalid.`);
  return true;
}

function boundedText(value, maximum = 500) {
  return typeof value === "string" && value.trim() === value && value.length > 0 && value.length <= maximum
    && ![...value].some((character) => character.codePointAt(0) < 32 || character.codePointAt(0) === 127);
}

function validHttpsUrl(value) {
  if (!boundedText(value, 2048)) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && Boolean(parsed.hostname);
  } catch { return false; }
}

function validRepositoryUrl(value, policy) {
  if (!validHttpsUrl(value)) return false;
  const parsed = new URL(value);
  return parsed.hostname === "github.com" && parsed.pathname.startsWith(`/${policy.canonical_repository}/`);
}

function validActor(value) {
  return typeof value === "string" && GITHUB_ACTOR_RE.test(value);
}

function validTimestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return false;
  const normalized = new Date(parsed).toISOString();
  return normalized === value || normalized.replace(".000Z", "Z") === value;
}

function requireTimestamp(value, label, createdAt, blockers, { candidateAt, now, maximumClockSkewMs } = {}) {
  if (!validTimestamp(value)) blockers.push(`${label} timestamp is invalid.`);
  else if (validTimestamp(createdAt) && Date.parse(value) > Date.parse(createdAt)) blockers.push(`${label} occurs after the publication evidence was created.`);
  else {
    if (validTimestamp(candidateAt) && Date.parse(value) < Date.parse(candidateAt)) blockers.push(`${label} predates the accepted signed candidate.`);
    if (Number.isFinite(now) && Date.parse(value) > now + (maximumClockSkewMs ?? 0)) blockers.push(`${label} is unacceptably future-dated.`);
  }
}

function parseEvidenceBytes(value, label) {
  const bytes = Buffer.isBuffer(value) ? value : typeof value === "string" ? Buffer.from(value) : null;
  if (!bytes || bytes.length === 0 || bytes.length > MAX_EVIDENCE_BYTES) throw new Error(`${label} bytes are missing or exceed the allowed bound.`);
  let evidence;
  try { evidence = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error(`${label} is not valid JSON.`); }
  return { bytes, evidence, sha256: createHash("sha256").update(bytes).digest("hex") };
}

function canonicalJsonSha256(value) {
  return createHash("sha256").update(Buffer.from(`${JSON.stringify(value, null, 2)}\n`)).digest("hex");
}

function validateRetainedLifecycleReport(record, target, blockers) {
  const report = record?.lifecycle_report;
  if (!exactKeys(report, [
    "schema_version", "target", "release", "candidate_package", "signed_launchers",
    "build_receipt_sha256", "unsigned_asset_index_sha256", "signed_launcher_index_sha256",
    "candidate_package_manifest_sha256", "modes", "checks"
  ], `${target} retained lifecycle report`, blockers)) return;
  exactKeys(report.release, ["version", "commit", "channel"], `${target} lifecycle release`, blockers);
  exactKeys(report.modes, ["safe", "local_actions"], `${target} lifecycle modes`, blockers);
  exactKeys(report.checks, LIFECYCLE_CHECK_KEYS, `${target} lifecycle checks`, blockers);
  if (report.schema_version !== 1 || report.target !== target
      || report.release?.version !== record.version || report.release?.commit !== record.commit || report.release?.channel !== "portable"
      || JSON.stringify(report.candidate_package) !== JSON.stringify(record.candidate_package)
      || JSON.stringify(report.signed_launchers) !== JSON.stringify(record.signed_launchers)
      || report.build_receipt_sha256 !== record.build_receipt_sha256
      || report.unsigned_asset_index_sha256 !== record.unsigned_asset_index_sha256
      || report.signed_launcher_index_sha256 !== record.signed_launcher_index_sha256
      || report.candidate_package_manifest_sha256 !== record.candidate_package_manifest_sha256
      || record.lifecycle_report_sha256 !== canonicalJsonSha256(report)
      || Object.values(report.checks ?? {}).some((value) => value !== true)) {
    blockers.push(`${target} retained lifecycle report is not bound to the exact candidate.`);
  }
  for (const [key, mode] of [["safe", "safe"], ["local_actions", "local-actions"]]) {
    const result = report.modes?.[key];
    if (!exactKeys(result, LIFECYCLE_RESULT_KEYS, `${target} ${mode} lifecycle result`, blockers)) continue;
    exactKeys(result.release, ["product", "version", "commit", "channel"], `${target} ${mode} lifecycle release`, blockers);
    if (result.schema_version !== 1 || result.mode !== mode || result.release?.product !== "Dusk Developer Studio"
        || result.release?.version !== record.version || result.release?.commit !== record.commit || result.release?.channel !== "portable"
        || result.bootstrap_succeeded !== true || result.bootstrap_replay_denied !== true
        || result.authenticated_session_verified !== true || result.exact_release_parity_verified !== true
        || result.capability_contract_verified !== true || result.isolated_project_root_verified !== true
        || result.studio_loopback_services_stopped !== true
        || JSON.stringify(result.expected_studio_listening_endpoints) !== JSON.stringify(["127.0.0.1:5173", "127.0.0.1:8788"])
        || !Array.isArray(result.unexpected_studio_listening_endpoints) || result.unexpected_studio_listening_endpoints.length !== 0) {
      blockers.push(`${target} ${mode} retained lifecycle result is invalid.`);
    }
  }
}

function validateBasePolicy(policy, releaseTag) {
  const blockers = [];
  exactKeys(policy, POLICY_KEYS, "Standalone signing policy", blockers);
  if (policy?.schema_version !== 2 || policy?.product !== "Dusk Developer Studio Local Standalone") blockers.push("Standalone signing policy schema is invalid.");
  if (policy?.channel !== "node-sea-in-process") blockers.push("Standalone signing policy channel is invalid.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy?.canonical_repository ?? "")) blockers.push("Canonical signing repository is invalid.");
  if (!/^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/.test(policy?.workflow_path ?? "")) blockers.push("Signing workflow path is invalid.");
  if (!SAFE_NAME_RE.test(policy?.protected_environment ?? "")) blockers.push("Protected signing environment is invalid.");
  const tagRegex = releaseTagRegex(policy);
  if (!tagRegex) blockers.push("Release tag policy is invalid.");
  else if (!tagRegex.test(releaseTag ?? "")) blockers.push("Release tag does not match the signed-RC policy.");
  if (typeof policy?.publication_enabled !== "boolean") blockers.push("Standalone publication state is invalid.");
  if (policy?.publication_enabled === false && !boundedText(policy?.publication_blocker, 1000)) blockers.push("Disabled publication requires a bounded blocker.");
  if (policy?.publication_enabled === true && policy?.publication_blocker !== "") blockers.push("Enabled publication cannot retain a contradictory blocker.");
  const boundary = policy?.same_user_tool_boundary;
  const boundaryKeys = [
    "schema_version", "decision", "owner", "accepted_at", "authority_reference", "scope",
    "compensating_controls", "residual_risk", "revisit_triggers"
  ];
  const boundaryShapeValid = exactKeys(boundary, boundaryKeys, "Same-user tool boundary decision", blockers);
  if (!boundaryShapeValid || boundary?.schema_version !== 1 || boundary?.decision !== "accepted"
      || boundary?.owner !== "George" || !validTimestamp(boundary?.accepted_at)
      || boundary?.authority_reference !== "docs/security/same-user-tool-boundary-decision.md"
      || boundary?.scope !== "allowlisted-local-developer-tools-current-user"
      || JSON.stringify(boundary?.compensating_controls) !== JSON.stringify(SAME_USER_BOUNDARY_CONTROLS)
      || !boundedText(boundary?.residual_risk, 1000)
      || JSON.stringify(boundary?.revisit_triggers) !== JSON.stringify(SAME_USER_BOUNDARY_REVISIT_TRIGGERS)) {
    blockers.push("Same-user tool boundary decision is invalid.");
  }
  return blockers;
}

export function evaluateStandaloneSigningReadiness(policy, options = {}) {
  const blockers = validateBasePolicy(policy, options.releaseTag);
  const payloadTrustBlockers = [];
  if (exactKeys(policy?.payload_trust, Object.keys(PAYLOAD_TRUST_CONTRACT), "Standalone payload trust contract", payloadTrustBlockers)) {
    for (const [field, expected] of Object.entries(PAYLOAD_TRUST_CONTRACT)) {
      if (policy.payload_trust[field] !== expected) payloadTrustBlockers.push("Standalone payload trust contract is invalid.");
    }
  }
  if (payloadTrustBlockers.length) blockers.push("Standalone payload trust contract is invalid.");
  const requiredTargets = Object.keys(TARGET_CONTRACT).sort();
  const policyTargets = Object.keys(policy?.targets ?? {}).sort();
  if (JSON.stringify(requiredTargets) !== JSON.stringify(policyTargets)) blockers.push("Signing policy must cover the exact supported target set.");
  exactKeys(policy?.runner_labels, requiredTargets, "Standalone runner labels", blockers);
  for (const target of requiredTargets) {
    const targetPolicy = policy?.targets?.[target];
    const contract = TARGET_CONTRACT[target];
    if (!targetPolicy) continue;
    const targetKeys = target === "linux-x64"
      ? ["distribution_format", "signing_provider", "identity_field", "identity_template", "approved_oidc_issuer", "required_checks"]
      : ["distribution_format", "signing_provider", "approved_identity", "identity_field", "required_checks"];
    exactKeys(targetPolicy, targetKeys, `${target} signing policy`, blockers);
    if (targetPolicy.distribution_format !== contract.distribution_format || targetPolicy.signing_provider !== contract.signing_provider || targetPolicy.identity_field !== contract.identity_field) blockers.push(`${target} signing contract is invalid.`);
    if (policy?.runner_labels?.[target] !== contract.runner_label) blockers.push(`${target} runner label is not approved.`);
    if (!expectedTargetIdentity(policy, target, options.releaseTag ?? "")) blockers.push(`${target} platform identity is not configured.`);
    if (target === "linux-x64" && targetPolicy.approved_oidc_issuer !== "https://token.actions.githubusercontent.com") blockers.push("Linux OIDC issuer is not approved.");
    if (JSON.stringify(targetPolicy.required_checks) !== JSON.stringify(contract.required_checks)) blockers.push(`${target} required checks are invalid.`);
  }
  return { stage: "source-build-signing-readiness", decision: blockers.length ? "blocked" : "ready", blockers: unique(blockers) };
}

export function evaluateStandaloneTransportReadiness(policy) {
  const blockers = [];
  const transport = policy?.candidate_transport;
  const shapeBlockers = [];
  if (exactKeys(transport, ["enabled", "provider", "blocker"], "Candidate transport policy", shapeBlockers)
      && transport.enabled === false && transport.provider === "none" && boundedText(transport.blocker, 1000)) {
    blockers.push(transport.blocker);
  } else {
    blockers.push("No candidate transport provider is approved by standalone signing policy schema 2.");
  }
  blockers.push(...shapeBlockers);
  return { stage: "candidate-transport-readiness", decision: blockers.length ? "blocked" : "ready", blockers: unique(blockers) };
}

export function evaluateStandaloneSigningEvidence(policy, evidence) {
  const releaseTag = evidence?.release_tag ?? "";
  const readiness = evaluateStandaloneSigningReadiness(policy, { releaseTag });
  const blockers = [...readiness.blockers];
  exactKeys(evidence, [
    "schema_version", "repository", "workflow_ref", "run_id", "run_attempt", "run_actor",
    "approval_reference_url", "release_tag", "commit", "created_at", "targets"
  ], "Standalone signing evidence", blockers);
  if (evidence?.schema_version !== 3) blockers.push("Standalone signing evidence schema is invalid.");
  if (!COMMIT_RE.test(evidence?.commit ?? "")) blockers.push("Standalone evidence commit is invalid.");
  if (evidence?.repository !== policy?.canonical_repository) blockers.push("Standalone evidence repository is not canonical.");
  if (evidence?.workflow_ref !== expectedWorkflowRef(policy, releaseTag)) blockers.push("Standalone evidence workflow reference is not tag-bound.");
  if (!/^[1-9][0-9]*$/.test(String(evidence?.run_id ?? ""))) blockers.push("Standalone evidence workflow run id is invalid.");
  if (!/^[1-9][0-9]*$/.test(String(evidence?.run_attempt ?? ""))) blockers.push("Standalone evidence workflow run attempt is invalid.");
  if (!validActor(evidence?.run_actor)) blockers.push("Standalone evidence workflow actor is invalid.");
  if (!validRepositoryUrl(evidence?.approval_reference_url, policy)) blockers.push("Standalone evidence approval reference is not canonical.");
  if (!validTimestamp(evidence?.created_at)) blockers.push("Standalone evidence timestamp is invalid.");
  const requiredTargets = Object.keys(TARGET_CONTRACT).sort();
  const evidenceTargets = Object.keys(evidence?.targets ?? {}).sort();
  if (JSON.stringify(requiredTargets) !== JSON.stringify(evidenceTargets)) blockers.push("Standalone signing evidence must cover the exact required target set.");
  for (const target of requiredTargets) {
    const targetPolicy = policy?.targets?.[target];
    const record = evidence?.targets?.[target];
    if (!targetPolicy || !record) continue;
    const expectedRecordFields = [
      "schema_version", "target", "repository", "workflow_ref", "run_id", "run_attempt", "run_actor", "created_at",
      "release_tag", "version", "commit", "candidate_package", "signed_launchers",
      "build_receipt_sha256", "unsigned_asset_index_sha256", "signed_launcher_index_sha256",
      "candidate_package_manifest_sha256",
      "unsigned_launchers", "distribution_format", "signing_provider", targetPolicy.identity_field,
      "lifecycle_report", "lifecycle_report_sha256", "checks",
      ...(targetPolicy.approved_oidc_issuer ? ["oidc_issuer"] : [])
    ];
    exactKeys(record, expectedRecordFields, `${target} target evidence`, blockers);
    if (record.schema_version !== 3) blockers.push(`${target} target evidence schema is invalid.`);
    if (record.target !== target || record.version !== versionFromReleaseTag(releaseTag)
        || record.commit !== evidence.commit || record.release_tag !== releaseTag) blockers.push(`${target} release identity is inconsistent.`);
    if (record.repository !== evidence.repository || record.workflow_ref !== evidence.workflow_ref
        || record.run_id !== evidence.run_id || record.run_attempt !== evidence.run_attempt || record.run_actor !== evidence.run_actor) {
      blockers.push(`${target} workflow provenance is inconsistent.`);
    }
    if (!validTimestamp(record.created_at)) blockers.push(`${target} target evidence timestamp is invalid.`);
    else if (validTimestamp(evidence.created_at)) {
      const elapsed = Date.parse(evidence.created_at) - Date.parse(record.created_at);
      if (elapsed < 0 || elapsed > MAX_SIGNING_RUN_DURATION_MS) blockers.push(`${target} target evidence is outside the bounded signing run window.`);
    }
    if (exactKeys(record.candidate_package, ["name", "bytes", "sha256"], `${target} candidate package`, blockers)
        && (record.candidate_package.name !== `dusk-developer-studio-${record.version}-${target}-internal-rc.zip`
          || !SHA256_RE.test(record.candidate_package.sha256 ?? "") || !Number.isSafeInteger(record.candidate_package.bytes) || record.candidate_package.bytes <= 0)) {
      blockers.push(`${target} candidate package identity is invalid.`);
    }
    for (const [field, label] of [["signed_launchers", "signed launcher"], ["unsigned_launchers", "unsigned launcher"]]) {
      exactKeys(record[field], ["safe", "local_actions"], `${target} ${label} set`, blockers);
      for (const [variant, mode] of [["safe", "safe"], ["local_actions", "local-actions"]]) {
        const asset = record[field]?.[variant];
        const safeName = field === "signed_launchers"
          ? typeof asset?.name === "string" && /^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,299}$/.test(asset.name)
            && !asset.name.startsWith("/") && !asset.name.split("/").some((part) => !part || part === "." || part === "..")
          : SAFE_NAME_RE.test(asset?.name ?? "");
        if (exactKeys(asset, ["mode", "name", "bytes", "sha256"], `${target} ${variant} ${label}`, blockers)
            && (asset.mode !== mode || !safeName || !SHA256_RE.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0)) {
          blockers.push(`${target} ${variant} ${label} identity is invalid.`);
        }
      }
      if (record[field]?.safe?.name === record[field]?.local_actions?.name
          || record[field]?.safe?.sha256 === record[field]?.local_actions?.sha256) blockers.push(`${target} ${label} identities are not distinct.`);
    }
    if (!SHA256_RE.test(record.build_receipt_sha256 ?? "") || !SHA256_RE.test(record.unsigned_asset_index_sha256 ?? "")
        || !SHA256_RE.test(record.signed_launcher_index_sha256 ?? "")
        || !SHA256_RE.test(record.candidate_package_manifest_sha256 ?? "")
        || !SHA256_RE.test(record.lifecycle_report_sha256 ?? "")) blockers.push(`${target} build, asset-index, or lifecycle binding is invalid.`);
    if (record.distribution_format !== targetPolicy.distribution_format || record.signing_provider !== targetPolicy.signing_provider) blockers.push(`${target} distribution or signing provider is invalid.`);
    const expectedIdentity = expectedTargetIdentity(policy, target, releaseTag);
    if (!expectedIdentity || record[targetPolicy.identity_field] !== expectedIdentity) blockers.push(`${target} platform identity is not approved.`);
    if (targetPolicy.approved_oidc_issuer && record.oidc_issuer !== targetPolicy.approved_oidc_issuer) blockers.push(`${target} OIDC issuer is not approved.`);
    exactKeys(record.checks, targetPolicy.required_checks ?? [], `${target} checks`, blockers);
    for (const check of targetPolicy.required_checks ?? []) if (record.checks?.[check] !== true) blockers.push(`${target} required check failed: ${check}.`);
    validateRetainedLifecycleReport(record, target, blockers);
  }
  const packages = requiredTargets.map((target) => evidence?.targets?.[target]?.candidate_package).filter(Boolean);
  if (new Set(packages.map((record) => record.name)).size !== packages.length
      || new Set(packages.map((record) => record.sha256)).size !== packages.length) blockers.push("Standalone candidate packages must be distinct across targets.");
  return { stage: "signed-candidate-acceptance", decision: blockers.length ? "rejected" : "accepted", blockers: unique(blockers) };
}

function validatePublicationContract(policy, blockers) {
  const contract = policy?.publication_evidence_contract;
  const keys = [
    "schema_version", "maximum_candidate_age_days", "maximum_clock_skew_minutes",
    "maximum_monitoring_revisit_days", "actor_identity_scheme", "evidence_authentication", "required_gates"
  ];
  exactKeys(contract, keys, "Publication evidence contract", blockers);
  if (contract?.schema_version !== 1 || contract?.actor_identity_scheme !== "github-login"
      || contract?.evidence_authentication !== "not-implemented-schema-2"
      || JSON.stringify(contract?.required_gates) !== JSON.stringify(PUBLICATION_GATES)
      || !Number.isSafeInteger(contract?.maximum_candidate_age_days) || contract.maximum_candidate_age_days < 1 || contract.maximum_candidate_age_days > 90
      || !Number.isSafeInteger(contract?.maximum_clock_skew_minutes) || contract.maximum_clock_skew_minutes < 0 || contract.maximum_clock_skew_minutes > 30
      || !Number.isSafeInteger(contract?.maximum_monitoring_revisit_days) || contract.maximum_monitoring_revisit_days < 1 || contract.maximum_monitoring_revisit_days > 365) {
    blockers.push("Publication evidence contract is invalid.");
  }
  return contract;
}

export function createStandalonePublicationEvidenceTemplate(policy, { signingEvidenceBytes, createdAt = new Date().toISOString() }) {
  const contractBlockers = [];
  const contract = validatePublicationContract(policy, contractBlockers);
  if (contractBlockers.length) throw new Error("Publication evidence contract is invalid.");
  const signing = parseEvidenceBytes(signingEvidenceBytes, "Standalone signing evidence");
  const releaseTag = signing.evidence?.release_tag;
  const commit = signing.evidence?.commit;
  if (!releaseTagRegex(policy)?.test(releaseTag ?? "") || !COMMIT_RE.test(commit ?? "")) throw new Error("Signing evidence release identity is invalid.");
  if (!validTimestamp(createdAt) || !validTimestamp(signing.evidence?.created_at)
      || Date.parse(createdAt) < Date.parse(signing.evidence.created_at)) throw new Error("Publication evidence creation time is invalid.");
  return {
    schema_version: contract.schema_version,
    repository: policy.canonical_repository,
    release_tag: releaseTag,
    commit,
    signing_evidence_sha256: signing.sha256,
    created_at: createdAt,
    gates: {
      security_review: { status: "pending", reviewer_actor: "", reviewed_at: "", report_url: "", report_sha256: "", scope_commit: commit, open_critical_findings: null, open_high_findings: null },
      support_incident_route: { status: "pending", owner_actor: "", route_url: "", tested_at: "", response_target_hours: null },
      compatibility: { status: "pending", matrix_url: "", matrix_sha256: "", tested_at: "", targets: Object.keys(TARGET_CONTRACT) },
      rollback_revocation: { status: "pending", owner_actor: "", runbook_url: "", runbook_sha256: "", tested_at: "", revocation_tested: false },
      reputation_quarantine: { status: "pending", owner_actor: "", evidence_url: "", evidence_sha256: "", quarantine_plan_url: "", quarantine_plan_sha256: "", reviewed_at: "" },
      monitoring_revisit: { status: "pending", owner_actor: "", monitoring_url: "", revisit_at: "" },
      explicit_approval: { status: "pending", approver_actor: "", approved_at: "", approval_reference_url: "", approval_reference_sha256: "", release_tag: releaseTag, commit }
    }
  };
}

export function evaluateStandalonePublicationEvidence(policy, evidence, { signingEvidenceBytes, now = Date.now() } = {}) {
  const blockers = [];
  const contract = validatePublicationContract(policy, blockers);
  if (contract?.evidence_authentication === "not-implemented-schema-2") {
    blockers.push("Publication gate artifacts and actor identities are not authenticated by policy schema 2.");
  }
  let signing;
  try { signing = parseEvidenceBytes(signingEvidenceBytes, "Standalone signing evidence"); }
  catch (error) { blockers.push(error instanceof Error ? error.message : "Standalone signing evidence bytes are invalid."); }
  const signingEvidence = signing?.evidence;
  const nowMs = typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(nowMs)) blockers.push("Publication evaluation time is invalid.");
  const maximumClockSkewMs = (contract?.maximum_clock_skew_minutes ?? 0) * 60_000;
  const targetTimes = Object.values(signingEvidence?.targets ?? {}).map((record) => record?.created_at).filter(validTimestamp);
  const candidateAt = targetTimes.length ? new Date(Math.max(...targetTimes.map(Date.parse))).toISOString() : signingEvidence?.created_at;

  exactKeys(evidence, ["schema_version", "repository", "release_tag", "commit", "signing_evidence_sha256", "created_at", "gates"], "Publication evidence", blockers);
  if (evidence?.schema_version !== contract?.schema_version) blockers.push("Publication evidence schema is invalid.");
  if (evidence?.repository !== policy?.canonical_repository) blockers.push("Publication evidence repository is not canonical.");
  blockers.push(...validateBasePolicy(policy, evidence?.release_tag));
  if (!COMMIT_RE.test(evidence?.commit ?? "")) blockers.push("Publication evidence commit is invalid.");
  if (!SHA256_RE.test(evidence?.signing_evidence_sha256 ?? "") || evidence?.signing_evidence_sha256 !== signing?.sha256) blockers.push("Publication evidence is not bound to the accepted signing evidence bytes.");
  if (!validTimestamp(evidence?.created_at)) blockers.push("Publication evidence creation time is invalid.");
  if (!validTimestamp(candidateAt)) blockers.push("Accepted signing evidence timestamp is invalid.");
  if (validTimestamp(evidence?.created_at) && validTimestamp(candidateAt)) {
    if (Date.parse(evidence.created_at) < Date.parse(candidateAt)) blockers.push("Publication evidence predates the accepted signed candidate.");
    if (Number.isFinite(nowMs) && Date.parse(evidence.created_at) > nowMs + maximumClockSkewMs) blockers.push("Publication evidence is unacceptably future-dated.");
    if (Number.isFinite(nowMs) && nowMs - Date.parse(candidateAt) > (contract?.maximum_candidate_age_days ?? 0) * 86_400_000) blockers.push("Accepted signed-candidate evidence is stale.");
  }
  exactKeys(evidence?.gates, PUBLICATION_GATES, "Publication evidence gates", blockers);

  const timeOptions = { candidateAt, now: nowMs, maximumClockSkewMs };
  const createdAt = evidence?.created_at;
  const security = evidence?.gates?.security_review;
  if (exactKeys(security, ["status", "reviewer_actor", "reviewed_at", "report_url", "report_sha256", "scope_commit", "open_critical_findings", "open_high_findings"], "Security review gate", blockers)) {
    if (security.status !== "accepted" || !validActor(security.reviewer_actor) || !validRepositoryUrl(security.report_url, policy) || !SHA256_RE.test(security.report_sha256 ?? "")
        || security.scope_commit !== evidence.commit || security.open_critical_findings !== 0 || security.open_high_findings !== 0) blockers.push("Security review gate is not accepted without immutable evidence and zero critical or high findings.");
    requireTimestamp(security.reviewed_at, "Security review", createdAt, blockers, timeOptions);
  }
  const support = evidence?.gates?.support_incident_route;
  if (exactKeys(support, ["status", "owner_actor", "route_url", "tested_at", "response_target_hours"], "Support and incident gate", blockers)) {
    if (support.status !== "accepted" || !validActor(support.owner_actor) || !validRepositoryUrl(support.route_url, policy)
        || !Number.isSafeInteger(support.response_target_hours) || support.response_target_hours < 1 || support.response_target_hours > 168) blockers.push("Support and incident route gate is not accepted.");
    requireTimestamp(support.tested_at, "Support and incident route test", createdAt, blockers, timeOptions);
  }
  const compatibility = evidence?.gates?.compatibility;
  if (exactKeys(compatibility, ["status", "matrix_url", "matrix_sha256", "tested_at", "targets"], "Compatibility gate", blockers)) {
    const targets = Array.isArray(compatibility.targets) ? [...compatibility.targets].sort() : [];
    if (compatibility.status !== "accepted" || !validRepositoryUrl(compatibility.matrix_url, policy) || !SHA256_RE.test(compatibility.matrix_sha256 ?? "")
        || JSON.stringify(targets) !== JSON.stringify(Object.keys(TARGET_CONTRACT).sort())) blockers.push("Compatibility gate does not cover the exact supported target set with immutable evidence.");
    requireTimestamp(compatibility.tested_at, "Compatibility test", createdAt, blockers, timeOptions);
  }
  const rollback = evidence?.gates?.rollback_revocation;
  if (exactKeys(rollback, ["status", "owner_actor", "runbook_url", "runbook_sha256", "tested_at", "revocation_tested"], "Rollback and revocation gate", blockers)) {
    if (rollback.status !== "accepted" || !validActor(rollback.owner_actor) || !validRepositoryUrl(rollback.runbook_url, policy)
        || !SHA256_RE.test(rollback.runbook_sha256 ?? "") || rollback.revocation_tested !== true) blockers.push("Rollback and revocation gate is not accepted.");
    requireTimestamp(rollback.tested_at, "Rollback and revocation test", createdAt, blockers, timeOptions);
  }
  const reputation = evidence?.gates?.reputation_quarantine;
  if (exactKeys(reputation, ["status", "owner_actor", "evidence_url", "evidence_sha256", "quarantine_plan_url", "quarantine_plan_sha256", "reviewed_at"], "Reputation and quarantine gate", blockers)) {
    if (reputation.status !== "accepted" || !validActor(reputation.owner_actor) || !validRepositoryUrl(reputation.evidence_url, policy)
        || !SHA256_RE.test(reputation.evidence_sha256 ?? "") || !validRepositoryUrl(reputation.quarantine_plan_url, policy)
        || !SHA256_RE.test(reputation.quarantine_plan_sha256 ?? "")) blockers.push("Reputation and quarantine gate is not accepted with immutable evidence.");
    requireTimestamp(reputation.reviewed_at, "Reputation and quarantine review", createdAt, blockers, timeOptions);
  }
  const monitoring = evidence?.gates?.monitoring_revisit;
  if (exactKeys(monitoring, ["status", "owner_actor", "monitoring_url", "revisit_at"], "Monitoring revisit gate", blockers)) {
    if (monitoring.status !== "accepted" || !validActor(monitoring.owner_actor) || !validRepositoryUrl(monitoring.monitoring_url, policy) || !validTimestamp(monitoring.revisit_at)) blockers.push("Monitoring revisit gate is not accepted.");
    else if (validTimestamp(createdAt) && Number.isFinite(nowMs)) {
      const interval = Date.parse(monitoring.revisit_at) - Date.parse(createdAt);
      if (Date.parse(monitoring.revisit_at) <= nowMs || interval <= 0 || interval > (contract?.maximum_monitoring_revisit_days ?? 0) * 86_400_000) blockers.push("Monitoring revisit is expired or outside the allowed interval.");
    }
  }
  const approval = evidence?.gates?.explicit_approval;
  if (exactKeys(approval, ["status", "approver_actor", "approved_at", "approval_reference_url", "approval_reference_sha256", "release_tag", "commit"], "Explicit approval gate", blockers)) {
    if (approval.status !== "approved" || !validActor(approval.approver_actor) || !validRepositoryUrl(approval.approval_reference_url, policy)
        || !SHA256_RE.test(approval.approval_reference_sha256 ?? "") || approval.release_tag !== evidence.release_tag || approval.commit !== evidence.commit) blockers.push("Explicit publication approval is invalid or is not release-bound.");
    requireTimestamp(approval.approved_at, "Explicit publication approval", createdAt, blockers, timeOptions);
    if (validActor(approval.approver_actor) && validActor(security?.reviewer_actor)
        && approval.approver_actor.toLowerCase() === security.reviewer_actor.toLowerCase()) blockers.push("Security review and publication approval require different authenticated actors.");
    const prerequisiteTimes = [security?.reviewed_at, support?.tested_at, compatibility?.tested_at, rollback?.tested_at, reputation?.reviewed_at];
    if (validTimestamp(approval.approved_at) && prerequisiteTimes.every(validTimestamp)
        && prerequisiteTimes.some((value) => Date.parse(value) > Date.parse(approval.approved_at))) blockers.push("Explicit publication approval predates a required gate.");
  }
  if (signingEvidence && (evidence?.release_tag !== signingEvidence.release_tag || evidence?.commit !== signingEvidence.commit)) blockers.push("Publication evidence does not describe the supplied signed-candidate evidence.");
  return { stage: "publication-evidence-acceptance", decision: blockers.length ? "rejected" : "accepted", blockers: unique(blockers) };
}

export function evaluateStandalonePublicationReadiness(policy, { signingEvidenceBytes, publicationEvidence, now = Date.now() }) {
  let signing;
  try { signing = parseEvidenceBytes(signingEvidenceBytes, "Standalone signing evidence"); }
  catch (error) {
    return { stage: "publication-readiness", decision: "no-go", blockers: [error instanceof Error ? error.message : "Standalone signing evidence bytes are invalid."] };
  }
  const signedCandidate = evaluateStandaloneSigningEvidence(policy, signing.evidence);
  const transport = evaluateStandaloneTransportReadiness(policy);
  const publication = evaluateStandalonePublicationEvidence(policy, publicationEvidence, { signingEvidenceBytes: signing.bytes, now });
  const blockers = [...signedCandidate.blockers, ...transport.blockers, ...publication.blockers];
  if (policy?.publication_enabled !== true) blockers.push(policy?.publication_blocker || "Standalone publication is disabled.");
  return { stage: "publication-readiness", decision: blockers.length ? "no-go" : "go", blockers: unique(blockers) };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
    let result;
    if (args.readiness) result = evaluateStandaloneSigningReadiness(policy, { releaseTag: args["release-tag"] });
    else if (args["transport-readiness"]) result = evaluateStandaloneTransportReadiness(policy);
    else if (args["publication-template"]) {
      if (!args["signing-evidence"]) throw new Error("Publication template generation requires --signing-evidence=<json>.");
      result = createStandalonePublicationEvidenceTemplate(policy, {
        signingEvidenceBytes: fs.readFileSync(path.resolve(args["signing-evidence"])), createdAt: args["created-at"] ?? new Date().toISOString()
      });
    }
    else if (args["publication-evidence"]) {
      if (!args["signing-evidence"]) throw new Error("Publication validation requires --signing-evidence=<json>.");
      const signingEvidenceBytes = fs.readFileSync(path.resolve(args["signing-evidence"]));
      const publicationEvidence = JSON.parse(fs.readFileSync(path.resolve(args["publication-evidence"]), "utf8"));
      result = evaluateStandalonePublicationReadiness(policy, {
        signingEvidenceBytes, publicationEvidence, now: args.now ? Date.parse(args.now) : Date.now()
      });
    }
    else {
      if (!args.evidence) throw new Error("Usage: node scripts/standalone-signing-evidence.mjs (--readiness --release-tag=<tag> | --transport-readiness | --evidence=<json> | --publication-template --signing-evidence=<json> | --publication-evidence=<json> --signing-evidence=<json> [--now=<ISO-8601>]) [--report-only]");
      const evidence = JSON.parse(fs.readFileSync(path.resolve(args.evidence), "utf8"));
      result = evaluateStandaloneSigningEvidence(policy, evidence);
    }
    console.log(JSON.stringify(result, null, 2));
    if (!args["report-only"] && result?.decision && !["ready", "accepted", "go"].includes(result.decision)) process.exitCode = 1;
  } catch (error) { console.error(error instanceof Error ? error.message : "Standalone signing evidence failed."); process.exitCode = 1; }
}
