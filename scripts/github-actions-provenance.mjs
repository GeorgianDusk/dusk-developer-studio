import { Buffer } from "node:buffer";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { URL } from "node:url";
import { TextDecoder } from "node:util";

const API_BASE = "https://api.github.com";
const API_VERSION = "2026-03-10";
const MAX_API_BYTES = 1_000_000;
const MAX_RECEIPT_BYTES = 512_000;
const MAX_PACKAGE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_NPM_ATTESTATION_BYTES = 2_000_000;
const MAX_CLOCK_SKEW_MS = 10 * 60 * 1_000;
const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA512_RE = /^[a-f0-9]{128}$/;
const REPOSITORY_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const NPM_PACKAGE_RE = /^[a-z0-9][a-z0-9._-]*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SLSA_PROVENANCE_V1 = "https://slsa.dev/provenance/v1";
const IN_TOTO_STATEMENT_V1 = "https://in-toto.io/Statement/v1";
const GITHUB_ACTIONS_BUILD_TYPE_V1 = "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1";
const GITHUB_HOSTED_BUILDER = "https://github.com/actions/runner/github-hosted";
const NPM_VERIFICATION_TIMEOUT_MS = 120_000;
const MAX_NPM_COMMAND_OUTPUT_BYTES = 1_000_000;
const ACTIONS_PROVENANCE_KEYS = [
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

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
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

function parseJsonObject(bytes, label) {
  let value;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} was not valid UTF-8 JSON.`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} was not one JSON object.`);
  }
  return value;
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
  return parseJsonObject(bytes, `${label} GitHub API response`);
}

async function fetchPublicJson(fetchImpl, url, timeoutMs, label, maximumBytes = MAX_API_BYTES) {
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "DuskStudioPhase5Verifier/1.0"
      },
      redirect: "error",
      signal: requestSignal(timeoutMs)
    });
  } catch {
    throw new Error(`${label} public registry request failed.`);
  }
  if (response.status !== 200) throw new Error(`${label} public registry returned ${response.status}.`);
  const contentType = response.headers.get("content-type")?.split(";", 1)[0].trim().toLowerCase();
  if (contentType !== "application/json") throw new Error(`${label} public registry did not return JSON.`);
  return parseJsonObject(await readBoundedBytes(response, maximumBytes, label), `${label} public registry response`);
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

function canonicalSha512(integrity) {
  if (typeof integrity !== "string" || !integrity.startsWith("sha512-")) return "";
  const [, encoded, extra] = integrity.split("-");
  if (!encoded || extra !== undefined) return "";
  const digest = Buffer.from(encoded, "base64");
  const hexadecimal = digest.toString("hex");
  return SHA512_RE.test(hexadecimal)
      && `sha512-${digest.toString("base64")}` === integrity
    ? hexadecimal
    : "";
}

function exactPreservedReceiptPath(workspaceRoot, relativePath) {
  if (typeof relativePath !== "string" || !relativePath || path.isAbsolute(relativePath)) {
    throw new Error("npm initial publication preserved receipt path is invalid.");
  }
  const root = path.resolve(workspaceRoot);
  const target = path.resolve(root, relativePath);
  const withinRoot = path.relative(root, target);
  if (!withinRoot || withinRoot.startsWith("..") || path.isAbsolute(withinRoot)) {
    throw new Error("npm initial publication preserved receipt path escapes the candidate workspace.");
  }
  return target;
}

async function readPreservedInitialReceipt(requirement, expectation, options) {
  const workspaceRoot = options.workspaceRoot ?? process.cwd();
  const readFileImpl = options.readFileImpl ?? readFile;
  const target = exactPreservedReceiptPath(workspaceRoot, expectation.preservedReceiptPath);
  let bytes;
  try {
    bytes = Buffer.from(await readFileImpl(target));
  } catch {
    throw new Error("npm initial publication preserved receipt could not be read.");
  }
  if (!bytes.length || bytes.length > MAX_RECEIPT_BYTES) {
    throw new Error("npm initial publication preserved receipt exceeded its byte bound.");
  }
  const digest = sha256(bytes);
  const embeddedBytes = Buffer.from(requirement.record?.receipt_json ?? "", "utf8");
  if (digest !== expectation.receiptSha256
      || digest !== requirement.record?.receipt_sha256
      || digest !== requirement.record?.provenance?.receipt_sha256
      || !bytes.equals(embeddedBytes)) {
    throw new Error("npm initial publication preserved receipt does not match policy, provenance, and embedded evidence.");
  }
  return { bytes, digest, receipt: parseJsonObject(bytes, "npm initial publication preserved receipt") };
}

