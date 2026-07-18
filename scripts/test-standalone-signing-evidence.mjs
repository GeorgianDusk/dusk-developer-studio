import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { assembleStandaloneSigningEvidence } from "./assemble-standalone-signing-evidence.mjs";
import {
  createStandalonePublicationEvidenceTemplate,
  evaluateStandalonePublicationEvidence,
  evaluateStandalonePublicationReadiness,
  evaluateStandaloneSigningEvidence,
  evaluateStandaloneSigningReadiness,
  evaluateStandaloneTransportReadiness,
  expectedTargetIdentity,
  expectedWorkflowRef
} from "./standalone-signing-evidence.mjs";

const root = path.resolve(process.cwd());
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
const releaseTag = "studio-companion-v1.0.0-rc.1";
const version = "1.0.0";
const commit = "b".repeat(40);
const now = Date.parse("2026-07-18T12:00:00Z");
const sha = (value) => createHash("sha256").update(value).digest("hex");
const clone = (value) => JSON.parse(JSON.stringify(value));
const repository = policy.canonical_repository;
const workflowRef = expectedWorkflowRef(policy, releaseTag);
const runId = "123456789";
const runAttempt = "2";
const runActor = "github:GeorgianDusk";
const approvalReferenceUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/issues/42";
const targetCreatedAt = "2026-07-16T06:50:00Z";
assert.match(policy.publication_blocker, /OS-level containment of detached tool descendants or an explicitly accepted same-user tool boundary/);
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
const lifecycleMode = (mode) => ({
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
});

const unconfigured = evaluateStandaloneSigningReadiness(policy, { releaseTag });
assert.equal(unconfigured.stage, "source-build-signing-readiness");
assert.equal(unconfigured.decision, "blocked");
assert.match(unconfigured.blockers.join("\n"), /windows-x64 platform identity is not configured/);
assert.match(unconfigured.blockers.join("\n"), /darwin-arm64 platform identity is not configured/);
assert.doesNotMatch(unconfigured.blockers.join("\n"), /transport|publication is disabled/i);

const signingReadyPolicy = clone(policy);
signingReadyPolicy.targets["windows-x64"].approved_identity = "CN=Independent Studio Publisher, O=Independent Studio Publisher, C=RO";
signingReadyPolicy.targets["darwin-arm64"].approved_identity = "STUDIOTEAM1";
assert.equal(evaluateStandaloneSigningReadiness(signingReadyPolicy, { releaseTag }).decision, "ready");
assert.equal(signingReadyPolicy.publication_enabled, false);
assert.equal(signingReadyPolicy.candidate_transport.provider, "none");

const falsePortableTrustClaim = clone(signingReadyPolicy);
falsePortableTrustClaim.payload_trust.portable_directory_ed25519_publication_satisfied = true;
assert.match(evaluateStandaloneSigningReadiness(falsePortableTrustClaim, { releaseTag }).blockers.join("\n"), /payload trust contract is invalid/);
const extraPolicyField = clone(signingReadyPolicy);
extraPolicyField.unreviewed = true;
assert.match(evaluateStandaloneSigningReadiness(extraPolicyField, { releaseTag }).blockers.join("\n"), /policy fields are invalid/);

const transportBlocked = evaluateStandaloneTransportReadiness(signingReadyPolicy);
assert.equal(transportBlocked.stage, "candidate-transport-readiness");
assert.equal(transportBlocked.decision, "blocked");
assert.deepEqual(transportBlocked.blockers, [policy.candidate_transport.blocker]);
const unapprovedTransport = clone(signingReadyPolicy);
unapprovedTransport.candidate_transport = {
  enabled: true,
  provider: "age-x25519-actions",
  independent_review_accepted: true,
  review_reference: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/100"
};
assert.match(evaluateStandaloneTransportReadiness(unapprovedTransport).blockers.join("\n"), /No candidate transport provider is approved/);

const weakenedPolicy = clone(signingReadyPolicy);
weakenedPolicy.targets["windows-x64"].required_checks.pop();
assert.match(evaluateStandaloneSigningReadiness(weakenedPolicy, { releaseTag }).blockers.join("\n"), /windows-x64 required checks are invalid/);

