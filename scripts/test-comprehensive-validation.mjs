import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import {
  inspectNpmTarballBytes,
  validateComprehensiveCampaign,
  validateComprehensiveCampaignTestFixture
} from "./check-comprehensive-validation.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const policy = JSON.parse(
  await fs.readFile(path.join(productRoot, "config", "comprehensive-validation-policy.json"), "utf8")
);
const evidence = JSON.parse(
  await fs.readFile(
    path.join(productRoot, "docs", "evidence", "comprehensive-validation-evidence-2026-07-20.json"),
    "utf8"
  )
);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function writeTarString(header, offset, length, value) {
  const bytes = Buffer.from(value, "utf8");
  assert.ok(bytes.byteLength <= length);
  bytes.copy(header, offset);
}

function writeTarOctal(header, offset, length, value) {
  const encoded = value.toString(8).padStart(length - 1, "0");
  writeTarString(header, offset, length, `${encoded}\0`);
}

function tarFileEntry(name, bytes) {
  const header = Buffer.alloc(512);
  writeTarString(header, 0, 100, name);
  writeTarOctal(header, 100, 8, 0o644);
  writeTarOctal(header, 108, 8, 0);
  writeTarOctal(header, 116, 8, 0);
  writeTarOctal(header, 124, 12, bytes.byteLength);
  writeTarOctal(header, 136, 12, 0);
  header.fill(32, 148, 156);
  header[156] = "0".charCodeAt(0);
  writeTarString(header, 257, 6, "ustar");
  writeTarString(header, 263, 2, "00");
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const checksumText = `${checksum.toString(8).padStart(6, "0")}\0 `;
  Buffer.from(checksumText, "ascii").copy(header, 148);
  const padding = Buffer.alloc((512 - (bytes.byteLength % 512)) % 512);
  return Buffer.concat([header, bytes, padding]);
}

function buildTarballFixture({ corruptManifest = false, trailingNonzero = false } = {}) {
  const packageJsonBytes = Buffer.from(JSON.stringify({
    name: "dusk-developer-studio",
    version: "1.0.2",
    repository: { url: "git+https://github.com/GeorgianDusk/dusk-developer-studio.git" },
    engines: { node: ">=24.18.0 <25" }
  }), "utf8");
  const readmeBytes = Buffer.from("Fixture package bytes.\n", "utf8");
  const inventory = [
    { path: "README.md", bytes: readmeBytes.byteLength, sha256: sha256(readmeBytes) },
    { path: "package.json", bytes: packageJsonBytes.byteLength, sha256: sha256(packageJsonBytes) }
  ];
  if (corruptManifest) inventory[0].sha256 = "0".repeat(64);
  const manifestBytes = Buffer.from(JSON.stringify({
    schema_version: 1,
    package: "dusk-developer-studio",
    version: "1.0.2",
    commit: "1".repeat(40),
    channel: "npm",
    node: { required_range: ">=24.18.0 <25" },
    files: inventory
  }), "utf8");
  return gzipSync(Buffer.concat([
    tarFileEntry("package/README.md", readmeBytes),
    tarFileEntry("package/package-manifest.json", manifestBytes),
    tarFileEntry("package/package.json", packageJsonBytes),
    Buffer.alloc(1024),
    trailingNonzero ? Buffer.alloc(512, 1) : Buffer.alloc(0)
  ]), { mtime: 0 });
}

