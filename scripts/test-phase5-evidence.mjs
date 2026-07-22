import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { URL } from "node:url";
import {
  buildCanonicalAgentPilotPlan,
  canonicalJson,
  canonicalSha256,
  validatePilotPlan
} from "./agent-pilot-collector.mjs";
import { verifyCandidateBoundPhase5Context } from "./phase5-candidate-context.mjs";
import {
  evaluatePhase5Evidence as evaluatePhase5EvidenceRaw,
  evaluatePhase5EvidenceOnline as evaluatePhase5EvidenceOnlineRaw
} from "./phase5-evidence.mjs";

const root = path.resolve(process.cwd());
const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "phase5-policy.json"), "utf8"));
const now = new Date("2026-07-15T12:00:00Z");
policy.monitoring_evidence.accepted_risk.accepted_at = "2026-07-15T00:30:00Z";
policy.npm_distribution.expected_npm_maintainer = "phase5-test-maintainer";
assert.equal(policy.npm_distribution.package_version, "1.0.10");
assert.equal(policy.npm_distribution.tag, "v1.0.10");
assert.equal(policy.npm_distribution.publication_workflow, ".github/workflows/studio-npm-oidc-publish.yml");
assert.equal(policy.npm_distribution.publication_environment, "npm-trusted-publication");
assert.equal(policy.npm_distribution.initial_package_version, "1.0.0");
assert.equal(policy.npm_distribution.initial_tag, "v1.0.0");
assert.equal(policy.npm_distribution.expected_initial_provenance_workflow, ".github/workflows/studio-npm-publish.yml");
const digest = "a".repeat(64);
const restoredDigest = "c".repeat(64);
const candidateCommit = "b".repeat(40);
const policyShaFor = (testPolicy) => createHash("sha256").update(JSON.stringify(testPolicy), "utf8").digest("hex");
const evaluationOptions = (testPolicy, options = {}) => ({
  policySha256: policyShaFor(testPolicy),
  evaluatorCommit: candidateCommit,
  ...options
});
const evaluatePhase5Evidence = (testPolicy, testEvidence, options = {}) =>
  evaluatePhase5EvidenceRaw(testPolicy, testEvidence, evaluationOptions(testPolicy, options));
const evaluatePhase5EvidenceOnline = (testPolicy, testEvidence, options = {}) =>
  evaluatePhase5EvidenceOnlineRaw(testPolicy, testEvidence, evaluationOptions(testPolicy, options));
const publicAssuranceRunUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123456";
const nativeSmokeRunUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123450";
const heartbeatRunUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123457";
const alertRunUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123458";
const npmAssuranceRunUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123459";
const npmPublicationRunUrl = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/123460";
const npmIntegrity = `sha512-${Buffer.alloc(64, 0x42).toString("base64")}`;
const npmIntegrityHex = Buffer.alloc(64, 0x42).toString("hex");
const npmPackageBytes = Buffer.from("phase5-exact-npm-candidate", "utf8");
const npmPackageSha256 = createHash("sha256").update(npmPackageBytes).digest("hex");
const npmInventoryDigest = "e".repeat(64);
const npmPackageFileCount = 29;
const preflightCheckId = "local-actions-preflight";
const consumerContractSha256 = "7".repeat(64);
const emptySha256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const environmentIdentity = (environment) => `env-${canonicalSha256({
  context: environment.context,
  platform: environment.platform,
  os_version: environment.os_version,
  os_release: environment.os_release,
  arch: environment.arch,
  node_version: environment.node_version,
  privilege: environment.privilege
}).slice(0, 24)}`;
const boundReceipt = (receipt) => {
  const receipt_json = `${JSON.stringify(receipt, null, 2)}\n`;
  return {
    receipt_json,
    receipt_sha256: createHash("sha256").update(receipt_json, "utf8").digest("hex")
  };
};
const rewriteReceipt = (record, mutate) => {
  const receipt = JSON.parse(record.receipt_json);
  mutate(receipt);
  Object.assign(record, boundReceipt(receipt));
  if (record.provenance) {
    record.provenance.receipt_sha256 = record.receipt_sha256;
    record.provenance.artifact_digest_sha256 = record.receipt_sha256;
    record.provenance.artifact_sha256 = record.receipt_sha256;
  }
};
const rewriteCurrentAssuranceReceipt = (record, mutate) => {
  rewriteReceipt(record, (receipt) => {
    mutate(receipt);
    receipt.evidence_payload_json = JSON.stringify(receipt.evidence_payload);
    receipt.evidence_payload_sha256 = createHash("sha256")
      .update(receipt.evidence_payload_json, "utf8")
      .digest("hex");
    receipt.github_actions_provenance.artifact_digest_sha256 =
      receipt.evidence_payload_sha256;
  });
};
const rewriteMachineReceipt = (record, mutate) => {
  const receipt = JSON.parse(record.receipt_json);
  mutate(receipt);
  record.receipt_json = canonicalJson(receipt);
  record.receipt_sha256 = createHash("sha256")
    .update(record.receipt_json, "utf8")
    .digest("hex");
  record.recovery_evidence_reference =
    `agent-pilots/${receipt.scenario.id}/${receipt.execution.raw_observation_bundle_sha256}.recovery.json`;
  record.session_record_reference =
    `agent-pilots/${receipt.scenario.id}/${record.receipt_sha256}.json`;
  if (record.provenance) {
    record.provenance.receipt_sha256 = record.receipt_sha256;
    record.provenance.artifact_digest_sha256 = record.receipt_sha256;
    record.provenance.artifact_sha256 = record.receipt_sha256;
  }
};
const rewritePilotMachineReceipt = (record, mutate, options = {}) => {
  rewriteMachineReceipt(record, (receipt) => {
    mutate(receipt);
    if (options.rehashPlan !== false) receipt.plan_sha256 = canonicalSha256(receipt.plan);
    if (options.rehashObservations !== false) {
      receipt.execution.raw_observation_bundle_sha256 = canonicalSha256(receipt.execution.observations);
    }
    if (options.rehashEnvironment !== false) {
      receipt.environment.environment_identity = environmentIdentity(receipt.environment);
    }
  });
};
const provenanceFor = ({
  workflowPath,
  runUrl,
  runEvent,
  artifactId,
  artifactName,
  receiptPath,
  receiptSha256,
  downloadedAt,
  runCommit = candidateCommit
}) => {
  const runId = Number(new URL(runUrl).pathname.split("/").at(-1));
  return {
    schema_version: 1,
    repository: "GeorgianDusk/dusk-developer-studio",
    workflow_path: workflowPath,
    run_id: runId,
    run_url: runUrl,
    run_attempt: 1,
    run_event: runEvent,
    run_commit: runCommit,
    run_conclusion: "success",
    artifact_id: artifactId,
    artifact_name: artifactName,
    artifact_api_url: `https://api.github.com/repos/GeorgianDusk/dusk-developer-studio/actions/artifacts/${artifactId}`,
    artifact_digest_sha256: receiptSha256,
    artifact_sha256: receiptSha256,
    artifact_expired: false,
    receipt_path: receiptPath,
    receipt_sha256: receiptSha256,
    downloaded_at: downloadedAt
  };
};
const owners = Object.fromEntries(policy.required_owners.map((owner) => [owner, policy.responsibility_model.human_owner]));
const reviews = Object.fromEntries(policy.required_reviews.map((review) => [review, {
  status: "accepted",
  reviewer_identity: `codex-${review}-challenge-task`,
  reviewer_type: policy.responsibility_model.reviewer_type,
  separate_agent: true,
  external_independent: false,
  reviewed_at: "2026-07-15T01:00:00Z",
  evidence_reference: `review-${review}`,
  candidate_commit: candidateCommit,
  candidate_artifact_fingerprint_sha256: digest
}]));
const sessions = policy.pilot.required_scenarios.map((scenario, index) => {
  const id = `p${index + 1}`;
  const startedAt = "2026-07-15T01:10:00.000Z";
  const completedAt = "2026-07-15T01:30:00.000Z";
  const invocationId = createHash("sha256").update(`invocation-${id}`).digest("hex").slice(0, 32);
  const receiptCandidate = {
    tarball_sha256: "9".repeat(64),
    tarball_bytes: 297_456,
    npm_integrity: npmIntegrity,
    package_inventory_sha256: npmInventoryDigest,
    package_file_count: 37,
    package_name: policy.npm_distribution.package_name,
    package_version: policy.npm_distribution.package_version,
    package_commit: candidateCommit,
    phase5_artifact_fingerprint_sha256: digest
  };
  const plan = buildCanonicalAgentPilotPlan(policy, scenario.id, {
    package_name: receiptCandidate.package_name,
    package_version: receiptCandidate.package_version,
    package_commit: receiptCandidate.package_commit,
    tarball_sha256: receiptCandidate.tarball_sha256,
    npm_integrity: receiptCandidate.npm_integrity,
    package_inventory_sha256: receiptCandidate.package_inventory_sha256,
    candidate_artifact_fingerprint_sha256: digest
  });
  const markerBytes = plan.steps.find((step) => step.kind === "file-probe")
    ?.expect.min_bytes ?? 0;
  const observationBase = Date.parse("2026-07-15T01:10:01.000Z");
  const observations = plan.steps.map((step, stepIndex) => {
    const start = new Date(observationBase + stepIndex * 2_000).toISOString();
    const complete = new Date(observationBase + stepIndex * 2_000 + 1_000).toISOString();
    const common = {
      id: step.id,
      role: step.role,
      kind: step.kind,
      started_at: start,
      completed_at: complete,
      duration_ms: 1_000,
      expected_outcome: step.kind === "command" ? step.expect.outcome : "success",
      observed_outcome: step.kind === "command" ? step.expect.outcome : "success",
      exit_code: step.kind === "command" && step.expect.outcome === "failure" ? 1 : 0,
      stdout_bytes: 0,
      stdout_sha256: emptySha256,
      stderr_bytes: 0,
      stderr_sha256: emptySha256,
      passed: true
    };
    if (step.kind === "command") {
      return {
        ...common,
        command: step.command,
        args: [...step.args],
        cwd: step.cwd,
        signal: null
      };
    }
    return {
      ...common,
      artifact: step.kind === "file-probe"
        ? {
            relative_path: step.path,
            type: step.expect.type,
            bytes: step.expect.min_bytes
          }
        : {
            relative_path: step.path,
            type: "file",
            bytes: markerBytes,
            sha256: step.expected_digest
          }
    };
  });
  const githubRunId = 223_450 + index;
  const githubArtifactName = `studio-agent-pilot-${scenario.id}-${githubRunId}.json`;
  const githubRunUrl =
    `https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/${githubRunId}`;
  const githubActionsInput = ["linux", "macos"].includes(scenario.context)
    ? {
        schema_version: 1,
        repository: "GeorgianDusk/dusk-developer-studio",
        workflow_path: ".github/workflows/studio-npm-package-assurance.yml",
        run_id: String(githubRunId),
        run_attempt: 1,
        job_name: `agent-pilot-${scenario.id}`,
        event_name: "workflow_dispatch",
        ref: "refs/heads/main",
        sha: candidateCommit,
        artifact_name: githubArtifactName
      }
    : null;
  const summary = {
    id,
    scenario_id: scenario.id,
    path: "duskds",
    experience: scenario.experience,
    context: scenario.context,
    capability: scenario.capability,
    execution_surface: scenario.execution_surface,
    failure_class: scenario.failure_class,
    operator_type: policy.pilot.operator_type,
    operator_identity: policy.pilot.operator_identity,
    completed: true,
    controlled_failure: true,
    recovery_attempted: true,
    recovered: true,
    recovery_evidence_reference: `pilot-${id}-recovery`,
    started_at: startedAt,
    completed_at: completedAt,
    candidate_commit: candidateCommit,
    candidate_artifact_fingerprint_sha256: digest,
    agent_confidence_score: 5,
    blocking_confusion: false,
    duration_seconds: 1_200,
    session_record_reference: `pilot-${id}-session-record`,
    run_url: githubActionsInput ? githubRunUrl : null,
    artifact_name: githubActionsInput ? githubArtifactName : null,
    provenance: null
  };
  assert.doesNotThrow(() => validatePilotPlan(policy, plan));
  const environment = {
    context: scenario.context,
    platform: {
      windows: "win32",
      wsl: "linux",
      linux: "linux",
      macos: "darwin"
    }[scenario.context],
    os_version: scenario.context === "wsl"
      ? "Linux fixture under Microsoft WSL2"
      : `${scenario.context}-fixture-version`,
    os_release: scenario.context === "wsl"
      ? "5.15.0-microsoft-standard-WSL2"
      : `${scenario.context}-fixture-release`,
    arch: scenario.context === "macos" ? "arm64" : "x64",
    node_version: "v24.18.0",
    privilege: {
      level: "standard",
      mechanism: scenario.context === "windows" ? "windows-integrity-level" : "posix-euid",
      uid: scenario.context === "windows" ? null : 1_000
    },
    environment_identity: ""
  };
  environment.environment_identity = environmentIdentity(environment);
  const receipt = {
    schema_version: 1,
    evidence_class: "operator-attested-machine-collected",
    independent_execution: false,
    operator_type: summary.operator_type,
    operator_identity: summary.operator_identity,
    scenario,
    invocation_id: invocationId,
    plan,
    plan_sha256: canonicalSha256(plan),
    collector: {
      path: "scripts/agent-pilot-collector.mjs",
      commit: candidateCommit,
      source_sha256: "8".repeat(64)
    },
    candidate: receiptCandidate,
    environment,
    execution: {
      started_at: startedAt,
      completed_at: completedAt,
      duration_seconds: 1_200,
      step_count: observations.length,
      controlled_failure_step_id: scenario.failure_class,
      recovery_step_ids: plan.steps
        .filter((step) => step.role === "recovery")
        .map((step) => step.id),
      final_verification_step_id: plan.final_verification_step_id,
      observations,
      raw_observation_bundle_sha256: canonicalSha256(observations)
    },
    github_actions_provenance_input: githubActionsInput,
    redacted: true
  };
  const receiptJson = canonicalJson(receipt);
  const receiptSha256 = createHash("sha256").update(receiptJson, "utf8").digest("hex");
  summary.receipt_json = receiptJson;
  summary.receipt_sha256 = receiptSha256;
  summary.recovery_evidence_reference =
    `agent-pilots/${scenario.id}/${receipt.execution.raw_observation_bundle_sha256}.recovery.json`;
  summary.session_record_reference =
    `agent-pilots/${scenario.id}/${receiptSha256}.json`;
  if (githubActionsInput) {
    summary.provenance = provenanceFor({
      workflowPath: githubActionsInput.workflow_path,
      runUrl: githubRunUrl,
      runEvent: githubActionsInput.event_name,
      artifactId: 700 + index,
      artifactName: githubArtifactName,
      receiptPath: githubArtifactName,
      receiptSha256,
      downloadedAt: "2026-07-15T01:40:00Z"
    });
  }
  return summary;
});
const checks = Object.fromEntries(policy.required_synthetic_checks.map((check) => [check, {
  status: "passed",
  owner: "platform-owner",
  candidate_commit: candidateCommit,
  candidate_public_fingerprint_sha256: digest
}]));
checks.duskds_node_read = {
  ...checks.duskds_node_read,
  endpoint: policy.duskds_testnet_graphql_url,
  height: 3_818_138,
  hash: "f".repeat(64),
  observed_at: "2026-07-15T02:59:00Z"
};
checks.rpc_chain_id = {
  status: "deferred",
  path: "evm",
  reason: policy.deferred_synthetic_checks.rpc_chain_id.reason,
  authority_reference: "config/phase5-policy.json",
  candidate_commit: candidateCommit,
  candidate_public_fingerprint_sha256: digest
};
const passedSteps = (steps) => Object.fromEntries(steps.map((step) => [step, "passed"]));
const nativeReceipt = {
  schema_version: 1,
  status: "passed",
  candidate_commit: candidateCommit,
  candidate_artifact_fingerprint_sha256: digest,
  workflow_path: ".github/workflows/duskds-native-smoke.yml",
  observed_at: "2026-07-15T02:00:00Z",
  contract_sha256: "1".repeat(64),
  data_driver_sha256: "2".repeat(64),
  native_steps: passedSteps(policy.required_native_smoke_steps)
};
const publicReceiptChecks = Object.fromEntries(policy.required_synthetic_checks
  .filter((check) => check !== "monitor_heartbeat")
  .map((check) => [check, { status: "passed" }]));