function validateInitialReceiptIdentity(receipt, expectation) {
  const expectedSubject = `pkg:npm/${expectation.packageName}@${expectation.packageVersion}`;
  const expectedSha512 = canonicalSha512(expectation.integrity);
  if (!expectedSha512
      || receipt.status !== "published"
      || receipt.package_name !== expectation.packageName
      || receipt.package_version !== expectation.packageVersion
      || receipt.registry_url !== expectation.registryUrl
      || receipt.tag !== expectation.tag
      || receipt.candidate_commit !== expectation.candidateCommit
      || receipt.workflow_path !== expectation.workflowPath
      || receipt.integrity !== expectation.integrity
      || receipt.npm_maintainer !== expectation.maintainer
      || receipt.provenance_predicate_type !== SLSA_PROVENANCE_V1
      || receipt.provenance_subject !== expectedSubject
      || receipt.provenance_subject_sha512 !== expectedSha512
      || receipt.provenance_repository !== expectation.provenanceRepository
      || receipt.provenance_workflow !== expectation.workflowPath
      || receipt.provenance_ref !== `refs/tags/${expectation.tag}`
      || receipt.provenance_resolved_commit !== expectation.candidateCommit) {
    throw new Error("npm initial publication preserved receipt is not the exact package and SLSA source identity.");
  }
  return { expectedSubject, expectedSha512 };
}

function registryEndpoints(expectation) {
  let registry;
  let sourceRepository;
  try {
    registry = new URL(expectation.registryUrl);
    sourceRepository = new URL(expectation.provenanceRepository);
  } catch {
    throw new Error("npm initial publication registry or source repository URL is invalid.");
  }
  if (!NPM_PACKAGE_RE.test(expectation.packageName ?? "")
      || !SEMVER_RE.test(expectation.packageVersion ?? "")
      || registry.protocol !== "https:"
      || registry.username
      || registry.password
      || registry.port
      || registry.search
      || registry.hash
      || registry.pathname.replace(/\/$/, "") !== `/${expectation.packageName}`
      || sourceRepository.protocol !== "https:"
      || sourceRepository.hostname !== "github.com"
      || sourceRepository.username
      || sourceRepository.password
      || sourceRepository.port
      || sourceRepository.search
      || sourceRepository.hash
      || sourceRepository.pathname.replace(/\/$/, "") !== `/${expectation.repository}`) {
    throw new Error("npm initial publication registry or source repository is outside the exact HTTPS boundary.");
  }
  const packageBase = `${registry.origin}/${expectation.packageName}`;
  return {
    metadataUrl: `${packageBase}/${expectation.packageVersion}`,
    expectedTarballUrl: `${packageBase}/-/${expectation.packageName}-${expectation.packageVersion}.tgz`,
    expectedAttestationUrl: `${registry.origin}/-/npm/v1/attestations/${expectation.packageName}@${expectation.packageVersion}`,
    expectedDependencyUri: `git+${expectation.provenanceRepository}@refs/tags/${expectation.tag}`,
    expectedInvocationId: `https://github.com/${expectation.repository}/actions/runs/${expectation.runId}/attempts/1`
  };
}

async function activeNodeNpmCli() {
  const executableDirectory = path.dirname(process.execPath);
  const candidates = process.platform === "win32"
    ? [path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js")]
    : [
        path.resolve(executableDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
        path.resolve(executableDirectory, "..", "share", "nodejs", "npm", "bin", "npm-cli.js"),
        path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js")
      ];
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue only through paths derived from the active Node installation.
    }
  }
  throw new Error("The active Node installation does not expose its bundled npm CLI for signature verification.");
}

function scrubbedNpmEnvironment(verificationRoot, registryOrigin) {
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined
        || /(?:^|_)(?:TOKEN|PASSWORD|SECRET|AUTH)(?:_|$)/iu.test(key)
        || /^(?:GH|GITHUB|NPM|NODE)_/iu.test(key)) {
      continue;
    }
    environment[key] = value;
  }
  return {
    ...environment,
    HOME: verificationRoot,
    USERPROFILE: verificationRoot,
    NPM_CONFIG_USERCONFIG: path.join(verificationRoot, ".npmrc"),
    NPM_CONFIG_CACHE: path.join(verificationRoot, ".npm-cache"),
    NPM_CONFIG_REGISTRY: registryOrigin,
    NPM_CONFIG_IGNORE_SCRIPTS: "true",
    NPM_CONFIG_AUDIT: "false",
    NPM_CONFIG_FUND: "false",
    NPM_CONFIG_UPDATE_NOTIFIER: "false",
    NPM_CONFIG_COLOR: "false",
    NPM_CONFIG_LOGLEVEL: "error"
  };
}

