import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluatePhase5Evidence } from "./phase5-evidence.mjs";

const root = path.resolve(process.cwd());
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "phase5-policy.json"), "utf8"));
const now = new Date("2026-07-15T00:00:00Z");
policy.monitoring_evidence.accepted_risk.accepted_at = now.toISOString();
const digest = "a".repeat(64);
const owners = Object.fromEntries(policy.required_owners.map((owner) => [owner, `${owner}-owner`]));
const reviews = Object.fromEntries(policy.required_reviews.map((review) => [review, { status: "accepted", reviewer: `${review}-reviewer`, reviewed_at: "2026-07-15T00:00:00Z", independent: true }]));
const sessions = [
  ["p1", "duskds", "novice", "windows", true, true],
  ["p2", "duskds", "experienced", "wsl", true, true],
  ["p3", "duskds", "experienced", "linux", true, true],
  ["p4", "duskds", "novice", "windows", true, true],
  ["p5", "duskds", "experienced", "wsl", true, true],
  ["p6", "duskds", "experienced", "linux", true, true],
  ["p7", "duskds", "experienced", "macos", true, true],
  ["p8", "duskds", "experienced", "macos", true, true]
].map(([id, pathName, experience, context, recoveryAttempted, recovered]) => ({ id, path: pathName, experience, context, completed: true, recovery_attempted: recoveryAttempted, recovered, trust_score: 5, blocking_confusion: false, duration_minutes: 20 }));
const checks = Object.fromEntries(policy.required_synthetic_checks.map((check) => [check, { status: "passed", owner: "platform-owner" }]));
checks.duskds_node_read = {
  ...checks.duskds_node_read,
  endpoint: policy.duskds_testnet_graphql_url,
  height: 3_818_138,
  hash: "f".repeat(64),
  observed_at: "2026-07-15T00:00:00Z"
};
checks.rpc_chain_id = {
  status: "deferred",
  path: "evm",
  reason: policy.deferred_synthetic_checks.rpc_chain_id.reason
};
checks.monitor_heartbeat = {
  ...checks.monitor_heartbeat,
  receipt_sha256: digest,
  workflow_path: policy.monitoring_evidence.schedule_guard_workflow,
  observed_at: "2026-07-14T12:00:00Z",
  run_url: "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123456"
};
const passedSteps = (steps) => Object.fromEntries(steps.map((step) => [step, "passed"]));
const evidence = {
  schema_version: 2,
  candidate: { artifact_fingerprint_sha256: digest, public_fingerprint_sha256: digest, commit: "b".repeat(40), manifest_url: "https://studio.134-122-59-217.nip.io/release-manifest.json", built_at: "2026-07-15T00:00:00Z", source_checked_at: "2026-07-14T00:00:00Z", source_expires_at: "2026-08-03T23:59:59Z" },
  companion_distribution: { hosted_mode: "docs-only", availability: "not-published", targets: {} },
  owners,
  reviews,
  pilot: { sessions },
  live_smoke: { status: "passed", authority_reference: "approval-2026-07-15", redacted: true, native_steps: passedSteps(policy.required_native_smoke_steps) },
  synthetics: {
    checks,
    monitoring: {
      mode: policy.monitoring_evidence.mode,
      owner: policy.monitoring_evidence.accepted_risk.owner,
      authority_reference: policy.monitoring_evidence.accepted_risk.authority_reference
    },
    alert_delivery_verified: true,
    checked_at: "2026-07-15T00:00:00Z"
  },
  rollback: {
    product: { status: "passed", owner: "engineering-owner", duration_seconds: 100, restored_fingerprint_sha256: digest, health_proof: "receipt-product", data_cache_effects: "immutable assets retained; HTML reverted" },
    platform: { status: "passed", owner: "platform-owner", duration_seconds: 200, restored_fingerprint_sha256: digest, health_proof: "receipt-platform", data_cache_effects: "no data mutation; route restored" }
  },
  issues: [],
  support: { on_call_owner: "support-owner", support_channel_confirmed: true, launch_message_owner: "product-owner", incident_message_owner: "platform-owner" },
  product_signoff: { decision: "go", owner: "George", signed_at: "2026-07-15T00:00:00Z", artifact_fingerprint_sha256: digest }
};