function buildReceiptBoundFinal() {
  const fixture = clone(evidence);
  const receiptDigests = new Map();
  const receiptContents = new Map();
  const policySha256 = "f".repeat(64);
  const packageSha256 = "a".repeat(64);
  const packageInventorySha256 = "c".repeat(64);
  const candidate = {
    source_commit: evidence.baseline.commit,
    package_name: evidence.baseline.package_name,
    package_version: policy.intended_final_candidate.package_version,
    package_sha256: packageSha256,
    package_inventory_sha256: packageInventorySha256,
    package_file_count: 30,
    npm_integrity: `sha512-${Buffer.alloc(64, 1).toString("base64")}`,
    production_url: evidence.baseline.production_url,
    repository_tag: policy.intended_final_candidate.repository_tag,
    deployed_at: "2026-07-21T03:05:00Z"
  };
  const receipt = (id, contents = { kind: "synthetic-validator-fixture", id }) => {
    const receipt_path = `${policy.receipt_root}/${id}.json`;
    const bytes = JSON.stringify(contents);
    const receipt_sha256 = createHash("sha256").update(bytes).digest("hex");
    receiptDigests.set(receipt_path, receipt_sha256);
    receiptContents.set(receipt_path, contents);
    return { receipt_path, receipt_sha256 };
  };
  const receiptEvidenceClass = {
    "black-box-pilot": "black-box-pilot",
    "defect-retest": "operator-receipt",
    "automated-regression": "automated-regression",
    "challenge-review": "challenge-review",
    "final-package-assurance": "package-lifecycle-smoke",
    "registry-verification": "operator-receipt",
    "production-verification": "operator-receipt"
  };
  const validationContext = {
    policy_sha256: policySha256,
    source_commit: candidate.source_commit,
    package_name: candidate.package_name,
    package_version: candidate.package_version,
    package_sha256: candidate.package_sha256,
    npm_integrity: candidate.npm_integrity,
    repository_tag: candidate.repository_tag
  };
  const boundReceipt = (kind, id, record, fields, trace_claims = [], extra = {}) => receipt(id, {
    schema_version: 1,
    kind,
    record_id: id,
    evidence_class: receiptEvidenceClass[kind],
    producer: "validator-test-fixture",
    capture_mode: "validator-test-fixture",
    test_fixture: true,
    validation_context: validationContext,
    record: Object.fromEntries(fields.map((field) => [field, record[field]])),
    ...(trace_claims.length ? { trace_claims } : {}),
    ...extra
  });
  const identity = (os) => ({
    source_commit: candidate.source_commit,
    package_version: candidate.package_version,
    npm_integrity: candidate.npm_integrity,
    production_url: candidate.production_url,
    os,
    node: "24.18.0",
    browser: "fixture-browser"
  });

  fixture.status = "final";
  fixture.completed_at = "2026-07-21T03:40:00Z";
  fixture.policy_sha256 = policySha256;
  fixture.final_candidate = candidate;
  const requiredTraceSurfaces = Object.values(policy.required_product_surfaces).flat();
  const pilotRecords = policy.pilots.map((scenario, index) => {
    const execution_id = `CV-X-FINAL-${String(index + 1).padStart(2, "0")}`;
    const allowedNotApplicable = new Set(policy.clean_state_profiles[scenario.clean_state_profile]);
    const record = {
      execution_id,
      scenario_id: scenario.id,
      evidence_class: "black-box-pilot",
      counted: true,
      status: "passed",
      started_at: "2026-07-21T02:00:00Z",
      ended_at: "2026-07-21T02:05:00Z",
      identity: identity(scenario.required_context),
      clean_state_checks: policy.clean_state_requirements.map((requirement) => ({
        requirement,
        result: allowedNotApplicable.has(requirement) ? "not-applicable" : "passed",
        observation: "Synthetic validator fixture only."
      })),
      task_observations: ["Synthetic validator fixture only; never campaign evidence."],
      surfaces_verified: [
        ...scenario.required_surfaces,
        ...policy.required_browser_claims,
        ...policy.required_viewports,
        ...requiredTraceSurfaces
      ],
      evidence_refs: [`${execution_id}:E1 synthetic validator fixture`],
      cleanup: {
        ports_closed: true,
        processes_stopped: true,
        temporary_state_disposition: "Synthetic validator fixture only."
      }
    };
    return record;
  });
  const traceClaimsBySurface = new Map();
  const traceClaimsByPilot = new Map(pilotRecords.map((record) => [record.execution_id, []]));
  const recoveryPilots = pilotRecords.filter((record) => {
    const scenario = policy.pilots.find((item) => item.id === record.scenario_id);
    return scenario.category === "failure-recovery";
  });
  const addTraceClaim = (record, surface_id, outcome, sequence) => {
    const ref = `${record.execution_id}:T${String(sequence).padStart(4, "0")} ${surface_id} ${outcome}`;
    record.evidence_refs.push(ref);
    const claim = {
      ref,
      surface_id,
      outcome,
      record_id: record.execution_id,
      evidence_class: record.evidence_class
    };
    traceClaimsByPilot.get(record.execution_id).push(claim);
    const byOutcome = traceClaimsBySurface.get(surface_id) ?? {};
    byOutcome[outcome] = ref;
    traceClaimsBySurface.set(surface_id, byOutcome);
  };
  for (const [surfaceIndex, surface] of requiredTraceSurfaces.entries()) {
    addTraceClaim(pilotRecords[surfaceIndex % pilotRecords.length], surface, "success", surfaceIndex * 3 + 1);
    addTraceClaim(recoveryPilots[surfaceIndex % recoveryPilots.length], surface, "failure-recovery", surfaceIndex * 3 + 2);
    addTraceClaim(pilotRecords[(surfaceIndex + 8) % pilotRecords.length], surface, "final-candidate", surfaceIndex * 3 + 3);
  }
  fixture.pilot_executions = pilotRecords.map((record) => ({
    ...record,
    ...boundReceipt("black-box-pilot", record.execution_id, record, [
        "execution_id",
        "scenario_id",
        "evidence_class",
        "counted",
        "status",
        "started_at",
        "ended_at",
        "identity",
        "clean_state_checks",
        "task_observations",
        "surfaces_verified",
        "evidence_refs",
        "cleanup"
      ], traceClaimsByPilot.get(record.execution_id))
  }));
  fixture.defects = policy.required_defect_ids.map((defect_id) => ({
    defect_id,
    severity: "P3",
    status: "invalidated",
    summary: "Synthetic validator fixture only.",
    qualification: "Synthetic validator fixture only.",
    invalidation_evidence: [`${fixture.pilot_executions[0].execution_id}:E1 synthetic validator fixture`]
  }));
  fixture.defects[0] = {
    ...fixture.defects[0],
    status: "verified",
    root_cause: "Synthetic validator fixture only.",
    fix: "Synthetic validator fixture only.",
    regression_test: "Synthetic validator fixture only."
  };
  delete fixture.defects[0].qualification;
  delete fixture.defects[0].invalidation_evidence;
  const retestRecord = {
    retest_id: "CV-R-FINAL-01",
    defect_id: fixture.defects[0].defect_id,
    evidence_class: "operator-receipt",
    status: "passed",
    started_at: "2026-07-21T02:10:00Z",
    ended_at: "2026-07-21T02:12:00Z",
    identity: identity("windows-x64"),
    surfaces_verified: [requiredTraceSurfaces[0]],
    evidence_refs: ["CV-R-FINAL-01:E1 synthetic validator fixture"],
    adjacent_flow_evidence_refs: ["CV-R-FINAL-01:E2 synthetic validator fixture"]
  };
  fixture.retests = [{
    ...retestRecord,
    ...boundReceipt("defect-retest", retestRecord.retest_id, retestRecord, [
      "retest_id",
      "defect_id",
      "evidence_class",
      "status",
      "started_at",
      "ended_at",
      "identity",
      "surfaces_verified",
      "evidence_refs",
      "adjacent_flow_evidence_refs"
    ])
  }];
  fixture.automation_evidence = policy.required_automation_scopes.map((scope, index) => {
    const evidence_id = `CV-E-AUTO-FINAL-${index + 1}`;
    const record = {
      evidence_id,
      evidence_class: "automated-regression",
      scope,
      status: "passed",
      observed_at: "2026-07-21T02:30:00Z",
      identity: identity("automation-runner"),
      summary: "Synthetic validator fixture only; never campaign evidence.",
      surfaces_verified: [requiredTraceSurfaces[index]],
      evidence_refs: [`${evidence_id}:E1 synthetic validator fixture`]
    };
    return {
      ...record,
      ...boundReceipt("automated-regression", evidence_id, record, [
        "evidence_id",
        "evidence_class",
        "scope",
        "status",
        "observed_at",
        "identity",
        "summary",
        "surfaces_verified",
        "evidence_refs"
      ])
    };
  });
  fixture.challenge_reviews = policy.required_final_challenge_scopes.map((scope, index) => {
    const evidence_id = `CV-E-CHALLENGE-FINAL-${index + 1}`;
    const record = {
      evidence_id,
      evidence_class: "challenge-review",
      scope,
      observed_at: "2026-07-21T03:30:00Z",
      result: "clear",
      independent_execution: true,
      identity: identity("challenge-review"),
      summary: "Synthetic validator fixture only; never campaign evidence.",
      evidence_refs: [`${evidence_id}:E1 synthetic validator fixture`]
    };
    return {
      ...record,
      ...boundReceipt("challenge-review", evidence_id, record, [
        "evidence_id",
        "evidence_class",
        "scope",
        "observed_at",
        "result",
        "independent_execution",
        "identity",
        "summary",
        "evidence_refs"
      ])
    };
  });
  const packageAssuranceRecord = {
    evidence_id: "CV-E-FINAL-PACKAGE",
    source_commit: candidate.source_commit,
    package_name: candidate.package_name,
    package_version: candidate.package_version,
    package_path: `output/npm/${candidate.package_name}-${candidate.package_version}.tgz`,
    package_sha256: candidate.package_sha256,
    package_inventory_sha256: candidate.package_inventory_sha256,
    package_file_count: candidate.package_file_count,
    npm_integrity: candidate.npm_integrity,
    observed_at: "2026-07-21T02:45:00Z",
    platforms_verified: [...policy.required_package_platforms],
    checks_verified: [...policy.required_package_checks],
    platform_results: policy.required_package_platforms.map((platform, index) => ({
      platform,
      status: "passed",
      evidence_refs: [`CV-E-FINAL-PACKAGE:P${index + 1} synthetic validator fixture`]
    })),
    check_results: policy.required_package_checks.map((check, index) => ({
      check,
      status: "passed",
      evidence_refs: [`CV-E-FINAL-PACKAGE:C${index + 1} synthetic validator fixture`]
    }))
  };
  const consumerContractSourceSha256 = "d".repeat(64);
  const nativeCiPlatformSmoke = Object.fromEntries(
    Object.entries(policy.native_ci_runner_map).map(([, runner]) => [runner, {
      schema_version: 2,
      status: "passed",
      runner,
      node_version: "24.18.0",
      local_actions_preflight_verified: true,
      local_actions_preflight_consumer_contract_source_sha256: consumerContractSourceSha256,
      candidate_commit: candidate.source_commit,
      integrity: candidate.npm_integrity,
      package_inventory_sha256: candidate.package_inventory_sha256,
      package_file_count: candidate.package_file_count
    }])
  );
  const assuranceEvidencePayload = {
    schema_version: 1,
    record: packageAssuranceRecord,
    native_ci_evidence: {
      browser_boot_and_pairing_smoke: "passed",
      local_actions_preflight_verified: true,
      consumer_contract_source_sha256: consumerContractSourceSha256,
      platform_smoke: nativeCiPlatformSmoke
    }
  };
  const assuranceEvidencePayloadJson = JSON.stringify(assuranceEvidencePayload);
  const assuranceEvidencePayloadSha256 = sha256(Buffer.from(assuranceEvidencePayloadJson, "utf8"));
  const assuranceRunId = "123456789";
  const assuranceArtifactId = "987654321";
  fixture.final_package_assurance = {
    ...packageAssuranceRecord,
    ...boundReceipt("final-package-assurance", packageAssuranceRecord.evidence_id, packageAssuranceRecord, [
      "evidence_id",
      "source_commit",
      "package_name",
      "package_version",
      "package_path",
      "package_sha256",
      "package_inventory_sha256",
      "package_file_count",
      "npm_integrity",
      "observed_at",
      "platforms_verified",
      "checks_verified",
      "platform_results",
      "check_results"
    ], [], {
      evidence_payload_json: assuranceEvidencePayloadJson,
      evidence_payload: assuranceEvidencePayload,
      evidence_payload_sha256: assuranceEvidencePayloadSha256,
      github_actions_provenance: {
        schema_version: 1,
        mode: "github-actions-upload-artifact-v7",
        repository: policy.canonical_identity.repository,
        workflow_path: policy.intended_final_candidate.assurance_workflow_path,
        run_id: assuranceRunId,
        run_attempt: 1,
        run_event: "push",
        run_ref: "refs/heads/main",
        run_commit: candidate.source_commit,
        run_url: `https://github.com/${policy.canonical_identity.repository}/actions/runs/${assuranceRunId}`,
        job_name: "aggregate-assurance",
        artifact_id: assuranceArtifactId,
        artifact_name: `studio-npm-assurance-evidence-${assuranceRunId}.json`,
        artifact_url: `https://github.com/${policy.canonical_identity.repository}/actions/runs/${assuranceRunId}/artifacts/${assuranceArtifactId}`,
        artifact_digest_sha256: assuranceEvidencePayloadSha256
      }
    })
  };
  const registryRecord = {
    evidence_id: "CV-E-FINAL-REGISTRY",
    source_commit: candidate.source_commit,
    package_name: candidate.package_name,
    package_version: candidate.package_version,
    package_sha256: candidate.package_sha256,
    npm_integrity: candidate.npm_integrity,
    repository_tag: candidate.repository_tag,
    registry_url: `https://registry.npmjs.org/${candidate.package_name}/${candidate.package_version}`,
    provenance_url: "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123456789",
    observed_at: "2026-07-21T03:10:00Z"
  };
  fixture.registry_verification = {
    ...registryRecord,
    ...boundReceipt("registry-verification", registryRecord.evidence_id, registryRecord, Object.keys(registryRecord))
  };
  const productionRecord = {
    evidence_id: "CV-E-FINAL-PRODUCTION",
    source_commit: candidate.source_commit,
    package_version: candidate.package_version,
    npm_integrity: candidate.npm_integrity,
    production_url: candidate.production_url,
    release_manifest_sha256: "b".repeat(64),
    tls_verified: true,
    health_verified: true,
    assets_verified: true,
    rollback_verified: true,
    duskds_public_node_verified: true,
    duskds_public_node_observed_at: "2026-07-21T03:14:00Z",
    observed_at: "2026-07-21T03:15:00Z"
  };
  fixture.production_verification = {
    ...productionRecord,
    ...boundReceipt("production-verification", productionRecord.evidence_id, productionRecord, Object.keys(productionRecord))
  };
  fixture.traceability = requiredTraceSurfaces.map((surface_id) => ({
    surface_id,
    status: "verified",
    success_evidence_refs: [traceClaimsBySurface.get(surface_id)["success"]],
    failure_recovery_evidence_refs: [traceClaimsBySurface.get(surface_id)["failure-recovery"]],
    final_candidate_evidence_refs: [traceClaimsBySurface.get(surface_id)["final-candidate"]]
  }));
  fixture.completion = {
    counted_pilots: 32,
    minimum_counted_pilots: 32,
    ...Object.fromEntries(policy.required_completion_fields.map((field) => [field, true]))
  };
  return {
    fixture,
    receiptDigests,
    receiptContents,
    policySha256,
    authoritativeState: {
      clean_worktree: true,
      head_commit: candidate.source_commit,
      tag_commit: candidate.source_commit,
      package_path: packageAssuranceRecord.package_path,
      package_sha256: candidate.package_sha256,
      npm_integrity: candidate.npm_integrity,
      tarball: {
        package_name: candidate.package_name,
        package_version: candidate.package_version,
        package_node_engine: policy.canonical_identity.node_engine,
        package_repository: `git+https://github.com/${policy.canonical_identity.repository}.git`,
        manifest_package: candidate.package_name,
        manifest_version: candidate.package_version,
        manifest_commit: candidate.source_commit,
        manifest_channel: "npm",
        manifest_node_engine: policy.canonical_identity.node_engine,
        inventory_sha256: candidate.package_inventory_sha256,
        inventory_file_count: candidate.package_file_count,
        inventory_total_bytes: 123456,
        inventory_verified: true
      }
    }
  };
}

