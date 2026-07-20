import { Buffer } from "node:buffer";
import { readFile, lstat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextDecoder } from "node:util";

import {
  canonicalJson,
  verifyAgentPilotResult
} from "./agent-pilot-collector.mjs";
import { downloadGitHubActionsReceipt } from "./github-actions-provenance.mjs";

const assemblerFile = fileURLToPath(import.meta.url);
const MAX_WRAPPER_BYTES = 2 * 1024 * 1024;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const COMMIT_RE = /^[a-f0-9]{40}$/u;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID_RE = /^[1-9][0-9]{0,19}$/u;
const WORKFLOW_PATH = ".github/workflows/studio-npm-package-assurance.yml";
const ENVELOPE_KEYS = [
  "schema_version",
  "repository",
  "workflow_path",
  "run_id",
  "run_attempt",
  "job_name",
  "event_name",
  "ref",
  "sha",
  "artifact_name"
];
const PROVENANCE_KEYS = [
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
];
const SECRET_VALUE_RE =
  /(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,})\b)/iu;

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function parseJsonObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} is not valid UTF-8 JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must contain one JSON object.`);
  }
  return value;
}

export async function readBoundedAgentPilotWrapper(wrapperPath) {
  const absolutePath = path.resolve(wrapperPath);
  let stat;
  try {
    stat = await lstat(absolutePath);
  } catch {
    throw new Error("The agent pilot wrapper could not be read.");
  }
  if (!stat.isFile()
      || stat.isSymbolicLink()
      || stat.size <= 0
      || stat.size > MAX_WRAPPER_BYTES) {
    throw new Error("The agent pilot wrapper must be a bounded regular file.");
  }
  const bytes = Buffer.from(await readFile(absolutePath));
  if (bytes.length !== stat.size || bytes.length > MAX_WRAPPER_BYTES) {
    throw new Error("The agent pilot wrapper changed while it was being read.");
  }
  return parseJsonObject(bytes, "The agent pilot wrapper");
}

function assertNoSecrets(value) {
  const serialized = JSON.stringify(value);
  if (SECRET_VALUE_RE.test(serialized)
      || /"(?:authorization|cookie|password|secret|token)"\s*:/iu.test(serialized)) {
    throw new Error("The assembled agent pilot evidence contains forbidden secret material.");
  }
}

function canonicalEmbeddingSummary(wrapper, envelope) {
  const receipt = wrapper.receipt;
  const scenario = receipt.scenario;
  const execution = receipt.execution;
  const receiptSha256 = wrapper.receipt_sha256;
  return {
    id: `${scenario.id}-${receipt.invocation_id.slice(0, 8)}`,
    scenario_id: scenario.id,
    path: receipt.plan.path,
    experience: scenario.experience,
    context: scenario.context,
    capability: scenario.capability,
    execution_surface: scenario.execution_surface,
    failure_class: scenario.failure_class,
    operator_type: receipt.operator_type,
    operator_identity: receipt.operator_identity,
    completed: true,
    controlled_failure: true,
    recovery_attempted: true,
    recovered: true,
    started_at: execution.started_at,
    completed_at: execution.completed_at,
    candidate_commit: receipt.candidate.package_commit,
    candidate_artifact_fingerprint_sha256:
      receipt.candidate.phase5_artifact_fingerprint_sha256,
    agent_confidence_score: receipt.plan.agent_confidence_score,
    blocking_confusion: receipt.plan.blocking_confusion,
    duration_seconds: execution.duration_seconds,
    recovery_evidence_reference:
      `agent-pilots/${scenario.id}/${execution.raw_observation_bundle_sha256}.recovery.json`,
    session_record_reference:
      `agent-pilots/${scenario.id}/${receiptSha256}.json`,
    receipt_sha256: receiptSha256,
    receipt_json: canonicalJson(receipt),
    run_url:
      `https://github.com/${envelope.repository}/actions/runs/${String(envelope.run_id)}`,
    artifact_name: envelope.artifact_name,
    provenance: null
  };
}

