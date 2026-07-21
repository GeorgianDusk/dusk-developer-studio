import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import {
  phase5GitHubRequirements,
  verifyGitHubActionsArtifactBytes,
  verifyGitHubActionsReceipt,
  verifyInitialNpmPublication
} from "./github-actions-provenance.mjs";

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

const exactArtifact = fixture();
const exactArtifactRequirement = {
  ...exactArtifact.requirement,
  label: "Exact package artifact",
  expectedArtifactId: exactArtifact.artifacts.artifacts[0].id,
  expectedDigestSha256: digest(exactArtifact.bytes)
};
const exactArtifactFetch = mockFetch(exactArtifact);
const exactArtifactResult = await verifyGitHubActionsArtifactBytes(
  exactArtifactRequirement,
  { token, fetchImpl: exactArtifactFetch.fetchImpl, now }
);
assert.equal(exactArtifactResult.artifact_id, exactArtifactRequirement.expectedArtifactId);
assert.equal(exactArtifactResult.artifact_digest_sha256, exactArtifactRequirement.expectedDigestSha256);
assert.equal(exactArtifactResult.artifact_bytes, exactArtifact.bytes.length);

for (const [name, mutate, pattern] of [
  ["wrong immutable artifact id", (requirement) => { requirement.expectedArtifactId += 1; }, /identity or digest/],
  ["wrong immutable artifact digest", (requirement) => { requirement.expectedDigestSha256 = "0".repeat(64); }, /identity or digest/]
]) {
  const state = fixture();
  const requirement = {
    ...state.requirement,
    label: "Exact package artifact",
    expectedArtifactId: state.artifacts.artifacts[0].id,
    expectedDigestSha256: digest(state.bytes)
  };
  mutate(requirement);
  await assert.rejects(
    verifyGitHubActionsArtifactBytes(requirement, {
      token,
      fetchImpl: mockFetch(state).fetchImpl,
      now
    }),
    pattern,
    name
  );
}
const alteredExactArtifact = fixture();
alteredExactArtifact.options.downloadBytes = Buffer.from("different bytes", "utf8");
await assert.rejects(
  verifyGitHubActionsArtifactBytes({
    ...alteredExactArtifact.requirement,
    label: "Exact package artifact",
    expectedArtifactId: alteredExactArtifact.artifacts.artifacts[0].id,
    expectedDigestSha256: digest(alteredExactArtifact.bytes)
  }, {
    token,
    fetchImpl: mockFetch(alteredExactArtifact).fetchImpl,
    now
  }),
  /downloaded bytes do not match/
);

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

function bindReceipt(state, receipt) {
  const receiptJson = `${JSON.stringify(receipt, null, 2)}\n`;
  const bytes = Buffer.from(receiptJson, "utf8");
  const receiptSha256 = digest(bytes);
  state.bytes = bytes;
  state.requirement.record.receipt_json = receiptJson;
  state.requirement.record.receipt_sha256 = receiptSha256;
  state.requirement.record.provenance.receipt_sha256 = receiptSha256;
  state.requirement.record.provenance.artifact_digest_sha256 = receiptSha256;
  state.requirement.record.provenance.artifact_sha256 = receiptSha256;
  state.artifacts.artifacts[0].size_in_bytes = bytes.length;
  state.artifacts.artifacts[0].digest = `sha256:${receiptSha256}`;
  return receiptSha256;
}

