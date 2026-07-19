import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { verifyGitHubActionsReceipt } from "./github-actions-provenance.mjs";

const repository = "GeorgianDusk/dusk-developer-studio";
const candidateCommit = "b".repeat(40);
const token = "test-actions-read-token";
const now = new Date("2026-07-15T12:00:00Z");

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const runId = 123456;
  const artifactId = 654321;
  const workflowPath = ".github/workflows/studio-public-staging.yml";
  const artifactName = `studio-public-synthetic-receipt-${runId}.json`;
  const receipt = {
    schema_version: 1,
    status: "passed",
    checked_at: "2026-07-15T03:00:00Z"
  };
  const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
  const bytes = Buffer.from(receiptJson, "utf8");
  const receiptSha256 = digest(bytes);
  const runUrl = `https://github.com/${repository}/actions/runs/${runId}`;
  const artifactApiUrl = `https://api.github.com/repos/${repository}/actions/artifacts/${artifactId}`;
  const record = {
    run_url: runUrl,
    artifact_name: artifactName,
    observed_at: receipt.checked_at,
    receipt_json: receiptJson,
    receipt_sha256: receiptSha256,
    provenance: {
      schema_version: 1,
      repository,
      workflow_path: workflowPath,
      run_id: runId,
      run_url: runUrl,
      run_attempt: 1,
      run_event: "schedule",
      run_commit: candidateCommit,
      run_conclusion: "success",
      artifact_id: artifactId,
      artifact_name: artifactName,
      artifact_api_url: artifactApiUrl,
      artifact_digest_sha256: receiptSha256,
      artifact_sha256: receiptSha256,
      artifact_expired: false,
      receipt_path: artifactName,
      receipt_sha256: receiptSha256,
      downloaded_at: "2026-07-15T03:10:00Z"
    }
  };
  const requirement = {
    label: "Public assurance receipt",
    repository,
    workflowPath,
    event: "schedule",
    candidateCommit,
    artifactName,
    record
  };
  const runApiUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  const run = {
    id: runId,
    url: runApiUrl,
    html_url: runUrl,
    artifacts_url: `${runApiUrl}/artifacts`,
    path: `${workflowPath}@main`,
    head_sha: candidateCommit,
    status: "completed",
    conclusion: "success",
    event: "schedule",
    run_attempt: 1,
    created_at: "2026-07-15T02:50:00Z",
    run_started_at: "2026-07-15T02:55:00Z",
    updated_at: "2026-07-15T03:05:00Z",
    repository: { id: 99, full_name: repository },
    head_repository: { id: 99, full_name: repository }
  };
  const artifact = {
    id: artifactId,
    name: artifactName,
    size_in_bytes: bytes.length,
    url: artifactApiUrl,
    archive_download_url: `${artifactApiUrl}/zip`,
    expired: false,
    created_at: "2026-07-15T03:01:00Z",
    expires_at: "2026-08-14T03:01:00Z",
    digest: `sha256:${receiptSha256}`,
    workflow_run: {
      id: runId,
      repository_id: 99,
      head_repository_id: 99,
      head_sha: candidateCommit
    }
  };
  return {
    requirement,
    run,
    artifacts: { total_count: 1, artifacts: [artifact] },
    bytes,
    signedUrl: `https://results-receiver.actions.githubusercontent.com/artifacts/${artifactId}?sig=redacted`,
    options: {}
  };
}

function responseJson(value, status = 200) {
  return new globalThis.Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function header(init, name) {
  return new globalThis.Headers(init?.headers).get(name);
}

function mockFetch(state) {
  const calls = [];
  const runId = state.requirement.record.provenance.run_id;
  const runApiUrl = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  const artifactsUrl = `${runApiUrl}/artifacts?name=${encodeURIComponent(state.requirement.artifactName)}&per_page=100`;
  const artifactDownloadUrl = state.artifacts.artifacts[0]?.archive_download_url
    ?? `https://api.github.com/repos/${repository}/actions/artifacts/654321/zip`;
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.startsWith("https://api.github.com/")) {
      assert.equal(header(init, "authorization"), `Bearer ${token}`, "GitHub API requests must carry the scoped token.");
    }
    if (url === runApiUrl) {
      assert.equal(init.redirect, "error");
      return state.options.runStatus ? responseJson({}, state.options.runStatus) : responseJson(state.run);
    }
    if (url === artifactsUrl) {
      assert.equal(init.redirect, "error");
      return state.options.artifactsStatus ? responseJson({}, state.options.artifactsStatus) : responseJson(state.artifacts);
    }
    if (url === artifactDownloadUrl) {
      assert.equal(init.redirect, "manual");
      return new globalThis.Response(null, {
        status: state.options.redirectStatus ?? 302,
        headers: state.options.omitLocation ? {} : { location: state.options.location ?? state.signedUrl }
      });
    }
    if (url === (state.options.location ?? state.signedUrl)) {
      assert.equal(header(init, "authorization"), null, "The GitHub token must not be forwarded to signed blob storage.");
      assert.equal(init.redirect, "error");
      return new globalThis.Response(state.options.downloadBytes ?? state.bytes, {
        status: state.options.blobStatus ?? 200,
        headers: { "content-type": "application/json" }
      });
    }
    throw new Error(`Unexpected mock URL: ${url}`);
  };
  return { fetchImpl, calls };
}

async function verify(state) {
  const { fetchImpl, calls } = mockFetch(state);
  const result = await verifyGitHubActionsReceipt(state.requirement, { token, fetchImpl, now });
  return { result, calls };
}

