import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { evaluatePhase5Evidence } from "./phase5-evidence.mjs";

const root = path.resolve(process.cwd());
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "phase5-policy.json"), "utf8"));
const now = new Date("2026-07-15T00:00:00Z");
const digest = "a".repeat(64);
const owners = Object.fromEntries(policy.required_owners.map((owner) => [owner, `${owner}-owner`]));
const reviews = Object.fromEntries(policy.required_reviews.map((review) => [review, { status: "accepted", reviewer: `${review}-reviewer`, reviewed_at: "2026-07-15T00:00:00Z", independent: true }]));
const sessions = [
  ["p1", "evm", "novice", "windows", true, true],
  ["p2", "evm", "experienced", "wsl", true, true],
  ["p3", "evm", "experienced", "linux", true, true],
  ["p4", "native", "novice", "windows", true, true],
  ["p5", "native", "experienced", "wsl", true, true],
  ["p6", "native", "experienced", "linux", true, true],
  ["p7", "evm", "experienced", "macos", true, true],
  ["p8", "native", "experienced", "macos", true, true]
].map(([id, pathName, experience, context, recoveryAttempted, recovered]) => ({ id, path: pathName, experience, context, completed: true, recovery_attempted: recoveryAttempted, recovered, trust_score: 5, blocking_confusion: false, duration_minutes: 20 }));
const checks = Object.fromEntries(policy.required_synthetic_checks.map((check) => [check, { status: "passed", owner: "platform-owner" }]));
checks.monitor_heartbeat = {
  ...checks.monitor_heartbeat,
  receipt_sha256: digest,
  workflow_path: policy.monitoring_evidence.schedule_guard_workflow,
  observed_at: "2026-07-14T12:00:00Z",
  run_url: "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123456"
};
checks.external_dead_man = {
  ...checks.external_dead_man,
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
checks.external_direct_health = {
  ...checks.external_direct_health,
  outside_github: true,
  provider: "external-uptime-provider",
  check_id: "studio-public-health",
  target_url: "https://studio.134-122-59-217.sslip.io/healthz",
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
const passedSteps = (steps) => Object.fromEntries(steps.map((step) => [step, "passed"]));
const evidence = {
  schema_version: 1,
  candidate: { artifact_fingerprint_sha256: digest, public_fingerprint_sha256: digest, commit: "b".repeat(40), manifest_url: "https://studio.134-122-59-217.sslip.io/release-manifest.json", built_at: "2026-07-15T00:00:00Z", source_checked_at: "2026-07-14T00:00:00Z", source_expires_at: "2026-08-03T23:59:59Z" },
  companion_distribution: { hosted_mode: "docs-only", availability: "not-published", targets: {} },
  owners,
  reviews,
  pilot: { sessions },
  live_smoke: { status: "passed", authority_reference: "approval-2026-07-15", redacted: true, evm_steps: passedSteps(policy.required_evm_smoke_steps), native_steps: passedSteps(policy.required_native_smoke_steps) },
  synthetics: { checks, alert_delivery_verified: true, checked_at: "2026-07-15T00:00:00Z" },
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
assert.match(evaluatePhase5Evidence(policy, { ...evidence, live_smoke: { status: "not-authorized" } }, { now }).blockers.join("\n"), /explicit authority/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, reviews: { ...reviews, companion_security: { ...reviews.companion_security, independent: false } } }, { now }).blockers.join("\n"), /not recorded as independent/);
const missingDevelopmentPort = JSON.parse(JSON.stringify(evidence));
delete missingDevelopmentPort.synthetics.checks.development_port_closed;
assert.match(evaluatePhase5Evidence(policy, missingDevelopmentPort, { now }).blockers.join("\n"), /development_port_closed/);
const unboundHeartbeat = JSON.parse(JSON.stringify(evidence));
delete unboundHeartbeat.synthetics.checks.monitor_heartbeat.receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, unboundHeartbeat, { now }).blockers.join("\n"), /Monitor heartbeat evidence/);
const githubBoundDeadMan = JSON.parse(JSON.stringify(evidence));
githubBoundDeadMan.synthetics.checks.external_dead_man.outside_github = false;
assert.match(evaluatePhase5Evidence(policy, githubBoundDeadMan, { now }).blockers.join("\n"), /External dead-man evidence/);
const staleExternalSuccess = JSON.parse(JSON.stringify(evidence));
staleExternalSuccess.synthetics.checks.external_dead_man.latest_success_at = "2026-07-13T00:00:00Z";
assert.match(evaluatePhase5Evidence(policy, staleExternalSuccess, { now }).blockers.join("\n"), /External dead-man evidence/);
const missingDirectHealth = JSON.parse(JSON.stringify(evidence));
delete missingDirectHealth.synthetics.checks.external_direct_health;
assert.match(evaluatePhase5Evidence(policy, missingDirectHealth, { now }).blockers.join("\n"), /external_direct_health|External direct health evidence/);
const wrongDirectTarget = JSON.parse(JSON.stringify(evidence));
wrongDirectTarget.synthetics.checks.external_direct_health.target_url = "https://studio.134-122-59-217.sslip.io:8443/healthz";
assert.match(evaluatePhase5Evidence(policy, wrongDirectTarget, { now }).blockers.join("\n"), /External direct health evidence/);
const unhealthyDirectObservation = JSON.parse(JSON.stringify(evidence));
unhealthyDirectObservation.synthetics.checks.external_direct_health.tls_verified = false;
assert.match(evaluatePhase5Evidence(policy, unhealthyDirectObservation, { now }).blockers.join("\n"), /External direct health evidence/);
const staleDirectObservation = JSON.parse(JSON.stringify(evidence));
staleDirectObservation.synthetics.checks.external_direct_health.latest_success_at = "2026-07-13T00:00:00Z";
assert.match(evaluatePhase5Evidence(policy, staleDirectObservation, { now }).blockers.join("\n"), /External direct health evidence/);
const staleDirectAlert = JSON.parse(JSON.stringify(evidence));
staleDirectAlert.synthetics.checks.external_direct_health.alert_rehearsed_at = "2026-06-01T00:00:00Z";
assert.match(evaluatePhase5Evidence(policy, staleDirectAlert, { now }).blockers.join("\n"), /External direct health evidence/);
const unverifiedDirectRecovery = JSON.parse(JSON.stringify(evidence));
unverifiedDirectRecovery.synthetics.checks.external_direct_health.recovery_verified = false;
assert.match(evaluatePhase5Evidence(policy, unverifiedDirectRecovery, { now }).blockers.join("\n"), /External direct health evidence/);
const recoveryBeforeAlert = JSON.parse(JSON.stringify(evidence));
recoveryBeforeAlert.synthetics.checks.external_direct_health.recovered_at = "2026-07-10T12:30:00Z";
assert.match(evaluatePhase5Evidence(policy, recoveryBeforeAlert, { now }).blockers.join("\n"), /External direct health evidence/);
const successBeforeRecovery = JSON.parse(JSON.stringify(evidence));
successBeforeRecovery.synthetics.checks.external_direct_health.latest_success_at = "2026-07-10T13:15:00Z";
assert.match(evaluatePhase5Evidence(policy, successBeforeRecovery, { now }).blockers.join("\n"), /External direct health evidence/);
const reusedExternalCheck = JSON.parse(JSON.stringify(evidence));
reusedExternalCheck.synthetics.checks.external_direct_health.check_id = reusedExternalCheck.synthetics.checks.external_dead_man.check_id;
assert.match(evaluatePhase5Evidence(policy, reusedExternalCheck, { now }).blockers.join("\n"), /External direct health evidence/);
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
