import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const API_BASE = "https://api.github.com";
const COMMIT = /^[a-f0-9]{40}$/u;
const REPOSITORY = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const WORKFLOW_PATH = /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/u;
const ARTIFACT_NAME = /^[A-Za-z0-9._-]+\.tgz$/u;
const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

function safeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function timestamp(value) {
  const parsed = Date.parse(value ?? "");
  return Number.isFinite(parsed) ? parsed : undefined;
}

function validateRequirement(requirement) {
  if (!REPOSITORY.test(requirement?.repository ?? "")
      || !COMMIT.test(requirement?.commit ?? "")
      || !WORKFLOW_PATH.test(requirement?.workflowPath ?? "")
      || !ARTIFACT_NAME.test(requirement?.artifactName ?? "")) {
    throw new Error("Main assurance lookup requirement is invalid.");
  }
}

export function selectMainAssuranceRun(payload, requirement, now = new Date()) {
  validateRequirement(requirement);
  const runs = Array.isArray(payload?.workflow_runs) ? payload.workflow_runs : [];
  const matches = runs.filter((run) =>
    run.head_sha === requirement.commit
    && run.head_branch === "main"
    && run.event === "push"
    && run.status === "completed"
    && run.conclusion === "success"
    && run.run_attempt === 1
    && run.path === requirement.workflowPath
    && run.repository?.full_name === requirement.repository
    && run.head_repository?.full_name === requirement.repository
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one successful first-attempt main assurance run; found ${matches.length}.`);
  }
  const run = matches[0];
  const createdAt = timestamp(run.created_at);
  const startedAt = timestamp(run.run_started_at);
  const updatedAt = timestamp(run.updated_at);
  if (!safeInteger(run.id)
      || !safeInteger(run.repository?.id)
      || run.head_repository?.id !== run.repository.id
      || run.url !== `${API_BASE}/repos/${requirement.repository}/actions/runs/${run.id}`
      || run.html_url !== `https://github.com/${requirement.repository}/actions/runs/${run.id}`
      || createdAt === undefined
      || startedAt === undefined
      || updatedAt === undefined
      || startedAt < createdAt - MAX_CLOCK_SKEW_MS
      || updatedAt < startedAt
      || updatedAt > now.getTime() + MAX_CLOCK_SKEW_MS) {
    throw new Error("Main assurance run metadata is invalid.");
  }
  return run;
}

export function selectMainAssuranceArtifact(payload, requirement, run, now = new Date()) {
  validateRequirement(requirement);
  const artifacts = Array.isArray(payload?.artifacts) ? payload.artifacts : [];
  const matches = artifacts.filter((artifact) =>
    artifact.name === requirement.artifactName
    && artifact.expired === false
    && artifact.workflow_run?.id === run.id
    && artifact.workflow_run?.repository_id === run.repository.id
    && artifact.workflow_run?.head_repository_id === run.repository.id
    && artifact.workflow_run?.head_branch === "main"
    && artifact.workflow_run?.head_sha === requirement.commit
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one unexpired main candidate artifact; found ${matches.length}.`);
  }
  const artifact = matches[0];
  const createdAt = timestamp(artifact.created_at);
  const updatedAt = timestamp(artifact.updated_at);
  const expiresAt = timestamp(artifact.expires_at);
  if (!safeInteger(artifact.id)
      || !safeInteger(artifact.size_in_bytes)
      || artifact.size_in_bytes > MAX_ARCHIVE_BYTES
      || artifact.url !== `${API_BASE}/repos/${requirement.repository}/actions/artifacts/${artifact.id}`
      || artifact.archive_download_url !== `${artifact.url}/zip`
      || !/^sha256:[a-f0-9]{64}$/u.test(artifact.digest ?? "")
      || createdAt === undefined
      || updatedAt === undefined
      || expiresAt === undefined
      || updatedAt < createdAt
      || expiresAt <= now.getTime()) {
    throw new Error("Main candidate artifact metadata is invalid.");
  }
  return artifact;
}

async function fetchJson(fetchImpl, url, token) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28"
      },
      redirect: "error",
      signal: globalThis.AbortSignal.timeout(15_000)
    });
  } catch {
    throw new Error("GitHub Actions API request failed.");
  }
  if (response.status !== 200) throw new Error(`GitHub Actions API returned ${response.status}.`);
  return response.json();
}

export async function resolveMainAssuranceArtifact(requirement, options = {}) {
  validateRequirement(requirement);
  const token = options.token ?? "";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? new Date();
  if (!token.trim() || typeof fetchImpl !== "function") {
    throw new Error("Main assurance lookup requires an Actions-read token and HTTP client.");
  }
  const runsUrl = `${API_BASE}/repos/${requirement.repository}/actions/workflows/${encodeURIComponent(requirement.workflowPath)}/runs?branch=main&event=push&status=success&per_page=100`;
  const runs = await fetchJson(fetchImpl, runsUrl, token);
  const run = selectMainAssuranceRun(runs, requirement, now);
  const artifactsUrl = `${run.url}/artifacts?name=${encodeURIComponent(requirement.artifactName)}&per_page=100`;
  const artifacts = await fetchJson(fetchImpl, artifactsUrl, token);
  const artifact = selectMainAssuranceArtifact(artifacts, requirement, run, now);
  return {
    run_id: run.id,
    run_url: run.html_url,
    run_attempt: 1,
    artifact_id: artifact.id,
    artifact_name: artifact.name,
    artifact_digest_sha256: artifact.digest.slice("sha256:".length)
  };
}

function parseArguments(args) {
  const values = {};
  for (const argument of args) {
    const match = /^--([a-z0-9-]+)=(.*)$/u.exec(argument);
    if (!match) throw new Error(`Invalid argument: ${argument}`);
    values[match[1]] = match[2];
  }
  for (const name of ["repository", "commit", "workflow", "artifact", "github-output", "github-env"]) {
    if (!values[name]) throw new Error(`Missing --${name}.`);
  }
  return values;
}

async function runCli(args) {
  const values = parseArguments(args);
  const resolved = await resolveMainAssuranceArtifact({
    repository: values.repository,
    commit: values.commit,
    workflowPath: values.workflow,
    artifactName: values.artifact
  }, { token: process.env.GITHUB_API_TOKEN });
  fs.appendFileSync(values["github-output"], `run_id=${resolved.run_id}\n`);
  fs.appendFileSync(values["github-env"], [
    `MAIN_ASSURANCE_RUN_ID=${resolved.run_id}`,
    `MAIN_ASSURANCE_RUN_URL=${resolved.run_url}`,
    `MAIN_ASSURANCE_ARTIFACT_ID=${resolved.artifact_id}`,
    `MAIN_ASSURANCE_ARTIFACT_NAME=${resolved.artifact_name}`,
    `MAIN_ASSURANCE_ARTIFACT_DIGEST_SHA256=${resolved.artifact_digest_sha256}`,
    ""
  ].join("\n"));
  process.stdout.write(`${JSON.stringify({ status: "passed", ...resolved })}\n`);
}

const isMain = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runCli(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
