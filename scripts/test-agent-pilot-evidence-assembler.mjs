import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { URL } from "node:url";

import {
  assembleAgentPilotEvidence
} from "./assemble-agent-pilot-evidence.mjs";
import {
  buildCanonicalAgentPilotPlan,
  canonicalJson,
  canonicalSha256,
  canonicalPilotRecoveryMarker,
  verifyAgentPilotResult
} from "./agent-pilot-collector.mjs";
import { verifyGitHubActionsReceipt } from "./github-actions-provenance.mjs";

const EMPTY_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");
const repository = "GeorgianDusk/dusk-developer-studio";
const workflowPath = ".github/workflows/studio-npm-package-assurance.yml";
const runId = 987654321;
const token = "fixture-actions-read-token";
const now = new Date("2026-07-20T03:05:00.000Z");
const policy = JSON.parse(await readFile(new URL("../config/phase5-policy.json", import.meta.url), "utf8"));

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function makeCommandObservation(step, index) {
  const startedAt = new Date(Date.parse("2026-07-20T03:01:00.000Z") + index * 1_000);
  const completedAt = new Date(startedAt.getTime() + 1_000);
  const expectedOutcome = step.expect.outcome;
  return {
    id: step.id,
    role: step.role,
    kind: step.kind,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: 1_000,
    expected_outcome: expectedOutcome,
    observed_outcome: expectedOutcome,
    exit_code: expectedOutcome === "success" ? 0 : 7,
    stdout_bytes: 0,
    stdout_sha256: EMPTY_SHA256,
    stderr_bytes: 0,
    stderr_sha256: EMPTY_SHA256,
    passed: true,
    command: step.command,
    args: [...step.args],
    cwd: step.cwd,
    signal: null
  };
}

function makeProbeObservation(step, index, markerBytes) {
  const startedAt = new Date(Date.parse("2026-07-20T03:01:00.000Z") + index * 1_000);
  const completedAt = new Date(startedAt.getTime() + 1_000);
  const artifact = {
    relative_path: step.path,
    type: "file",
    bytes: markerBytes
  };
  if (step.kind === "hash-probe") artifact.sha256 = step.expected_digest;
  return {
    id: step.id,
    role: step.role,
    kind: step.kind,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: 1_000,
    expected_outcome: "success",
    observed_outcome: "success",
    exit_code: 0,
    stdout_bytes: 0,
    stdout_sha256: EMPTY_SHA256,
    stderr_bytes: 0,
    stderr_sha256: EMPTY_SHA256,
    passed: true,
    artifact
  };
}

