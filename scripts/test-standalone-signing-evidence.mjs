import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateStandaloneSigningEvidence,
  evaluateStandaloneSigningReadiness,
  expectedTargetIdentity,
  expectedWorkflowRef
} from "./standalone-signing-evidence.mjs";

const root = path.resolve(process.cwd());
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
const releaseTag = "studio-companion-v1.0.0-rc.1";
const digest = "a".repeat(64);
const commit = "b".repeat(40);
const clone = (value) => JSON.parse(JSON.stringify(value));

const unconfigured = evaluateStandaloneSigningReadiness(policy, { releaseTag });
assert.equal(unconfigured.decision, "blocked");
assert.match(unconfigured.blockers.join("\n"), /windows-x64 platform identity is not configured/);
assert.match(unconfigured.blockers.join("\n"), /darwin-arm64 platform identity is not configured/);

const readyPolicy = clone(policy);
readyPolicy.publication_enabled = true;
readyPolicy.publication_blocker = "";
readyPolicy.targets["windows-x64"].approved_identity = "CN=Dusk Network B.V., O=Dusk Network B.V., C=NL";
readyPolicy.targets["darwin-arm64"].approved_identity = "DUSKTEAM01";
assert.equal(evaluateStandaloneSigningReadiness(readyPolicy, { releaseTag }).decision, "ready");
const weakenedPolicy = clone(readyPolicy);
weakenedPolicy.targets["windows-x64"].required_checks.pop();
assert.match(evaluateStandaloneSigningReadiness(weakenedPolicy, { releaseTag }).blockers.join("\n"), /windows-x64 required checks are invalid/);

const targets = Object.fromEntries(Object.entries(readyPolicy.targets).map(([target, targetPolicy]) => [target, {
  schema_version: 1,
  target,
  release_tag: releaseTag,
  commit,
  artifact_name: target === "windows-x64" ? "dusk-studio.exe" : target === "darwin-arm64" ? "dusk-studio-macos.zip" : "dusk-studio",
  artifact_bytes: 1234,
  artifact_sha256: digest,
  build_receipt_sha256: digest,
  unsigned_artifact_sha256: digest,
  distribution_format: targetPolicy.distribution_format,
  signing_provider: targetPolicy.signing_provider,
  [targetPolicy.identity_field]: expectedTargetIdentity(readyPolicy, target, releaseTag),
  ...(targetPolicy.approved_oidc_issuer ? { oidc_issuer: targetPolicy.approved_oidc_issuer } : {}),
  checks: Object.fromEntries(targetPolicy.required_checks.map((check) => [check, true]))
}]));

const evidence = {
  schema_version: 2,
  repository: readyPolicy.canonical_repository,
  workflow_ref: expectedWorkflowRef(readyPolicy, releaseTag),
  run_id: "123456789",
  release_tag: releaseTag,
  commit,
  created_at: "2026-07-16T00:00:00Z",
  targets
};

assert.equal(evaluateStandaloneSigningEvidence(policy, evidence).decision, "no-go");
assert.match(evaluateStandaloneSigningEvidence(policy, evidence).blockers.join("\n"), /publication is disabled|not approved or configured/);
assert.equal(evaluateStandaloneSigningEvidence(readyPolicy, evidence).decision, "go");

const missingNotarization = clone(evidence);
missingNotarization.targets["darwin-arm64"].checks.notarized = false;
assert.match(evaluateStandaloneSigningEvidence(readyPolicy, missingNotarization).blockers.join("\n"), /darwin-arm64 required check failed: notarized/);

const wrongIssuer = clone(evidence);
wrongIssuer.targets["linux-x64"].oidc_issuer = "https://example.invalid";
assert.match(evaluateStandaloneSigningEvidence(readyPolicy, wrongIssuer).blockers.join("\n"), /OIDC issuer is not approved/);

const wrongWorkflow = clone(evidence);
wrongWorkflow.workflow_ref = "https://github.com/example/unsafe/.github/workflows/release.yml@refs/heads/main";
assert.match(evaluateStandaloneSigningEvidence(readyPolicy, wrongWorkflow).blockers.join("\n"), /workflow reference is not tag-bound/);

const wrongTag = clone(evidence);
wrongTag.release_tag = "v1.0.0";
assert.match(evaluateStandaloneSigningEvidence(readyPolicy, wrongTag).blockers.join("\n"), /Release tag does not match/);

const wrongPublisher = clone(evidence);
wrongPublisher.targets["windows-x64"].publisher_subject = "CN=Someone Else";
assert.match(evaluateStandaloneSigningEvidence(readyPolicy, wrongPublisher).blockers.join("\n"), /platform identity is not approved/);

console.log("Standalone platform-signing readiness and publication-gate fixtures passed.");
