import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { TextDecoder } from "node:util";

const API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";
const MAX_API_BYTES = 1_000_000;
const MAX_RECEIPT_BYTES = 512_000;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1_000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parsedDate(value) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function apiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "User-Agent": "DuskStudioPhase5Verifier/1.0",
    "X-GitHub-Api-Version": API_VERSION
  };
}

function requestSignal(timeoutMs) {
  return typeof globalThis.AbortSignal?.timeout === "function"
    ? globalThis.AbortSignal.timeout(timeoutMs)
    : undefined;
}

async function readBoundedBytes(response, maximumBytes, label) {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null) {
    const declared = Number(contentLength);
    if (!Number.isSafeInteger(declared) || declared < 0 || declared > maximumBytes) {
      throw new Error(`${label} response exceeded its byte bound.`);
    }
  }
  if (!response.body) throw new Error(`${label} response had no body.`);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) throw new Error(`${label} response exceeded its byte bound.`);
      chunks.push(Buffer.from(value));
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, total);
}

async function fetchJson(fetchImpl, url, token, timeoutMs, label) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: apiHeaders(token),
      redirect: "error",
      signal: requestSignal(timeoutMs)
    });
  } catch {
    throw new Error(`${label} GitHub API request failed.`);
  }
  if (response.status !== 200) throw new Error(`${label} GitHub API returned ${response.status}.`);
  const bytes = await readBoundedBytes(response, MAX_API_BYTES, label);
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} GitHub API response was not valid JSON.`);
  }
}

function runIdFromUrl(value, repository) {
  try {
    const url = new URL(value);
    const prefix = `/${repository}/actions/runs/`;
    const suffix = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length).replace(/\/$/, "") : "";
    if (url.protocol !== "https:"
        || url.hostname !== "github.com"
        || url.username
        || url.password
        || url.port
        || url.search
        || url.hash
        || !/^\d+$/.test(suffix)) {
      return undefined;
    }
    const runId = Number(suffix);
    return safeInteger(runId) ? runId : undefined;
  } catch {
    return undefined;
  }
}

function expectedWorkflowPath(value) {
  if (typeof value !== "string") return "";
  return value.split("@", 1)[0];
}

function validateRun(requirement, run, runId, now) {
  const repositoryApi = `${API_BASE}/repos/${requirement.repository}`;
  const expectedRunApi = `${repositoryApi}/actions/runs/${runId}`;
  const expectedRunHtml = `https://github.com/${requirement.repository}/actions/runs/${runId}`;
  const createdAt = parsedDate(run?.created_at);
  const startedAt = parsedDate(run?.run_started_at);
  const updatedAt = parsedDate(run?.updated_at);
  const repositoryId = run?.repository?.id;
  if (run?.id !== runId
      || run?.url !== expectedRunApi
      || run?.html_url !== expectedRunHtml
      || run?.artifacts_url !== `${expectedRunApi}/artifacts`
      || run?.repository?.full_name !== requirement.repository
      || run?.head_repository?.full_name !== requirement.repository
      || !safeInteger(repositoryId)
      || run?.head_repository?.id !== repositoryId
      || expectedWorkflowPath(run?.path) !== requirement.workflowPath
      || run?.head_sha !== requirement.candidateCommit
      || run?.status !== "completed"
      || run?.conclusion !== "success"
      || run?.event !== requirement.event
      || run?.run_attempt !== 1
      || createdAt === undefined
      || startedAt === undefined
      || updatedAt === undefined
      || createdAt > startedAt
      || startedAt > updatedAt
      || updatedAt > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${requirement.label} GitHub run is not the exact successful first-attempt candidate workflow.`);
  }
  const observedAt = parsedDate(requirement.record?.observed_at);
  if (observedAt === undefined
      || observedAt < startedAt - MAX_CLOCK_SKEW_MS
      || observedAt > updatedAt + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${requirement.label} receipt timestamp is outside its verified workflow run.`);
  }
  return { repositoryId, startedAt, updatedAt };
}