function runBoundedNpm(npmCli, args, options) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [npmCli, ...args], {
      cwd: options.cwd,
      env: options.env,
      timeout: NPM_VERIFICATION_TIMEOUT_MS,
      maxBuffer: MAX_NPM_COMMAND_OUTPUT_BYTES,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`npm cryptographic signature verification failed: ${String(stderr || stdout || error.message).trim().slice(0, 500)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function verifyExactNpmPackageSignatures(expectation, endpoints) {
  const npmCli = await activeNodeNpmCli();
  const verificationRoot = await mkdtemp(path.join(os.tmpdir(), "dusk-studio-npm-signatures-"));
  const registry = new URL(expectation.registryUrl);
  const environment = scrubbedNpmEnvironment(verificationRoot, registry.origin);
  try {
    await writeFile(
      path.join(verificationRoot, "package.json"),
      `${JSON.stringify({ name: "dusk-studio-signature-verification", version: "0.0.0", private: true }, null, 2)}\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await writeFile(
      path.join(verificationRoot, ".npmrc"),
      `registry=${registry.origin}/\nalways-auth=false\nignore-scripts=true\naudit=false\nfund=false\n`,
      { encoding: "utf8", mode: 0o600 }
    );
    await runBoundedNpm(npmCli, [
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      "--save-exact",
      `--registry=${registry.origin}`,
      `${expectation.packageName}@${expectation.packageVersion}`
    ], { cwd: verificationRoot, env: environment });
    const lockBytes = await readFile(path.join(verificationRoot, "package-lock.json"));
    if (!lockBytes.length || lockBytes.length > MAX_API_BYTES) {
      throw new Error("npm signature-verification lockfile exceeded its byte bound.");
    }
    const lock = parseJsonObject(lockBytes, "npm signature-verification lockfile");
    const installed = lock.packages?.[`node_modules/${expectation.packageName}`];
    if (installed?.version !== expectation.packageVersion
        || installed?.integrity !== expectation.integrity
        || installed?.resolved !== endpoints.expectedTarballUrl
        || lock.packages?.[""]?.dependencies?.[expectation.packageName] !== expectation.packageVersion) {
      throw new Error("npm signature-verification lockfile is not bound to the exact historical package bytes.");
    }
    await runBoundedNpm(npmCli, [
      "audit",
      "signatures",
      `--registry=${registry.origin}`
    ], { cwd: verificationRoot, env: environment });
    return {
      verified: true,
      verifier: "npm audit signatures",
      package_name: expectation.packageName,
      package_version: expectation.packageVersion,
      integrity: expectation.integrity
    };
  } finally {
    await rm(verificationRoot, { recursive: true, force: true }).catch(() => {});
  }
}

async function verifyNpmRegistryProvenance(expectation, preserved, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (typeof fetchImpl !== "function") throw new Error("npm initial publication fallback has no HTTP client.");
  const endpoints = registryEndpoints(expectation);
  const metadata = await fetchPublicJson(
    fetchImpl,
    endpoints.metadataUrl,
    timeoutMs,
    "npm initial publication metadata"
  );
  const maintainers = Array.isArray(metadata.maintainers) ? metadata.maintainers : [];
  const signatures = Array.isArray(metadata.dist?.signatures) ? metadata.dist.signatures : [];
  if (metadata.name !== expectation.packageName
      || metadata.version !== expectation.packageVersion
      || metadata._id !== `${expectation.packageName}@${expectation.packageVersion}`
      || metadata._integrity !== expectation.integrity
      || metadata._npmUser?.name !== expectation.maintainer
      || !maintainers.some((maintainer) => maintainer?.name === expectation.maintainer)
      || metadata.dist?.integrity !== expectation.integrity
      || metadata.dist?.tarball !== endpoints.expectedTarballUrl
      || metadata.dist?.attestations?.provenance?.predicateType !== SLSA_PROVENANCE_V1
      || metadata.dist?.attestations?.url !== endpoints.expectedAttestationUrl
      || signatures.length < 1
      || signatures.some((signature) => typeof signature?.keyid !== "string"
        || !signature.keyid
        || typeof signature?.sig !== "string"
        || !signature.sig)) {
    throw new Error("npm initial publication registry metadata is not the exact signed package identity.");
  }

  const document = await fetchPublicJson(
    fetchImpl,
    endpoints.expectedAttestationUrl,
    timeoutMs,
    "npm initial publication attestation",
    MAX_NPM_ATTESTATION_BYTES
  );
  const attestations = Array.isArray(document.attestations) ? document.attestations : [];
  const provenanceAttestations = attestations.filter((attestation) => attestation?.predicateType === SLSA_PROVENANCE_V1);
  if (provenanceAttestations.length !== 1) {
    throw new Error("npm initial publication must have exactly one SLSA provenance statement.");
  }
  const bundle = provenanceAttestations[0]?.bundle;
  const envelope = bundle?.dsseEnvelope;
  const verificationMaterial = bundle?.verificationMaterial;
  const signaturesInEnvelope = Array.isArray(envelope?.signatures) ? envelope.signatures : [];
  const transparencyEntries = Array.isArray(verificationMaterial?.tlogEntries)
    ? verificationMaterial.tlogEntries
    : [];
  if (bundle?.mediaType !== "application/vnd.dev.sigstore.bundle.v0.3+json"
      || typeof verificationMaterial?.certificate?.rawBytes !== "string"
      || !verificationMaterial.certificate.rawBytes
      || transparencyEntries.length < 1
      || envelope?.payloadType !== "application/vnd.in-toto+json"
      || typeof envelope?.payload !== "string"
      || !envelope.payload
      || signaturesInEnvelope.length < 1
      || signaturesInEnvelope.some((signature) => typeof signature?.sig !== "string" || !signature.sig)) {
    throw new Error("npm initial publication SLSA Sigstore bundle is incomplete.");
  }
  const payload = Buffer.from(envelope.payload, "base64");
  if (!payload.length
      || payload.toString("base64").replace(/=+$/u, "") !== envelope.payload.replace(/=+$/u, "")) {
    throw new Error("npm initial publication SLSA payload is not canonical base64.");
  }
  const statement = parseJsonObject(payload, "npm initial publication SLSA statement");
  const subjectList = Array.isArray(statement.subject) ? statement.subject : [];
  const buildDefinition = statement.predicate?.buildDefinition;
  const workflow = buildDefinition?.externalParameters?.workflow;
  const internalGitHub = buildDefinition?.internalParameters?.github;
  const dependencies = Array.isArray(buildDefinition?.resolvedDependencies)
    ? buildDefinition.resolvedDependencies
    : [];
  const { expectedSubject, expectedSha512 } = validateInitialReceiptIdentity(preserved.receipt, expectation);
  if (statement._type !== IN_TOTO_STATEMENT_V1
      || statement.predicateType !== SLSA_PROVENANCE_V1
      || subjectList.length !== 1
      || subjectList[0]?.name !== expectedSubject
      || subjectList[0]?.digest?.sha512?.toLowerCase() !== expectedSha512
      || buildDefinition?.buildType !== GITHUB_ACTIONS_BUILD_TYPE_V1
      || workflow?.repository !== expectation.provenanceRepository
      || workflow?.path !== expectation.workflowPath
      || workflow?.ref !== `refs/tags/${expectation.tag}`
      || internalGitHub?.event_name !== "push"
      || dependencies.length !== 1
      || dependencies[0]?.uri !== endpoints.expectedDependencyUri
      || dependencies[0]?.digest?.gitCommit !== expectation.candidateCommit
      || statement.predicate?.runDetails?.builder?.id !== GITHUB_HOSTED_BUILDER
      || statement.predicate?.runDetails?.metadata?.invocationId !== endpoints.expectedInvocationId) {
    throw new Error("npm initial publication SLSA provenance is not bound to the exact workflow, tag, run, and commit.");
  }
  const auditSignaturesImpl = options.auditSignaturesImpl ?? verifyExactNpmPackageSignatures;
  const signatureVerification = await auditSignaturesImpl(expectation, endpoints);
  if (signatureVerification?.verified !== true
      || signatureVerification.package_name !== expectation.packageName
      || signatureVerification.package_version !== expectation.packageVersion
      || signatureVerification.integrity !== expectation.integrity) {
    throw new Error("npm initial publication did not pass cryptographic npm signature and provenance verification.");
  }
  return {
    label: "npm initial publication",
    repository: expectation.repository,
    workflow_path: expectation.workflowPath,
    run_id: expectation.runId,
    run_url: `https://github.com/${expectation.repository}/actions/runs/${expectation.runId}`,
    run_attempt: 1,
    run_event: "push",
    run_commit: expectation.candidateCommit,
    artifact_id: expectation.artifactId,
    artifact_name: expectation.artifactName,
    artifact_digest_sha256: expectation.receiptSha256,
    receipt_sha256: preserved.digest,
    verified_at: (options.now ?? new Date()).toISOString(),
    verification_source: "npm-registry-slsa-fallback",
    cryptographic_verifier: signatureVerification.verifier,
    preserved_receipt_path: expectation.preservedReceiptPath,
    preserved_receipt_sha256: preserved.digest,
    receipt: preserved.receipt
  };
}