publicReceiptChecks.release_parity = {
  status: "passed",
  commit: candidateCommit,
  version: "2026.07.15",
  artifact_fingerprint_sha256: digest
};
publicReceiptChecks.key_routes = { status: "passed", spa_fallback_cache: "no-cache" };
publicReceiptChecks.source_links = {
  status: "passed",
  urls: Object.fromEntries(policy.key_source_urls.map((url) => [url, 200]))
};
publicReceiptChecks.duskds_node_read = {
  status: "passed",
  endpoint: policy.duskds_testnet_graphql_url,
  height: 3_818_138,
  hash: "f".repeat(64),
  observed_at: "2026-07-15T02:59:00Z"
};
publicReceiptChecks.rpc_chain_id = {
  status: "deferred",
  path: "evm",
  reason: policy.deferred_synthetic_checks.rpc_chain_id.reason
};
publicReceiptChecks.rpc_degradation = { status: "passed", evidence: "hosted-browser-offline-recovery" };
publicReceiptChecks.tls_expiry = { status: "passed", days_remaining: 45, expires_at: "2026-08-29T00:00:00Z" };
publicReceiptChecks.companion_port_closed = { status: "passed", observed: "econnrefused" };
publicReceiptChecks.development_port_closed = { status: "passed", observed: "econnrefused" };
const publicReceipt = {
  schema_version: 1,
  checked_at: "2026-07-15T03:00:00Z",
  target: "https://studio.134-122-59-217.nip.io",
  expected_environment: "production",
  status: "passed",
  studio_status: "passed",
  upstream_dependency_status: "passed",
  checks: publicReceiptChecks,
  errors: []
};
const heartbeatReceipt = {
  schema_version: 1,
  status: "passed",
  workflow_path: ".github/workflows/studio-public-staging.yml",
  checked_at: "2026-07-15T04:00:00Z",
  max_age_seconds: 54_000,
  workflow_id: 123,
  workflow_state: "active",
  last_run_id: 123456,
  last_run_url: publicAssuranceRunUrl,
  last_run_status: "completed",
  last_run_conclusion: "success",
  last_run_created_at: "2026-07-15T03:00:00Z",
  age_seconds: 3600
};
const heartbeatBoundReceipt = boundReceipt(heartbeatReceipt);
checks.monitor_heartbeat = {
  ...checks.monitor_heartbeat,
  ...heartbeatBoundReceipt,
  workflow_path: policy.monitoring_evidence.schedule_guard_workflow,
  guard_run_url: heartbeatRunUrl,
  artifact_name: "studio-monitor-heartbeat-123457.json",
  observed_at: heartbeatReceipt.checked_at,
  observed_public_run_url: publicAssuranceRunUrl,
  provenance: provenanceFor({
    workflowPath: ".github/workflows/studio-monitor-schedule-guard.yml",
    runUrl: heartbeatRunUrl,
    runEvent: "schedule",
    artifactId: 457,
    artifactName: "studio-monitor-heartbeat-123457.json",
    receiptPath: "studio-monitor-heartbeat-123457.json",
    receiptSha256: heartbeatBoundReceipt.receipt_sha256,
    downloadedAt: "2026-07-15T04:10:00Z"
  })
};
const alertReceipt = {
  schema_version: 2,
  status: "passed",
  channel: "github-assigned-issue",
  owner: "George",
  issue_number: 123,
  issue_closed: true,
  run_id: "123458",
  candidate_commit: candidateCommit,
  candidate_public_fingerprint_sha256: digest,
  workflow_path: ".github/workflows/studio-public-staging.yml",
  observed_at: "2026-07-15T05:00:00Z"
};
const nativeBoundReceipt = boundReceipt(nativeReceipt);
const publicBoundReceipt = boundReceipt(publicReceipt);
const alertBoundReceipt = boundReceipt(alertReceipt);
const npmPlatformSmoke = Object.fromEntries(policy.npm_distribution.required_platforms.map((platform, index) => [platform, {
  schema_version: 2,
  status: "passed",
  runner: platform,
  node_version: "24.18.0",
  install_smoke: "passed",
  safe_smoke: "passed",
  local_actions_capability_contract_smoke: "passed",
  local_actions_preflight_verified: true,
  local_actions_preflight_check_id: preflightCheckId,
  local_actions_preflight_loopback_services_stopped: true,
  local_actions_preflight_consumer_contract_source_sha256: consumerContractSha256,
  direct_cli_scaffold_smoke: "passed",
  local_actions_scaffold_smoke: "passed",
  scaffold_preservation_smoke: "passed",
  shutdown_smoke: "passed",
  cleanup_smoke: "passed",
  elevated_refusal: "passed",
  candidate_commit: candidateCommit,
  integrity: npmIntegrity,
  package_inventory_sha256: npmInventoryDigest,
  package_file_count: npmPackageFileCount,
  observed_at: `2026-07-15T06:3${index}:00Z`
}]));
const npmAssuranceRunId = Number(new URL(npmAssuranceRunUrl).pathname.split("/").at(-1));
const npmEvidenceId = `CV-E-FINAL-PACKAGE-${npmAssuranceRunId}`;
const npmPlatformReceiptDigests = Object.fromEntries(
  Object.entries(npmPlatformSmoke).map(([runner, record]) => [
    runner,
    createHash("sha256").update(JSON.stringify(record), "utf8").digest("hex")
  ])
);
const npmAssuranceRecord = {
  evidence_id: npmEvidenceId,
  source_commit: candidateCommit,
  package_name: policy.npm_distribution.package_name,
  package_version: policy.npm_distribution.package_version,
  package_path: `output/npm/${policy.npm_distribution.package_name}-${policy.npm_distribution.package_version}.tgz`,
  package_sha256: npmPackageSha256,
  package_inventory_sha256: npmInventoryDigest,
  package_file_count: npmPackageFileCount,
  npm_integrity: npmIntegrity,
  observed_at: "2026-07-15T06:40:00Z",
  platforms_verified: [...policy.npm_distribution.required_package_platforms],
  checks_verified: [...policy.npm_distribution.required_package_checks],
  platform_results: policy.npm_distribution.required_package_platforms.map((platform) => {
    const runner = policy.npm_distribution.native_ci_runner_map[platform];
    return {
      platform,
      status: "passed",
      evidence_refs: [`${npmEvidenceId}:platform:${runner}:${npmPlatformReceiptDigests[runner]}`]
    };
  }),
  check_results: policy.npm_distribution.required_package_checks.map((check) => ({
    check,
    status: "passed",
    evidence_refs: policy.npm_distribution.required_platforms.map((runner) =>
      `${npmEvidenceId}:check:${check}:${runner}:${npmPlatformReceiptDigests[runner]}`
    )
  }))
};
const npmAssurancePayload = {
  schema_version: 1,
  record: npmAssuranceRecord,
  native_ci_evidence: {
    browser_boot_and_pairing_smoke: "passed",
    local_actions_preflight_verified: true,
    consumer_contract_source_sha256: consumerContractSha256,
    platform_smoke: npmPlatformSmoke
  }
};
const npmAssurancePayloadJson = JSON.stringify(npmAssurancePayload);
const npmAssurancePayloadSha256 = createHash("sha256")
  .update(npmAssurancePayloadJson, "utf8")
  .digest("hex");
const npmAssuranceEvidenceArtifactId = "8459";
const npmAssuranceReceipt = {
  schema_version: 1,
  kind: "final-package-assurance",
  record_id: npmEvidenceId,
  evidence_class: "package-lifecycle-smoke",
  producer: "ci-package-assurance",
  capture_mode: "machine-observed",
  test_fixture: false,
  validation_context: {
    policy_sha256: "8".repeat(64),
    source_commit: candidateCommit,
    package_name: policy.npm_distribution.package_name,
    package_version: policy.npm_distribution.package_version,
    package_sha256: npmPackageSha256,
    npm_integrity: npmIntegrity,
    repository_tag: policy.npm_distribution.tag
  },
  record: npmAssuranceRecord,
  evidence_payload_json: npmAssurancePayloadJson,
  evidence_payload: npmAssurancePayload,
  evidence_payload_sha256: npmAssurancePayloadSha256,
  github_actions_provenance: {
    schema_version: 1,
    mode: "github-actions-upload-artifact-v7",
    repository: "GeorgianDusk/dusk-developer-studio",
    workflow_path: policy.npm_distribution.assurance_workflow,
    run_id: String(npmAssuranceRunId),
    run_attempt: 1,
    run_event: "push",
    run_ref: "refs/heads/main",
    run_commit: candidateCommit,
    run_url: npmAssuranceRunUrl,
    job_name: "aggregate-assurance",
    artifact_id: npmAssuranceEvidenceArtifactId,
    artifact_name: `studio-npm-assurance-evidence-${npmAssuranceRunId}.json`,
    artifact_url: `${npmAssuranceRunUrl}/artifacts/${npmAssuranceEvidenceArtifactId}`,
    artifact_digest_sha256: npmAssurancePayloadSha256
  }
};
const npmPublicationReceipt = {
  schema_version: 1,
  status: "published",
  package_name: policy.npm_distribution.package_name,
  package_version: policy.npm_distribution.package_version,
  node_engine: policy.npm_distribution.node_engine,
  registry_url: policy.npm_distribution.registry_url,
  tag: policy.npm_distribution.tag,
  candidate_commit: candidateCommit,
  workflow_path: policy.npm_distribution.publication_workflow,
  observed_at: "2026-07-15T06:50:00Z",
  integrity: npmIntegrity,
  package_inventory_sha256: npmInventoryDigest,
  npm_maintainer: policy.npm_distribution.expected_npm_maintainer,
  npm_publisher: policy.npm_distribution.expected_oidc_publisher,
  trusted_publisher_id: policy.npm_distribution.expected_oidc_trusted_publisher_id,
  main_assurance_run_id: npmAssuranceRunId,
  main_assurance_run_url: npmAssuranceRunUrl,
  main_assurance_run_attempt: 1,
  main_assurance_artifact_id: 9460,
  main_assurance_artifact_name:
    `${policy.npm_distribution.package_name}-${policy.npm_distribution.package_version}.tgz`,
  main_assurance_artifact_digest_sha256: npmPackageSha256,
  main_assurance_tarball_sha256: npmPackageSha256,
  tag_assurance_tarball_sha256: npmPackageSha256,
  prepublication_cross_run_byte_match: true,
  registry_authentication: policy.npm_distribution.subsequent_registry_authentication,
  provenance_verification: "npm-audit-signatures-and-slsa-source-bound",
  provenance_predicate_type: "https://slsa.dev/provenance/v1",
  provenance_subject: `pkg:npm/${policy.npm_distribution.package_name}@${policy.npm_distribution.package_version}`,
  provenance_subject_sha512: npmIntegrityHex,
  provenance_repository: policy.npm_distribution.expected_provenance_repository,
  provenance_workflow: policy.npm_distribution.publication_workflow,
  provenance_ref: `refs/tags/${policy.npm_distribution.tag}`,
  provenance_resolved_commit: candidateCommit
};
const initialPublicationCommit = "d".repeat(40);
const initialPublicationRunId = 123449;
const initialPublicationArtifactId = 449;
const initialPublicationRunUrl =
  `https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/${initialPublicationRunId}`;
const initialPublicationArtifact =
  `studio-npm-publication-receipt-${initialPublicationRunId}.json`;