function initialFixture() {
  const state = fixture();
  const packageName = "dusk-developer-studio";
  const packageVersion = "1.0.0";
  const tag = `v${packageVersion}`;
  const workflowPath = ".github/workflows/studio-npm-publish.yml";
  const registryUrl = `https://registry.npmjs.org/${packageName}`;
  const provenanceRepository = `https://github.com/${repository}`;
  const integrityBytes = Buffer.alloc(64, 0xab);
  const integrity = `sha512-${integrityBytes.toString("base64")}`;
  const sha512 = integrityBytes.toString("hex");
  const runId = state.requirement.record.provenance.run_id;
  const artifactId = state.requirement.record.provenance.artifact_id;
  const artifactName = `studio-npm-publication-receipt-${runId}.json`;
  const artifactExpiresAt = "2026-10-17T11:58:51Z";
  const observedAt = "2026-07-15T03:00:00Z";
  const receipt = {
    schema_version: 1,
    status: "published",
    package_name: packageName,
    package_version: packageVersion,
    node_engine: ">=24.18.0 <25",
    registry_url: registryUrl,
    tag,
    candidate_commit: candidateCommit,
    workflow_path: workflowPath,
    observed_at: observedAt,
    integrity,
    package_inventory_sha256: "c".repeat(64),
    npm_maintainer: "georgiandusk",
    registry_authentication: "short-lived-granular-token",
    provenance_verification: "npm-audit-signatures-and-slsa-source-bound",
    provenance_predicate_type: "https://slsa.dev/provenance/v1",
    provenance_subject: `pkg:npm/${packageName}@${packageVersion}`,
    provenance_subject_sha512: sha512,
    provenance_repository: provenanceRepository,
    provenance_workflow: workflowPath,
    provenance_ref: `refs/tags/${tag}`,
    provenance_resolved_commit: candidateCommit
  };
  state.requirement.label = "npm initial publication";
  state.requirement.workflowPath = workflowPath;
  state.requirement.event = "push";
  state.requirement.artifactName = artifactName;
  state.requirement.expectedArtifactExpiresAt = artifactExpiresAt;
  state.requirement.record.artifact_name = artifactName;
  state.requirement.record.observed_at = observedAt;
  state.requirement.record.provenance.workflow_path = workflowPath;
  state.requirement.record.provenance.run_event = "push";
  state.requirement.record.provenance.artifact_name = artifactName;
  state.requirement.record.provenance.receipt_path = artifactName;
  state.run.path = `${workflowPath}@refs/tags/${tag}`;
  state.run.event = "push";
  state.artifacts.artifacts[0].name = artifactName;
  state.artifacts.artifacts[0].expires_at = artifactExpiresAt;
  const receiptSha256 = bindReceipt(state, receipt);
  const policy = {
    monitoring_evidence: { canonical_repository: repository },
    npm_distribution: {
      package_name: packageName,
      initial_package_version: packageVersion,
      initial_tag: tag,
      registry_url: registryUrl,
      expected_npm_maintainer: "georgiandusk",
      expected_provenance_repository: provenanceRepository,
      expected_initial_provenance_workflow: workflowPath,
      initial_publication_evidence: {
        candidate_commit: candidateCommit,
        integrity,
        run_id: runId,
        artifact_id: artifactId,
        artifact_name: artifactName,
        artifact_expires_at: artifactExpiresAt,
        receipt_sha256: receiptSha256,
        preserved_receipt_path: `docs/evidence/${artifactName}`
      }
    }
  };
  const metadataUrl = `${registryUrl}/${packageVersion}`;
  const attestationUrl = `https://registry.npmjs.org/-/npm/v1/attestations/${packageName}@${packageVersion}`;
  const metadata = {
    name: packageName,
    version: packageVersion,
    _id: `${packageName}@${packageVersion}`,
    _integrity: integrity,
    _npmUser: { name: "georgiandusk" },
    maintainers: [{ name: "georgiandusk" }],
    dist: {
      integrity,
      tarball: `${registryUrl}/-/${packageName}-${packageVersion}.tgz`,
      attestations: {
        url: attestationUrl,
        provenance: { predicateType: "https://slsa.dev/provenance/v1" }
      },
      signatures: [{ keyid: "SHA256:test", sig: "registry-signature" }]
    }
  };
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    subject: [{
      name: `pkg:npm/${packageName}@${packageVersion}`,
      digest: { sha512 }
    }],
    predicateType: "https://slsa.dev/provenance/v1",
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: {
          workflow: {
            ref: `refs/tags/${tag}`,
            repository: provenanceRepository,
            path: workflowPath
          }
        },
        internalParameters: { github: { event_name: "push" } },
        resolvedDependencies: [{
          uri: `git+${provenanceRepository}@refs/tags/${tag}`,
          digest: { gitCommit: candidateCommit }
        }]
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: {
          invocationId: `https://github.com/${repository}/actions/runs/${runId}/attempts/1`
        }
      }
    }
  };
  const attestation = {
    attestations: [{
      predicateType: "https://slsa.dev/provenance/v1",
      bundle: {
        mediaType: "application/vnd.dev.sigstore.bundle.v0.3+json",
        verificationMaterial: {
          certificate: { rawBytes: "certificate" },
          tlogEntries: [{ logIndex: "1" }]
        },
        dsseEnvelope: {
          payloadType: "application/vnd.in-toto+json",
          payload: Buffer.from(JSON.stringify(statement), "utf8").toString("base64"),
          signatures: [{ sig: "provenance-signature", keyid: "" }]
        }
      }
    }]
  };
  return { state, policy, metadataUrl, attestationUrl, metadata, attestation, statement };
}