function validateRun(requirement, run, runId, now) {
  const repositoryApi = `${API_BASE}/repos/${requirement.repository}`;
  const expectedRunApi = `${repositoryApi}/actions/runs/${runId}`;
  const expectedRunHtml = `https://github.com/${requirement.repository}/actions/runs/${runId}`;
  const createdAt = parsedDate(run?.created_at);
  const startedAt = parsedDate(run?.run_started_at);
  const updatedAt = parsedDate(run?.updated_at);
  const repositoryId = run?.repository?.id;
  const expectedHeadBranch = requirement.expectedRef === undefined
    ? undefined
    : typeof requirement.expectedRef === "string"
        && requirement.expectedRef.startsWith("refs/heads/")
      ? requirement.expectedRef.slice("refs/heads/".length)
      : "";
  if (run?.id !== runId
      || run?.url !== expectedRunApi
      || run?.html_url !== expectedRunHtml
      || run?.artifacts_url !== `${expectedRunApi}/artifacts`
      || run?.repository?.full_name !== requirement.repository
      || run?.head_repository?.full_name !== requirement.repository
      || !safeInteger(repositoryId)
      || run?.head_repository?.id !== repositoryId
      || expectedWorkflowPath(run?.path) !== requirement.workflowPath
      || (expectedHeadBranch !== undefined
        && (!expectedHeadBranch || run?.head_branch !== expectedHeadBranch))
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

function validateArtifact(
  requirement,
  result,
  runId,
  runWindow,
  now,
  maximumBytes = MAX_RECEIPT_BYTES
) {
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
      || (artifact.expired !== false && artifact.expired !== true)
      || !safeInteger(artifact.size_in_bytes)
      || artifact.size_in_bytes > maximumBytes
      || !SHA256_RE.test(digest)
      || artifact.workflow_run?.id !== runId
      || artifact.workflow_run?.repository_id !== runWindow.repositoryId
      || artifact.workflow_run?.head_repository_id !== runWindow.repositoryId
      || artifact.workflow_run?.head_sha !== requirement.candidateCommit
      || createdAt === undefined
      || expiresAt === undefined
      || (requirement.expectedArtifactExpiresAt
        && artifact.expires_at !== requirement.expectedArtifactExpiresAt)
      || createdAt < runWindow.startedAt - MAX_CLOCK_SKEW_MS
      || createdAt > runWindow.updatedAt + MAX_CLOCK_SKEW_MS) {
    throw new Error(`${requirement.label} GitHub artifact is not the exact unexpired run-scoped candidate receipt.`);
  }
  if (artifact.expired === true || expiresAt <= now.getTime()) {
    throw new Error(`${requirement.label} GitHub artifact is not the exact unexpired run-scoped candidate receipt.`);
  }
  return { artifact, digest };
}

function validateRecordedArtifactMetadata(requirement, artifact, digest) {
  const provenance = requirement.record?.provenance;
  if (provenance?.artifact_id !== artifact.id
      || provenance.artifact_name !== artifact.name
      || provenance.artifact_api_url !== artifact.url
      || provenance.artifact_digest_sha256 !== digest
      || provenance.artifact_sha256 !== digest
      || provenance.artifact_expired !== false) {
    throw new Error(`${requirement.label} recorded artifact provenance does not match GitHub.`);
  }
}

async function downloadDirectReceipt(fetchImpl, artifact, token, timeoutMs, label, maximumBytes = MAX_RECEIPT_BYTES) {
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
  return readBoundedBytes(response, maximumBytes, label);
}

export async function verifyGitHubActionsArtifactBytes(requirement, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? "";
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!requirement
      || !REPOSITORY_RE.test(requirement.repository ?? "")
      || !requirement.label
      || !requirement.workflowPath
      || !requirement.event
      || !/^[a-f0-9]{40}$/.test(requirement.candidateCommit ?? "")
      || !requirement.artifactName
      || !safeInteger(requirement.expectedArtifactId)
      || !SHA256_RE.test(requirement.expectedDigestSha256 ?? "")
      || requirement.record?.artifact_name !== requirement.artifactName
      || parsedDate(requirement.record?.observed_at) === undefined) {
    throw new Error(`${requirement?.label ?? "GitHub artifact"} verification requirement is invalid.`);
  }
  if (typeof fetchImpl !== "function") throw new Error(`${requirement.label} has no HTTP client.`);
  if (typeof token !== "string" || !token.trim()) {
    throw new Error(`${requirement.label} requires GH_TOKEN or GITHUB_TOKEN with Actions read access.`);
  }
  const runId = runIdFromUrl(requirement.record.run_url, requirement.repository);
  if (runId === undefined) throw new Error(`${requirement.label} run URL is invalid.`);
  const runUrl = `${API_BASE}/repos/${requirement.repository}/actions/runs/${runId}`;
  const run = await fetchJson(fetchImpl, runUrl, token, timeoutMs, requirement.label);
  const runWindow = validateRun(requirement, run, runId, now);
  const artifactsUrl = `${runUrl}/artifacts?name=${encodeURIComponent(requirement.artifactName)}&per_page=100`;
  const artifacts = await fetchJson(fetchImpl, artifactsUrl, token, timeoutMs, requirement.label);
  const { artifact, digest } = validateArtifact(
    requirement,
    artifacts,
    runId,
    runWindow,
    now,
    MAX_PACKAGE_ARTIFACT_BYTES
  );
  if (artifact.id !== requirement.expectedArtifactId
      || digest !== requirement.expectedDigestSha256) {
    throw new Error(`${requirement.label} GitHub artifact identity or digest does not match the recorded immutable candidate.`);
  }
  const bytes = await downloadDirectReceipt(
    fetchImpl,
    artifact,
    token,
    timeoutMs,
    requirement.label,
    MAX_PACKAGE_ARTIFACT_BYTES
  );
  const downloadedDigest = sha256(bytes);
  if (artifact.size_in_bytes !== bytes.length || downloadedDigest !== digest) {
    throw new Error(`${requirement.label} downloaded bytes do not match GitHub and the recorded SHA-256.`);
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
    artifact_digest_sha256: digest,
    artifact_bytes: bytes.length,
    verified_at: now.toISOString(),
    verification_source: "github-actions-artifact"
  };
}