function makeWrapper() {
  const scenario = policy.pilot.required_scenarios.find(
    (entry) => entry.id === "linux-port-conflict-recovery"
  );
  const candidateInput = {
    package_name: policy.npm_distribution.package_name,
    package_version: policy.npm_distribution.package_version,
    package_commit: "a".repeat(40),
    tarball_sha256: "b".repeat(64),
    npm_integrity: `sha512-${Buffer.alloc(64, 0x63).toString("base64")}`,
    package_inventory_sha256: "d".repeat(64),
    candidate_artifact_fingerprint_sha256: "e".repeat(64)
  };
  const plan = buildCanonicalAgentPilotPlan(
    policy,
    scenario.id,
    candidateInput
  );
  const markerBytes = Buffer.byteLength(canonicalPilotRecoveryMarker(scenario), "utf8");
  const observations = plan.steps.map((step, index) =>
    step.kind === "command"
      ? makeCommandObservation(step, index)
      : makeProbeObservation(step, index, markerBytes)
  );
  const privilege = {
    level: "standard",
    mechanism: "posix-euid",
    uid: 1000
  };
  const environmentInputs = {
    context: "linux",
    platform: "linux",
    os_version: "Linux 6.8.0",
    os_release: "6.8.0",
    arch: "x64",
    node_version: "v24.18.0",
    privilege
  };
  const environment = {
    ...environmentInputs,
    environment_identity: `env-${canonicalSha256(environmentInputs).slice(0, 24)}`
  };
  const artifactName = `studio-agent-pilot-${scenario.id}-${runId}.json`;
  const envelope = {
    schema_version: 1,
    repository,
    workflow_path: workflowPath,
    run_id: String(runId),
    run_attempt: 1,
    job_name: `agent-pilot-${scenario.id}`,
    event_name: "workflow_dispatch",
    ref: "refs/heads/main",
    sha: candidateInput.package_commit,
    artifact_name: artifactName
  };
  const receiptCandidate = {
    tarball_sha256: candidateInput.tarball_sha256,
    tarball_bytes: 1_234,
    npm_integrity: candidateInput.npm_integrity,
    package_inventory_sha256: candidateInput.package_inventory_sha256,
    package_file_count: 12,
    package_name: candidateInput.package_name,
    package_version: candidateInput.package_version,
    package_commit: candidateInput.package_commit,
    phase5_artifact_fingerprint_sha256:
      candidateInput.candidate_artifact_fingerprint_sha256
  };
  const execution = {
    started_at: "2026-07-20T03:01:00.000Z",
    completed_at: "2026-07-20T03:01:05.000Z",
    duration_seconds: 5,
    step_count: observations.length,
    controlled_failure_step_id: scenario.failure_class,
    recovery_step_ids: plan.steps
      .filter((step) => step.role === "recovery")
      .map((step) => step.id),
    final_verification_step_id: plan.final_verification_step_id,
    observations,
    raw_observation_bundle_sha256: canonicalSha256(observations)
  };
  const receipt = {
    schema_version: 1,
    evidence_class: "operator-attested-machine-collected",
    independent_execution: false,
    operator_type: policy.pilot.operator_type,
    operator_identity: policy.pilot.operator_identity,
    scenario: { ...scenario },
    invocation_id: "f".repeat(32),
    plan,
    plan_sha256: canonicalSha256(plan),
    collector: {
      path: "scripts/agent-pilot-collector.mjs",
      commit: candidateInput.package_commit,
      source_sha256: "1".repeat(64)
    },
    candidate: receiptCandidate,
    environment,
    execution,
    github_actions_provenance_input: envelope,
    redacted: true
  };
  const receiptJson = canonicalJson(receipt);
  const receiptSha256 = sha256(Buffer.from(receiptJson, "utf8"));
  const summary = {
    id: `${scenario.id}-${receipt.invocation_id.slice(0, 8)}`,
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
    started_at: execution.started_at,
    completed_at: execution.completed_at,
    candidate_commit: candidateInput.package_commit,
    candidate_artifact_fingerprint_sha256:
      candidateInput.candidate_artifact_fingerprint_sha256,
    agent_confidence_score: plan.agent_confidence_score,
    blocking_confusion: false,
    duration_seconds: execution.duration_seconds,
    recovery_evidence_reference:
      `agent-pilots/${scenario.id}/${execution.raw_observation_bundle_sha256}.recovery.json`,
    session_record_reference:
      `agent-pilots/${scenario.id}/${receiptSha256}.json`,
    receipt_sha256: receiptSha256,
    receipt_json: receiptJson,
    run_url: `https://github.com/${repository}/actions/runs/${runId}`,
    artifact_name: artifactName,
    provenance: null
  };
  const wrapper = {
    schema_version: 1,
    receipt,
    receipt_sha256: receiptSha256,
    phase5_embedding_summary: summary,
    github_actions_provenance_output: {
      schema_version: 1,
      mode: "github-actions-envelope",
      independently_verified: false,
      input_sha256: canonicalSha256(envelope),
      collector_receipt_sha256: receiptSha256,
      raw_observation_bundle_sha256: execution.raw_observation_bundle_sha256,
      candidate_commit: candidateInput.package_commit,
      tarball_sha256: candidateInput.tarball_sha256,
      invocation_id: receipt.invocation_id,
      run_url: summary.run_url,
      artifact_name: artifactName
    }
  };
  assert.equal(verifyAgentPilotResult(wrapper), true);
  return wrapper;
}

function apiFixture(wrapper, overrides = {}) {
  const summary = wrapper.phase5_embedding_summary;
  const receiptBytes = Buffer.from(summary.receipt_json, "utf8");
  const digest = sha256(receiptBytes);
  const artifactId = 24681012;
  const runApiUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  const artifactApiUrl =
    `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`;
  const artifactsUrl =
    `${runApiUrl}/artifacts?name=${encodeURIComponent(summary.artifact_name)}&per_page=100`;
  const signedUrl =
    `https://results-receiver.actions.githubusercontent.com/artifacts/${artifactId}?sig=fixture`;
  const run = {
    id: runId,
    url: runApiUrl,
    html_url: summary.run_url,
    artifacts_url: `${runApiUrl}/artifacts`,
    repository: { id: 12345, full_name: repository },
    head_repository: { id: 12345, full_name: repository },
    path: `${workflowPath}@refs/heads/main`,
    head_branch: "main",
    head_sha: summary.candidate_commit,
    status: "completed",
    conclusion: "success",
    event: "workflow_dispatch",
    run_attempt: 1,
    created_at: "2026-07-20T03:00:00.000Z",
    run_started_at: "2026-07-20T03:00:30.000Z",
    updated_at: "2026-07-20T03:02:00.000Z",
    ...overrides.run
  };
  const artifact = {
    id: artifactId,
    name: summary.artifact_name,
    url: artifactApiUrl,
    archive_download_url: `${artifactApiUrl}/zip`,
    expired: false,
    size_in_bytes: receiptBytes.length,
    digest: `sha256:${digest}`,
    created_at: "2026-07-20T03:01:10.000Z",
    expires_at: "2026-10-18T03:01:10.000Z",
    workflow_run: {
      id: runId,
      repository_id: 12345,
      head_repository_id: 12345,
      head_sha: summary.candidate_commit
    },
    ...overrides.artifact
  };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (url === runApiUrl) {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return globalThis.Response.json(run);
    }
    if (url === artifactsUrl) {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return globalThis.Response.json({ total_count: 1, artifacts: [artifact] });
    }
    if (url === artifact.archive_download_url) {
      assert.equal(options.headers.Authorization, `Bearer ${token}`);
      return new globalThis.Response(null, {
        status: 302,
        headers: { location: signedUrl }
      });
    }
    if (url === signedUrl) {
      assert.equal(options.headers?.Authorization, undefined);
      const bytes = overrides.downloadBytes ?? receiptBytes;
      return new globalThis.Response(bytes, {
        status: 200,
        headers: {
          "content-length": String(bytes.length),
          "content-type": "application/octet-stream"
        }
      });
    }
    throw new Error(`Unexpected fixture URL: ${url}`);
  };
  return { fetchImpl, calls };
}