function verifiedSignatureAudit(fixtureState) {
  return {
    verified: true,
    verifier: "npm audit signatures",
    package_name: fixtureState.policy.npm_distribution.package_name,
    package_version: fixtureState.policy.npm_distribution.initial_package_version,
    integrity: fixtureState.policy.npm_distribution.initial_publication_evidence.integrity
  };
}

function initialFetch(fixtureState) {
  const github = mockFetch(fixtureState.state);
  const registryCalls = [];
  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    if (url === fixtureState.metadataUrl) {
      registryCalls.push(url);
      assert.equal(header(init, "authorization"), null);
      assert.equal(init.redirect, "error");
      return responseJson(fixtureState.metadata);
    }
    if (url === fixtureState.attestationUrl) {
      registryCalls.push(url);
      assert.equal(header(init, "authorization"), null);
      assert.equal(init.redirect, "error");
      return responseJson(fixtureState.attestation);
    }
    return github.fetchImpl(input, init);
  };
  return { fetchImpl, githubCalls: github.calls, registryCalls };
}

const initial = initialFixture();
const initialRequirements = phase5GitHubRequirements(initial.policy, {
  candidate: { commit: "d".repeat(40) },
  npm_distribution: {
    bootstrap_controls: { initial_publication: initial.state.requirement.record }
  }
});
const initialRequirement = initialRequirements.at(-1);
assert.equal(initialRequirements.length, 7);
assert.equal(initialRequirement.label, "npm initial publication");
assert.equal(initialRequirement.candidateCommit, candidateCommit);
assert.equal(initialRequirement.workflowPath, ".github/workflows/studio-npm-publish.yml");
assert.equal(initialRequirement.artifactName, initial.state.requirement.artifactName);
assert.equal(initialRequirement.expectedArtifactExpiresAt, "2026-10-17T11:58:51Z");
assert.equal(initialRequirement.historicalInitialPublication, true);

const initialOnline = initialFetch(initial);
const verifiedInitial = await verifyInitialNpmPublication(initial.state.requirement, initial.policy, {
  token,
  fetchImpl: initialOnline.fetchImpl,
  readFileImpl: async () => initial.state.bytes,
  workspaceRoot: "C:\\candidate",
  now
});
assert.equal(verifiedInitial.verification_source, "github-actions-artifact");
assert.equal(verifiedInitial.preserved_receipt_sha256, initial.policy.npm_distribution.initial_publication_evidence.receipt_sha256);
assert.equal(initialOnline.registryCalls.length, 0);

const missingBeforeExpiry = initialFixture();
missingBeforeExpiry.state.artifacts = { total_count: 0, artifacts: [] };
const missingBeforeExpiryOnline = initialFetch(missingBeforeExpiry);
await assert.rejects(
  verifyInitialNpmPublication(missingBeforeExpiry.state.requirement, missingBeforeExpiry.policy, {
    token,
    fetchImpl: missingBeforeExpiryOnline.fetchImpl,
    readFileImpl: async () => missingBeforeExpiry.state.bytes,
    workspaceRoot: "C:\\candidate",
    now
  }),
  /exactly one run-scoped receipt artifact/
);
assert.equal(missingBeforeExpiryOnline.registryCalls.length, 0, "Registry fallback must be impossible before policy-bound expiry.");

const inconsistentExpiryBeforePolicy = initialFixture();
inconsistentExpiryBeforePolicy.state.artifacts.artifacts[0].expired = true;
const inconsistentExpiryOnline = initialFetch(inconsistentExpiryBeforePolicy);
await assert.rejects(
  verifyInitialNpmPublication(inconsistentExpiryBeforePolicy.state.requirement, inconsistentExpiryBeforePolicy.policy, {
    token,
    fetchImpl: inconsistentExpiryOnline.fetchImpl,
    readFileImpl: async () => inconsistentExpiryBeforePolicy.state.bytes,
    workspaceRoot: "C:\\candidate",
    now
  }),
  /not the exact unexpired run-scoped candidate receipt/
);
assert.equal(inconsistentExpiryOnline.registryCalls.length, 0);