assert.deepEqual(validateComprehensiveCampaign(policy, evidence), []);

const duplicatePolicy = clone(policy);
duplicatePolicy.pilots[1].id = duplicatePolicy.pilots[0].id;
assert.match(
  validateComprehensiveCampaign(duplicatePolicy, evidence).join("\n"),
  /Duplicate pilot ids/u
);

const humanLikeMetric = clone(evidence);
humanLikeMetric.pilot_executions.push({
  confidence: 5
});
assert.match(
  validateComprehensiveCampaign(policy, humanLikeMetric).join("\n"),
  /confidence, confusion, or trust fields are forbidden/u
);

const misclassified = clone(evidence);
misclassified.automation_evidence[0].evidence_class = "black-box-pilot";
assert.match(
  validateComprehensiveCampaign(policy, misclassified).join("\n"),
  /cannot count as a black-box pilot/u
);

const incompleteCleanState = clone(evidence);
incompleteCleanState.pilot_executions[0].clean_state_checks.pop();
assert.match(
  validateComprehensiveCampaign(policy, incompleteCleanState).join("\n"),
  /each policy requirement exactly once/u
);

const incompletePassingSurface = clone(evidence);
const passingExecution = incompletePassingSurface.pilot_executions.find(
  (execution) => execution.status === "passed"
);
const assignedScenario = policy.pilots.find((pilot) => pilot.id === passingExecution.scenario_id);
passingExecution.surfaces_verified = passingExecution.surfaces_verified.filter(
  (surface) => surface !== assignedScenario.required_surfaces[0]
);
assert.match(
  validateComprehensiveCampaign(policy, incompletePassingSurface).join("\n"),
  /is missing required pilot surfaces/u
);