const wrapper = makeWrapper();
const firstApi = apiFixture(wrapper);
const session = await assembleAgentPilotEvidence(wrapper, {
  token,
  fetchImpl: firstApi.fetchImpl,
  now
});

assert.deepEqual(Object.keys(session.provenance).sort(), [
  "schema_version",
  "repository",
  "workflow_path",
  "run_id",
  "run_url",
  "run_attempt",
  "run_event",
  "run_commit",
  "run_conclusion",
  "artifact_id",
  "artifact_name",
  "artifact_api_url",
  "artifact_digest_sha256",
  "artifact_sha256",
  "artifact_expired",
  "receipt_path",
  "receipt_sha256",
  "downloaded_at"
].sort());
assert.equal(session.provenance.run_id, runId);
assert.equal(session.provenance.workflow_path, workflowPath);
assert.equal(session.provenance.run_event, "workflow_dispatch");
assert.equal(session.provenance.run_commit, "a".repeat(40));
assert.equal(session.provenance.artifact_sha256, session.receipt_sha256);
assert.equal(session.provenance.receipt_path, session.artifact_name);
assert.equal(session.provenance.downloaded_at, now.toISOString());
assert.ok(!JSON.stringify(session).includes(token));
assert.equal(firstApi.calls.length, 4);

const secondApi = apiFixture(wrapper);
const onlineVerified = await verifyGitHubActionsReceipt({
  label: `Agent pilot ${session.scenario_id}`,
  repository,
  workflowPath,
  event: "workflow_dispatch",
  expectedRef: "refs/heads/main",
  candidateCommit: session.candidate_commit,
  artifactName: session.artifact_name,
  record: {
    ...session,
    workflow_path: workflowPath,
    observed_at: session.completed_at
  }
}, {
  token,
  fetchImpl: secondApi.fetchImpl,
  now
});
assert.equal(onlineVerified.verification_source, "github-actions-artifact");
assert.deepEqual(onlineVerified.receipt, wrapper.receipt);

const attemptTwo = apiFixture(wrapper, { run: { run_attempt: 2 } });
await assert.rejects(
  assembleAgentPilotEvidence(wrapper, {
    token,
    fetchImpl: attemptTwo.fetchImpl,
    now
  }),
  /exact successful first-attempt candidate workflow/
);

const wrongRef = apiFixture(wrapper, { run: { head_branch: "feature" } });
await assert.rejects(
  assembleAgentPilotEvidence(wrapper, {
    token,
    fetchImpl: wrongRef.fetchImpl,
    now
  }),
  /exact successful first-attempt candidate workflow/
);

const wrongBytes = apiFixture(wrapper, {
  downloadBytes: Buffer.from(`${wrapper.phase5_embedding_summary.receipt_json} `, "utf8")
});
await assert.rejects(
  assembleAgentPilotEvidence(wrapper, {
    token,
    fetchImpl: wrongBytes.fetchImpl,
    now
  }),
  /downloaded receipt bytes do not match/
);

const tamperedWrapper = globalThis.structuredClone(wrapper);
tamperedWrapper.phase5_embedding_summary.artifact_name = "other.json";
await assert.rejects(
  assembleAgentPilotEvidence(tamperedWrapper, {
    token,
    fetchImpl: apiFixture(wrapper).fetchImpl,
    now
  }),
  /canonically derived from its authenticated receipt/
);

const tamperedSummary = globalThis.structuredClone(wrapper);
tamperedSummary.phase5_embedding_summary.blocking_confusion = true;
await assert.rejects(
  assembleAgentPilotEvidence(tamperedSummary, {
    token,
    fetchImpl: apiFixture(wrapper).fetchImpl,
    now
  }),
  /canonically derived from its authenticated receipt/
);

await assert.rejects(
  assembleAgentPilotEvidence(wrapper, {
    token: "",
    fetchImpl: apiFixture(wrapper).fetchImpl,
    now
  }),
  /requires GH_TOKEN or GITHUB_TOKEN/
);

console.log("Agent pilot artifact-to-session provenance assembly fixtures passed.");