function validateAssemblyBoundary(wrapper) {
  if (verifyAgentPilotResult(wrapper) !== true) {
    throw new Error("The agent pilot wrapper did not pass its canonical verifier.");
  }
  const submittedSummary = wrapper.phase5_embedding_summary;
  const envelope = wrapper.receipt.github_actions_provenance_input;
  const scenarioId = wrapper.receipt.scenario?.id;
  const runId = String(envelope?.run_id ?? "");
  const artifactName = `studio-agent-pilot-${scenarioId}-${runId}.json`;
  const runUrl = `https://github.com/${envelope?.repository}/actions/runs/${runId}`;
  if (!hasExactKeys(envelope, ENVELOPE_KEYS)
      || envelope.schema_version !== 1
      || !REPOSITORY_RE.test(envelope.repository ?? "")
      || envelope.workflow_path !== WORKFLOW_PATH
      || !RUN_ID_RE.test(runId)
      || envelope.run_attempt !== 1
      || envelope.job_name !== `agent-pilot-${scenarioId}`
      || envelope.event_name !== "workflow_dispatch"
      || envelope.ref !== "refs/heads/main"
      || !COMMIT_RE.test(envelope.sha ?? "")
      || envelope.sha !== wrapper.receipt.candidate.package_commit
      || envelope.artifact_name !== artifactName
      || wrapper.receipt.scenario.context !== wrapper.receipt.environment.context
      || !["linux", "macos"].includes(wrapper.receipt.scenario.context)) {
    throw new Error("The pilot wrapper is not an un-enriched, exact first-attempt Actions session.");
  }
  const summary = canonicalEmbeddingSummary(wrapper, envelope);
  if (summary.run_url !== runUrl
      || summary.artifact_name !== artifactName
      || canonicalJson(submittedSummary) !== canonicalJson(summary)) {
    throw new Error("The pilot wrapper summary is not canonically derived from its authenticated receipt.");
  }
  return { summary, envelope };
}

export async function assembleAgentPilotEvidence(wrapper, options = {}) {
  const token = options.token ?? "";
  if (typeof token !== "string" || !token.trim()) {
    throw new Error("Agent pilot evidence assembly requires GH_TOKEN or GITHUB_TOKEN with Actions read access.");
  }
  const { summary, envelope } = validateAssemblyBoundary(wrapper);
  const requirement = {
    label: `Agent pilot ${summary.scenario_id}`,
    repository: envelope.repository,
    workflowPath: envelope.workflow_path,
    event: envelope.event_name,
    expectedRef: envelope.ref,
    candidateCommit: envelope.sha,
    artifactName: envelope.artifact_name,
    record: {
      ...summary,
      workflow_path: envelope.workflow_path,
      observed_at: summary.completed_at
    }
  };
  const downloaded = await downloadGitHubActionsReceipt(requirement, {
    fetchImpl: options.fetchImpl,
    token,
    now: options.now,
    timeoutMs: options.timeoutMs
  });
  const provenance = downloaded.provenance;
  if (!hasExactKeys(provenance, PROVENANCE_KEYS)
      || provenance.receipt_path !== summary.artifact_name
      || provenance.receipt_sha256 !== summary.receipt_sha256
      || !Number.isFinite(Date.parse(summary.completed_at))
      || Date.parse(provenance.downloaded_at) < Date.parse(summary.completed_at)) {
    throw new Error("Downloaded agent pilot provenance is incomplete or not bound to the session.");
  }
  const session = { ...summary, provenance };
  assertNoSecrets(session);
  return session;
}

function parseCliArguments(argumentsList) {
  const allowed = new Set(["--wrapper", "--output"]);
  if (argumentsList.length !== 4) {
    throw new Error("Usage: node scripts/assemble-agent-pilot-evidence.mjs --wrapper <path> --output <path>.");
  }
  const parsed = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(key) || typeof value !== "string" || value.length === 0 || Object.hasOwn(parsed, key)) {
      throw new Error("The agent pilot evidence assembler arguments are incomplete or unsupported.");
    }
    parsed[key] = value;
  }
  if (!parsed["--wrapper"] || !parsed["--output"]) {
    throw new Error("The agent pilot evidence assembler requires one wrapper and one output path.");
  }
  return parsed;
}

function redactError(error) {
  const message = error instanceof Error ? error.message : "Unknown evidence assembly failure.";
  return message
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/gu, "[redacted-path]")
    .replace(/\/(?:Users|home|root|tmp|var|etc|opt|private)\/[^\s"'<>]+/gu, "[redacted-path]")
    .slice(0, 1_000);
}

async function main() {
  const cli = parseCliArguments(process.argv.slice(2));
  const wrapper = await readBoundedAgentPilotWrapper(cli["--wrapper"]);
  const token = process.env.GH_TOKEN?.trim() || process.env.GITHUB_TOKEN?.trim() || "";
  const session = await assembleAgentPilotEvidence(wrapper, { token });
  const output = `${JSON.stringify(session, null, 2)}\n`;
  if (Buffer.byteLength(output, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error("The enriched agent pilot session exceeds its output byte bound.");
  }
  await writeFile(path.resolve(cli["--output"]), output, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600
  });
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    scenario_id: session.scenario_id,
    receipt_sha256: session.receipt_sha256,
    output: "written"
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === assemblerFile) {
  main().catch((error) => {
    process.stderr.write(`Agent pilot evidence assembly failed: ${redactError(error)}\n`);
    process.exitCode = 1;
  });
}