assert.equal(evaluatePhase5Evidence(policy, evidence, { now }).decision, "go");
assert.match(evaluatePhase5Evidence(policy, { ...evidence, candidate: { ...evidence.candidate, public_fingerprint_sha256: "c".repeat(64) } }, { now }).blockers.join("\n"), /fingerprints differ/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, pilot: { sessions: sessions.slice(0, 7) } }, { now }).blockers.join("\n"), /Pilot has 7\/8/);
const mixedPathSessions = sessions.map((session, index) => index === 0 ? { ...session, path: "evm" } : session);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, pilot: { sessions: mixedPathSessions } }, { now }).blockers.join("\n"), /required DuskDS sessions|non-production path/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, live_smoke: { status: "not-authorized" } }, { now }).blockers.join("\n"), /explicit authority/);
const incompleteNativeSmoke = JSON.parse(JSON.stringify(evidence));
delete incompleteNativeSmoke.live_smoke.native_steps.node_read;
assert.match(evaluatePhase5Evidence(policy, incompleteNativeSmoke, { now }).blockers.join("\n"), /DuskDS production smoke step node_read/);
const missingRpcDeferral = JSON.parse(JSON.stringify(evidence));
delete missingRpcDeferral.synthetics.checks.rpc_chain_id;
assert.match(evaluatePhase5Evidence(policy, missingRpcDeferral, { now }).blockers.join("\n"), /exact reviewed pre-launch deferral/);
const attemptedEvmActivation = JSON.parse(JSON.stringify(policy));
attemptedEvmActivation.production_paths.push("evm");
attemptedEvmActivation.preview_paths = [];
const attemptedEvmBlockers = evaluatePhase5Evidence(attemptedEvmActivation, evidence, { now }).blockers.join("\n");
assert.match(attemptedEvmBlockers, /real RPC verification and no active deferral/);
assert.match(attemptedEvmBlockers, /explicit EVM smoke steps and pilot coverage/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, reviews: { ...reviews, companion_security: { ...reviews.companion_security, independent: false } } }, { now }).blockers.join("\n"), /not recorded as independent/);
const missingDevelopmentPort = JSON.parse(JSON.stringify(evidence));
delete missingDevelopmentPort.synthetics.checks.development_port_closed;
assert.match(evaluatePhase5Evidence(policy, missingDevelopmentPort, { now }).blockers.join("\n"), /development_port_closed/);
const invalidDuskDsRead = JSON.parse(JSON.stringify(evidence));
invalidDuskDsRead.synthetics.checks.duskds_node_read.height = 0;
assert.match(evaluatePhase5Evidence(policy, invalidDuskDsRead, { now }).blockers.join("\n"), /DuskDS node-read evidence/);
const staleDuskDsRead = JSON.parse(JSON.stringify(evidence));
staleDuskDsRead.synthetics.checks.duskds_node_read.observed_at = "2026-07-13T00:00:00Z";
assert.match(evaluatePhase5Evidence(policy, staleDuskDsRead, { now }).blockers.join("\n"), /DuskDS node-read evidence/);
const futureDuskDsRead = JSON.parse(JSON.stringify(evidence));
futureDuskDsRead.synthetics.checks.duskds_node_read.observed_at = "2026-07-15T00:01:00Z";
assert.match(evaluatePhase5Evidence(policy, futureDuskDsRead, { now }).blockers.join("\n"), /DuskDS node-read evidence/);
const unboundDuskDsRead = JSON.parse(JSON.stringify(evidence));
unboundDuskDsRead.synthetics.checked_at = "2026-07-14T23:30:00Z";
assert.match(evaluatePhase5Evidence(policy, unboundDuskDsRead, { now }).blockers.join("\n"), /DuskDS node-read evidence/);
const unboundHeartbeat = JSON.parse(JSON.stringify(evidence));
delete unboundHeartbeat.synthetics.checks.monitor_heartbeat.receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, unboundHeartbeat, { now }).blockers.join("\n"), /Monitor heartbeat evidence/);
const wrongMonitoringMode = JSON.parse(JSON.stringify(evidence));
wrongMonitoringMode.synthetics.monitoring.mode = "external";
assert.match(evaluatePhase5Evidence(policy, wrongMonitoringMode, { now }).blockers.join("\n"), /reviewed monitoring mode/);
const missingAcceptedRisk = JSON.parse(JSON.stringify(policy));
delete missingAcceptedRisk.monitoring_evidence.accepted_risk;
assert.match(evaluatePhase5Evidence(missingAcceptedRisk, evidence, { now }).blockers.join("\n"), /accepted-risk record/);
const futureAcceptedRisk = JSON.parse(JSON.stringify(policy));
futureAcceptedRisk.monitoring_evidence.accepted_risk.accepted_at = "2099-01-01T00:00:00Z";
assert.match(evaluatePhase5Evidence(futureAcceptedRisk, evidence, { now }).blockers.join("\n"), /accepted-risk record/);
const externalRequiredByGithubOnly = JSON.parse(JSON.stringify(policy));
externalRequiredByGithubOnly.required_synthetic_checks.push("external_dead_man");
assert.match(evaluatePhase5Evidence(externalRequiredByGithubOnly, evidence, { now }).blockers.join("\n"), /cannot require external checks/);

