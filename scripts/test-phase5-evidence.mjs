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