const incompleteFinal = validateComprehensiveCampaign(policy, evidence, { final: true }).join("\n");
assert.match(incompleteFinal, /requires at least 32 counted passing pilots/u);
assert.match(incompleteFinal, /evidence\.final_candidate must be an object/u);
assert.match(incompleteFinal, /product-ui-developer-experience/u);
assert.match(incompleteFinal, /security-release-evidence-integrity/u);

const malformedRetest = clone(evidence);
malformedRetest.retests.push({ retest_id: "bad" });
assert.match(
  validateComprehensiveCampaign(policy, malformedRetest).join("\n"),
  /retest_id is invalid/u
);

const mismatchedFinalIdentity = clone(evidence);
mismatchedFinalIdentity.final_candidate = {
  source_commit: evidence.baseline.commit,
  package_name: evidence.baseline.package_name,
  package_version: evidence.baseline.package_version,
  package_sha256: "a".repeat(64),
  npm_integrity: evidence.baseline.npm_integrity,
  production_url: evidence.baseline.production_url,
  repository_tag: `v${evidence.baseline.package_version}`,
  deployed_at: "2026-07-20T21:30:00Z"
};
const firstPassingExecution = mismatchedFinalIdentity.pilot_executions.find(
  (execution) => execution.status === "passed"
);
firstPassingExecution.identity.source_commit = "b".repeat(40);
assert.match(
  validateComprehensiveCampaign(policy, mismatchedFinalIdentity, { final: true }).join("\n"),
  /is not bound to the exact final candidate identity/u
);