const externalPolicy = JSON.parse(JSON.stringify(policy));
externalPolicy.required_synthetic_checks.push("external_dead_man", "external_direct_health");
externalPolicy.monitoring_evidence = {
  ...externalPolicy.monitoring_evidence,
  mode: "external",
  external_success_max_age_hours: 15,
  direct_health_max_age_hours: 15,
  external_rehearsal_max_age_days: 30
};
delete externalPolicy.monitoring_evidence.accepted_risk;
const externalEvidence = JSON.parse(JSON.stringify(evidence));
externalEvidence.synthetics.monitoring = {
  mode: "external",
  owner: "platform-owner",
  authority_reference: "external-monitoring-review"
};
externalEvidence.synthetics.checks.external_dead_man = {
  status: "passed",
  owner: "platform-owner",
  outside_github: true,
  success_endpoint_configured: true,
  provider: "external-dead-man-provider",
  check_id: "studio-public-staging",
  alert_channel: "email",
  alert_delivery_verified: true,
  latest_success_at: "2026-07-14T18:00:00Z",
  missed_ping_rehearsed_at: "2026-07-10T12:00:00Z",
  rehearsal_reference: "external-rehearsal-2026-07-10"
};
externalEvidence.synthetics.checks.external_direct_health = {
  status: "passed",
  owner: "platform-owner",
  outside_github: true,
  provider: "external-uptime-provider",
  check_id: "studio-public-health",
  target_url: "https://studio.134-122-59-217.nip.io/healthz",
  response_status: 200,
  body_match: "ok",
  tls_verified: true,
  alert_channel: "email",
  alert_delivery_verified: true,
  latest_success_at: "2026-07-14T18:00:00Z",
  alert_rehearsed_at: "2026-07-10T13:00:00Z",
  recovery_verified: true,
  recovered_at: "2026-07-10T13:30:00Z",
  rehearsal_reference: "direct-health-rehearsal-2026-07-10"
};
assert.equal(evaluatePhase5Evidence(externalPolicy, externalEvidence, { now }).decision, "go");
const githubBoundDeadMan = JSON.parse(JSON.stringify(externalEvidence));
githubBoundDeadMan.synthetics.checks.external_dead_man.outside_github = false;
assert.match(evaluatePhase5Evidence(externalPolicy, githubBoundDeadMan, { now }).blockers.join("\n"), /External dead-man evidence/);
const staleExternalSuccess = JSON.parse(JSON.stringify(externalEvidence));
staleExternalSuccess.synthetics.checks.external_dead_man.latest_success_at = "2026-07-13T00:00:00Z";
assert.match(evaluatePhase5Evidence(externalPolicy, staleExternalSuccess, { now }).blockers.join("\n"), /External dead-man evidence/);
const missingDirectHealth = JSON.parse(JSON.stringify(externalEvidence));
delete missingDirectHealth.synthetics.checks.external_direct_health;
assert.match(evaluatePhase5Evidence(externalPolicy, missingDirectHealth, { now }).blockers.join("\n"), /external_direct_health|External direct health evidence/);
const wrongDirectTarget = JSON.parse(JSON.stringify(externalEvidence));
wrongDirectTarget.synthetics.checks.external_direct_health.target_url = "https://studio.134-122-59-217.nip.io:8443/healthz";
assert.match(evaluatePhase5Evidence(externalPolicy, wrongDirectTarget, { now }).blockers.join("\n"), /External direct health evidence/);
const unhealthyDirectObservation = JSON.parse(JSON.stringify(externalEvidence));
unhealthyDirectObservation.synthetics.checks.external_direct_health.tls_verified = false;
assert.match(evaluatePhase5Evidence(externalPolicy, unhealthyDirectObservation, { now }).blockers.join("\n"), /External direct health evidence/);
const staleDirectObservation = JSON.parse(JSON.stringify(externalEvidence));
staleDirectObservation.synthetics.checks.external_direct_health.latest_success_at = "2026-07-13T00:00:00Z";
assert.match(evaluatePhase5Evidence(externalPolicy, staleDirectObservation, { now }).blockers.join("\n"), /External direct health evidence/);
const staleDirectAlert = JSON.parse(JSON.stringify(externalEvidence));
staleDirectAlert.synthetics.checks.external_direct_health.alert_rehearsed_at = "2026-06-01T00:00:00Z";
assert.match(evaluatePhase5Evidence(externalPolicy, staleDirectAlert, { now }).blockers.join("\n"), /External direct health evidence/);
const unverifiedDirectRecovery = JSON.parse(JSON.stringify(externalEvidence));
unverifiedDirectRecovery.synthetics.checks.external_direct_health.recovery_verified = false;
assert.match(evaluatePhase5Evidence(externalPolicy, unverifiedDirectRecovery, { now }).blockers.join("\n"), /External direct health evidence/);
const recoveryBeforeAlert = JSON.parse(JSON.stringify(externalEvidence));
recoveryBeforeAlert.synthetics.checks.external_direct_health.recovered_at = "2026-07-10T12:30:00Z";
assert.match(evaluatePhase5Evidence(externalPolicy, recoveryBeforeAlert, { now }).blockers.join("\n"), /External direct health evidence/);
const successBeforeRecovery = JSON.parse(JSON.stringify(externalEvidence));
successBeforeRecovery.synthetics.checks.external_direct_health.latest_success_at = "2026-07-10T13:15:00Z";
assert.match(evaluatePhase5Evidence(externalPolicy, successBeforeRecovery, { now }).blockers.join("\n"), /External direct health evidence/);
const reusedExternalCheck = JSON.parse(JSON.stringify(externalEvidence));
reusedExternalCheck.synthetics.checks.external_direct_health.check_id = reusedExternalCheck.synthetics.checks.external_dead_man.check_id;
assert.match(evaluatePhase5Evidence(externalPolicy, reusedExternalCheck, { now }).blockers.join("\n"), /External direct health evidence/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, issues: [{ id: "P1-1", severity: "P1", status: "open" }] }, { now }).blockers.join("\n"), /no complete exception/);
const unsignedDistribution = { ...evidence, companion_distribution: { hosted_mode: "docs-only", availability: "unsigned-downloads", targets: {} } };
assert.match(evaluatePhase5Evidence(policy, unsignedDistribution, { now }).blockers.join("\n"), /availability is not allowed/);
const incompleteSignedDistribution = { ...evidence, companion_distribution: { hosted_mode: "docs-only", availability: "signed-downloads", targets: {} } };
assert.match(evaluatePhase5Evidence(policy, incompleteSignedDistribution, { now }).blockers.join("\n"), /incomplete for windows-x64/);
const signedTargets = Object.fromEntries(policy.companion_distribution.required_targets.map((target) => [target, {
  signing_status: "signed",
  signature_algorithm: policy.companion_distribution.required_signatures[target],
  signature_verified: true,
  clean_machine_smoke: "passed",
  archive_sha256: digest,
  manifest_sha256: digest
}]));
const signedDistribution = { ...evidence, companion_distribution: { hosted_mode: "docs-only", availability: "signed-downloads", targets: signedTargets } };
assert.equal(evaluatePhase5Evidence(policy, signedDistribution, { now }).decision, "go");
const wrongLinuxSignature = JSON.parse(JSON.stringify(signedDistribution));
wrongLinuxSignature.companion_distribution.targets["linux-x64"].signature_algorithm = "ed25519";
assert.match(evaluatePhase5Evidence(policy, wrongLinuxSignature, { now }).blockers.join("\n"), /incomplete for linux-x64/);
const forbiddenKey = ["private", "key"].join("_");
assert.match(evaluatePhase5Evidence(policy, { ...evidence, unsafe: { [forbiddenKey]: "redacted" } }, { now }).blockers.join("\n"), /forbidden secret-shaped fields/);
console.log("Phase 5 evidence go/no-go fixtures passed.");