function validateArtifact(requirement, result, runId, runWindow, now) {
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  if (result?.total_count !== 1 || artifacts.length !== 1) {
    throw new Error(`${requirement.label} does not have exactly one run-scoped receipt artifact.`);
  }
  const artifact = artifacts[0];
  const artifactId = artifact?.id;
  const expectedArtifactApi = `${API_BASE}/repos/${requirement.repository}/actions/artifacts/${artifactId}`;
  const createdAt = parsedDate(artifact?.created_at);
  const expiresAt = parsedDate(artifact?.expires_at);
  const digest = typeof artifact?.digest === "string" && artifact.digest.startsWith("sha256:")
    ? artifact.digest.slice("sha256:".length)
    : "";
  if (!safeInteger(artifactId)
      || artifact.name !== requirement.artifactName
      || artifact.url !== expectedArtifactApi
      || artifact.archive_download_url !== `${expectedArtifactApi}/zip`
      || artifact.expired !== false
      || !safeInteger(artifact.size_in_bytes)
      || artifact.size_in_bytes > MAX_RECEIPT_BYTES
      || !SHA256_RE.test(digest)
      || artifact.workflow_run?.id !== runId
      || artifact.workflow_run?.repository_id !== runWindow.repositoryId
      || artifact.workflow_run?.head_repository_id !== runWindow.repositoryId
      || artifact.workflow_run?.head_sha !== requirement.candidateCommit
      || createdAt === undefined
      || expiresAt === undefined
      || createdAt < runWindow.startedAt - MAX_CLOCK_SKEW_MS
      || createdAt > runWindow.updatedAt + MAX_CLOCK_SKEW_MS
      || expiresAt <= now.getTime()) {
    throw new Error(`${requirement.label} GitHub artifact is not the exact unexpired run-scoped candidate receipt.`);
  }
  const provenance = requirement.record?.provenance;
  if (provenance?.artifact_id !== artifactId
      || provenance.artifact_name !== artifact.name
      || provenance.artifact_api_url !== artifact.url
      || provenance.artifact_digest_sha256 !== digest
      || provenance.artifact_sha256 !== digest
      || provenance.artifact_expired !== artifact.expired) {
    throw new Error(`${requirement.label} recorded artifact provenance does not match GitHub.`);
  }
  return { artifact, digest };
}

async function downloadDirectReceipt(fetchImpl, artifact, token, timeoutMs, label) {
  let redirectResponse;
  try {
    redirectResponse = await fetchImpl(artifact.archive_download_url, {
      headers: apiHeaders(token),
      redirect: "manual",
      signal: requestSignal(timeoutMs)
    });
  } catch {
    throw new Error(`${label} artifact download request failed.`);
  }
  if (redirectResponse.status !== 302) {
    throw new Error(`${label} artifact download did not return the required one-use redirect.`);
  }
  const location = redirectResponse.headers.get("location");
  let target;
  try {
    target = new URL(location);
  } catch {
    throw new Error(`${label} artifact download redirect was invalid.`);
  }
  if (target.protocol !== "https:" || target.username || target.password || target.hash) {
    throw new Error(`${label} artifact download redirect was not bounded HTTPS.`);
  }
  let response;
  try {
    response = await fetchImpl(target.href, {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": "DuskStudioPhase5Verifier/1.0"
      },
      redirect: "error",
      signal: requestSignal(timeoutMs)
    });
  } catch {
    throw new Error(`${label} signed artifact download failed.`);
  }
  if (response.status !== 200) throw new Error(`${label} signed artifact download returned ${response.status}.`);
  return readBoundedBytes(response, MAX_RECEIPT_BYTES, label);
}