const valid = fixture();
const verified = await verify(valid);
assert.equal(verified.result.run_id, 123456);
assert.equal(verified.result.artifact_id, 654321);
assert.equal(verified.result.run_completed_at, "2026-07-15T03:05:00.000Z");
assert.equal(verified.result.receipt_sha256, valid.requirement.record.receipt_sha256);
assert.deepEqual(verified.result.receipt, JSON.parse(valid.requirement.record.receipt_json));
assert.equal(verified.calls.length, 4);

const missingToken = fixture();
let missingTokenCalls = 0;
await assert.rejects(
  verifyGitHubActionsReceipt(missingToken.requirement, {
    token: "",
    now,
    fetchImpl: async () => {
      missingTokenCalls += 1;
      throw new Error("must not run");
    }
  }),
  /requires GH_TOKEN or GITHUB_TOKEN/
);
assert.equal(missingTokenCalls, 0);

for (const [name, mutate] of [
  ["wrong repository", (state) => { state.run.repository.full_name = "attacker/repository"; }],
  ["wrong workflow", (state) => { state.run.path = ".github/workflows/other.yml@main"; }],
  ["wrong event", (state) => { state.run.event = "workflow_dispatch"; }],
  ["wrong commit", (state) => { state.run.head_sha = "d".repeat(40); }],
  ["failed conclusion", (state) => { state.run.conclusion = "failure"; }],
  ["rerun attempt", (state) => { state.run.run_attempt = 2; }]
]) {
  const state = fixture();
  mutate(state);
  const { fetchImpl } = mockFetch(state);
  await assert.rejects(
    verifyGitHubActionsReceipt(state.requirement, { token, fetchImpl, now }),
    /exact successful first-attempt candidate workflow/,
    name
  );
}

const fabricatedRun = fixture();
fabricatedRun.options.runStatus = 404;
await assert.rejects(
  verifyGitHubActionsReceipt(fabricatedRun.requirement, { token, fetchImpl: mockFetch(fabricatedRun).fetchImpl, now }),
  /GitHub API returned 404/
);

for (const [name, mutate] of [
  ["no artifact", (state) => { state.artifacts = { total_count: 0, artifacts: [] }; }],
  ["duplicate artifacts", (state) => {
    state.artifacts = {
      total_count: 2,
      artifacts: [state.artifacts.artifacts[0], { ...state.artifacts.artifacts[0], id: 654322 }]
    };
  }]
]) {
  const state = fixture();
  mutate(state);
  await assert.rejects(
    verifyGitHubActionsReceipt(state.requirement, { token, fetchImpl: mockFetch(state).fetchImpl, now }),
    /exactly one run-scoped receipt artifact/,
    name
  );
}

const wrongArtifactRun = fixture();
wrongArtifactRun.artifacts.artifacts[0].workflow_run.id = 999999;
await assert.rejects(
  verifyGitHubActionsReceipt(wrongArtifactRun.requirement, { token, fetchImpl: mockFetch(wrongArtifactRun).fetchImpl, now }),
  /not the exact unexpired run-scoped candidate receipt/
);

const expiredArtifact = fixture();
expiredArtifact.artifacts.artifacts[0].expired = true;
expiredArtifact.artifacts.artifacts[0].expires_at = "2026-07-14T00:00:00Z";
await assert.rejects(
  verifyGitHubActionsReceipt(expiredArtifact.requirement, { token, fetchImpl: mockFetch(expiredArtifact).fetchImpl, now }),
  /not the exact unexpired run-scoped candidate receipt/
);

const mismatchedMetadata = fixture();
mismatchedMetadata.artifacts.artifacts[0].digest = `sha256:${"d".repeat(64)}`;
await assert.rejects(
  verifyGitHubActionsReceipt(mismatchedMetadata.requirement, { token, fetchImpl: mockFetch(mismatchedMetadata).fetchImpl, now }),
  /recorded artifact provenance does not match GitHub/
);

const mismatchedDownload = fixture();
mismatchedDownload.options.downloadBytes = Buffer.from(`${mismatchedDownload.requirement.record.receipt_json} `, "utf8");
await assert.rejects(
  verifyGitHubActionsReceipt(mismatchedDownload.requirement, { token, fetchImpl: mockFetch(mismatchedDownload).fetchImpl, now }),
  /downloaded receipt bytes do not match/
);

const mismatchedEmbeddedReceipt = fixture();
mismatchedEmbeddedReceipt.requirement.record.receipt_json = `${mismatchedEmbeddedReceipt.requirement.record.receipt_json} `;
await assert.rejects(
  verifyGitHubActionsReceipt(mismatchedEmbeddedReceipt.requirement, {
    token,
    fetchImpl: mockFetch(mismatchedEmbeddedReceipt).fetchImpl,
    now
  }),
  /downloaded receipt bytes do not match/
);

const missingRedirect = fixture();
missingRedirect.options.omitLocation = true;
await assert.rejects(
  verifyGitHubActionsReceipt(missingRedirect.requirement, { token, fetchImpl: mockFetch(missingRedirect).fetchImpl, now }),
  /redirect was invalid/
);

const insecureRedirect = fixture();
insecureRedirect.options.location = "http://results.example.test/artifact";
await assert.rejects(
  verifyGitHubActionsReceipt(insecureRedirect.requirement, { token, fetchImpl: mockFetch(insecureRedirect).fetchImpl, now }),
  /not bounded HTTPS/
);

const secondRedirect = fixture();
secondRedirect.options.blobStatus = 302;
await assert.rejects(
  verifyGitHubActionsReceipt(secondRedirect.requirement, { token, fetchImpl: mockFetch(secondRedirect).fetchImpl, now }),
  /signed artifact download returned 302/
);

console.log("GitHub Actions online provenance HTTP-boundary fixtures passed.");