const initialPublicationIntegrity = `sha512-${Buffer.alloc(64, 0x41).toString("base64")}`;
const initialPublicationIntegrityHex = Buffer.alloc(64, 0x41).toString("hex");
const initialPublicationInventoryDigest = "f".repeat(64);
const initialPublicationObservedAt = "2026-07-14T06:47:00Z";
const initialPublicationReceipt = {
  schema_version: 1,
  status: "published",
  package_name: policy.npm_distribution.package_name,
  package_version: policy.npm_distribution.initial_package_version,
  node_engine: policy.npm_distribution.node_engine,
  registry_url: policy.npm_distribution.registry_url,
  tag: policy.npm_distribution.initial_tag,
  candidate_commit: initialPublicationCommit,
  workflow_path: policy.npm_distribution.expected_initial_provenance_workflow,
  observed_at: initialPublicationObservedAt,
  integrity: initialPublicationIntegrity,
  package_inventory_sha256: initialPublicationInventoryDigest,
  npm_maintainer: policy.npm_distribution.expected_npm_maintainer,
  registry_authentication: policy.npm_distribution.initial_registry_authentication,
  provenance_verification: "npm-audit-signatures-and-slsa-source-bound",
  provenance_predicate_type: "https://slsa.dev/provenance/v1",
  provenance_subject:
    `pkg:npm/${policy.npm_distribution.package_name}@${policy.npm_distribution.initial_package_version}`,
  provenance_subject_sha512: initialPublicationIntegrityHex,
  provenance_repository: policy.npm_distribution.expected_provenance_repository,
  provenance_workflow: policy.npm_distribution.expected_initial_provenance_workflow,
  provenance_ref: `refs/tags/${policy.npm_distribution.initial_tag}`,
  provenance_resolved_commit: initialPublicationCommit
};
const npmAssuranceBoundReceipt = boundReceipt(npmAssuranceReceipt);
const npmPublicationBoundReceipt = boundReceipt(npmPublicationReceipt);
const initialPublicationBoundReceipt = boundReceipt(initialPublicationReceipt);
policy.npm_distribution.initial_publication_evidence = {
  candidate_commit: initialPublicationCommit,
  integrity: initialPublicationIntegrity,
  package_inventory_sha256: initialPublicationInventoryDigest,
  run_id: initialPublicationRunId,
  artifact_id: initialPublicationArtifactId,
  artifact_name: initialPublicationArtifact,
  artifact_expires_at: "2026-10-13T06:45:00Z",
  preserved_receipt_path:
    `docs/evidence/npm-initial-publication-receipt-${initialPublicationRunId}.json`,
  receipt_sha256: initialPublicationBoundReceipt.receipt_sha256,
  observed_at: initialPublicationObservedAt
};
const evidence = {
  schema_version: 10,
  candidate: {
    artifact_fingerprint_sha256: digest,
    public_fingerprint_sha256: digest,
    commit: candidateCommit,
    release_id: "2026.07.15",
    policy_sha256: policyShaFor(policy),
    evaluator_commit: candidateCommit,
    implementation_identities: ["codex-agent"],
    manifest_url: "https://studio.134-122-59-217.nip.io/release-manifest.json",
    built_at: "2026-07-15T00:00:00Z",
    source_checked_at: "2026-07-14T00:00:00Z",
    source_expires_at: "2026-08-03T23:59:59Z"
  },
  npm_distribution: {
    package_name: policy.npm_distribution.package_name,
    package_version: policy.npm_distribution.package_version,
    node_engine: policy.npm_distribution.node_engine,
    registry_url: policy.npm_distribution.registry_url,
    integrity: npmIntegrity,
    package_sha256: npmPackageSha256,
    package_inventory_sha256: npmInventoryDigest,
    package_file_count: npmPackageFileCount,
    platform_smoke: npmPlatformSmoke,
    assurance: {
      candidate_commit: candidateCommit,
      ...npmAssuranceBoundReceipt,
      workflow_path: policy.npm_distribution.assurance_workflow,
      run_url: npmAssuranceRunUrl,
      artifact_name: "studio-npm-assurance-receipt-123459.json",
      observed_at: npmAssuranceRecord.observed_at,
      provenance: provenanceFor({
        workflowPath: policy.npm_distribution.assurance_workflow,
        runUrl: npmAssuranceRunUrl,
        runEvent: "push",
        artifactId: 459,
        artifactName: "studio-npm-assurance-receipt-123459.json",
        receiptPath: "studio-npm-assurance-receipt-123459.json",
        receiptSha256: npmAssuranceBoundReceipt.receipt_sha256,
        downloadedAt: "2026-07-15T06:45:00Z"
      })
    },
    publication: {
      candidate_commit: candidateCommit,
      ...npmPublicationBoundReceipt,
      workflow_path: policy.npm_distribution.publication_workflow,
      run_url: npmPublicationRunUrl,
      artifact_name: "studio-npm-oidc-publication-receipt-123460.json",
      observed_at: npmPublicationReceipt.observed_at,
      provenance: provenanceFor({
        workflowPath: policy.npm_distribution.publication_workflow,
        runUrl: npmPublicationRunUrl,
        runEvent: "push",
        artifactId: 460,
        artifactName: "studio-npm-oidc-publication-receipt-123460.json",
        receiptPath: "studio-npm-oidc-publication-receipt-123460.json",
        receiptSha256: npmPublicationBoundReceipt.receipt_sha256,
        downloadedAt: "2026-07-15T06:55:00Z"
      })
    },
    bootstrap_controls: {
      package_version: policy.npm_distribution.initial_package_version,
      tag: policy.npm_distribution.initial_tag,
      workflow_path: policy.npm_distribution.expected_initial_provenance_workflow,
      environment: policy.npm_distribution.initial_publication_environment,
      initial_publication: {
        candidate_commit: initialPublicationCommit,
        ...initialPublicationBoundReceipt,
        workflow_path: policy.npm_distribution.expected_initial_provenance_workflow,
        run_url: initialPublicationRunUrl,
        artifact_name: initialPublicationArtifact,
        observed_at: initialPublicationObservedAt,
        provenance: provenanceFor({
          workflowPath: policy.npm_distribution.expected_initial_provenance_workflow,
          runUrl: initialPublicationRunUrl,
          runEvent: "push",
          artifactId: initialPublicationArtifactId,
          artifactName: initialPublicationArtifact,
          receiptPath: initialPublicationArtifact,
          receiptSha256: initialPublicationBoundReceipt.receipt_sha256,
          downloadedAt: "2026-07-14T06:50:00Z",
          runCommit: initialPublicationCommit
        })
      },
      token_created_at: "2026-07-14T06:42:00Z",
      token_permissions: policy.npm_distribution.initial_token_scope.permissions,
      token_package_access: policy.npm_distribution.initial_token_scope.package_access,
      token_bypass_2fa: policy.npm_distribution.initial_token_scope.bypass_2fa,
      token_revoked: true,
      token_revoked_at: "2026-07-14T06:52:00Z",
      token_revocation_evidence_reference: "npm-token-revocation-review",
      token_revocation_evidence_sha256: "3".repeat(64),
      environment_secret_removed: true,
      environment_secret_removed_at: "2026-07-14T06:53:00Z",
      environment_secret_removal_evidence_reference: "github-environment-secret-removal-review",
      environment_secret_removal_evidence_sha256: "4".repeat(64),
      trusted_publisher_configured: true,
      trusted_publisher_configured_at: "2026-07-14T06:54:00Z",
      trusted_publisher_evidence_reference: "npm-trusted-publisher-settings-review",
      trusted_publisher_evidence_sha256: "5".repeat(64),
      verified_by: "npm-control-reviewer",
      verified_at: "2026-07-14T06:56:00Z"
    }
  },
  owners,
  reviews,
  pilot: {
    evidence_class: policy.pilot.evidence_class,
    operator_type: policy.pilot.operator_type,
    operator_identity: policy.pilot.operator_identity,
    confidence_score_semantics: policy.pilot.confidence_score_semantics,
    receipt_assurance: policy.pilot.receipt_assurance,
    fixed_limitation: policy.pilot.fixed_limitation,
    sessions
  },
  live_smoke: {
    status: "passed",
    authority_reference: "approval-2026-07-15",
    redacted: true,
    candidate_commit: candidateCommit,
    candidate_artifact_fingerprint_sha256: digest,
    ...nativeBoundReceipt,
    workflow_path: ".github/workflows/duskds-native-smoke.yml",
    run_url: nativeSmokeRunUrl,
    artifact_name: "duskds-native-smoke-receipt-123450.json",
    observed_at: nativeReceipt.observed_at,
    provenance: provenanceFor({
      workflowPath: ".github/workflows/duskds-native-smoke.yml",
      runUrl: nativeSmokeRunUrl,
      runEvent: "workflow_dispatch",
      artifactId: 450,
      artifactName: "duskds-native-smoke-receipt-123450.json",
      receiptPath: "duskds-native-smoke-receipt-123450.json",
      receiptSha256: nativeBoundReceipt.receipt_sha256,
      downloadedAt: "2026-07-15T02:10:00Z"
    }),
    native_steps: passedSteps(policy.required_native_smoke_steps)
  },
  synthetics: {
    public_assurance: {
      candidate_commit: candidateCommit,
      candidate_public_fingerprint_sha256: digest,
      ...publicBoundReceipt,
      workflow_path: ".github/workflows/studio-public-staging.yml",
      run_url: publicAssuranceRunUrl,
      artifact_name: "studio-public-synthetic-receipt-123456.json",
      observed_at: publicReceipt.checked_at,
      provenance: provenanceFor({
        workflowPath: ".github/workflows/studio-public-staging.yml",
        runUrl: publicAssuranceRunUrl,
        runEvent: "schedule",
        artifactId: 456,
        artifactName: "studio-public-synthetic-receipt-123456.json",
        receiptPath: "studio-public-synthetic-receipt-123456.json",
        receiptSha256: publicBoundReceipt.receipt_sha256,
        downloadedAt: "2026-07-15T03:10:00Z"
      })
    },
    checks,
    monitoring: {
      mode: policy.monitoring_evidence.mode,
      owner: policy.monitoring_evidence.accepted_risk.owner,
      authority_reference: policy.monitoring_evidence.accepted_risk.authority_reference
    },
    alert_delivery: {
      candidate_commit: candidateCommit,
      candidate_public_fingerprint_sha256: digest,
      ...alertBoundReceipt,
      workflow_path: ".github/workflows/studio-public-staging.yml",
      run_url: alertRunUrl,
      artifact_name: "studio-alert-delivery-receipt-123458.json",
      observed_at: alertReceipt.observed_at,
      provenance: provenanceFor({
        workflowPath: ".github/workflows/studio-public-staging.yml",
        runUrl: alertRunUrl,
        runEvent: "workflow_dispatch",
        artifactId: 458,
        artifactName: "studio-alert-delivery-receipt-123458.json",
        receiptPath: "studio-alert-delivery-receipt-123458.json",
        receiptSha256: alertBoundReceipt.receipt_sha256,
        downloadedAt: "2026-07-15T05:10:00Z"
      })
    },
    checked_at: publicReceipt.checked_at
  },
  rollback: {
    product: (() => {
      const record = {
      owner: "engineering-owner",
      target: "product",
      result: "passed",
      duration_seconds: 100,
      prior_release_id: "2026.07.14",
      prior_commit: "a".repeat(40),
      prior_fingerprint_sha256: restoredDigest,
      candidate_release_id: "2026.07.15",
      candidate_commit: candidateCommit,
      candidate_artifact_fingerprint_sha256: digest,
      restored_fingerprint_sha256: restoredDigest,
      started_at: "2026-07-15T05:58:20Z",
      completed_at: "2026-07-15T06:00:00Z",
      evidence_reference: "rollback-product",
      health_proof: "receipt-product",
      data_cache_effects: "immutable assets retained; HTML reverted"
      };
      return { ...record, ...boundReceipt({ schema_version: 1, ...record }) };
    })(),
    platform: (() => {
      const record = {
      owner: "platform-owner",
      target: "platform",
      result: "passed",
      duration_seconds: 200,
      prior_release_id: "2026.07.14",
      prior_commit: "a".repeat(40),
      prior_fingerprint_sha256: restoredDigest,
      candidate_release_id: "2026.07.15",
      candidate_commit: candidateCommit,
      candidate_artifact_fingerprint_sha256: digest,
      restored_fingerprint_sha256: restoredDigest,
      started_at: "2026-07-15T06:26:40Z",
      completed_at: "2026-07-15T06:30:00Z",
      evidence_reference: "rollback-platform",
      health_proof: "receipt-platform",
      data_cache_effects: "no data mutation; route restored"
      };
      return { ...record, ...boundReceipt({ schema_version: 1, ...record }) };
    })()
  },
  issues: [],
  support: { on_call_owner: "George", support_channel_confirmed: true, launch_message_owner: "George", incident_message_owner: "George" },
  product_signoff: { decision: "go", owner: "George", signed_at: "2026-07-15T07:00:00Z", artifact_fingerprint_sha256: digest }
};

function onlineFetchFor(testPolicy, testEvidence) {
  const repository = "GeorgianDusk/dusk-developer-studio";
  const records = [
    testEvidence.live_smoke,
    testEvidence.synthetics.public_assurance,
    { ...testEvidence.synthetics.checks.monitor_heartbeat, run_url: testEvidence.synthetics.checks.monitor_heartbeat.guard_run_url },
    testEvidence.synthetics.alert_delivery,
    testEvidence.npm_distribution.assurance,
    testEvidence.npm_distribution.publication,
    testEvidence.npm_distribution.bootstrap_controls.initial_publication,
    ...testEvidence.pilot.sessions
      .filter((session) => ["linux", "macos"].includes(session.context))
      .map((session) => ({
        ...session,
        workflow_path: testPolicy.npm_distribution.assurance_workflow,
        observed_at: session.completed_at
      }))
  ];
  const routes = new Map();
  for (const record of records) {
    const provenance = record.provenance;
    const runId = provenance.run_id;
    const runApi = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
    const observedAt = Date.parse(record.observed_at);
    const runCommit = provenance.run_commit;
    const receiptBytes = Buffer.from(record.receipt_json, "utf8");
    const artifactApi = `https://api.github.com/repos/${repository}/actions/artifacts/${provenance.artifact_id}`;
    const artifact = {
      id: provenance.artifact_id,
      name: record.artifact_name,
      size_in_bytes: receiptBytes.length,
      url: artifactApi,
      archive_download_url: `${artifactApi}/zip`,
      expired: false,
      created_at: new Date(observedAt + 60_000).toISOString(),
      expires_at: record === testEvidence.npm_distribution.bootstrap_controls.initial_publication
        ? testPolicy.npm_distribution.initial_publication_evidence.artifact_expires_at
        : new Date(observedAt + 30 * 24 * 60 * 60 * 1_000).toISOString(),
      digest: `sha256:${record.receipt_sha256}`,
      workflow_run: {
        id: runId,
        repository_id: 99,
        head_repository_id: 99,
        head_sha: runCommit
      }
    };
    routes.set(runApi, {
      kind: "json",
      value: {
        id: runId,
        url: runApi,
        html_url: record.run_url,
        artifacts_url: `${runApi}/artifacts`,
        path: `${record.workflow_path}@main`,
        head_branch: "main",
        head_sha: runCommit,
        status: "completed",
        conclusion: "success",
        event: provenance.run_event,
        run_attempt: 1,
        created_at: new Date(observedAt - 10 * 60_000).toISOString(),
        run_started_at: new Date(observedAt - 5 * 60_000).toISOString(),
        updated_at: new Date(observedAt + 5 * 60_000).toISOString(),
        repository: { id: 99, full_name: repository },
        head_repository: { id: 99, full_name: repository }
      }
    });
    routes.set(`${runApi}/artifacts?name=${encodeURIComponent(record.artifact_name)}&per_page=100`, {
      kind: "json",
      value: { total_count: 1, artifacts: [artifact] }
    });
    const signedUrl = `https://results-receiver.actions.githubusercontent.com/artifacts/${provenance.artifact_id}?sig=redacted`;
    routes.set(artifact.archive_download_url, { kind: "redirect", location: signedUrl });
    routes.set(signedUrl, { kind: "bytes", value: receiptBytes });
  }
  const addAssuranceArtifact = ({ artifactId, artifactName, bytes }) => {
    const runId = npmAssuranceRunId;
    const runApi = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
    const artifactApi = `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`;
    const digest = createHash("sha256").update(bytes).digest("hex");
    const artifact = {
      id: artifactId,
      name: artifactName,
      size_in_bytes: bytes.length,
      url: artifactApi,
      archive_download_url: `${artifactApi}/zip`,
      expired: false,
      created_at: "2026-07-15T06:41:00Z",
      expires_at: "2026-10-13T06:41:00Z",
      digest: `sha256:${digest}`,
      workflow_run: {
        id: runId,
        repository_id: 99,
        head_repository_id: 99,
        head_sha: candidateCommit
      }
    };
    routes.set(`${runApi}/artifacts?name=${encodeURIComponent(artifactName)}&per_page=100`, {
      kind: "json",
      value: { total_count: 1, artifacts: [artifact] }
    });
    const signedUrl =
      `https://results-receiver.actions.githubusercontent.com/artifacts/${artifactId}?sig=redacted`;
    routes.set(artifact.archive_download_url, { kind: "redirect", location: signedUrl });
    routes.set(signedUrl, { kind: "bytes", value: bytes });
  };
  addAssuranceArtifact({
    artifactId: Number(npmAssuranceEvidenceArtifactId),
    artifactName: `studio-npm-assurance-evidence-${npmAssuranceRunId}.json`,
    bytes: Buffer.from(npmAssurancePayloadJson, "utf8")
  });
  addAssuranceArtifact({
    artifactId: npmPublicationReceipt.main_assurance_artifact_id,
    artifactName: npmPublicationReceipt.main_assurance_artifact_name,
    bytes: npmPackageBytes
  });
  return async (input, init = {}) => {
    const url = String(input);
    const route = routes.get(url);
    if (!route) throw new Error(`Unexpected online Phase 5 fixture URL: ${url}`);
    const authorization = new globalThis.Headers(init.headers).get("authorization");
    if (url.startsWith("https://api.github.com/")) assert.equal(authorization, "Bearer phase5-test-token");
    else assert.equal(authorization, null);
    if (route.kind === "json") return new globalThis.Response(JSON.stringify(route.value), { status: 200 });
    if (route.kind === "redirect") return new globalThis.Response(null, { status: 302, headers: { location: route.location } });
    return new globalThis.Response(route.value, { status: 200 });
  };
}