const missingDefectRetest = clone(mismatchedFinalIdentity);
missingDefectRetest.defects[0].status = "verified";
assert.match(
  validateComprehensiveCampaign(policy, missingDefectRetest, { final: true }).join("\n"),
  /must have a passing exact-candidate retest/u
);

const validFinal = buildReceiptBoundFinal();
const fixtureNow = "2026-07-21T04:00:00Z";
const validateFinalFixture = (fixture, options = {}) => validateComprehensiveCampaignTestFixture(
  policy,
  fixture,
  { now: fixtureNow, ...options }
);
assert.deepEqual(validateFinalFixture(validFinal.fixture, {
  final: true,
  receiptDigests: validFinal.receiptDigests,
  receiptContents: validFinal.receiptContents,
  policySha256: validFinal.policySha256,
  authoritativeState: validFinal.authoritativeState
}), []);

const productionFixtureBoundary = validateComprehensiveCampaign(policy, validFinal.fixture, {
  final: true,
  receiptDigests: validFinal.receiptDigests,
  receiptContents: validFinal.receiptContents,
  policySha256: validFinal.policySha256,
  authoritativeState: validFinal.authoritativeState,
  now: fixtureNow,
  allowTestFixtures: true
}).join("\n");
assert.match(productionFixtureBoundary, /validator-test-fixture receipt provenance.*forbidden/u);

const missingFinalAutomation = clone(validFinal.fixture);
missingFinalAutomation.automation_evidence = [];
assert.match(
  validateFinalFixture(missingFinalAutomation, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /requires passing exact-candidate automation/u
);

assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: { ...validFinal.authoritativeState, head_commit: "b".repeat(40) }
  }).join("\n"),
  /computed tarball bytes, package\.json, package manifest, and exact inventory/u
);

const missingPackagePlatformReceipt = new Map(validFinal.receiptContents);
const packageReceiptPath = validFinal.fixture.final_package_assurance.receipt_path;
const packageReceiptWithoutResults = clone(missingPackagePlatformReceipt.get(packageReceiptPath));
delete packageReceiptWithoutResults.record.platform_results;
missingPackagePlatformReceipt.set(packageReceiptPath, packageReceiptWithoutResults);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: missingPackagePlatformReceipt,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /exact final-package-assurance record/u
);