const targets = Object.fromEntries(Object.entries(signingReadyPolicy.targets).map(([target, targetPolicy]) => {
  const signedSafeName = target === "darwin-arm64"
    ? "Dusk Developer Studio.app/Contents/MacOS/dusk-studio"
    : `launchers/dusk-developer-studio-safe-${version}-${target}-internal-rc${target === "windows-x64" ? ".exe" : ""}`;
  const signedActionsName = target === "darwin-arm64"
    ? "Dusk Developer Studio Local Actions.app/Contents/MacOS/dusk-studio-local-actions"
    : `launchers/dusk-developer-studio-local-actions-${version}-${target}-internal-rc${target === "windows-x64" ? ".exe" : ""}`;
  const candidatePackage = {
    name: `dusk-developer-studio-${version}-${target}-internal-rc.zip`,
    bytes: 5000,
    sha256: sha(`package-${target}`)
  };
  const signedLaunchers = {
    safe: { mode: "safe", name: signedSafeName, bytes: 1234, sha256: sha(`signed-safe-${target}`) },
    local_actions: { mode: "local-actions", name: signedActionsName, bytes: 1235, sha256: sha(`signed-actions-${target}`) }
  };
  const buildReceiptSha256 = sha(`receipt-${target}`);
  const unsignedAssetIndexSha256 = sha(`unsigned-index-${target}`);
  const signedLauncherIndexSha256 = sha(`signed-index-${target}`);
  const candidatePackageManifestSha256 = sha(`package-manifest-${target}`);
  const lifecycleReport = {
    schema_version: 1,
    target,
    release: { version, commit, channel: "portable" },
    candidate_package: candidatePackage,
    signed_launchers: signedLaunchers,
    build_receipt_sha256: buildReceiptSha256,
    unsigned_asset_index_sha256: unsignedAssetIndexSha256,
    signed_launcher_index_sha256: signedLauncherIndexSha256,
    candidate_package_manifest_sha256: candidatePackageManifestSha256,
    modes: { safe: lifecycleMode("safe"), local_actions: lifecycleMode("local-actions") },
    checks: lifecycleChecks
  };
  return [target, {
    schema_version: 3,
    target,
    repository,
    workflow_ref: workflowRef,
    run_id: runId,
    run_attempt: runAttempt,
    run_actor: runActor,
    created_at: targetCreatedAt,
    release_tag: releaseTag,
    version,
    commit,
    candidate_package: candidatePackage,
    signed_launchers: signedLaunchers,
    build_receipt_sha256: buildReceiptSha256,
    unsigned_asset_index_sha256: unsignedAssetIndexSha256,
    signed_launcher_index_sha256: signedLauncherIndexSha256,
    candidate_package_manifest_sha256: candidatePackageManifestSha256,
    unsigned_launchers: {
      safe: { mode: "safe", name: `dusk-developer-studio-safe-${version}-${target}-internal-rc${target === "windows-x64" ? ".exe" : ""}`, bytes: 1200, sha256: sha(`unsigned-safe-${target}`) },
      local_actions: { mode: "local-actions", name: `dusk-developer-studio-local-actions-${version}-${target}-internal-rc${target === "windows-x64" ? ".exe" : ""}`, bytes: 1201, sha256: sha(`unsigned-actions-${target}`) }
    },
    distribution_format: targetPolicy.distribution_format,
    signing_provider: targetPolicy.signing_provider,
    [targetPolicy.identity_field]: expectedTargetIdentity(signingReadyPolicy, target, releaseTag),
    ...(targetPolicy.approved_oidc_issuer ? { oidc_issuer: targetPolicy.approved_oidc_issuer } : {}),
    lifecycle_report: lifecycleReport,
    lifecycle_report_sha256: sha(Buffer.from(`${JSON.stringify(lifecycleReport, null, 2)}\n`)),
    checks: Object.fromEntries(targetPolicy.required_checks.map((check) => [check, true]))
  }];
}));