async function formalDecision(testPolicy, testEvidence) {
  const policyBoundEvidence = {
    ...testEvidence,
    candidate: {
      ...testEvidence.candidate,
      policy_sha256: policyShaFor(testPolicy),
      evaluator_commit: candidateCommit
    }
  };
  return evaluatePhase5EvidenceOnline(testPolicy, policyBoundEvidence, {
    now,
    token: "phase5-test-token",
    fetchImpl: onlineFetchFor(testPolicy, policyBoundEvidence),
    readFileImpl: async () => Buffer.from(
      policyBoundEvidence.npm_distribution.bootstrap_controls.initial_publication.receipt_json,
      "utf8"
    ),
    workspaceRoot: "C:\\candidate"
  });
}

assert.equal(evaluatePhase5Evidence(policy, evidence, { now }).decision, "no-go");
assert.match(evaluatePhase5Evidence(policy, evidence, { now }).blockers.join("\n"), /Online GitHub Actions/);
const baselineFormalDecision = await formalDecision(policy, evidence);
assert.equal(
  baselineFormalDecision.decision,
  "go",
  baselineFormalDecision.blockers?.join("\n")
);
assert.equal(baselineFormalDecision.assurance_scope, "policy-complete-under-declared-human-and-agent-assembly");
assert.equal(Object.hasOwn(baselineFormalDecision, "trusted_human_attestations"), false);
const obsoleteSchemaEvidence = JSON.parse(JSON.stringify(evidence));
obsoleteSchemaEvidence.schema_version = 9;
assert.match(
  evaluatePhase5Evidence(policy, obsoleteSchemaEvidence, { now }).blockers.join("\n"),
  /evidence schema is unsupported/
);
assert.deepEqual(baselineFormalDecision.human_attestations, ["product_signoff"]);
assert.deepEqual(
  baselineFormalDecision.agent_attestations,
  ["separate_agent_challenge_reviews", "support_assignments", "rollback_execution"]
);
assert.deepEqual(baselineFormalDecision.agent_operated_simulations, {
  evidence_class: policy.pilot.evidence_class,
  operator_type: policy.pilot.operator_type,
  operator_identity: policy.pilot.operator_identity,
  receipt_assurance: policy.pilot.receipt_assurance,
  sessions: 8,
  duskds_sessions: 8,
  github_actions_provenance_sessions: 2,
  local_operator_attested_sessions: 6,
  average_agent_confidence_score: 5
});
assert.deepEqual(
  baselineFormalDecision.limitations,
  [policy.pilot.fixed_limitation, policy.responsibility_model.fixed_limitation]
);
assert.match(baselineFormalDecision.limitations[0], /do not prove external-human comprehension[\s\S]*adoption/iu);
assert.match(baselineFormalDecision.limitations[1], /not external independent human or security audits/iu);
assert.deepEqual(
  baselineFormalDecision.github_actions.records
    .filter((record) => record.label.startsWith("Agent pilot "))
    .map((record) => record.label)
    .sort(),
  ["Agent pilot linux-port-conflict-recovery", "Agent pilot macos-privilege-recovery"]
);
assert.match(evaluatePhase5EvidenceRaw(policy, evidence, { now }).blockers.join("\n"), /exact reviewed policy bytes and evaluator commit/);
const wrongPolicyBinding = JSON.parse(JSON.stringify(evidence));
wrongPolicyBinding.candidate.policy_sha256 = "d".repeat(64);
assert.match(evaluatePhase5Evidence(policy, wrongPolicyBinding, { now }).blockers.join("\n"), /exact reviewed policy bytes and evaluator commit/);
const wrongEvaluatorBinding = JSON.parse(JSON.stringify(evidence));
wrongEvaluatorBinding.candidate.evaluator_commit = "d".repeat(40);
assert.match(evaluatePhase5Evidence(policy, wrongEvaluatorBinding, { now }).blockers.join("\n"), /exact reviewed policy bytes and evaluator commit/);
const contextPolicyBytes = Buffer.from(JSON.stringify(policy), "utf8");
const cleanCandidateContext = verifyCandidateBoundPhase5Context({
  root,
  evidence,
  policyBytes: contextPolicyBytes,
  git: (args) => args[0] === "rev-parse" ? candidateCommit : ""
});
assert.deepEqual(cleanCandidateContext, { evaluatorCommit: candidateCommit, policySha256: evidence.candidate.policy_sha256 });
assert.throws(() => verifyCandidateBoundPhase5Context({
  root,
  evidence,
  policyBytes: contextPolicyBytes,
  git: (args) => args[0] === "rev-parse" ? "d".repeat(40) : ""
}), /exact candidate commit/);
assert.throws(() => verifyCandidateBoundPhase5Context({
  root,
  evidence,
  policyBytes: contextPolicyBytes,
  git: (args) => args[0] === "rev-parse" ? candidateCommit : args[0] === "status" ? " M config/phase5-policy.json" : ""
}), /clean tracked candidate checkout/);
assert.throws(() => verifyCandidateBoundPhase5Context({
  root,
  evidence,
  policyBytes: Buffer.from("{}", "utf8"),
  git: () => ""
}), /exact local policy bytes/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, schema_version: 2 }, { now }).blockers.join("\n"), /schema is unsupported/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, schema_version: 3 }, { now }).blockers.join("\n"), /schema is unsupported/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, schema_version: 4 }, { now }).blockers.join("\n"), /schema is unsupported/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, schema_version: 5 }, { now }).blockers.join("\n"), /schema is unsupported/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, candidate: { ...evidence.candidate, public_fingerprint_sha256: "c".repeat(64) } }, { now }).blockers.join("\n"), /fingerprints differ/);
const futureCandidateBuild = JSON.parse(JSON.stringify(evidence));
futureCandidateBuild.candidate.built_at = "2026-07-15T12:01:00Z";
assert.match(evaluatePhase5Evidence(policy, futureCandidateBuild, { now }).blockers.join("\n"), /build time is invalid or in the future/);
for (const invalidTimestamp of [
  "2026-07-15",
  "2026-07-15T00:00:00+00:00",
  "2026-02-30T00:00:00Z",
  "2026-07-15T00:00:00.0000Z"
]) {
  const nonCanonicalCandidateBuild = JSON.parse(JSON.stringify(evidence));
  nonCanonicalCandidateBuild.candidate.built_at = invalidTimestamp;
  assert.match(evaluatePhase5Evidence(policy, nonCanonicalCandidateBuild, { now }).blockers.join("\n"), /build time is invalid/);
}
const futureSourceCheck = JSON.parse(JSON.stringify(evidence));
futureSourceCheck.candidate.source_checked_at = "2026-07-15T12:01:00Z";
assert.match(evaluatePhase5Evidence(policy, futureSourceCheck, { now }).blockers.join("\n"), /source receipt is future-dated/);
const excessiveSourceHorizon = JSON.parse(JSON.stringify(evidence));
excessiveSourceHorizon.candidate.source_expires_at = "2026-08-20T00:00:01Z";
assert.match(evaluatePhase5Evidence(policy, excessiveSourceHorizon, { now }).blockers.join("\n"), /exceeds the 31-day horizon/);
const futureSignoff = JSON.parse(JSON.stringify(evidence));
futureSignoff.product_signoff.signed_at = "2026-07-15T12:01:00Z";
assert.match(evaluatePhase5Evidence(policy, futureSignoff, { now }).blockers.join("\n"), /no later than now/);
const earlySignoff = JSON.parse(JSON.stringify(evidence));
earlySignoff.product_signoff.signed_at = "2026-07-15T06:00:00Z";
assert.match(evaluatePhase5Evidence(policy, earlySignoff, { now }).blockers.join("\n"), /no earlier than every gating record/);
const credentialedManifest = JSON.parse(JSON.stringify(evidence));
credentialedManifest.candidate.manifest_url = "https://user:pass@studio.134-122-59-217.nip.io/release-manifest.json";
assert.match(evaluatePhase5Evidence(policy, credentialedManifest, { now }).blockers.join("\n"), /credential-free/);
const queriedManifest = JSON.parse(JSON.stringify(evidence));
queriedManifest.candidate.manifest_url = "https://studio.134-122-59-217.nip.io/release-manifest.json?candidate=1";
assert.match(evaluatePhase5Evidence(policy, queriedManifest, { now }).blockers.join("\n"), /credential-free/);
const queriedActionsRun = JSON.parse(JSON.stringify(evidence));
queriedActionsRun.synthetics.public_assurance.run_url = `${publicAssuranceRunUrl}?download=1`;
assert.match(evaluatePhase5Evidence(policy, queriedActionsRun, { now }).blockers.join("\n"), /exact canonical Actions workflow and run/);
const secretInAllowedValue = JSON.parse(JSON.stringify(evidence));
secretInAllowedValue.pilot.sessions[0].failure_scenario = "mnemonic is nonsecret-placeholder";
assert.match(evaluatePhase5Evidence(policy, secretInAllowedValue, { now }).blockers.join("\n"), /forbidden secret-shaped fields or values/);
const unknownSecretNote = JSON.parse(JSON.stringify(evidence));
unknownSecretNote.notes = "mnemonic words";
assert.match(evaluatePhase5Evidence(policy, unknownSecretNote, { now }).blockers.join("\n"), /unknown: notes/);
const nonexistentArtifactMetadata = JSON.parse(JSON.stringify(evidence));
nonexistentArtifactMetadata.synthetics.public_assurance.provenance.artifact_id = 0;
assert.match(evaluatePhase5Evidence(policy, nonexistentArtifactMetadata, { now }).blockers.join("\n"), /lacks complete downloaded GitHub run\/artifact provenance/);
const mismatchedRunMetadata = JSON.parse(JSON.stringify(evidence));
mismatchedRunMetadata.synthetics.public_assurance.provenance.run_id = 999999;
assert.match(evaluatePhase5Evidence(policy, mismatchedRunMetadata, { now }).blockers.join("\n"), /lacks complete downloaded GitHub run\/artifact provenance/);
const mismatchedArtifactDigest = JSON.parse(JSON.stringify(evidence));
mismatchedArtifactDigest.synthetics.alert_delivery.provenance.artifact_sha256 = "d".repeat(64);
assert.match(evaluatePhase5Evidence(policy, mismatchedArtifactDigest, { now }).blockers.join("\n"), /lacks complete downloaded GitHub run\/artifact provenance/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, pilot: { ...evidence.pilot, sessions: sessions.slice(0, 7) } }, { now }).blockers.join("\n"), /Pilot has 7\/8/);
assert.match(
  evaluatePhase5Evidence(policy, {
    ...evidence,
    pilot: { ...evidence.pilot, sessions: [...sessions, JSON.parse(JSON.stringify(sessions[0]))] }
  }, { now }).blockers.join("\n"),
  /Pilot has 9\/8 exact required sessions/
);
const mixedPathSessions = sessions.map((session, index) => index === 0 ? { ...session, path: "evm" } : session);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, pilot: { ...evidence.pilot, sessions: mixedPathSessions } }, { now }).blockers.join("\n"), /required DuskDS sessions|non-production path/);
const duplicateScenarioSession = JSON.parse(JSON.stringify(evidence));
duplicateScenarioSession.pilot.sessions[1].scenario_id = duplicateScenarioSession.pilot.sessions[0].scenario_id;
rewriteMachineReceipt(duplicateScenarioSession.pilot.sessions[1], (receipt) => {
  receipt.scenario = JSON.parse(JSON.stringify(receipt.scenario));
  receipt.scenario.id = duplicateScenarioSession.pilot.sessions[1].scenario_id;
});
assert.match(
  evaluatePhase5Evidence(policy, duplicateScenarioSession, { now }).blockers.join("\n"),
  /every exact required scenario once/
);
const macosWithoutActionsProvenance = JSON.parse(JSON.stringify(evidence));
const macosWithoutActionsSession = macosWithoutActionsProvenance.pilot.sessions.find(
  (session) => session.scenario_id === "macos-privilege-recovery"
);
macosWithoutActionsSession.run_url = null;
macosWithoutActionsSession.artifact_name = null;
macosWithoutActionsSession.provenance = null;
rewriteMachineReceipt(macosWithoutActionsSession, (receipt) => {
  receipt.github_actions_provenance_input = null;
});
assert.match(
  evaluatePhase5Evidence(policy, macosWithoutActionsProvenance, { now }).blockers.join("\n"),
  /lacks exact first-attempt GitHub Actions candidate provenance/
);
for (const field of ["capability", "failure_class"]) {
  const duplicateScenarioPolicy = JSON.parse(JSON.stringify(policy));
  duplicateScenarioPolicy.pilot.required_scenarios[1][field] =
    duplicateScenarioPolicy.pilot.required_scenarios[0][field];
  assert.match(
    evaluatePhase5Evidence(duplicateScenarioPolicy, evidence, { now }).blockers.join("\n"),
    new RegExp(field === "capability" ? "capabilities must be complete and unique" : "controlled-failure classes must be complete and unique")
  );
}
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
assert.match(evaluatePhase5Evidence(policy, { ...evidence, reviews: { ...reviews, companion_security: { ...reviews.companion_security, separate_agent: false } } }, { now }).blockers.join("\n"), /separate-agent challenge review companion_security/iu);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, reviews: { ...reviews, platform: { ...reviews.platform, reviewer_type: "human" } } }, { now }).blockers.join("\n"), /separate-agent challenge review platform/iu);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, reviews: { ...reviews, accessibility: { ...reviews.accessibility, external_independent: true } } }, { now }).blockers.join("\n"), /separate-agent challenge review accessibility/iu);
const repeatedReviewer = JSON.parse(JSON.stringify(evidence));
repeatedReviewer.reviews.accessibility.reviewer_identity = repeatedReviewer.reviews.platform.reviewer_identity;
assert.match(evaluatePhase5Evidence(policy, repeatedReviewer, { now }).blockers.join("\n"), /distinct Codex subagent identities/);
const repeatedReviewReference = JSON.parse(JSON.stringify(evidence));
repeatedReviewReference.reviews.accessibility.evidence_reference = ` ${repeatedReviewReference.reviews.platform.evidence_reference.toUpperCase()} `;
assert.match(evaluatePhase5Evidence(policy, repeatedReviewReference, { now }).blockers.join("\n"), /challenge reviews must use distinct evidence references/);
const ownerReviewer = JSON.parse(JSON.stringify(evidence));
ownerReviewer.reviews.companion_security.reviewer_identity = ownerReviewer.owners.security;
assert.match(evaluatePhase5Evidence(policy, ownerReviewer, { now }).blockers.join("\n"), /not a separately identified Codex subagent/);
const implementerReviewer = JSON.parse(JSON.stringify(evidence));
implementerReviewer.reviews.platform.reviewer_identity = implementerReviewer.candidate.implementation_identities[0];
assert.match(evaluatePhase5Evidence(policy, implementerReviewer, { now }).blockers.join("\n"), /not a separately identified Codex subagent/);
const wrongResponsibleOwner = JSON.parse(JSON.stringify(evidence));
wrongResponsibleOwner.owners.security = "Alice";
assert.match(evaluatePhase5Evidence(policy, wrongResponsibleOwner, { now }).blockers.join("\n"), /Responsible role security is not assigned to the declared human owner/);
const wrongSupportAssignment = JSON.parse(JSON.stringify(evidence));
wrongSupportAssignment.support.on_call_owner = "Invented support owner";
assert.match(
  evaluatePhase5Evidence(policy, wrongSupportAssignment, { now }).blockers.join("\n"),
  /Support\/on-call\/status communication assignments are not bound/
);
const unsafeReviewReference = JSON.parse(JSON.stringify(evidence));
unsafeReviewReference.reviews.accessibility.evidence_reference = "https://github.com/example/review?token=1";
assert.match(evaluatePhase5Evidence(policy, unsafeReviewReference, { now }).blockers.join("\n"), /safe redacted evidence reference/);
for (const unsafeReference of [
  " https://user:pass@example.com/review",
  "//user:pass@example.com/review",
  "file:///tmp/review.json",
  "C:\\Users\\Alice\\review.json",
  "\\\\server\\share\\review.json",
  "/tmp/review.json",
  "https://example.com/review?download=1",
  "https://example.com/review#finding"
]) {
  const bypassedReference = JSON.parse(JSON.stringify(evidence));
  bypassedReference.reviews.accessibility.evidence_reference = unsafeReference;
  assert.match(evaluatePhase5Evidence(policy, bypassedReference, { now }).blockers.join("\n"), /safe redacted evidence reference/);
}
const recoveryPhraseWithoutDelimiter = JSON.parse(JSON.stringify(evidence));
recoveryPhraseWithoutDelimiter.pilot.sessions[0].failure_scenario = "recovery phrase alpha beta gamma";
assert.match(evaluatePhase5Evidence(policy, recoveryPhraseWithoutDelimiter, { now }).blockers.join("\n"), /forbidden secret-shaped fields or values/);
const accessTokenValue = JSON.parse(JSON.stringify(evidence));
accessTokenValue.support.on_call_owner = "access token: ghp_abcdefghijklmnopqrstuvwxyz123456";
assert.match(evaluatePhase5Evidence(policy, accessTokenValue, { now }).blockers.join("\n"), /forbidden secret-shaped fields or values/);
for (const secretShapedValue of [
  `npm_${"a".repeat(36)}`,
  `github_pat_${"A1_".repeat(12)}`,
  `Bearer ${"b".repeat(32)}`,
  `Cookie: session=${"c".repeat(32)}`,
  `session_token=${"d".repeat(32)}`
]) {
  const secretShapedEvidence = JSON.parse(JSON.stringify(evidence));
  secretShapedEvidence.support.on_call_owner = secretShapedValue;
  assert.match(
    evaluatePhase5Evidence(policy, secretShapedEvidence, { now }).blockers.join("\n"),
    /forbidden secret-shaped fields or values/
  );
}
const embeddedCredentialedUrl = JSON.parse(JSON.stringify(evidence));
embeddedCredentialedUrl.support.on_call_owner = "reviewed at https://user:pass@example.com/evidence";
assert.match(evaluatePhase5Evidence(policy, embeddedCredentialedUrl, { now }).blockers.join("\n"), /forbidden secret-shaped fields or values/);
const oversizedEvidence = JSON.parse(JSON.stringify(evidence));
oversizedEvidence.oversized = "x".repeat(4_000_001);
assert.match(
  evaluatePhase5Evidence(policy, oversizedEvidence, { now }).blockers.join("\n"),
  /exceeds the reviewed size, depth, or collection boundary/
);
const deeplyNestedEvidence = JSON.parse(JSON.stringify(evidence));
deeplyNestedEvidence.deep = {};
let nestedCursor = deeplyNestedEvidence.deep;
for (let depth = 0; depth < 40; depth += 1) {
  nestedCursor.next = {};
  nestedCursor = nestedCursor.next;
}
assert.match(
  evaluatePhase5Evidence(policy, deeplyNestedEvidence, { now }).blockers.join("\n"),
  /exceeds the reviewed size, depth, or collection boundary/
);
const prebuildReview = JSON.parse(JSON.stringify(evidence));
prebuildReview.reviews.accessibility.reviewed_at = "2026-07-14T23:59:59Z";
assert.match(evaluatePhase5Evidence(policy, prebuildReview, { now }).blockers.join("\n"), /at or after the candidate build/);
const unboundReview = JSON.parse(JSON.stringify(evidence));
unboundReview.reviews.accessibility.candidate_commit = "d".repeat(40);
assert.match(evaluatePhase5Evidence(policy, unboundReview, { now }).blockers.join("\n"), /Separate-agent challenge review accessibility is not bound/);
const participantWithoutRecovery = JSON.parse(JSON.stringify(evidence));
participantWithoutRecovery.pilot.sessions[3].controlled_failure = false;
participantWithoutRecovery.pilot.sessions[3].recovered = false;
assert.match(evaluatePhase5Evidence(policy, participantWithoutRecovery, { now }).blockers.join("\n"), /Pilot session p4 lacks its own/);
const oneUnrecoveredPilot = JSON.parse(JSON.stringify(evidence));
oneUnrecoveredPilot.pilot.sessions[3].recovered = false;
assert.match(
  evaluatePhase5Evidence(policy, oneUnrecoveredPilot, { now }).blockers.join("\n"),
  /recovery rate 0\.88 is below 1/
);
const twoUnrecoveredPilots = JSON.parse(JSON.stringify(evidence));
twoUnrecoveredPilots.pilot.sessions[3].recovered = false;
twoUnrecoveredPilots.pilot.sessions[4].recovered = false;
assert.match(evaluatePhase5Evidence(policy, twoUnrecoveredPilots, { now }).blockers.join("\n"), /recovery rate 0.75 is below 1/);
const unboundPilot = JSON.parse(JSON.stringify(evidence));
unboundPilot.pilot.sessions[0].candidate_artifact_fingerprint_sha256 = "d".repeat(64);
assert.match(evaluatePhase5Evidence(policy, unboundPilot, { now }).blockers.join("\n"), /Pilot session p1 is not bound/);
const duplicateRecoveryReference = JSON.parse(JSON.stringify(evidence));
duplicateRecoveryReference.pilot.sessions[1].recovery_evidence_reference = `  ${duplicateRecoveryReference.pilot.sessions[0].recovery_evidence_reference.toUpperCase()}  `;
assert.match(evaluatePhase5Evidence(policy, duplicateRecoveryReference, { now }).blockers.join("\n"), /unique evidence reference/);
const duplicateSessionReference = JSON.parse(JSON.stringify(evidence));
duplicateSessionReference.pilot.sessions[1].session_record_reference = duplicateSessionReference.pilot.sessions[0].session_record_reference;
assert.match(evaluatePhase5Evidence(policy, duplicateSessionReference, { now }).blockers.join("\n"), /unique canonical session record reference/);
const reusedRecoveryAsSessionReference = JSON.parse(JSON.stringify(evidence));
reusedRecoveryAsSessionReference.pilot.sessions[1].session_record_reference = reusedRecoveryAsSessionReference.pilot.sessions[0].recovery_evidence_reference;
assert.match(evaluatePhase5Evidence(policy, reusedRecoveryAsSessionReference, { now }).blockers.join("\n"), /unique canonical session record reference/);
const mismatchedRecoveryDigestReference = JSON.parse(JSON.stringify(evidence));
mismatchedRecoveryDigestReference.pilot.sessions[0].recovery_evidence_reference =
  `agent-pilots/${mismatchedRecoveryDigestReference.pilot.sessions[0].scenario_id}/${"d".repeat(64)}.recovery.json`;