function validateReceiptDownloadRequirement(requirement) {
  if (!requirement
      || !REPOSITORY_RE.test(requirement.repository ?? "")
      || !requirement.label
      || !requirement.workflowPath
      || !requirement.event
      || !/^[a-f0-9]{40}$/.test(requirement.candidateCommit ?? "")
      || !requirement.artifactName
      || requirement.record?.artifact_name !== requirement.artifactName
      || requirement.record?.provenance === undefined
      || !SHA256_RE.test(requirement.record?.receipt_sha256 ?? "")
      || typeof requirement.record?.receipt_json !== "string"
      || Buffer.byteLength(requirement.record.receipt_json, "utf8") > MAX_RECEIPT_BYTES) {
    throw new Error(`${requirement?.label ?? "GitHub receipt"} verification requirement is invalid.`);
  }
}

export async function downloadGitHubActionsReceipt(requirement, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const token = options.token ?? "";
  const now = options.now ?? new Date();
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (typeof fetchImpl !== "function") throw new Error(`${requirement?.label ?? "GitHub receipt"} has no HTTP client.`);
  if (typeof token !== "string" || !token.trim()) throw new Error(`${requirement?.label ?? "GitHub receipt"} requires GH_TOKEN or GITHUB_TOKEN with Actions read access.`);
  validateReceiptDownloadRequirement(requirement);
  const runId = runIdFromUrl(requirement.record.run_url, requirement.repository);
  if (runId === undefined) throw new Error(`${requirement.label} run URL is invalid.`);
  const runUrl = `${API_BASE}/repos/${requirement.repository}/actions/runs/${runId}`;
  const run = await fetchJson(
    fetchImpl,
    runUrl,
    token,
    timeoutMs,
    requirement.label
  );
  const runWindow = validateRun(requirement, run, runId, now);
  const artifactsUrl = `${runUrl}/artifacts?name=${encodeURIComponent(requirement.artifactName)}&per_page=100`;
  const artifacts = await fetchJson(
    fetchImpl,
    artifactsUrl,
    token,
    timeoutMs,
    requirement.label
  );
  const { artifact, digest } = validateArtifact(
    requirement,
    artifacts,
    runId,
    runWindow,
    now
  );
  if (options.requireRecordedProvenance === true) {
    validateRecordedArtifactMetadata(requirement, artifact, digest);
  }
  const bytes = await downloadDirectReceipt(
    fetchImpl,
    artifact,
    token,
    timeoutMs,
    requirement.label
  );
  const downloadedDigest = sha256(bytes);
  const embeddedBytes = Buffer.from(requirement.record.receipt_json ?? "", "utf8");
  if (artifact.size_in_bytes !== bytes.length
      || digest !== downloadedDigest
      || requirement.record.receipt_sha256 !== downloadedDigest
      || !embeddedBytes.equals(bytes)) {
    throw new Error(`${requirement.label} downloaded receipt bytes do not match GitHub, the recorded SHA-256, and the embedded evidence.`);
  }
  const receipt = parseJsonObject(bytes, `${requirement.label} downloaded receipt`);
  const provenance = {
    schema_version: 1,
    repository: requirement.repository,
    workflow_path: requirement.workflowPath,
    run_id: runId,
    run_url: requirement.record.run_url,
    run_attempt: 1,
    run_event: requirement.event,
    run_commit: requirement.candidateCommit,
    run_conclusion: "success",
    artifact_id: artifact.id,
    artifact_name: artifact.name,
    artifact_api_url: artifact.url,
    artifact_digest_sha256: digest,
    artifact_sha256: downloadedDigest,
    artifact_expired: false,
    receipt_path: requirement.artifactName,
    receipt_sha256: downloadedDigest,
    downloaded_at: now.toISOString()
  };
  if (!hasExactKeys(provenance, ACTIONS_PROVENANCE_KEYS)) {
    throw new Error(`${requirement.label} generated provenance has an invalid exact shape.`);
  }
  return {
    provenance,
    receipt,
    receipt_bytes: bytes,
    run_completed_at: new Date(runWindow.updatedAt).toISOString()
  };
}