const unavailableDownloadBeforeExpiry = initialFixture();
unavailableDownloadBeforeExpiry.state.options.redirectStatus = 410;
const unavailableDownloadOnline = initialFetch(unavailableDownloadBeforeExpiry);
await assert.rejects(
  verifyInitialNpmPublication(unavailableDownloadBeforeExpiry.state.requirement, unavailableDownloadBeforeExpiry.policy, {
    token,
    fetchImpl: unavailableDownloadOnline.fetchImpl,
    readFileImpl: async () => unavailableDownloadBeforeExpiry.state.bytes,
    workspaceRoot: "C:\\candidate",
    now
  }),
  /did not return the required one-use redirect/
);
assert.equal(unavailableDownloadOnline.registryCalls.length, 0);

const fallbackAfterExpiry = initialFixture();
const fallbackOnline = initialFetch(fallbackAfterExpiry);
const afterExpiry = new Date("2026-10-17T11:58:51Z");
const verifiedFallback = await verifyInitialNpmPublication(fallbackAfterExpiry.state.requirement, fallbackAfterExpiry.policy, {
  token,
  fetchImpl: fallbackOnline.fetchImpl,
  readFileImpl: async () => fallbackAfterExpiry.state.bytes,
  workspaceRoot: "C:\\candidate",
  now: afterExpiry,
  auditSignaturesImpl: async () => verifiedSignatureAudit(fallbackAfterExpiry)
});
assert.equal(verifiedFallback.verification_source, "npm-registry-slsa-fallback");
assert.equal(verifiedFallback.cryptographic_verifier, "npm audit signatures");
assert.equal(verifiedFallback.run_id, fallbackAfterExpiry.policy.npm_distribution.initial_publication_evidence.run_id);
assert.equal(fallbackOnline.githubCalls.length, 0, "The expired historical path must use durable registry provenance deterministically.");
assert.equal(fallbackOnline.registryCalls.length, 2);

const wrongHistoricalRun = initialFixture();
wrongHistoricalRun.state.run.head_sha = "d".repeat(40);
const wrongHistoricalOnline = initialFetch(wrongHistoricalRun);
await assert.rejects(
  verifyInitialNpmPublication(wrongHistoricalRun.state.requirement, wrongHistoricalRun.policy, {
    token,
    fetchImpl: wrongHistoricalOnline.fetchImpl,
    readFileImpl: async () => wrongHistoricalRun.state.bytes,
    workspaceRoot: "C:\\candidate",
    now
  }),
  /exact successful first-attempt candidate workflow/
);
assert.equal(wrongHistoricalOnline.registryCalls.length, 0, "A live GitHub mismatch must never downgrade to registry fallback.");

const forgedFallback = initialFixture();
forgedFallback.statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "d".repeat(40);
forgedFallback.attestation.attestations[0].bundle.dsseEnvelope.payload = Buffer
  .from(JSON.stringify(forgedFallback.statement), "utf8")
  .toString("base64");
const forgedFallbackOnline = initialFetch(forgedFallback);
await assert.rejects(
  verifyInitialNpmPublication(forgedFallback.state.requirement, forgedFallback.policy, {
    token,
    fetchImpl: forgedFallbackOnline.fetchImpl,
    readFileImpl: async () => forgedFallback.state.bytes,
    workspaceRoot: "C:\\candidate",
    now: afterExpiry,
    auditSignaturesImpl: async () => verifiedSignatureAudit(forgedFallback)
  }),
  /not bound to the exact workflow, tag, run, and commit/
);

for (const [name, mutate] of [
  ["wrong workflow", (state) => {
    state.statement.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/forged.yml";
  }],
  ["wrong ref", (state) => {
    state.statement.predicate.buildDefinition.externalParameters.workflow.ref = "refs/tags/v9.9.9";
  }],
  ["wrong subject", (state) => {
    state.statement.subject[0].name = "pkg:npm/attacker-package@1.0.0";
  }],
  ["wrong invocation", (state) => {
    state.statement.predicate.runDetails.metadata.invocationId =
      `https://github.com/${repository}/actions/runs/999999/attempts/1`;
  }]
]) {
  const changed = initialFixture();
  mutate(changed);
  changed.attestation.attestations[0].bundle.dsseEnvelope.payload = Buffer
    .from(JSON.stringify(changed.statement), "utf8")
    .toString("base64");
  const changedOnline = initialFetch(changed);
  await assert.rejects(
    verifyInitialNpmPublication(changed.state.requirement, changed.policy, {
      token,
      fetchImpl: changedOnline.fetchImpl,
      readFileImpl: async () => changed.state.bytes,
      workspaceRoot: "C:\\candidate",
      now: afterExpiry,
      auditSignaturesImpl: async () => verifiedSignatureAudit(changed)
    }),
    /not bound to the exact workflow, tag, run, and commit/,
    name
  );
}