assert.match(
  evaluatePhase5Evidence(policy, mismatchedRecoveryDigestReference, { now }).blockers.join("\n"),
  /evidence references do not exact-match/
);
const mismatchedSessionDigestReference = JSON.parse(JSON.stringify(evidence));
mismatchedSessionDigestReference.pilot.sessions[0].session_record_reference =
  `agent-pilots/${mismatchedSessionDigestReference.pilot.sessions[0].scenario_id}/${"d".repeat(64)}.json`;
assert.match(
  evaluatePhase5Evidence(policy, mismatchedSessionDigestReference, { now }).blockers.join("\n"),
  /evidence references do not exact-match/
);
const unsafeSessionReference = JSON.parse(JSON.stringify(evidence));
unsafeSessionReference.pilot.sessions[0].session_record_reference = "C:\\Users\\Alice\\pilot.json";
assert.match(evaluatePhase5Evidence(policy, unsafeSessionReference, { now }).blockers.join("\n"), /canonical session/);
const mismatchedPilotDuration = JSON.parse(JSON.stringify(evidence));
mismatchedPilotDuration.pilot.sessions[0].duration_seconds = 19;
assert.match(evaluatePhase5Evidence(policy, mismatchedPilotDuration, { now }).blockers.join("\n"), /canonical session/);
const identifyingPilotId = JSON.parse(JSON.stringify(evidence));
identifyingPilotId.pilot.sessions[0].id = "alice@example.com";
assert.match(evaluatePhase5Evidence(policy, identifyingPilotId, { now }).blockers.join("\n"), /non-identifying pseudonymous id/);
const prebuildPilot = JSON.parse(JSON.stringify(evidence));
prebuildPilot.pilot.sessions[0].started_at = "2026-07-14T23:40:00Z";
prebuildPilot.pilot.sessions[0].completed_at = "2026-07-15T00:00:00Z";
assert.match(evaluatePhase5Evidence(policy, prebuildPilot, { now }).blockers.join("\n"), /Pilot session p1 start must be dated at or after/);
const invalidPilotScale = JSON.parse(JSON.stringify(evidence));
invalidPilotScale.pilot.sessions[0].agent_confidence_score = 6;
assert.match(evaluatePhase5Evidence(policy, invalidPilotScale, { now }).blockers.join("\n"), /1-5 informational agent-confidence evidence/);
const missingPilotReceipt = JSON.parse(JSON.stringify(evidence));
delete missingPilotReceipt.pilot.sessions[0].receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, missingPilotReceipt, { now }).blockers.join("\n"), /Pilot session p1 receipt bytes/);
const forgedPilotReceipt = JSON.parse(JSON.stringify(evidence));
forgedPilotReceipt.pilot.sessions[0].receipt_json =
  forgedPilotReceipt.pilot.sessions[0].receipt_json.replace('"redacted":true', '"redacted":false');
assert.match(evaluatePhase5Evidence(policy, forgedPilotReceipt, { now }).blockers.join("\n"), /Pilot session p1 receipt bytes/);
const oversizedPilotReceipt = JSON.parse(JSON.stringify(evidence));
oversizedPilotReceipt.pilot.sessions[0].receipt_json = "x".repeat(512_001);
oversizedPilotReceipt.pilot.sessions[0].receipt_sha256 = createHash("sha256")
  .update(oversizedPilotReceipt.pilot.sessions[0].receipt_json, "utf8")
  .digest("hex");