export async function verifyGitHubActionsReceipt(requirement, options = {}) {
  if (requirement?.record?.provenance?.receipt_path !== requirement?.artifactName) {
    throw new Error(`${requirement?.label ?? "GitHub receipt"} verification requirement is invalid.`);
  }
  const downloaded = await downloadGitHubActionsReceipt(requirement, {
    ...options,
    requireRecordedProvenance: true
  });
  const expectedProvenance = downloaded.provenance;
  const recordedProvenance = requirement.record.provenance;
  const recordedDownloadedAt = parsedDate(recordedProvenance?.downloaded_at);
  const observedAt = parsedDate(requirement.record.observed_at);
  const verificationNow = (options.now ?? new Date()).getTime();
  if (!hasExactKeys(recordedProvenance, ACTIONS_PROVENANCE_KEYS)
      || ACTIONS_PROVENANCE_KEYS.some(
        (key) => key !== "downloaded_at"
          && recordedProvenance[key] !== expectedProvenance[key]
      )
      || recordedDownloadedAt === undefined
      || observedAt === undefined
      || recordedDownloadedAt < observedAt
      || recordedDownloadedAt > verificationNow) {
    throw new Error(`${requirement.label} recorded artifact provenance does not match GitHub.`);
  }
  return {
    label: requirement.label,
    repository: requirement.repository,
    workflow_path: requirement.workflowPath,
    run_id: expectedProvenance.run_id,
    run_url: requirement.record.run_url,
    run_attempt: 1,
    run_event: requirement.event,
    run_commit: requirement.candidateCommit,
    run_conclusion: "success",
    run_completed_at: downloaded.run_completed_at,
    artifact_id: expectedProvenance.artifact_id,
    artifact_name: expectedProvenance.artifact_name,
    artifact_digest_sha256: expectedProvenance.artifact_digest_sha256,
    receipt_sha256: expectedProvenance.receipt_sha256,
    verified_at: expectedProvenance.downloaded_at,
    verification_source: "github-actions-artifact",
    receipt: downloaded.receipt
  };
}