const missingProductionProof = clone(validFinal.fixture);
delete missingProductionProof.production_verification;
assert.match(
  validateFinalFixture(missingProductionProof, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /evidence\.production_verification must be an object/u
);

const wrongOutcomeCount = clone(validFinal.fixture);
wrongOutcomeCount.pilot_executions[0].status = "failed";
assert.match(
  validateFinalFixture(wrongOutcomeCount, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /counted must be true only for a passing black-box pilot/u
);

const wrongContext = clone(validFinal.fixture);
wrongContext.pilot_executions[0].identity.os = "plausible-but-wrong-context";
assert.match(
  validateFinalFixture(wrongContext, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /must exactly match scenario required_context/u
);

const unapprovedNotApplicable = clone(validFinal.fixture);
const localExecution = unapprovedNotApplicable.pilot_executions.find((execution) => {
  const scenario = policy.pilots.find((pilot) => pilot.id === execution.scenario_id);
  return scenario.clean_state_profile === "local-runtime";
});
localExecution.clean_state_checks[0].result = "not-applicable";
assert.match(
  validateFinalFixture(unapprovedNotApplicable, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /unapproved not-applicable clean-state results/u
);

const unanchoredReference = clone(validFinal.fixture);
unanchoredReference.pilot_executions[0].evidence_refs = ["convincing but unattached receipt claim"];
assert.match(
  validateFinalFixture(unanchoredReference, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /anchored to its execution_id/u
);

const deletedDefect = clone(validFinal.fixture);
deletedDefect.defects.pop();
assert.match(
  validateFinalFixture(deletedDefect, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /must exactly match policy\.required_defect_ids/u
);

const missingCompletionFlag = clone(validFinal.fixture);
delete missingCompletionFlag.completion[policy.required_completion_fields[0]];
assert.match(
  validateFinalFixture(missingCompletionFlag, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /Final completion flag .* is required/u
);

const unboundChallenge = clone(validFinal.fixture);
delete unboundChallenge.challenge_reviews[0].independent_execution;
assert.match(
  validateFinalFixture(unboundChallenge, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /independent_execution/u
);

const changedReceiptBytes = new Map(validFinal.receiptDigests);
changedReceiptBytes.set(validFinal.fixture.pilot_executions[0].receipt_path, "0".repeat(64));
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: changedReceiptBytes,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /receipt bytes are missing or do not match/u
);

const changedPilotRecord = clone(validFinal.fixture);
changedPilotRecord.pilot_executions[0].task_observations = ["A polished claim added after receipt capture."];
assert.match(
  validateFinalFixture(changedPilotRecord, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /receipt contents must bind the exact black-box-pilot record/u
);

const changedRetestRecord = clone(validFinal.fixture);
changedRetestRecord.retests[0].adjacent_flow_evidence_refs = ["CV-R-FINAL-01:E9 invented later"];
assert.match(
  validateFinalFixture(changedRetestRecord, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /receipt contents must bind the exact defect-retest record/u
);

const duplicateReceiptPath = clone(validFinal.fixture);
duplicateReceiptPath.pilot_executions[1].receipt_path = duplicateReceiptPath.pilot_executions[0].receipt_path;
duplicateReceiptPath.pilot_executions[1].receipt_sha256 = duplicateReceiptPath.pilot_executions[0].receipt_sha256;
assert.match(
  validateFinalFixture(duplicateReceiptPath, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /Final receipt paths must be unique per bound record/u
);

const nonFinalTraceabilityReference = clone(validFinal.fixture);
const nonFinalRef = "CV-E-AUTO-UNBOUND:E1 plausible automated claim";
nonFinalTraceabilityReference.automation_evidence = [{
  evidence_id: "CV-E-AUTO-UNBOUND",
  evidence_class: "automated-regression",
  evidence_refs: [nonFinalRef]
}];
nonFinalTraceabilityReference.traceability[0].final_candidate_evidence_refs = [nonFinalRef];
assert.match(
  validateFinalFixture(nonFinalTraceabilityReference, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /final-candidate references without a matching exact-candidate receipt claim/u
);

const reusedTraceabilityReference = clone(validFinal.fixture);
const reusedRef = reusedTraceabilityReference.traceability[0].success_evidence_refs[0];
for (const record of reusedTraceabilityReference.traceability) {
  record.success_evidence_refs = [reusedRef];
  record.failure_recovery_evidence_refs = [reusedRef];
  record.final_candidate_evidence_refs = [reusedRef];
}
assert.match(
  validateFinalFixture(reusedTraceabilityReference, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /without a matching receipt claim/u
);

const duplicateTraceClaimRefContents = new Map(validFinal.receiptContents);
const traceReceiptPath = validFinal.fixture.pilot_executions
  .map((record) => record.receipt_path)
  .find((receiptPath) => duplicateTraceClaimRefContents.get(receiptPath)?.trace_claims?.length > 1);
const duplicatedTraceReceipt = clone(duplicateTraceClaimRefContents.get(traceReceiptPath));
duplicatedTraceReceipt.trace_claims[1].ref = duplicatedTraceReceipt.trace_claims[0].ref;
duplicateTraceClaimRefContents.set(traceReceiptPath, duplicatedTraceReceipt);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: duplicateTraceClaimRefContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /Each trace evidence reference may prove only one surface\/outcome claim/u
);

const unboundPackageReceiptContents = new Map(validFinal.receiptContents);
unboundPackageReceiptContents.set(validFinal.fixture.final_package_assurance.receipt_path, {
  ...unboundPackageReceiptContents.get(validFinal.fixture.final_package_assurance.receipt_path),
  record: {
    ...unboundPackageReceiptContents.get(validFinal.fixture.final_package_assurance.receipt_path).record,
    package_sha256: "b".repeat(64)
  }
});
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: unboundPackageReceiptContents,
    policySha256: validFinal.policySha256
  }).join("\n"),
  /receipt contents must bind the exact final-package-assurance record/u
);

const missingGitHubProvenance = new Map(validFinal.receiptContents);
const assuranceReceiptPath = validFinal.fixture.final_package_assurance.receipt_path;
const receiptWithoutGitHubProvenance = clone(missingGitHubProvenance.get(assuranceReceiptPath));
delete receiptWithoutGitHubProvenance.github_actions_provenance;
missingGitHubProvenance.set(assuranceReceiptPath, receiptWithoutGitHubProvenance);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: missingGitHubProvenance,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /directly consumable GitHub Actions artifact provenance envelope/u
);

const localSelfAttestedAssurance = new Map(validFinal.receiptContents);
const localSelfAttestedReceipt = clone(localSelfAttestedAssurance.get(assuranceReceiptPath));
localSelfAttestedReceipt.github_actions_provenance.mode = "local-self-attested";
localSelfAttestedAssurance.set(assuranceReceiptPath, localSelfAttestedReceipt);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: localSelfAttestedAssurance,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /directly consumable GitHub Actions artifact provenance envelope/u
);

const wrongGitHubArtifactBinding = new Map(validFinal.receiptContents);
const wrongGitHubArtifactReceipt = clone(wrongGitHubArtifactBinding.get(assuranceReceiptPath));
wrongGitHubArtifactReceipt.github_actions_provenance.run_commit = "2".repeat(40);
wrongGitHubArtifactReceipt.github_actions_provenance.artifact_digest_sha256 = "invalid";
wrongGitHubArtifactBinding.set(assuranceReceiptPath, wrongGitHubArtifactReceipt);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: wrongGitHubArtifactBinding,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /directly consumable GitHub Actions artifact provenance envelope/u
);

const divergentGitHubArtifactDigest = new Map(validFinal.receiptContents);
const divergentGitHubArtifactReceipt = clone(divergentGitHubArtifactDigest.get(assuranceReceiptPath));
divergentGitHubArtifactReceipt.github_actions_provenance.artifact_digest_sha256 = "e".repeat(64);
divergentGitHubArtifactDigest.set(assuranceReceiptPath, divergentGitHubArtifactReceipt);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: divergentGitHubArtifactDigest,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /directly consumable GitHub Actions artifact provenance envelope/u
);

const plausibleForgery = clone(validFinal.fixture);
plausibleForgery.pilot_executions.forEach((execution) => {
  execution.clean_state_checks.forEach((check) => { check.result = "not-applicable"; });
  execution.evidence_refs = ["polished narrative with no execution anchor"];
});
plausibleForgery.defects = [];
delete plausibleForgery.completion[policy.required_completion_fields[0]];
const forgeryErrors = validateFinalFixture(plausibleForgery, {
  final: true,
  receiptDigests: new Map(),
  receiptContents: new Map(),
  policySha256: validFinal.policySha256
}).join("\n");
assert.match(forgeryErrors, /unapproved not-applicable clean-state results/u);
assert.match(forgeryErrors, /anchored to its execution_id/u);
assert.match(forgeryErrors, /receipt bytes are missing or do not match/u);
assert.match(forgeryErrors, /must exactly match policy\.required_defect_ids/u);
assert.match(forgeryErrors, /Final completion flag .* is required/u);

const challengeImpersonationContents = new Map(validFinal.receiptContents);
const challengeRecord = validFinal.fixture.challenge_reviews[0];
challengeImpersonationContents.set(challengeRecord.receipt_path, {
  ...clone(challengeImpersonationContents.get(challengeRecord.receipt_path)),
  trace_claims: [{
    ref: challengeRecord.evidence_refs[0],
    surface_id: requiredSurfaceForTest(),
    outcome: "success",
    record_id: challengeRecord.evidence_id,
    evidence_class: "challenge-review"
  }]
});
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: challengeImpersonationContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /Challenge receipt .* must not contain product success/u
);

const wrongClaimClassContents = new Map(validFinal.receiptContents);
const claimedPilotPath = validFinal.fixture.pilot_executions
  .map((record) => record.receipt_path)
  .find((receiptPath) => wrongClaimClassContents.get(receiptPath)?.trace_claims?.length);
const wrongClaimClassReceipt = clone(wrongClaimClassContents.get(claimedPilotPath));
wrongClaimClassReceipt.trace_claims[0].evidence_class = "challenge-review";
wrongClaimClassContents.set(claimedPilotPath, wrongClaimClassReceipt);
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: wrongClaimClassContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /compatible evidence class, verified surface, and typed outcome/u
);

const absentSurfaceFixture = clone(validFinal.fixture);
const absentSurfaceContents = new Map(validFinal.receiptContents);
const absentSurfacePilot = absentSurfaceFixture.pilot_executions.find((record) =>
  absentSurfaceContents.get(record.receipt_path)?.trace_claims?.some((claim) => claim.surface_id.startsWith("security:"))
);
const absentSurfaceReceipt = clone(absentSurfaceContents.get(absentSurfacePilot.receipt_path));
const absentSurfaceClaim = absentSurfaceReceipt.trace_claims.find((claim) => claim.surface_id.startsWith("security:"));
absentSurfacePilot.surfaces_verified = absentSurfacePilot.surfaces_verified.filter(
  (surface) => surface !== absentSurfaceClaim.surface_id
);
absentSurfaceReceipt.record.surfaces_verified = [...absentSurfacePilot.surfaces_verified];
absentSurfaceContents.set(absentSurfacePilot.receipt_path, absentSurfaceReceipt);
assert.match(
  validateFinalFixture(absentSurfaceFixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: absentSurfaceContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /compatible evidence class, verified surface, and typed outcome/u
);

const unintendedCandidate = clone(validFinal.fixture);
unintendedCandidate.final_candidate.package_version = "1.0.3";
unintendedCandidate.final_candidate.repository_tag = "v1.0.3";
assert.match(
  validateFinalFixture(unintendedCandidate, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /inconsistent with the intended release contract/u
);

assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: {
      ...validFinal.authoritativeState,
      tarball: { ...validFinal.authoritativeState.tarball, manifest_version: "9.9.9" }
    }
  }).join("\n"),
  /package\.json, package manifest, and exact inventory/u
);

const reverseChronology = clone(validFinal.fixture);
reverseChronology.pilot_executions[0].ended_at = "2026-07-21T01:59:59Z";
assert.match(
  validateFinalFixture(reverseChronology, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /ended_at must be at or after started_at/u
);

const futureEvidence = clone(validFinal.fixture);
futureEvidence.automation_evidence[0].observed_at = "2026-07-21T05:00:00Z";
assert.match(
  validateFinalFixture(futureEvidence, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /must not be in the future/u
);

const staleEvidence = clone(validFinal.fixture);
staleEvidence.pilot_executions[0].started_at = "2026-07-10T02:00:00Z";
staleEvidence.pilot_executions[0].ended_at = "2026-07-10T02:05:00Z";
assert.match(
  validateFinalFixture(staleEvidence, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /pilot_executions\[0\]\.ended_at exceeds the 168-hour/u
);

const stalePolicyContext = new Map(validFinal.receiptContents);
const policyBoundReceiptPath = validFinal.fixture.pilot_executions[0].receipt_path;
stalePolicyContext.set(policyBoundReceiptPath, {
  ...clone(stalePolicyContext.get(policyBoundReceiptPath)),
  validation_context: {
    ...stalePolicyContext.get(policyBoundReceiptPath).validation_context,
    policy_sha256: "0".repeat(64)
  }
});
assert.match(
  validateFinalFixture(validFinal.fixture, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: stalePolicyContext,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /receipt contents must bind the exact black-box-pilot record/u
);

const missingNodeProof = clone(validFinal.fixture);
missingNodeProof.production_verification.duskds_public_node_verified = false;
assert.match(
  validateFinalFixture(missingNodeProof, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /must prove TLS, health, assets, rollback, DuskDS public-node behavior/u
);

const staleNodeProof = clone(validFinal.fixture);
staleNodeProof.production_verification.duskds_public_node_observed_at = "2026-07-20T12:00:00Z";
assert.match(
  validateFinalFixture(staleNodeProof, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /duskds_public_node_observed_at exceeds the 15-hour/u
);

const postChallengeFailure = clone(validFinal.fixture);
const lateFailure = clone(postChallengeFailure.pilot_executions[0]);
lateFailure.execution_id = "CV-X-LATE-EXACT-CANDIDATE-FAILURE";
lateFailure.counted = false;
lateFailure.status = "failed";
lateFailure.started_at = "2026-07-21T03:31:00Z";
lateFailure.ended_at = "2026-07-21T03:35:00Z";
lateFailure.evidence_refs = [`${lateFailure.execution_id}:E1 post-challenge exact-candidate failure`];
delete lateFailure.receipt_path;
delete lateFailure.receipt_sha256;
postChallengeFailure.pilot_executions.push(lateFailure);
assert.match(
  validateFinalFixture(postChallengeFailure, {
    final: true,
    receiptDigests: validFinal.receiptDigests,
    receiptContents: validFinal.receiptContents,
    policySha256: validFinal.policySha256,
    authoritativeState: validFinal.authoritativeState
  }).join("\n"),
  /must be rerun after all final-candidate pilot, retest, automation, package, registry, and production evidence/u
);

const tarballInspection = inspectNpmTarballBytes(buildTarballFixture());
assert.equal(tarballInspection.package_name, "dusk-developer-studio");
assert.equal(tarballInspection.package_version, "1.0.2");
assert.equal(tarballInspection.manifest_commit, "1".repeat(40));
assert.equal(tarballInspection.inventory_file_count, 2);
assert.equal(tarballInspection.inventory_verified, true);
assert.throws(
  () => inspectNpmTarballBytes(buildTarballFixture({ corruptManifest: true })),
  /exact file inventory does not match/u
);
assert.throws(
  () => inspectNpmTarballBytes(buildTarballFixture({ trailingNonzero: true })),
  /nonzero data after its end marker/u
);

process.stdout.write("Comprehensive validation policy and evidence fixtures passed.\n");

function requiredSurfaceForTest() {
  return Object.values(policy.required_product_surfaces).flat()[0];
}