const wrongRegistryIntegrity = initialFixture();
wrongRegistryIntegrity.metadata.dist.integrity = `sha512-${Buffer.alloc(64, 0xcd).toString("base64")}`;
const wrongRegistryIntegrityOnline = initialFetch(wrongRegistryIntegrity);
await assert.rejects(
  verifyInitialNpmPublication(wrongRegistryIntegrity.state.requirement, wrongRegistryIntegrity.policy, {
    token,
    fetchImpl: wrongRegistryIntegrityOnline.fetchImpl,
    readFileImpl: async () => wrongRegistryIntegrity.state.bytes,
    workspaceRoot: "C:\\candidate",
    now: afterExpiry,
    auditSignaturesImpl: async () => verifiedSignatureAudit(wrongRegistryIntegrity)
  }),
  /registry metadata is not the exact signed package identity/
);

const duplicateProvenance = initialFixture();
duplicateProvenance.attestation.attestations.push(duplicateProvenance.attestation.attestations[0]);
const duplicateProvenanceOnline = initialFetch(duplicateProvenance);
await assert.rejects(
  verifyInitialNpmPublication(duplicateProvenance.state.requirement, duplicateProvenance.policy, {
    token,
    fetchImpl: duplicateProvenanceOnline.fetchImpl,
    readFileImpl: async () => duplicateProvenance.state.bytes,
    workspaceRoot: "C:\\candidate",
    now: afterExpiry,
    auditSignaturesImpl: async () => verifiedSignatureAudit(duplicateProvenance)
  }),
  /exactly one SLSA provenance statement/
);

const unsignedFallback = initialFixture();
const unsignedFallbackOnline = initialFetch(unsignedFallback);
await assert.rejects(
  verifyInitialNpmPublication(unsignedFallback.state.requirement, unsignedFallback.policy, {
    token,
    fetchImpl: unsignedFallbackOnline.fetchImpl,
    readFileImpl: async () => unsignedFallback.state.bytes,
    workspaceRoot: "C:\\candidate",
    now: afterExpiry,
    auditSignaturesImpl: async () => ({
      ...verifiedSignatureAudit(unsignedFallback),
      verified: false
    })
  }),
  /did not pass cryptographic npm signature/
);

for (const [name, response, expected] of [
  [
    "registry failure",
    () => responseJson({}, 503),
    /public registry returned 503/
  ],
  [
    "registry redirect",
    () => new globalThis.Response(null, { status: 302, headers: { location: "https://example.test/forged" } }),
    /public registry returned 302/
  ],
  [
    "wrong registry content type",
    () => new globalThis.Response("{}", { status: 200, headers: { "content-type": "text/plain" } }),
    /did not return JSON/
  ],
  [
    "malformed registry JSON",
    () => new globalThis.Response("{", { status: 200, headers: { "content-type": "application/json" } }),
    /was not valid UTF-8 JSON/
  ],
  [
    "oversized registry response",
    () => new globalThis.Response("{}", {
      status: 200,
      headers: { "content-type": "application/json", "content-length": "1000001" }
    }),
    /exceeded its byte bound/
  ]
]) {
  const unavailable = initialFixture();
  const base = initialFetch(unavailable);
  const fetchImpl = async (input, init) => String(input) === unavailable.metadataUrl
    ? response()
    : base.fetchImpl(input, init);
  await assert.rejects(
    verifyInitialNpmPublication(unavailable.state.requirement, unavailable.policy, {
      token,
      fetchImpl,
      readFileImpl: async () => unavailable.state.bytes,
      workspaceRoot: "C:\\candidate",
      now: afterExpiry,
      auditSignaturesImpl: async () => verifiedSignatureAudit(unavailable)
    }),
    expected,
    name
  );
}

const changedPreservedReceipt = initialFixture();
let changedReceiptCalls = 0;
await assert.rejects(
  verifyInitialNpmPublication(changedPreservedReceipt.state.requirement, changedPreservedReceipt.policy, {
    token,
    fetchImpl: async () => {
      changedReceiptCalls += 1;
      throw new Error("must not run");
    },
    readFileImpl: async () => Buffer.from(`${changedPreservedReceipt.state.requirement.record.receipt_json} `, "utf8"),
    workspaceRoot: "C:\\candidate",
    now
  }),
  /preserved receipt does not match/
);
assert.equal(changedReceiptCalls, 0);

console.log("GitHub Actions online provenance HTTP-boundary fixtures passed.");