export async function verifyGitHubActionsReceipt(requirement, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? "";
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (typeof fetchImpl !== "function") throw new Error(`${requirement?.label ?? "GitHub receipt"} has no HTTP client.`);
  if (typeof token !== "string" || !token.trim()) throw new Error(`${requirement?.label ?? "GitHub receipt"} requires GH_TOKEN or GITHUB_TOKEN with Actions read access.`);
  if (!requirement
      || !REPOSITORY_RE.test(requirement.repository ?? "")
      || !requirement.label
      || !requirement.workflowPath
      || !requirement.event
      || !/^[a-f0-9]{40}$/.test(requirement.candidateCommit ?? "")
      || !requirement.artifactName
      || requirement.record?.artifact_name !== requirement.artifactName
      || requirement.record?.provenance?.receipt_path !== requirement.artifactName) {
    throw new Error(`${requirement?.label ?? "GitHub receipt"} verification requirement is invalid.`);
  }
  const runId = runIdFromUrl(requirement.record.run_url, requirement.repository);
  if (runId === undefined) throw new Error(`${requirement.label} run URL is invalid.`);
  const runUrl = `${API_BASE}/repos/${requirement.repository}/actions/runs/${runId}`;
  const run = await fetchJson(fetchImpl, runUrl, token, timeoutMs, requirement.label);
  const runWindow = validateRun(requirement, run, runId, now);
  const artifactsUrl = `${runUrl}/artifacts?name=${encodeURIComponent(requirement.artifactName)}&per_page=100`;
  const artifacts = await fetchJson(fetchImpl, artifactsUrl, token, timeoutMs, requirement.label);
  const { artifact, digest } = validateArtifact(requirement, artifacts, runId, runWindow, now);
  const bytes = await downloadDirectReceipt(fetchImpl, artifact, token, timeoutMs, requirement.label);
  const downloadedDigest = sha256(bytes);
  const embeddedBytes = Buffer.from(requirement.record.receipt_json ?? "", "utf8");
  if (artifact.size_in_bytes !== bytes.length
      || digest !== downloadedDigest
      || requirement.record.receipt_sha256 !== downloadedDigest
      || requirement.record.provenance?.receipt_sha256 !== downloadedDigest
      || !embeddedBytes.equals(bytes)) {
    throw new Error(`${requirement.label} downloaded receipt bytes do not match GitHub, the recorded SHA-256, and the embedded evidence.`);
  }
  let receipt;
  try {
    receipt = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${requirement.label} downloaded receipt was not valid UTF-8 JSON.`);
  }
  if (!receipt || typeof receipt !== "object" || Array.isArray(receipt)) {
    throw new Error(`${requirement.label} downloaded receipt was not one JSON object.`);
  }
  return {
    label: requirement.label,
    repository: requirement.repository,
    workflow_path: requirement.workflowPath,
    run_id: runId,
    run_url: requirement.record.run_url,
    run_attempt: 1,
    run_event: requirement.event,
    run_commit: requirement.candidateCommit,
    run_conclusion: "success",
    run_completed_at: new Date(runWindow.updatedAt).toISOString(),
    artifact_id: artifact.id,
    artifact_name: artifact.name,
    artifact_digest_sha256: downloadedDigest,
    receipt_sha256: downloadedDigest,
    verified_at: now.toISOString(),
    receipt
  };
}

export async function verifyPhase5GitHubProvenance(policy, evidence, options = {}) {
  const repository = policy?.monitoring_evidence?.canonical_repository;
  const candidateCommit = evidence?.candidate?.commit;
  const liveSmoke = evidence?.live_smoke ?? {};
  const publicAssurance = evidence?.synthetics?.public_assurance ?? {};
  const heartbeat = evidence?.synthetics?.checks?.monitor_heartbeat ?? {};
  const alertDelivery = evidence?.synthetics?.alert_delivery ?? {};
  const requirements = [
    {
      label: "DuskDS production smoke",
      repository,
      workflowPath: ".github/workflows/duskds-native-smoke.yml",
      event: "workflow_dispatch",
      candidateCommit,
      artifactName: liveSmoke.artifact_name,
      record: liveSmoke
    },
    {
      label: "Public assurance receipt",
      repository,
      workflowPath: ".github/workflows/studio-public-staging.yml",
      event: "schedule",
      candidateCommit,
      artifactName: publicAssurance.artifact_name,
      record: publicAssurance
    },
    {
      label: "Monitor heartbeat",
      repository,
      workflowPath: policy?.monitoring_evidence?.schedule_guard_workflow,
      event: "schedule",
      candidateCommit,
      artifactName: heartbeat.artifact_name,
      record: { ...heartbeat, run_url: heartbeat.guard_run_url }
    },
    {
      label: "Synthetic alert delivery",
      repository,
      workflowPath: ".github/workflows/studio-public-staging.yml",
      event: "workflow_dispatch",
      candidateCommit,
      artifactName: alertDelivery.artifact_name,
      record: alertDelivery
    }
  ];
  const verified = [];
  for (const requirement of requirements) {
    verified.push(await verifyGitHubActionsReceipt(requirement, options));
  }
  const publicRun = verified.find((record) => record.label === "Public assurance receipt");
  const heartbeatObservedAt = parsedDate(heartbeat.observed_at);
  const publicRunCompletedAt = parsedDate(publicRun?.run_completed_at);
  if (heartbeatObservedAt === undefined
      || publicRunCompletedAt === undefined
      || publicRunCompletedAt > heartbeatObservedAt) {
    throw new Error("Monitor heartbeat observation predates the verified public-assurance run completion.");
  }
  return verified;
}