const evidence = {
  schema_version: 3,
  repository,
  workflow_ref: workflowRef,
  run_id: runId,
  run_attempt: runAttempt,
  run_actor: runActor,
  approval_reference_url: approvalReferenceUrl,
  release_tag: releaseTag,
  commit,
  created_at: "2026-07-16T07:00:00Z",
  targets
};
const assembledEvidence = assembleStandaloneSigningEvidence({
  policy: signingReadyPolicy,
  records: targets,
  runId: evidence.run_id,
  runAttempt: evidence.run_attempt,
  runActor: evidence.run_actor,
  approvalReferenceUrl: evidence.approval_reference_url,
  createdAt: evidence.created_at
});
assert.deepEqual(assembledEvidence, evidence);
assert.throws(() => assembleStandaloneSigningEvidence({ policy: signingReadyPolicy, records: targets, runId: "42", runAttempt: "0", runActor, approvalReferenceUrl }), /run attempt is invalid/);
assert.throws(() => assembleStandaloneSigningEvidence({ policy: signingReadyPolicy, records: targets, runId, runAttempt, runActor, approvalReferenceUrl, createdAt: "2026-02-31T00:00:00Z" }), /creation time is invalid/);

const signedCandidate = evaluateStandaloneSigningEvidence(signingReadyPolicy, evidence);
assert.equal(signedCandidate.stage, "signed-candidate-acceptance");
assert.equal(signedCandidate.decision, "accepted");
assert.deepEqual(signedCandidate.blockers, []);
assert.equal(signingReadyPolicy.publication_enabled, false, "Candidate acceptance must not enable publication.");

const unconfiguredEvidence = evaluateStandaloneSigningEvidence(policy, evidence);
assert.equal(unconfiguredEvidence.decision, "rejected");
assert.ok(unconfiguredEvidence.blockers.includes("windows-x64 platform identity is not configured."));
assert.ok(!unconfiguredEvidence.blockers.includes(policy.publication_blocker));
assert.ok(!unconfiguredEvidence.blockers.includes(policy.candidate_transport.blocker));

const missingNotarization = clone(evidence);
missingNotarization.targets["darwin-arm64"].checks.notarized = false;
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, missingNotarization).blockers.join("\n"), /required check failed: notarized/);
const wrongIssuer = clone(evidence);
wrongIssuer.targets["linux-x64"].oidc_issuer = "https://example.invalid";
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, wrongIssuer).blockers.join("\n"), /OIDC issuer is not approved/);
const wrongWorkflow = clone(evidence);
wrongWorkflow.workflow_ref = "https://github.com/example/unsafe/.github/workflows/release.yml@refs/heads/main";
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, wrongWorkflow).blockers.join("\n"), /workflow reference is not tag-bound/);
const missingAttempt = clone(evidence);
delete missingAttempt.run_attempt;
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, missingAttempt).blockers.join("\n"), /run attempt is invalid/);
const wrongVersion = clone(evidence);
wrongVersion.targets["linux-x64"].version = "9.9.9";
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, wrongVersion).blockers.join("\n"), /release identity is inconsistent/);
const wrongPackage = clone(evidence);
wrongPackage.targets["linux-x64"].candidate_package.name = "ambiguous.zip";
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, wrongPackage).blockers.join("\n"), /candidate package identity is invalid/);
const duplicateLauncher = clone(evidence);
duplicateLauncher.targets["linux-x64"].signed_launchers.local_actions.sha256 = duplicateLauncher.targets["linux-x64"].signed_launchers.safe.sha256;
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, duplicateLauncher).blockers.join("\n"), /identities are not distinct/);
const extraTargetField = clone(evidence);
extraTargetField.targets["linux-x64"].unreviewed = true;
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, extraTargetField).blockers.join("\n"), /target evidence fields are invalid/);
const mixedAttempt = clone(evidence);
mixedAttempt.targets["linux-x64"].run_attempt = "1";
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, mixedAttempt).blockers.join("\n"), /workflow provenance is inconsistent/);
const staleTargetRecord = clone(evidence);
staleTargetRecord.targets["linux-x64"].created_at = "2026-07-15T00:00:00Z";
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, staleTargetRecord).blockers.join("\n"), /bounded signing run window/);
const tamperedLifecycle = clone(evidence);
tamperedLifecycle.targets["linux-x64"].lifecycle_report.modes.safe.studio_loopback_services_stopped = false;
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, tamperedLifecycle).blockers.join("\n"), /retained lifecycle/);
const legacyUnscopedLifecycle = clone(evidence);
delete legacyUnscopedLifecycle.targets["linux-x64"].lifecycle_report.modes.safe.studio_loopback_services_stopped;
legacyUnscopedLifecycle.targets["linux-x64"].lifecycle_report.modes.safe.services_stopped = true;
assert.match(evaluateStandaloneSigningEvidence(signingReadyPolicy, legacyUnscopedLifecycle).blockers.join("\n"), /retained lifecycle/);

const signingEvidenceBytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`);
const signingEvidenceSha256 = sha(signingEvidenceBytes);
const publicationTemplate = createStandalonePublicationEvidenceTemplate(signingReadyPolicy, {
  signingEvidenceBytes,
  createdAt: "2026-07-16T12:00:00Z"
});
assert.equal(publicationTemplate.signing_evidence_sha256, signingEvidenceSha256);
assert.equal(publicationTemplate.gates.security_review.open_critical_findings, null);
assert.deepEqual(Object.keys(publicationTemplate.gates), signingReadyPolicy.publication_evidence_contract.required_gates);
assert.equal(evaluateStandalonePublicationEvidence(signingReadyPolicy, publicationTemplate, { signingEvidenceBytes, now }).decision, "rejected");

const malformedPublicationContract = clone(signingReadyPolicy);
malformedPublicationContract.publication_evidence_contract.unreviewed = true;
assert.throws(() => createStandalonePublicationEvidenceTemplate(malformedPublicationContract, {
  signingEvidenceBytes, createdAt: "2026-07-16T12:00:00Z"
}), /Publication evidence contract is invalid/);

const publicationEvidence = clone(publicationTemplate);
publicationEvidence.gates.security_review = {
  status: "accepted",
  reviewer_actor: "github:IndependentReviewer",
  reviewed_at: "2026-07-16T08:00:00Z",
  report_url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/101",
  report_sha256: sha("security-report"),
  scope_commit: commit,
  open_critical_findings: 0,
  open_high_findings: 0
};
publicationEvidence.gates.support_incident_route = {
  status: "accepted",
  owner_actor: "github:GeorgianDusk",
  route_url: "https://github.com/GeorgianDusk/dusk-developer-studio/security",
  tested_at: "2026-07-16T09:00:00Z",
  response_sla_hours: 24
};
publicationEvidence.gates.compatibility = {
  status: "accepted",
  matrix_url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/102",
  matrix_sha256: sha("compatibility-matrix"),
  tested_at: "2026-07-16T09:15:00Z",
  targets: ["windows-x64", "linux-x64", "darwin-arm64"]
};
publicationEvidence.gates.rollback_revocation = {
  status: "accepted",
  owner_actor: "github:GeorgianDusk",
  runbook_url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/103",
  runbook_sha256: sha("rollback-runbook"),
  tested_at: "2026-07-16T09:30:00Z",
  revocation_tested: true
};
publicationEvidence.gates.reputation_quarantine = {
  status: "accepted",
  owner_actor: "github:GeorgianDusk",
  evidence_url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/104",
  evidence_sha256: sha("reputation-evidence"),
  quarantine_plan_url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/105",
  quarantine_plan_sha256: sha("quarantine-plan"),
  reviewed_at: "2026-07-16T10:00:00Z"
};
publicationEvidence.gates.monitoring_revisit = {
  status: "accepted",
  owner_actor: "github:GeorgianDusk",
  monitoring_url: "https://github.com/GeorgianDusk/dusk-developer-studio/actions",
  revisit_at: "2026-08-15T12:00:00Z"
};
publicationEvidence.gates.explicit_approval = {
  status: "approved",
  approver_actor: "github:GeorgianDusk",
  approved_at: "2026-07-16T11:00:00Z",
  approval_reference_url: "https://github.com/GeorgianDusk/dusk-developer-studio/issues/106",
  approval_reference_sha256: sha("publication-approval"),
  release_tag: releaseTag,
  commit
};
const acceptedPublicationEvidence = evaluateStandalonePublicationEvidence(signingReadyPolicy, publicationEvidence, { signingEvidenceBytes, now });
assert.equal(acceptedPublicationEvidence.stage, "publication-evidence-acceptance");
assert.equal(acceptedPublicationEvidence.decision, "rejected");
assert.match(acceptedPublicationEvidence.blockers.join("\n"), /not authenticated by policy schema 2/);

const publicationStillBlocked = evaluateStandalonePublicationReadiness(signingReadyPolicy, { signingEvidenceBytes, publicationEvidence, now });
assert.equal(publicationStillBlocked.stage, "publication-readiness");
assert.equal(publicationStillBlocked.decision, "no-go");
assert.ok(publicationStillBlocked.blockers.includes(policy.publication_blocker));
assert.ok(publicationStillBlocked.blockers.includes(policy.candidate_transport.blocker));

const bypassAttempt = clone(signingReadyPolicy);
bypassAttempt.publication_enabled = true;
bypassAttempt.publication_blocker = "";
bypassAttempt.candidate_transport = unapprovedTransport.candidate_transport;
const bypassDecision = evaluateStandalonePublicationReadiness(bypassAttempt, { signingEvidenceBytes, publicationEvidence, now });
assert.equal(bypassDecision.decision, "no-go");
assert.match(bypassDecision.blockers.join("\n"), /No candidate transport provider is approved/);

const extraField = clone(publicationEvidence);
extraField.gates.compatibility.unreviewed_note = "must be rejected";
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, extraField, { signingEvidenceBytes, now }).blockers.join("\n"), /Compatibility gate fields are invalid/);
const wrongDigest = clone(publicationEvidence);
wrongDigest.signing_evidence_sha256 = sha("unrelated");
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, wrongDigest, { signingEvidenceBytes, now }).blockers.join("\n"), /not bound/);
const tamperedEvidenceBytes = Buffer.from(`${JSON.stringify({ ...evidence, run_attempt: "3" }, null, 2)}\n`);
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, publicationEvidence, { signingEvidenceBytes: tamperedEvidenceBytes, now }).blockers.join("\n"), /not bound/);
const incompleteCompatibility = clone(publicationEvidence);
incompleteCompatibility.gates.compatibility.targets.pop();
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, incompleteCompatibility, { signingEvidenceBytes, now }).blockers.join("\n"), /exact supported target set/);
const lateRevisit = clone(publicationEvidence);
lateRevisit.gates.monitoring_revisit.revisit_at = "2027-01-01T00:00:00Z";
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, lateRevisit, { signingEvidenceBytes, now }).blockers.join("\n"), /outside the allowed interval/);
const selfApprovedReview = clone(publicationEvidence);
selfApprovedReview.gates.explicit_approval.approver_actor = selfApprovedReview.gates.security_review.reviewer_actor;
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, selfApprovedReview, { signingEvidenceBytes, now }).blockers.join("\n"), /different authenticated actors/);
const prematureApproval = clone(publicationEvidence);
prematureApproval.gates.explicit_approval.approved_at = "2026-07-16T08:30:00Z";
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, prematureApproval, { signingEvidenceBytes, now }).blockers.join("\n"), /predates a required gate/);
const normalizedInvalidDate = clone(publicationEvidence);
normalizedInvalidDate.created_at = "2026-02-31T12:00:00Z";
assert.match(evaluateStandalonePublicationEvidence(signingReadyPolicy, normalizedInvalidDate, { signingEvidenceBytes, now }).blockers.join("\n"), /creation time is invalid/);
const staleCandidate = evaluateStandalonePublicationEvidence(signingReadyPolicy, publicationEvidence, {
  signingEvidenceBytes,
  now: Date.parse("2026-09-01T00:00:00Z")
});
assert.match(staleCandidate.blockers.join("\n"), /signed-candidate evidence is stale/);

console.log("Standalone staged signing, candidate acceptance, and publication evidence fixtures passed.");