assert.match(evaluatePhase5Evidence(policy, oversizedPilotReceipt, { now }).blockers.join("\n"), /Pilot session p1 receipt bytes/);
const wrongPilotOperator = JSON.parse(JSON.stringify(evidence));
wrongPilotOperator.pilot.sessions[0].operator_type = "human";
rewriteMachineReceipt(wrongPilotOperator.pilot.sessions[0], (receipt) => { receipt.operator_type = "human"; });
assert.match(evaluatePhase5Evidence(policy, wrongPilotOperator, { now }).blockers.join("\n"), /required scenario, Codex operator/);
const wrongPilotPackageIntegrity = JSON.parse(JSON.stringify(evidence));
rewriteMachineReceipt(wrongPilotPackageIntegrity.pilot.sessions[0], (receipt) => {
  receipt.candidate.npm_integrity = `sha512-${Buffer.alloc(64, 0x43).toString("base64")}`;
});
assert.match(evaluatePhase5Evidence(policy, wrongPilotPackageIntegrity, { now }).blockers.join("\n"), /machine receipt does not exact-match/);
const wrongPilotPackageInventory = JSON.parse(JSON.stringify(evidence));
rewriteMachineReceipt(wrongPilotPackageInventory.pilot.sessions[0], (receipt) => {
  receipt.candidate.package_inventory_sha256 = "d".repeat(64);
});
assert.match(evaluatePhase5Evidence(policy, wrongPilotPackageInventory, { now }).blockers.join("\n"), /machine receipt does not exact-match/);
const wrongPilotReceiptCommit = JSON.parse(JSON.stringify(evidence));
rewriteMachineReceipt(wrongPilotReceiptCommit.pilot.sessions[0], (receipt) => {
  receipt.candidate.package_commit = "d".repeat(40);
});
assert.match(evaluatePhase5Evidence(policy, wrongPilotReceiptCommit, { now }).blockers.join("\n"), /machine receipt does not exact-match/);
const wrongPilotReceiptFingerprint = JSON.parse(JSON.stringify(evidence));
rewriteMachineReceipt(wrongPilotReceiptFingerprint.pilot.sessions[0], (receipt) => {
  receipt.candidate.phase5_artifact_fingerprint_sha256 = "d".repeat(64);
});
assert.match(evaluatePhase5Evidence(policy, wrongPilotReceiptFingerprint, { now }).blockers.join("\n"), /machine receipt does not exact-match/);
const mismatchedPilotPlanDigest = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(
  mismatchedPilotPlanDigest.pilot.sessions[0],
  (receipt) => { receipt.plan_sha256 = "d".repeat(64); },
  { rehashPlan: false }
);
assert.match(
  evaluatePhase5Evidence(policy, mismatchedPilotPlanDigest, { now }).blockers.join("\n"),
  /machine receipt does not exact-match/
);
const nonAllowlistedPilotCommand = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(nonAllowlistedPilotCommand.pilot.sessions[0], (receipt) => {
  const planStep = receipt.plan.steps.find((step) => step.kind === "command");
  const observation = receipt.execution.observations.find((entry) => entry.id === planStep.id);
  planStep.command = "powershell";
  observation.command = "powershell";
});
assert.match(
  evaluatePhase5Evidence(policy, nonAllowlistedPilotCommand, { now }).blockers.join("\n"),
  /embedded plan does not exactly bind/
);
const syntheticPilotCommand = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(syntheticPilotCommand.pilot.sessions[0], (receipt) => {
  const planStep = receipt.plan.steps.find((step) => step.kind === "command");
  const observation = receipt.execution.observations.find((entry) => entry.id === planStep.id);
  planStep.args = ["-e", "process.exitCode = 0"];
  observation.args = [...planStep.args];
});
assert.match(
  evaluatePhase5Evidence(policy, syntheticPilotCommand, { now }).blockers.join("\n"),
  /embedded plan does not exactly bind/
);
const unboundPilotCommandArguments = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(unboundPilotCommandArguments.pilot.sessions[0], (receipt) => {
  receipt.execution.observations.find((entry) => entry.kind === "command").args.push("--tampered");
});
assert.match(
  evaluatePhase5Evidence(policy, unboundPilotCommandArguments, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const unboundPilotCommandCwd = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(unboundPilotCommandCwd.pilot.sessions[0], (receipt) => {
  receipt.execution.observations.find((entry) => entry.kind === "command").cwd = "output";
});
assert.match(
  evaluatePhase5Evidence(policy, unboundPilotCommandCwd, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const failedSetupCommand = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(failedSetupCommand.pilot.sessions[0], (receipt) => {
  const setup = receipt.execution.observations.find(
    (observation) => observation.role === "setup"
  );
  setup.observed_outcome = "failure";
  setup.exit_code = 1;
});
assert.match(
  evaluatePhase5Evidence(policy, failedSetupCommand, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const nonCommandControlledFailure = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(nonCommandControlledFailure.pilot.sessions[0], (receipt) => {
  const observation = receipt.execution.observations.find((entry) => entry.role === "controlled-failure");
  observation.kind = "file-probe";
  delete observation.command;
  delete observation.args;
  delete observation.cwd;
  delete observation.signal;
  observation.artifact = { relative_path: "output/failure.txt", type: "file", bytes: 1 };
});
assert.match(
  evaluatePhase5Evidence(policy, nonCommandControlledFailure, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const failedRecoveryContract = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(failedRecoveryContract.pilot.sessions[0], (receipt) => {
  const recovery = receipt.execution.observations.find((entry) => entry.role === "recovery");
  recovery.expected_outcome = "failure";
});
assert.match(
  evaluatePhase5Evidence(policy, failedRecoveryContract, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const failedFinalContract = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(failedFinalContract.pilot.sessions[0], (receipt) => {
  const final = receipt.execution.observations.at(-1);
  final.observed_outcome = "failure";
  final.exit_code = 1;
});
assert.match(
  evaluatePhase5Evidence(policy, failedFinalContract, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const signalledPilotCommand = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(signalledPilotCommand.pilot.sessions[0], (receipt) => {
  receipt.execution.observations.find((entry) => entry.kind === "command").signal = "SIGTERM";
});
assert.match(
  evaluatePhase5Evidence(policy, signalledPilotCommand, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const unsafePilotProbePath = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(unsafePilotProbePath.pilot.sessions[0], (receipt) => {
  const planProbe = receipt.plan.steps.find((step) => step.kind === "file-probe");
  const observation = receipt.execution.observations.find((entry) => entry.id === planProbe.id);
  planProbe.path = "../private.txt";
  observation.artifact.relative_path = "../private.txt";
});
assert.match(
  evaluatePhase5Evidence(policy, unsafePilotProbePath, { now }).blockers.join("\n"),
  /embedded plan does not exactly bind|machine observations do not prove/
);
const impossiblePilotProbeType = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(impossiblePilotProbeType.pilot.sessions[0], (receipt) => {
  receipt.execution.observations.find((entry) => entry.kind === "file-probe").artifact.type = "symlink";
});
assert.match(
  evaluatePhase5Evidence(policy, impossiblePilotProbeType, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const impossiblePilotProbeBytes = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(impossiblePilotProbeBytes.pilot.sessions[0], (receipt) => {
  receipt.execution.observations.find((entry) => entry.kind === "file-probe").artifact.bytes = -1;
});
assert.match(
  evaluatePhase5Evidence(policy, impossiblePilotProbeBytes, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const unboundPilotHashProbe = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(unboundPilotHashProbe.pilot.sessions[0], (receipt) => {
  receipt.execution.observations.find((entry) => entry.kind === "hash-probe").artifact.sha256 = "d".repeat(64);
});
assert.match(
  evaluatePhase5Evidence(policy, unboundPilotHashProbe, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const forgedPilotObservationDuration = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(forgedPilotObservationDuration.pilot.sessions[0], (receipt) => {
  receipt.execution.observations[0].duration_ms += 1;
});
assert.match(
  evaluatePhase5Evidence(policy, forgedPilotObservationDuration, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const outsideSessionPilotObservation = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(outsideSessionPilotObservation.pilot.sessions[0], (receipt) => {
  receipt.execution.observations[0].started_at = "2026-07-15T01:09:59.000Z";
  receipt.execution.observations[0].duration_ms = 3_000;
});
assert.match(
  evaluatePhase5Evidence(policy, outsideSessionPilotObservation, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const overlappingPilotObservations = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(overlappingPilotObservations.pilot.sessions[0], (receipt) => {
  receipt.execution.observations[1].started_at = "2026-07-15T01:10:01.500Z";
  receipt.execution.observations[1].duration_ms = 2_500;
});
assert.match(
  evaluatePhase5Evidence(policy, overlappingPilotObservations, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const forgedEmptyOutputDigest = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(forgedEmptyOutputDigest.pilot.sessions[0], (receipt) => {
  receipt.execution.observations[0].stdout_sha256 = "d".repeat(64);
});
assert.match(
  evaluatePhase5Evidence(policy, forgedEmptyOutputDigest, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const duplicatePilotRecoveryIds = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(duplicatePilotRecoveryIds.pilot.sessions[0], (receipt) => {
  receipt.execution.recovery_step_ids.push(receipt.execution.recovery_step_ids[0]);
});
assert.match(
  evaluatePhase5Evidence(policy, duplicatePilotRecoveryIds, { now }).blockers.join("\n"),
  /machine observations do not prove/
);
const incoherentWindowsPrivilege = JSON.parse(JSON.stringify(evidence));
const windowsSession = incoherentWindowsPrivilege.pilot.sessions.find((session) => session.context === "windows");
rewritePilotMachineReceipt(windowsSession, (receipt) => { receipt.environment.privilege.level = "elevated"; });
assert.match(
  evaluatePhase5Evidence(policy, incoherentWindowsPrivilege, { now }).blockers.join("\n"),
  /coherent standard-privilege/
);
const incoherentPosixPrivilege = JSON.parse(JSON.stringify(evidence));
const posixSession = incoherentPosixPrivilege.pilot.sessions.find((session) => session.context === "linux");
rewritePilotMachineReceipt(posixSession, (receipt) => { receipt.environment.privilege.uid = 0; });
assert.match(
  evaluatePhase5Evidence(policy, incoherentPosixPrivilege, { now }).blockers.join("\n"),
  /coherent standard-privilege/
);
const incoherentWslIdentity = JSON.parse(JSON.stringify(evidence));
const wslSession = incoherentWslIdentity.pilot.sessions.find((session) => session.context === "wsl");
rewritePilotMachineReceipt(wslSession, (receipt) => {
  receipt.environment.os_version = "generic-linux-version";
  receipt.environment.os_release = "generic-linux-release";
});
assert.match(
  evaluatePhase5Evidence(policy, incoherentWslIdentity, { now }).blockers.join("\n"),
  /coherent standard-privilege/
);
const unsupportedPilotArchitecture = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(unsupportedPilotArchitecture.pilot.sessions[0], (receipt) => {
  receipt.environment.arch = "ia32";
});
assert.match(
  evaluatePhase5Evidence(policy, unsupportedPilotArchitecture, { now }).blockers.join("\n"),
  /coherent standard-privilege/
);
const forgedPilotEnvironmentIdentity = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(
  forgedPilotEnvironmentIdentity.pilot.sessions[0],
  (receipt) => { receipt.environment.environment_identity = `env-${"d".repeat(24)}`; },
  { rehashEnvironment: false }
);
assert.match(
  evaluatePhase5Evidence(policy, forgedPilotEnvironmentIdentity, { now }).blockers.join("\n"),
  /coherent standard-privilege/
);
const safeSriDoubleSlashText = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(safeSriDoubleSlashText.pilot.sessions[0], (receipt) => {
  receipt.environment.os_version = `sha512-${Buffer.alloc(64, 0xff).toString("base64")}`;
});
assert.deepEqual(
  evaluatePhase5Evidence(policy, safeSriDoubleSlashText, { now }).blockers,
  evaluatePhase5Evidence(policy, evidence, { now }).blockers
);
const standaloneProtocolRelativeUrl = JSON.parse(JSON.stringify(evidence));
rewritePilotMachineReceipt(standaloneProtocolRelativeUrl.pilot.sessions[0], (receipt) => {
  receipt.environment.os_version = "//untrusted.example/pilot";
});
assert.match(
  evaluatePhase5Evidence(policy, standaloneProtocolRelativeUrl, { now }).blockers.join("\n"),
  /parsed receipt contains forbidden secret-shaped or unsafe URL/
);
const unboundNativeSmoke = JSON.parse(JSON.stringify(evidence));
delete unboundNativeSmoke.live_smoke.receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, unboundNativeSmoke, { now }).blockers.join("\n"), /DuskDS production smoke receipt bytes/);
const forgedNativeReceipt = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedNativeReceipt.live_smoke, (receipt) => { receipt.candidate_commit = "d".repeat(40); });
assert.match(evaluatePhase5Evidence(policy, forgedNativeReceipt, { now }).blockers.join("\n"), /receipt does not prove the exact candidate/);
const nativeWithoutArtifactHash = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(nativeWithoutArtifactHash.live_smoke, (receipt) => { receipt.contract_sha256 = "pending"; });
assert.match(evaluatePhase5Evidence(policy, nativeWithoutArtifactHash, { now }).blockers.join("\n"), /receipt does not prove the exact candidate, workflow, timestamp, and native steps/);
const nativeWithoutCandidateFingerprint = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(nativeWithoutCandidateFingerprint.live_smoke, (receipt) => { receipt.candidate_artifact_fingerprint_sha256 = "d".repeat(64); });
assert.match(evaluatePhase5Evidence(policy, nativeWithoutCandidateFingerprint, { now }).blockers.join("\n"), /receipt does not prove the exact candidate/);
const prebuildNativeSmoke = JSON.parse(JSON.stringify(evidence));
prebuildNativeSmoke.live_smoke.observed_at = "2026-07-14T23:59:59Z";
rewriteReceipt(prebuildNativeSmoke.live_smoke, (receipt) => { receipt.observed_at = prebuildNativeSmoke.live_smoke.observed_at; });
assert.match(evaluatePhase5Evidence(policy, prebuildNativeSmoke, { now }).blockers.join("\n"), /production smoke must be dated at or after/);
const missingDevelopmentPort = JSON.parse(JSON.stringify(evidence));
delete missingDevelopmentPort.synthetics.checks.development_port_closed;
assert.match(evaluatePhase5Evidence(policy, missingDevelopmentPort, { now }).blockers.join("\n"), /development_port_closed/);
const unboundPublicSynthetic = JSON.parse(JSON.stringify(evidence));
unboundPublicSynthetic.synthetics.checks.key_routes.candidate_public_fingerprint_sha256 = "d".repeat(64);
assert.match(evaluatePhase5Evidence(policy, unboundPublicSynthetic, { now }).blockers.join("\n"), /Synthetic check key_routes is not bound/);
const missingPublicSyntheticReceipt = JSON.parse(JSON.stringify(evidence));
delete missingPublicSyntheticReceipt.synthetics.public_assurance.receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, missingPublicSyntheticReceipt, { now }).blockers.join("\n"), /Public assurance receipt bytes/);
const failedBoundPublicCheck = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(failedBoundPublicCheck.synthetics.public_assurance, (receipt) => { receipt.checks.key_routes.status = "failed"; });
assert.match(evaluatePhase5Evidence(policy, failedBoundPublicCheck, { now }).blockers.join("\n"), /Synthetic check key_routes is not passed in the bound/);
const forgedPublicCommit = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedPublicCommit.synthetics.public_assurance, (receipt) => { receipt.checks.release_parity.commit = "d".repeat(40); });
assert.match(evaluatePhase5Evidence(policy, forgedPublicCommit, { now }).blockers.join("\n"), /does not prove the exact public candidate/);
const forgedPublicVersion = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedPublicVersion.synthetics.public_assurance, (receipt) => { receipt.checks.release_parity.version = "unbound-version"; });
assert.match(evaluatePhase5Evidence(policy, forgedPublicVersion, { now }).blockers.join("\n"), /does not prove the exact public candidate/);
const forgedSpaCache = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedSpaCache.synthetics.public_assurance, (receipt) => { receipt.checks.key_routes.spa_fallback_cache = "public,max-age=3600"; });
assert.match(evaluatePhase5Evidence(policy, forgedSpaCache, { now }).blockers.join("\n"), /exact no-cache SPA fallback/);
const forgedRpcDegradation = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedRpcDegradation.synthetics.public_assurance, (receipt) => { receipt.checks.rpc_degradation.evidence = "operator-said-ok"; });
assert.match(evaluatePhase5Evidence(policy, forgedRpcDegradation, { now }).blockers.join("\n"), /reviewed hosted-browser recovery behavior/);
const forgedTlsLifetime = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedTlsLifetime.synthetics.public_assurance, (receipt) => { receipt.checks.tls_expiry.days_remaining = 1; });
assert.match(evaluatePhase5Evidence(policy, forgedTlsLifetime, { now }).blockers.join("\n"), /minimum lifetime and expiry chronology/);
const forgedTlsExpiry = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedTlsExpiry.synthetics.public_assurance, (receipt) => { receipt.checks.tls_expiry.expires_at = "2026-07-14T00:00:00Z"; });
assert.match(evaluatePhase5Evidence(policy, forgedTlsExpiry, { now }).blockers.join("\n"), /minimum lifetime and expiry chronology/);
const forgedClosedPort = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedClosedPort.synthetics.public_assurance, (receipt) => { receipt.checks.companion_port_closed.observed = "open"; });
assert.match(evaluatePhase5Evidence(policy, forgedClosedPort, { now }).blockers.join("\n"), /accepted closed-port observation/);
const secretInParsedReceipt = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(secretInParsedReceipt.synthetics.public_assurance, (receipt) => { receipt.checks.rpc_degradation.evidence = "recovery phrase: alpha beta gamma"; });
assert.match(evaluatePhase5Evidence(policy, secretInParsedReceipt, { now }).blockers.join("\n"), /parsed receipt contains forbidden secret-shaped/);
const unsafeUrlInParsedReceipt = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(unsafeUrlInParsedReceipt.synthetics.public_assurance, (receipt) => { receipt.target = "https://user:pass@studio.134-122-59-217.nip.io?proof=1"; });
assert.match(evaluatePhase5Evidence(policy, unsafeUrlInParsedReceipt, { now }).blockers.join("\n"), /parsed receipt contains forbidden secret-shaped or unsafe URL/);
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
assert.match(evaluatePhase5Evidence(policy, unboundHeartbeat, { now }).blockers.join("\n"), /Monitor heartbeat receipt bytes/);
const heartbeatForAnotherRun = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(heartbeatForAnotherRun.synthetics.checks.monitor_heartbeat, (receipt) => {
  receipt.last_run_url = "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/999999";
});
assert.match(evaluatePhase5Evidence(policy, heartbeatForAnotherRun, { now }).blockers.join("\n"), /does not prove a fresh successful scheduled run/);
const heartbeatBeforePublicAssurance = JSON.parse(JSON.stringify(evidence));
heartbeatBeforePublicAssurance.synthetics.checks.monitor_heartbeat.observed_at = "2026-07-15T02:30:00Z";
rewriteReceipt(heartbeatBeforePublicAssurance.synthetics.checks.monitor_heartbeat, (receipt) => {
  receipt.checked_at = "2026-07-15T02:30:00Z";
});
assert.match(evaluatePhase5Evidence(policy, heartbeatBeforePublicAssurance, { now }).blockers.join("\n"), /does not prove a fresh successful scheduled run/);
const nonCanonicalHeartbeatCreation = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(nonCanonicalHeartbeatCreation.synthetics.checks.monitor_heartbeat, (receipt) => {
  receipt.last_run_created_at = "2026-07-15T03:00:00+00:00";
});
assert.match(evaluatePhase5Evidence(policy, nonCanonicalHeartbeatCreation, { now }).blockers.join("\n"), /does not prove a fresh successful scheduled run/);
const heartbeatBeforeVerifiedCompletion = JSON.parse(JSON.stringify(evidence));
heartbeatBeforeVerifiedCompletion.synthetics.checks.monitor_heartbeat.observed_at = "2026-07-15T03:02:00Z";
rewriteReceipt(heartbeatBeforeVerifiedCompletion.synthetics.checks.monitor_heartbeat, (receipt) => {
  receipt.checked_at = "2026-07-15T03:02:00Z";
  receipt.age_seconds = 120;
});
assert.match((await formalDecision(policy, heartbeatBeforeVerifiedCompletion)).blockers.join("\n"), /predates the verified public-assurance run completion/);
const legacyAlertBoolean = JSON.parse(JSON.stringify(evidence));
delete legacyAlertBoolean.synthetics.alert_delivery;
legacyAlertBoolean.synthetics.alert_delivery_verified = true;
assert.match(evaluatePhase5Evidence(policy, legacyAlertBoolean, { now }).blockers.join("\n"), /Synthetic alert delivery lacks/);
const unboundAlert = JSON.parse(JSON.stringify(evidence));
unboundAlert.synthetics.alert_delivery.candidate_commit = "d".repeat(40);
assert.match(evaluatePhase5Evidence(policy, unboundAlert, { now }).blockers.join("\n"), /Synthetic alert delivery is not bound/);
const alertWithoutClosedIssue = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(alertWithoutClosedIssue.synthetics.alert_delivery, (receipt) => { receipt.issue_closed = false; });
assert.match(evaluatePhase5Evidence(policy, alertWithoutClosedIssue, { now }).blockers.join("\n"), /does not prove the exact candidate, workflow run, assigned issue, closure/);
const alertForAnotherCandidate = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(alertForAnotherCandidate.synthetics.alert_delivery, (receipt) => { receipt.candidate_public_fingerprint_sha256 = "d".repeat(64); });
assert.match(evaluatePhase5Evidence(policy, alertForAnotherCandidate, { now }).blockers.join("\n"), /does not prove the exact candidate/);
const wrongMonitoringMode = JSON.parse(JSON.stringify(evidence));
wrongMonitoringMode.synthetics.monitoring.mode = "external";
assert.match(evaluatePhase5Evidence(policy, wrongMonitoringMode, { now }).blockers.join("\n"), /reviewed monitoring mode/);
const missingAcceptedRisk = JSON.parse(JSON.stringify(policy));
delete missingAcceptedRisk.monitoring_evidence.accepted_risk;
assert.match(evaluatePhase5Evidence(missingAcceptedRisk, evidence, { now }).blockers.join("\n"), /accepted-risk record/);
const futureAcceptedRisk = JSON.parse(JSON.stringify(policy));
futureAcceptedRisk.monitoring_evidence.accepted_risk.accepted_at = "2099-01-01T00:00:00Z";
assert.match(evaluatePhase5Evidence(futureAcceptedRisk, evidence, { now }).blockers.join("\n"), /accepted-risk record/);
const acceptedRiskAfterSignoff = JSON.parse(JSON.stringify(policy));
acceptedRiskAfterSignoff.monitoring_evidence.accepted_risk.accepted_at = "2026-07-15T07:30:00Z";
assert.match(evaluatePhase5Evidence(acceptedRiskAfterSignoff, evidence, { now }).blockers.join("\n"), /no earlier than every gating record/);
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
  candidate_commit: candidateCommit,
  candidate_public_fingerprint_sha256: digest,
  evidence_reference: "external-dead-man-receipt",
  outside_github: true,
  success_endpoint_configured: true,
  provider: "external-dead-man-provider",
  check_id: "studio-public-staging",
  alert_channel: "email",
  alert_delivery_verified: true,
  latest_success_at: "2026-07-15T11:00:00Z",
  missed_ping_rehearsed_at: "2026-07-15T08:00:00Z",
  rehearsal_reference: "external-rehearsal-2026-07-10"
};
externalEvidence.synthetics.checks.external_direct_health = {
  status: "passed",
  owner: "platform-owner",
  candidate_commit: candidateCommit,
  candidate_public_fingerprint_sha256: digest,
  evidence_reference: "external-direct-health-receipt",
  outside_github: true,
  provider: "external-uptime-provider",
  check_id: "studio-public-health",
  target_url: "https://studio.134-122-59-217.nip.io/healthz",
  response_status: 200,
  body_match: "ok",
  tls_verified: true,
  alert_channel: "email",
  alert_delivery_verified: true,
  latest_success_at: "2026-07-15T11:00:00Z",
  alert_rehearsed_at: "2026-07-15T08:30:00Z",
  recovery_verified: true,
  recovered_at: "2026-07-15T09:00:00Z",
  rehearsal_reference: "direct-health-rehearsal-2026-07-10"
};
externalEvidence.product_signoff.signed_at = "2026-07-15T11:30:00Z";
assert.equal((await formalDecision(externalPolicy, externalEvidence)).decision, "go");
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
const unboundRollback = JSON.parse(JSON.stringify(evidence));
unboundRollback.rollback.product.candidate_commit = "d".repeat(40);
assert.match(evaluatePhase5Evidence(policy, unboundRollback, { now }).blockers.join("\n"), /product rollback is not bound/);
const missingRollbackReceipt = JSON.parse(JSON.stringify(evidence));
delete missingRollbackReceipt.rollback.product.receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, missingRollbackReceipt, { now }).blockers.join("\n"), /product rollback receipt bytes/);
const tamperedRollbackReceipt = JSON.parse(JSON.stringify(evidence));
tamperedRollbackReceipt.rollback.product.receipt_json = tamperedRollbackReceipt.rollback.product.receipt_json.replace("rollback-product", "rollback-forged");
assert.match(evaluatePhase5Evidence(policy, tamperedRollbackReceipt, { now }).blockers.join("\n"), /product rollback receipt bytes/);
const wrongRollbackTarget = JSON.parse(JSON.stringify(evidence));
wrongRollbackTarget.rollback.product.target = "platform";
rewriteReceipt(wrongRollbackTarget.rollback.product, (receipt) => { receipt.target = "platform"; });
assert.match(evaluatePhase5Evidence(policy, wrongRollbackTarget, { now }).blockers.join("\n"), /product rollback has not passed/);
const wrongRollbackPriorCommit = JSON.parse(JSON.stringify(evidence));
wrongRollbackPriorCommit.rollback.product.prior_commit = candidateCommit;
rewriteReceipt(wrongRollbackPriorCommit.rollback.product, (receipt) => { receipt.prior_commit = candidateCommit; });
assert.match(evaluatePhase5Evidence(policy, wrongRollbackPriorCommit, { now }).blockers.join("\n"), /incomplete or not a distinct dated restore/);
const wrongRollbackRelease = JSON.parse(JSON.stringify(evidence));
wrongRollbackRelease.rollback.product.candidate_release_id = "unbound-release";
rewriteReceipt(wrongRollbackRelease.rollback.product, (receipt) => { receipt.candidate_release_id = "unbound-release"; });
assert.match(evaluatePhase5Evidence(policy, wrongRollbackRelease, { now }).blockers.join("\n"), /incomplete or not a distinct dated restore/);
const noOpRollback = JSON.parse(JSON.stringify(evidence));
noOpRollback.rollback.platform.restored_fingerprint_sha256 = digest;
assert.match(evaluatePhase5Evidence(policy, noOpRollback, { now }).blockers.join("\n"), /platform rollback evidence is incomplete or not a distinct dated restore/);
const prebuildRollback = JSON.parse(JSON.stringify(evidence));
prebuildRollback.rollback.product.started_at = "2026-07-14T23:58:20Z";
prebuildRollback.rollback.product.completed_at = "2026-07-15T00:00:00Z";
rewriteReceipt(prebuildRollback.rollback.product, (receipt) => {
  receipt.started_at = prebuildRollback.rollback.product.started_at;
  receipt.completed_at = prebuildRollback.rollback.product.completed_at;
});
assert.match(evaluatePhase5Evidence(policy, prebuildRollback, { now }).blockers.join("\n"), /product rollback start must be dated at or after/);
const reusedRollbackReference = JSON.parse(JSON.stringify(evidence));
reusedRollbackReference.rollback.platform.evidence_reference = ` ${reusedRollbackReference.rollback.product.evidence_reference.toUpperCase()} `;
assert.match(evaluatePhase5Evidence(policy, reusedRollbackReference, { now }).blockers.join("\n"), /must use distinct evidence and health references/);
const reusedRollbackHealthProof = JSON.parse(JSON.stringify(evidence));
reusedRollbackHealthProof.rollback.platform.health_proof = reusedRollbackHealthProof.rollback.product.health_proof;
assert.match(evaluatePhase5Evidence(policy, reusedRollbackHealthProof, { now }).blockers.join("\n"), /must use distinct evidence and health references/);
const negativeRollbackDuration = JSON.parse(JSON.stringify(evidence));
negativeRollbackDuration.rollback.product.duration_seconds = -1;
assert.match(evaluatePhase5Evidence(policy, negativeRollbackDuration, { now }).blockers.join("\n"), /product rollback has not passed/);
const mismatchedRollbackDuration = JSON.parse(JSON.stringify(evidence));
mismatchedRollbackDuration.rollback.product.duration_seconds = 99;
rewriteReceipt(mismatchedRollbackDuration.rollback.product, (receipt) => { receipt.duration_seconds = 99; });
assert.match(evaluatePhase5Evidence(policy, mismatchedRollbackDuration, { now }).blockers.join("\n"), /product rollback has not passed/);
const reversedRollbackChronology = JSON.parse(JSON.stringify(evidence));
reversedRollbackChronology.rollback.product.started_at = "2026-07-15T06:01:00Z";
rewriteReceipt(reversedRollbackChronology.rollback.product, (receipt) => { receipt.started_at = "2026-07-15T06:01:00Z"; });
assert.match(evaluatePhase5Evidence(policy, reversedRollbackChronology, { now }).blockers.join("\n"), /rollback chronology is invalid/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, issues: [{ id: "P1-1", severity: "P1", status: "open" }] }, { now }).blockers.join("\n"), /no complete exception/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, issues: [{ id: "P0-pending", severity: "P0", status: "pending" }] }, { now }).blockers.join("\n"), /invalid status[\s\S]*Non-closed P0/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, issues: [{ id: "P1-pending", severity: "P1", status: "pending" }] }, { now }).blockers.join("\n"), /invalid status[\s\S]*no complete exception/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, issues: [{ id: "bad-severity", severity: "critical", status: "closed" }] }, { now }).blockers.join("\n"), /invalid severity/);
assert.match(evaluatePhase5Evidence(policy, { ...evidence, issues: [{ id: "P0-closed-incomplete", severity: "P0", status: "closed" }] }, { now }).blockers.join("\n"), /missing: owner, resolution_evidence, closed_at, candidate_commit, candidate_artifact_fingerprint_sha256/);
const closedP0 = JSON.parse(JSON.stringify(evidence));
closedP0.issues = [{
  id: "P0-closed",
  severity: "P0",
  status: "closed",
  owner: "security-owner",
  resolution_evidence: "p0-closed-review",
  closed_at: "2026-07-15T06:45:00Z",
  candidate_commit: candidateCommit,
  candidate_artifact_fingerprint_sha256: digest
}];
assert.equal((await formalDecision(policy, closedP0)).decision, "go");
const closedP0WrongCandidate = JSON.parse(JSON.stringify(closedP0));
closedP0WrongCandidate.issues[0].candidate_commit = "d".repeat(40);
assert.match(evaluatePhase5Evidence(policy, closedP0WrongCandidate, { now }).blockers.join("\n"), /Closed P0 P0-closed is not bound/);
const prebuildClosedP0 = JSON.parse(JSON.stringify(closedP0));
prebuildClosedP0.issues[0].closed_at = "2026-07-14T23:59:59Z";
assert.match(evaluatePhase5Evidence(policy, prebuildClosedP0, { now }).blockers.join("\n"), /Closed P0 P0-closed must be dated at or after/);
const exceptedP1 = JSON.parse(JSON.stringify(evidence));
exceptedP1.issues = [{
  id: "P1-excepted",
  severity: "P1",
  status: "open",
  exception: {
    owner: "security-owner",
    rationale: "bounded launch exception",
    compensating_control: "route remains disabled",
    residual_risk: "manual follow-up required",
    monitoring: "assigned issue",
    expiry: "2026-07-30T00:00:00Z",
    revalidation_trigger: "route activation",
    accepted_by: "George",
    accepted_at: "2026-07-15T06:45:00Z"
  }
}];
assert.equal((await formalDecision(policy, exceptedP1)).decision, "go");
const exceptionAfterSignoff = JSON.parse(JSON.stringify(exceptedP1));
exceptionAfterSignoff.issues[0].exception.accepted_at = "2026-07-15T08:00:00Z";
assert.match(evaluatePhase5Evidence(policy, exceptionAfterSignoff, { now }).blockers.join("\n"), /no earlier than every gating record/);
const legacyDistribution = { ...evidence, companion_distribution: { availability: "native-downloads" } };
assert.match(evaluatePhase5Evidence(policy, legacyDistribution, { now }).blockers.join("\n"), /unknown: companion_distribution/);
const wrongNpmPackage = JSON.parse(JSON.stringify(evidence));
wrongNpmPackage.npm_distribution.package_name = "@georgiandusk/studio";
assert.match(evaluatePhase5Evidence(policy, wrongNpmPackage, { now }).blockers.join("\n"), /exact approved public package/);
const invalidNpmIntegrity = JSON.parse(JSON.stringify(evidence));
invalidNpmIntegrity.npm_distribution.integrity = "sha512-invalid";
assert.match(evaluatePhase5Evidence(policy, invalidNpmIntegrity, { now }).blockers.join("\n"), /exact approved public package/);
const missingNpmPlatform = JSON.parse(JSON.stringify(evidence));
delete missingNpmPlatform.npm_distribution.platform_smoke["macos-15"];
assert.match(evaluatePhase5Evidence(policy, missingNpmPlatform, { now }).blockers.join("\n"), /npm platform-smoke evidence fields are invalid/);
const mismatchedNpmPlatform = JSON.parse(JSON.stringify(evidence));
mismatchedNpmPlatform.npm_distribution.platform_smoke["windows-2025"].integrity = `sha512-${Buffer.alloc(64, 0x43).toString("base64")}`;
assert.match(evaluatePhase5Evidence(policy, mismatchedNpmPlatform, { now }).blockers.join("\n"), /required lifecycle checks/);
for (const field of [
  "install_smoke",
  "safe_smoke",
  "local_actions_capability_contract_smoke",
  "direct_cli_scaffold_smoke",
  "local_actions_scaffold_smoke",
  "scaffold_preservation_smoke",
  "shutdown_smoke",
  "cleanup_smoke",
  "elevated_refusal"
]) {
  const failedPlatformProof = JSON.parse(JSON.stringify(evidence));
  failedPlatformProof.npm_distribution.platform_smoke["windows-2025"][field] = "failed";
  assert.match(
    evaluatePhase5Evidence(policy, failedPlatformProof, { now }).blockers.join("\n"),
    /required lifecycle checks/,
    field
  );
}
const wrongPlatformSchema = JSON.parse(JSON.stringify(evidence));
wrongPlatformSchema.npm_distribution.platform_smoke["macos-15"].schema_version = 1;
assert.match(
  evaluatePhase5Evidence(policy, wrongPlatformSchema, { now }).blockers.join("\n"),
  /required lifecycle checks/
);
for (const [field, value] of [
  ["local_actions_preflight_verified", false],
  ["local_actions_preflight_loopback_services_stopped", false],
  ["local_actions_preflight_check_id", "invalid value"],
  ["local_actions_preflight_consumer_contract_source_sha256", "invalid"],
  ["package_file_count", npmPackageFileCount + 1]
]) {
  const invalidPlatformProof = JSON.parse(JSON.stringify(evidence));
  invalidPlatformProof.npm_distribution.platform_smoke["windows-2025"][field] = value;
  assert.match(
    evaluatePhase5Evidence(policy, invalidPlatformProof, { now }).blockers.join("\n"),
    /required lifecycle checks/,
    field
  );
}
const expandedPlatformProof = JSON.parse(JSON.stringify(evidence));
expandedPlatformProof.npm_distribution.platform_smoke["ubuntu-24.04"].unexpected = true;
assert.match(
  evaluatePhase5Evidence(policy, expandedPlatformProof, { now }).blockers.join("\n"),
  /npm platform smoke ubuntu-24\.04 fields are invalid/
);
const missingNpmAssuranceReceipt = JSON.parse(JSON.stringify(evidence));
delete missingNpmAssuranceReceipt.npm_distribution.assurance.receipt_sha256;
assert.match(evaluatePhase5Evidence(policy, missingNpmAssuranceReceipt, { now }).blockers.join("\n"), /npm assurance receipt bytes/);
const forgedNpmAssurance = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(forgedNpmAssurance.npm_distribution.assurance, (receipt) => {
  receipt.evidence_payload.native_ci_evidence.platform_smoke["macos-15"].safe_smoke = "failed";
});
assert.match(evaluatePhase5Evidence(policy, forgedNpmAssurance, { now }).blockers.join("\n"), /current first-attempt main-push package/);
const missingBrowserBootAndPairing = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(missingBrowserBootAndPairing.npm_distribution.assurance, (receipt) => {
  delete receipt.evidence_payload.native_ci_evidence.browser_boot_and_pairing_smoke;
});
assert.match(evaluatePhase5Evidence(policy, missingBrowserBootAndPairing, { now }).blockers.join("\n"), /current first-attempt main-push package/);
const failedBrowserBootAndPairing = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(failedBrowserBootAndPairing.npm_distribution.assurance, (receipt) => {
  receipt.evidence_payload.native_ci_evidence.browser_boot_and_pairing_smoke = "failed";
});
assert.match(evaluatePhase5Evidence(policy, failedBrowserBootAndPairing, { now }).blockers.join("\n"), /current first-attempt main-push package/);
const obsoleteFlatAssurance = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(obsoleteFlatAssurance.npm_distribution.assurance, (receipt) => {
  for (const key of Object.keys(receipt)) delete receipt[key];
  Object.assign(receipt, {
    schema_version: 2,
    status: "passed",
    package_name: policy.npm_distribution.package_name,
    package_version: "1.0.1",
    platform_smoke: npmPlatformSmoke
  });
});
assert.match(
  evaluatePhase5Evidence(policy, obsoleteFlatAssurance, { now }).blockers.join("\n"),
  /npm assurance receipt JSON fields are invalid/
);
const workflowDispatchAssurance = JSON.parse(JSON.stringify(evidence));
workflowDispatchAssurance.npm_distribution.assurance.provenance.run_event = "workflow_dispatch";
rewriteReceipt(workflowDispatchAssurance.npm_distribution.assurance, (receipt) => {
  receipt.github_actions_provenance.run_event = "workflow_dispatch";
});
assert.match(
  evaluatePhase5Evidence(policy, workflowDispatchAssurance, { now }).blockers.join("\n"),
  /current first-attempt main-push package|lacks complete downloaded GitHub/
);
const internallyRehashedNestedMismatch = JSON.parse(JSON.stringify(evidence));
rewriteCurrentAssuranceReceipt(internallyRehashedNestedMismatch.npm_distribution.assurance, (receipt) => {
  receipt.evidence_payload.native_ci_evidence.platform_smoke["macos-15"].cleanup_smoke = "failed";
});
assert.match(
  evaluatePhase5Evidence(policy, internallyRehashedNestedMismatch, { now }).blockers.join("\n"),
  /current first-attempt main-push package/
);
const recordPayloadDivergence = JSON.parse(JSON.stringify(evidence));
rewriteCurrentAssuranceReceipt(recordPayloadDivergence.npm_distribution.assurance, (receipt) => {
  receipt.record.package_file_count += 1;
});
assert.match(
  evaluatePhase5Evidence(policy, recordPayloadDivergence, { now }).blockers.join("\n"),
  /current first-attempt main-push package/
);
for (const [field, value] of [
  ["run_event", "workflow_dispatch"],
  ["run_ref", "refs/heads/feature"],
  ["job_name", "different-job"],
  ["artifact_name", "studio-npm-assurance-receipt-123459.json"]
]) {
  const invalidInnerProvenance = JSON.parse(JSON.stringify(evidence));
  rewriteCurrentAssuranceReceipt(invalidInnerProvenance.npm_distribution.assurance, (receipt) => {
    receipt.github_actions_provenance[field] = value;
  });
  assert.match(
    evaluatePhase5Evidence(policy, invalidInnerProvenance, { now }).blockers.join("\n"),
    /current first-attempt main-push package/,
    field
  );
}
const invalidInnerArtifactDigest = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(invalidInnerArtifactDigest.npm_distribution.assurance, (receipt) => {
  receipt.github_actions_provenance.artifact_digest_sha256 = "0".repeat(64);
});
assert.match(
  evaluatePhase5Evidence(policy, invalidInnerArtifactDigest, { now }).blockers.join("\n"),
  /current first-attempt main-push package/
);
const wrongPublicationTag = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(wrongPublicationTag.npm_distribution.publication, (receipt) => { receipt.tag = "v1.0.0"; });
assert.match(evaluatePhase5Evidence(policy, wrongPublicationTag, { now }).blockers.join("\n"), /exact-tag OIDC publication/);
const wrongPublicationWorkflow = JSON.parse(JSON.stringify(evidence));
wrongPublicationWorkflow.npm_distribution.publication.workflow_path = policy.npm_distribution.expected_initial_provenance_workflow;
assert.match(evaluatePhase5Evidence(policy, wrongPublicationWorkflow, { now }).blockers.join("\n"), /exact canonical Actions workflow and run/);
const wrongPublicationArtifact = JSON.parse(JSON.stringify(evidence));
wrongPublicationArtifact.npm_distribution.publication.artifact_name = "studio-npm-publication-receipt-123460.json";
assert.match(evaluatePhase5Evidence(policy, wrongPublicationArtifact, { now }).blockers.join("\n"), /artifact name is not bound/);
const wrongOidcAuthentication = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(wrongOidcAuthentication.npm_distribution.publication, (receipt) => {
  receipt.registry_authentication = policy.npm_distribution.initial_registry_authentication;
});
assert.match(evaluatePhase5Evidence(policy, wrongOidcAuthentication, { now }).blockers.join("\n"), /exact-tag OIDC publication/);
const wrongOidcPublisher = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(wrongOidcPublisher.npm_distribution.publication, (receipt) => {
  receipt.npm_publisher = "unexpected-publisher";
});
assert.match(evaluatePhase5Evidence(policy, wrongOidcPublisher, { now }).blockers.join("\n"), /exact-tag OIDC publication/);
const wrongTrustedPublisher = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(wrongTrustedPublisher.npm_distribution.publication, (receipt) => {
  receipt.trusted_publisher_id = "unexpected";
});
assert.match(evaluatePhase5Evidence(policy, wrongTrustedPublisher, { now }).blockers.join("\n"), /exact-tag OIDC publication/);
for (const [field, value] of [
  ["main_assurance_run_id", npmAssuranceRunId + 1],
  ["main_assurance_run_url", "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/999999"],
  ["main_assurance_run_attempt", 2],
  ["main_assurance_artifact_id", 0],
  ["main_assurance_artifact_name", "different.tgz"],
  ["main_assurance_artifact_digest_sha256", "0".repeat(64)],
  ["main_assurance_tarball_sha256", "0".repeat(64)],
  ["tag_assurance_tarball_sha256", "0".repeat(64)],
  ["prepublication_cross_run_byte_match", false]
]) {
  const invalidCrossRunPublication = JSON.parse(JSON.stringify(evidence));
  rewriteReceipt(invalidCrossRunPublication.npm_distribution.publication, (receipt) => {
    receipt[field] = value;
  });
  assert.match(
    evaluatePhase5Evidence(policy, invalidCrossRunPublication, { now }).blockers.join("\n"),
    /exact-tag OIDC publication/,
    field
  );
}
const wrongOidcProvenanceWorkflow = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(wrongOidcProvenanceWorkflow.npm_distribution.publication, (receipt) => {
  receipt.provenance_workflow = policy.npm_distribution.expected_initial_provenance_workflow;
});
assert.match(evaluatePhase5Evidence(policy, wrongOidcProvenanceWorkflow, { now }).blockers.join("\n"), /exact-tag OIDC publication/);
const idempotentOidcVerification = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(idempotentOidcVerification.npm_distribution.publication, (receipt) => {
  receipt.status = "verified-existing";
  receipt.registry_authentication = "not-used-idempotent-verification";
});
assert.equal((await formalDecision(policy, idempotentOidcVerification)).decision, "go");
const unverifiedPublishedPackage = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(unverifiedPublishedPackage.npm_distribution.publication, (receipt) => { receipt.provenance_verification = "registry-metadata-only"; });
assert.match(evaluatePhase5Evidence(policy, unverifiedPublishedPackage, { now }).blockers.join("\n"), /cryptographically verified provenance/);
const publicationBeforeAssurance = JSON.parse(JSON.stringify(evidence));
publicationBeforeAssurance.npm_distribution.publication.observed_at = "2026-07-15T06:35:00Z";
rewriteReceipt(publicationBeforeAssurance.npm_distribution.publication, (receipt) => { receipt.observed_at = "2026-07-15T06:35:00Z"; });
assert.match(evaluatePhase5Evidence(policy, publicationBeforeAssurance, { now }).blockers.join("\n"), /exact-tag OIDC publication/);
const unrevokedInitialToken = JSON.parse(JSON.stringify(evidence));
unrevokedInitialToken.npm_distribution.bootstrap_controls.token_revoked = false;
assert.match(evaluatePhase5Evidence(policy, unrevokedInitialToken, { now }).blockers.join("\n"), /bootstrap controls/);
const wrongBootstrapTag = JSON.parse(JSON.stringify(evidence));
wrongBootstrapTag.npm_distribution.bootstrap_controls.tag = policy.npm_distribution.tag;
assert.match(evaluatePhase5Evidence(policy, wrongBootstrapTag, { now }).blockers.join("\n"), /bootstrap controls/);
const missingInitialPublication = JSON.parse(JSON.stringify(evidence));
delete missingInitialPublication.npm_distribution.bootstrap_controls.initial_publication;
assert.match(
  evaluatePhase5Evidence(policy, missingInitialPublication, { now }).blockers.join("\n"),
  /initial publication/
);
const prematureInitialArtifactExpiryPolicy = JSON.parse(JSON.stringify(policy));
prematureInitialArtifactExpiryPolicy.npm_distribution.initial_publication_evidence.artifact_expires_at =
  "2026-07-14T06:44:00Z";
assert.match(
  evaluatePhase5Evidence(prematureInitialArtifactExpiryPolicy, evidence, { now }).blockers.join("\n"),
  /initial-publication policy evidence/
);
const forgedInitialPublication = JSON.parse(JSON.stringify(evidence));
rewriteReceipt(
  forgedInitialPublication.npm_distribution.bootstrap_controls.initial_publication,
  (receipt) => { receipt.package_inventory_sha256 = "0".repeat(64); }
);
assert.match(
  evaluatePhase5Evidence(policy, forgedInitialPublication, { now }).blockers.join("\n"),
  /preserved immutable 1\.0\.0 publication/
);
const wrongInitialPublicationRun = JSON.parse(JSON.stringify(evidence));
wrongInitialPublicationRun.npm_distribution.bootstrap_controls.initial_publication.run_url =
  "https://github.com/GeorgianDusk/dusk-developer-studio/actions/runs/999999";
assert.match(
  evaluatePhase5Evidence(policy, wrongInitialPublicationRun, { now }).blockers.join("\n"),
  /preserved immutable 1\.0\.0 publication/
);
const wrongInitialPublicationArtifact = JSON.parse(JSON.stringify(evidence));
wrongInitialPublicationArtifact.npm_distribution.bootstrap_controls.initial_publication.provenance.artifact_id = 998;
wrongInitialPublicationArtifact.npm_distribution.bootstrap_controls.initial_publication.provenance.artifact_api_url =
  "https://api.github.com/repos/GeorgianDusk/dusk-developer-studio/actions/artifacts/998";
assert.match(
  evaluatePhase5Evidence(policy, wrongInitialPublicationArtifact, { now }).blockers.join("\n"),
  /historical artifact ID/
);
const tokenRevokedBeforeInitialPublication = JSON.parse(JSON.stringify(evidence));
tokenRevokedBeforeInitialPublication.npm_distribution.bootstrap_controls.token_revoked_at =
  "2026-07-14T06:46:00Z";
assert.match(
  evaluatePhase5Evidence(policy, tokenRevokedBeforeInitialPublication, { now }).blockers.join("\n"),
  /bootstrap controls/
);
const controlsVerifiedBeforeInitialReceipt = JSON.parse(JSON.stringify(evidence));
controlsVerifiedBeforeInitialReceipt.npm_distribution.bootstrap_controls.verified_at =
  "2026-07-14T06:49:00Z";
assert.match(
  evaluatePhase5Evidence(policy, controlsVerifiedBeforeInitialReceipt, { now }).blockers.join("\n"),
  /bootstrap controls/
);
const retainedEnvironmentSecret = JSON.parse(JSON.stringify(evidence));
retainedEnvironmentSecret.npm_distribution.bootstrap_controls.environment_secret_removed = false;
assert.match(evaluatePhase5Evidence(policy, retainedEnvironmentSecret, { now }).blockers.join("\n"), /bootstrap controls/);
const missingTrustedPublisher = JSON.parse(JSON.stringify(evidence));
missingTrustedPublisher.npm_distribution.bootstrap_controls.trusted_publisher_configured = false;
assert.match(evaluatePhase5Evidence(policy, missingTrustedPublisher, { now }).blockers.join("\n"), /bootstrap controls/);
const selfVerifiedBootstrapControls = JSON.parse(JSON.stringify(evidence));
selfVerifiedBootstrapControls.npm_distribution.bootstrap_controls.verified_by = selfVerifiedBootstrapControls.candidate.implementation_identities[0];
assert.match(evaluatePhase5Evidence(policy, selfVerifiedBootstrapControls, { now }).blockers.join("\n"), /bootstrap controls/);
const reversedBootstrapChronology = JSON.parse(JSON.stringify(evidence));
reversedBootstrapChronology.npm_distribution.bootstrap_controls.token_revoked_at = "2026-07-14T06:41:00Z";
assert.match(evaluatePhase5Evidence(policy, reversedBootstrapChronology, { now }).blockers.join("\n"), /bootstrap controls/);
const reusedBootstrapEvidence = JSON.parse(JSON.stringify(evidence));
reusedBootstrapEvidence.npm_distribution.bootstrap_controls.environment_secret_removal_evidence_sha256 =
  reusedBootstrapEvidence.npm_distribution.bootstrap_controls.token_revocation_evidence_sha256;
assert.match(evaluatePhase5Evidence(policy, reusedBootstrapEvidence, { now }).blockers.join("\n"), /bootstrap controls/);
const forbiddenKey = ["private", "key"].join("_");
assert.match(evaluatePhase5Evidence(policy, { ...evidence, unsafe: { [forbiddenKey]: "redacted" } }, { now }).blockers.join("\n"), /forbidden secret-shaped fields/);
console.log("Phase 5 evidence go/no-go fixtures passed.");