function initialPublicationExpectation(policy, requirement) {
  const npmPolicy = policy?.npm_distribution ?? {};
  const initial = npmPolicy.initial_publication_evidence ?? {};
  return {
    repository: policy?.monitoring_evidence?.canonical_repository,
    packageName: npmPolicy.package_name,
    packageVersion: npmPolicy.initial_package_version,
    tag: npmPolicy.initial_tag,
    registryUrl: npmPolicy.registry_url,
    maintainer: npmPolicy.expected_npm_maintainer,
    provenanceRepository: npmPolicy.expected_provenance_repository,
    workflowPath: npmPolicy.expected_initial_provenance_workflow,
    candidateCommit: initial.candidate_commit,
    integrity: initial.integrity,
    runId: initial.run_id,
    artifactId: initial.artifact_id,
    artifactName: initial.artifact_name,
    artifactExpiresAt: initial.artifact_expires_at,
    receiptSha256: initial.receipt_sha256,
    preservedReceiptPath: initial.preserved_receipt_path,
    requirement
  };
}

function validateInitialExpectation(expectation) {
  const requirement = expectation.requirement;
  const record = requirement?.record;
  const runId = runIdFromUrl(record?.run_url, expectation.repository);
  const artifactExpiresAt = parsedDate(expectation.artifactExpiresAt);
  const observedAt = parsedDate(record?.observed_at);
  if (!REPOSITORY_RE.test(expectation.repository ?? "")
      || !NPM_PACKAGE_RE.test(expectation.packageName ?? "")
      || !SEMVER_RE.test(expectation.packageVersion ?? "")
      || expectation.tag !== `v${expectation.packageVersion}`
      || expectation.workflowPath !== requirement?.workflowPath
      || expectation.candidateCommit !== requirement?.candidateCommit
      || !/^[a-f0-9]{40}$/.test(expectation.candidateCommit ?? "")
      || !canonicalSha512(expectation.integrity)
      || !safeInteger(expectation.runId)
      || runId !== expectation.runId
      || !safeInteger(expectation.artifactId)
      || expectation.artifactName !== requirement?.artifactName
      || requirement?.expectedArtifactExpiresAt !== expectation.artifactExpiresAt
      || artifactExpiresAt === undefined
      || observedAt === undefined
      || artifactExpiresAt <= observedAt
      || record?.provenance?.run_id !== expectation.runId
      || record?.provenance?.artifact_id !== expectation.artifactId
      || record?.provenance?.artifact_name !== expectation.artifactName
      || !SHA256_RE.test(expectation.receiptSha256 ?? "")
      || record?.receipt_sha256 !== expectation.receiptSha256
      || record?.provenance?.receipt_sha256 !== expectation.receiptSha256
      || typeof expectation.preservedReceiptPath !== "string"
      || !expectation.preservedReceiptPath
      || typeof expectation.maintainer !== "string"
      || !expectation.maintainer) {
    throw new Error("npm initial publication online verification expectation is invalid.");
  }
}

export async function verifyInitialNpmPublication(requirement, policy, options = {}) {
  const expectation = initialPublicationExpectation(policy, requirement);
  validateInitialExpectation(expectation);
  const preserved = await readPreservedInitialReceipt(requirement, expectation, options);
  validateInitialReceiptIdentity(preserved.receipt, expectation);
  const now = options.now ?? new Date();
  if (now.getTime() < Date.parse(expectation.artifactExpiresAt)) {
    const verified = await verifyGitHubActionsReceipt(requirement, options);
    return {
      ...verified,
      preserved_receipt_path: expectation.preservedReceiptPath,
      preserved_receipt_sha256: preserved.digest
    };
  }
  return verifyNpmRegistryProvenance(expectation, preserved, options);
}

export function phase5GitHubRequirements(policy, evidence) {
  const repository = policy?.monitoring_evidence?.canonical_repository;
  const candidateCommit = evidence?.candidate?.commit;
  const liveSmoke = evidence?.live_smoke ?? {};
  const publicAssurance = evidence?.synthetics?.public_assurance ?? {};
  const heartbeat = evidence?.synthetics?.checks?.monitor_heartbeat ?? {};
  const alertDelivery = evidence?.synthetics?.alert_delivery ?? {};
  const npmAssurance = evidence?.npm_distribution?.assurance ?? {};
  const npmPublication = evidence?.npm_distribution?.publication ?? {};
  const npmInitialPublication = evidence?.npm_distribution?.bootstrap_controls?.initial_publication ?? {};
  const npmInitialPolicy = policy?.npm_distribution?.initial_publication_evidence ?? {};
  const npmPublicationWorkflow = policy?.npm_distribution?.publication_workflow;
  const githubPilotRequirements = (evidence?.pilot?.sessions ?? [])
    .filter((session) => ["linux", "macos"].includes(session?.context))
    .map((session) => ({
      label: `Agent pilot ${session.scenario_id}`,
      repository,
      workflowPath: policy?.npm_distribution?.assurance_workflow,
      event: "workflow_dispatch",
      candidateCommit,
      artifactName: session.artifact_name,
      record: {
        ...session,
        workflow_path: policy?.npm_distribution?.assurance_workflow,
        observed_at: session.completed_at
      }
    }));
  return [
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
    },
    {
      label: "npm package assurance",
      repository,
      workflowPath: ".github/workflows/studio-npm-package-assurance.yml",
      event: "push",
      expectedRef: "refs/heads/main",
      candidateCommit,
      artifactName: npmAssurance.artifact_name,
      record: npmAssurance
    },
    {
      label: "npm package publication",
      repository,
      workflowPath: npmPublicationWorkflow,
      event: "push",
      candidateCommit,
      artifactName: npmPublication.artifact_name,
      record: npmPublication
    },
    {
      label: "npm initial publication",
      repository,
      workflowPath: policy?.npm_distribution?.expected_initial_provenance_workflow,
      event: "push",
      candidateCommit: npmInitialPolicy.candidate_commit,
      artifactName: npmInitialPublication.artifact_name,
      expectedArtifactExpiresAt: npmInitialPolicy.artifact_expires_at,
      record: npmInitialPublication,
      historicalInitialPublication: true
    },
    ...githubPilotRequirements
  ];
}

export async function verifyPhase5GitHubProvenance(policy, evidence, options = {}) {
  const heartbeat = evidence?.synthetics?.checks?.monitor_heartbeat ?? {};
  const requirements = phase5GitHubRequirements(policy, evidence);
  const verified = [];
  for (const requirement of requirements) {
    verified.push(requirement.historicalInitialPublication
      ? await verifyInitialNpmPublication(requirement, policy, options)
      : await verifyGitHubActionsReceipt(requirement, options));
  }
  const repository = policy?.monitoring_evidence?.canonical_repository;
  const candidateCommit = evidence?.candidate?.commit;
  const npmAssurance = evidence?.npm_distribution?.assurance ?? {};
  const npmPublication = evidence?.npm_distribution?.publication ?? {};
  const assuranceReceipt = parseJsonObject(
    Buffer.from(npmAssurance.receipt_json ?? "", "utf8"),
    "npm assurance embedded receipt"
  );
  const assurancePayloadProvenance = assuranceReceipt.github_actions_provenance ?? {};
  const assurancePayload = await downloadGitHubActionsReceipt({
    label: "npm package assurance evidence payload",
    repository,
    workflowPath: policy?.npm_distribution?.assurance_workflow,
    event: "push",
    expectedRef: "refs/heads/main",
    candidateCommit,
    artifactName: assurancePayloadProvenance.artifact_name,
    record: {
      artifact_name: assurancePayloadProvenance.artifact_name,
      run_url: npmAssurance.run_url,
      observed_at: assuranceReceipt.record?.observed_at,
      receipt_json: assuranceReceipt.evidence_payload_json,
      receipt_sha256: assuranceReceipt.evidence_payload_sha256,
      provenance: {}
    }
  }, { ...options, requireRecordedProvenance: false });
  if (String(assurancePayload.provenance.run_id) !== String(assurancePayloadProvenance.run_id)
      || assurancePayload.provenance.run_url !== assurancePayloadProvenance.run_url
      || assurancePayload.provenance.run_attempt !== assurancePayloadProvenance.run_attempt
      || assurancePayload.provenance.run_event !== assurancePayloadProvenance.run_event
      || assurancePayload.provenance.run_commit !== assurancePayloadProvenance.run_commit
      || String(assurancePayload.provenance.artifact_id) !== String(assurancePayloadProvenance.artifact_id)
      || assurancePayload.provenance.artifact_name !== assurancePayloadProvenance.artifact_name
      || assurancePayload.provenance.artifact_digest_sha256
        !== assurancePayloadProvenance.artifact_digest_sha256
      || assurancePayloadProvenance.artifact_url
        !== `${npmAssurance.run_url}/artifacts/${assurancePayloadProvenance.artifact_id}`) {
    throw new Error("npm package assurance evidence payload does not match its embedded immutable artifact provenance.");
  }
  verified.push({
    label: "npm package assurance evidence payload",
    repository,
    workflow_path: policy?.npm_distribution?.assurance_workflow,
    run_id: assurancePayload.provenance.run_id,
    run_url: assurancePayload.provenance.run_url,
    run_attempt: 1,
    run_event: "push",
    run_commit: candidateCommit,
    run_conclusion: "success",
    run_completed_at: assurancePayload.run_completed_at,
    artifact_id: assurancePayload.provenance.artifact_id,
    artifact_name: assurancePayload.provenance.artifact_name,
    artifact_digest_sha256: assurancePayload.provenance.artifact_digest_sha256,
    receipt_sha256: assurancePayload.provenance.receipt_sha256,
    verified_at: assurancePayload.provenance.downloaded_at,
    verification_source: "github-actions-artifact",
    receipt: assurancePayload.receipt
  });
  const publicationReceipt = parseJsonObject(
    Buffer.from(npmPublication.receipt_json ?? "", "utf8"),
    "npm publication embedded receipt"
  );
  verified.push(await verifyGitHubActionsArtifactBytes({
    label: "npm reviewed main-push candidate",
    repository,
    workflowPath: policy?.npm_distribution?.assurance_workflow,
    event: "push",
    expectedRef: "refs/heads/main",
    candidateCommit,
    artifactName: publicationReceipt.main_assurance_artifact_name,
    expectedArtifactId: publicationReceipt.main_assurance_artifact_id,
    expectedDigestSha256: publicationReceipt.main_assurance_artifact_digest_sha256,
    record: {
      artifact_name: publicationReceipt.main_assurance_artifact_name,
      run_url: publicationReceipt.main_assurance_run_url,
      observed_at: assuranceReceipt.record?.observed_at
    }
  }, options));
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
