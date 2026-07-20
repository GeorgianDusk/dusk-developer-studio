import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { URL } from "node:url";
import { verifyPhase5GitHubProvenance } from "./github-actions-provenance.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;
const SRI_SHA512_RE = /^sha512-[A-Za-z0-9+/]{80,}={0,2}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const DUSKDS_BLOCK_HASH_RE = /^[a-f0-9]{64}$/i;
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const PSEUDONYMOUS_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const NPM_USERNAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const UNASSIGNED_RE = /^(?:tbd|todo|unknown|unassigned|pending)$/i;
const SECRET_KEY_RE = /(?:private[_-]?key|mnemonic|seed(?:er|phrase)?|recovery[_-]?phrase|profile[_-]?entropy|wallet[_-]?password|pairing[_-]?token|api[_-]?key|access[_-]?token|client[_-]?secret)/i;
const SECRET_VALUE_RE = /(?:mnemonic|seed phrase|recovery phrase|private key|wallet password|pairing token|api key|client secret|access token)(?:\s*(?::|=|\bis\b)\s*|\s+)\S+/i;
const GITHUB_TOKEN_RE = /\bgh[pousr]_[A-Za-z0-9_]{10,}\b/;
const URL_TOKEN_RE = /(?:[a-z][a-z0-9+.-]*:)?\/\/[^\s<>"']+/gi;
const NATIVE_SMOKE_WORKFLOW = ".github/workflows/duskds-native-smoke.yml";
const PUBLIC_ASSURANCE_WORKFLOW = ".github/workflows/studio-public-staging.yml";
const NPM_ASSURANCE_WORKFLOW = ".github/workflows/studio-npm-package-assurance.yml";
const INITIAL_NPM_PACKAGE_VERSION = "1.0.0";
const INITIAL_NPM_TAG = "v1.0.0";
const INITIAL_NPM_PUBLICATION_WORKFLOW = ".github/workflows/studio-npm-publish.yml";
const OIDC_NPM_PUBLICATION_WORKFLOW = ".github/workflows/studio-npm-oidc-publish.yml";
const OIDC_NPM_PUBLICATION_ENVIRONMENT = "npm-trusted-publication";
const EXTERNAL_SYNTHETIC_CHECKS = new Set(["external_dead_man", "external_direct_health"]);
const CLOSED_PORT_OBSERVATIONS = new Set(["filtered-or-closed", "econnrefused", "etimedout", "ehostunreach", "enetunreach"]);
const MAX_RECEIPT_BYTES = 512_000;
const EXCEPTION_FIELDS = ["owner", "rationale", "compensating_control", "residual_risk", "monitoring", "expiry", "revalidation_trigger", "accepted_by", "accepted_at"];

function present(value) {
  return typeof value === "string" && value.trim().length > 0 && !UNASSIGNED_RE.test(value.trim());
}

function validDate(value) {
  if (typeof value !== "string" || !ISO_UTC_RE.test(value)) return false;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return false;
  const canonical = parsed.toISOString();
  return value === canonical || value === canonical.replace(".000Z", "Z");
}

function freshDate(value, now, maxAgeMilliseconds) {
  if (!validDate(value) || !Number.isFinite(maxAgeMilliseconds) || maxAgeMilliseconds <= 0) return false;
  const observed = Date.parse(value);
  return observed <= now.getTime() && observed >= now.getTime() - maxAgeMilliseconds;
}

function expectedActionsRunUrl(value, repository) {
  if (!present(value) || !present(repository)) return false;
  try {
    const url = new URL(value);
    const prefix = `/${repository}/actions/runs/`;
    return url.protocol === "https:"
      && url.hostname === "github.com"
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname.startsWith(prefix)
      && /^\d+\/?$/.test(url.pathname.slice(prefix.length));
  } catch {
    return false;
  }
}

function actionsRunId(value, repository) {
  if (!expectedActionsRunUrl(value, repository)) return undefined;
  const url = new URL(value);
  return url.pathname.replace(/\/$/, "").split("/").at(-1);
}

function expectedManifestUrl(value, approvedHosts) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && approvedHosts.includes(url.hostname)
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname === "/release-manifest.json";
  } catch {
    return false;
  }
}

function expectedDirectHealthTarget(value, manifestUrl) {
  try {
    const target = new URL(value);
    const manifest = new URL(manifestUrl);
    return target.protocol === "https:"
      && !target.username
      && !target.password
      && !target.port
      && target.href === `${target.origin}/healthz`
      && manifest.protocol === "https:"
      && !manifest.username
      && !manifest.password
      && !manifest.port
      && target.origin === manifest.origin;
  } catch {
    return false;
  }
}

function checkForSecretMaterial(value, path = "evidence", findings = []) {
  if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value) || GITHUB_TOKEN_RE.test(value)) findings.push(path);
    for (const [matched] of value.matchAll(URL_TOKEN_RE)) {
      if (matched.startsWith("//")) {
        findings.push(path);
        continue;
      }
      try {
        const url = new URL(matched);
        if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) findings.push(path);
      } catch {
        findings.push(path);
      }
    }
  }
  else if (Array.isArray(value)) value.forEach((item, index) => checkForSecretMaterial(item, `${path}[${index}]`, findings));
  else if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) findings.push(`${path}.${key}`);
      checkForSecretMaterial(item, `${path}.${key}`, findings);
    }
  }
  return findings;
}

function exactKeys(blockers, label, value, expectedKeys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    blockers.push(`${label} must be one object with the reviewed fields.`);
    return false;
  }
  const expected = new Set(expectedKeys);
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !expected.has(key));
  const missing = expectedKeys.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length || missing.length) {
    blockers.push(`${label} fields are invalid (unknown: ${unknown.join(", ") || "none"}; missing: ${missing.join(", ") || "none"}).`);
    return false;
  }
  return true;
}

function timestampAfterBuild(blockers, label, value, candidateBuiltAt, now) {
  if (!validDate(value)
      || Date.parse(value) < Date.parse(candidateBuiltAt)
      || Date.parse(value) > now.getTime()) {
    blockers.push(`${label} must be dated at or after the candidate build and no later than now.`);
    return false;
  }
  return true;
}

function normalizeReference(value) {
  return typeof value === "string" ? value.normalize("NFKC").trim().toLowerCase() : "";
}

function identityAliases(value) {
  if (!present(value)) return new Set();
  const normalized = normalizeReference(value);
  const aliases = new Set();
  const canonicalName = (candidate) => candidate.replace(/[^\p{L}\p{N}]+/gu, "");
  const emails = normalized.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g) ?? [];
  for (const email of emails) {
    aliases.add(email);
    const localPart = email.split("@")[0];
    aliases.add(localPart);
    aliases.add(canonicalName(localPart));
  }
  const display = normalized.replace(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/g, "").replace(/[^\p{L}\p{N}]+/gu, "");
  if (display) aliases.add(display);
  if (!emails.length) aliases.add(canonicalName(normalized));
  aliases.delete("");
  return aliases;
}

function aliasesOverlap(left, right) {
  for (const alias of left) if (right.has(alias)) return true;
  return false;
}

function aliasSetsOverlap(aliasSets) {
  for (let index = 0; index < aliasSets.length; index += 1) {
    if (aliasSets.slice(index + 1).some((other) => aliasesOverlap(aliasSets[index], other))) return true;
  }
  return false;
}

function containsAsciiControl(value) {
  return [...value].some((character) => character.codePointAt(0) <= 0x1f);
}

function validEvidenceReference(value) {
  if (!present(value) || containsAsciiControl(value)) return false;
  const normalized = value.normalize("NFKC").trim();
  if (/^https:\/\//i.test(normalized)) {
    try {
      const url = new URL(normalized);
      return url.protocol === "https:" && !url.username && !url.password && !url.port && !url.search && !url.hash;
    } catch {
      return false;
    }
  }
  if (/^(?:[\\/]|~(?:[\\/]|$))/u.test(normalized)
      || normalized.includes("\\")
      || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(normalized)
      || normalized.includes("://")
      || /[?#]/u.test(normalized)) return false;
  const segments = normalized.split("/");
  return segments.every((segment) => segment && segment !== "." && segment !== "..");
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function parseBoundReceipt(blockers, label, record) {
  if (typeof record?.receipt_json !== "string"
      || Buffer.byteLength(record.receipt_json, "utf8") > MAX_RECEIPT_BYTES
      || !SHA256_RE.test(record?.receipt_sha256 ?? "")
      || sha256(record.receipt_json ?? "") !== record?.receipt_sha256) {
    blockers.push(`${label} receipt bytes are missing, oversized, or do not match the recorded SHA-256.`);
    return {};
  }
  try {
    const parsed = JSON.parse(record.receipt_json);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    const receiptSecrets = checkForSecretMaterial(parsed, `${label}.receipt`);
    if (receiptSecrets.length) blockers.push(`${label} parsed receipt contains forbidden secret-shaped or unsafe URL values: ${receiptSecrets.join(", ")}.`);
    return parsed;
  } catch {
    blockers.push(`${label} receipt JSON is invalid.`);
    return {};
  }
}

function expectedArtifactApiUrl(value, repository, artifactId) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "api.github.com"
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && url.pathname === `/repos/${repository}/actions/artifacts/${artifactId}`;
  } catch {
    return false;
  }
}

function checkActionsProvenance(blockers, label, record, candidate, repository, allowedEvents, expectedReceiptPath, now, gatingTimestamps) {
  const provenance = record?.provenance;
  exactKeys(blockers, `${label} provenance`, provenance, [
    "schema_version", "repository", "workflow_path", "run_id", "run_url", "run_attempt",
    "run_event", "run_commit", "run_conclusion", "artifact_id", "artifact_name",
    "artifact_api_url", "artifact_digest_sha256", "artifact_sha256",
    "artifact_expired", "receipt_path", "receipt_sha256", "downloaded_at"
  ]);
  const runId = actionsRunId(record?.run_url, repository);
  if (provenance?.schema_version !== 1
      || provenance.repository !== repository
      || provenance.workflow_path !== record?.workflow_path
      || String(provenance.run_id) !== runId
      || provenance.run_url !== record?.run_url
      || provenance.run_attempt !== 1
      || !allowedEvents.includes(provenance.run_event)
      || provenance.run_commit !== candidate.commit
      || provenance.run_conclusion !== "success"
      || !Number.isSafeInteger(provenance.artifact_id)
      || provenance.artifact_id <= 0
      || provenance.artifact_name !== record?.artifact_name
      || !expectedArtifactApiUrl(provenance.artifact_api_url, repository, provenance.artifact_id)
      || !SHA256_RE.test(provenance.artifact_digest_sha256 ?? "")
      || provenance.artifact_sha256 !== provenance.artifact_digest_sha256
      || provenance.artifact_sha256 !== record?.receipt_sha256
      || provenance.artifact_expired !== false
      || provenance.receipt_path !== expectedReceiptPath
      || provenance.receipt_sha256 !== record?.receipt_sha256
      || !validDate(provenance.downloaded_at)
      || Date.parse(provenance.downloaded_at) < Date.parse(record?.observed_at)
      || Date.parse(provenance.downloaded_at) > now.getTime()) {
    blockers.push(`${label} lacks complete downloaded GitHub run/artifact provenance bound to the candidate, successful run, artifact digest, and receipt.`);
  } else {
    gatingTimestamps.push(Date.parse(provenance.downloaded_at));
  }
}

function checkPublicReceiptShape(blockers, receipt, policy, previewPaths) {
  exactKeys(blockers, "Public assurance receipt JSON", receipt, [
    "schema_version", "checked_at", "target", "expected_environment", "status",
    "studio_status", "upstream_dependency_status", "checks", "errors"
  ]);
  const expectedChecks = (policy.required_synthetic_checks ?? [])
    .filter((check) => check !== "monitor_heartbeat" && !EXTERNAL_SYNTHETIC_CHECKS.has(check));
  if (previewPaths.includes("evm") && !expectedChecks.includes("rpc_chain_id")) expectedChecks.push("rpc_chain_id");
  exactKeys(blockers, "Public assurance receipt checks", receipt?.checks, expectedChecks);
  const checkKeys = {
    public_health: ["status"],
    release_parity: ["status", "commit", "version", "artifact_fingerprint_sha256"],
    key_routes: ["status", "spa_fallback_cache"],
    source_links: ["status", "urls"],
    duskds_node_read: ["status", "endpoint", "height", "hash", "observed_at"],
    rpc_chain_id: ["status", "path", "reason"],
    rpc_degradation: ["status", "evidence"],
    tls_expiry: ["status", "days_remaining", "expires_at"],
    companion_port_closed: ["status", "observed"],
    development_port_closed: ["status", "observed"]
  };
  for (const check of expectedChecks) exactKeys(blockers, `Public assurance receipt check ${check}`, receipt?.checks?.[check], checkKeys[check] ?? ["status"]);
  for (const check of expectedChecks) {
    const expectedStatus = check === "rpc_chain_id" && previewPaths.includes("evm") ? "deferred" : "passed";
    if (receipt?.checks?.[check]?.status !== expectedStatus) blockers.push(`Public assurance receipt check ${check} does not have the required ${expectedStatus} status.`);
  }
  if (receipt?.checks?.source_links?.urls) {
    exactKeys(blockers, "Public assurance source-link statuses", receipt.checks.source_links.urls, policy.key_source_urls ?? []);
    if (Object.values(receipt.checks.source_links.urls).some((status) => !Number.isInteger(status) || status < 200 || status >= 400)) {
      blockers.push("Public assurance source-link receipt contains an invalid HTTP status.");
    }
  }
  const keyRoutes = receipt?.checks?.key_routes ?? {};
  const rpcDegradation = receipt?.checks?.rpc_degradation ?? {};
  const tlsExpiry = receipt?.checks?.tls_expiry ?? {};
  const checkedAt = Date.parse(receipt?.checked_at);
  const expiresAt = Date.parse(tlsExpiry.expires_at);
  const actualTlsDays = (expiresAt - checkedAt) / 86_400_000;
  if (keyRoutes.spa_fallback_cache !== "no-cache") blockers.push("Public assurance key-route receipt does not prove the exact no-cache SPA fallback.");
  if (rpcDegradation.evidence !== "hosted-browser-offline-recovery") blockers.push("Public assurance RPC degradation receipt does not prove the reviewed hosted-browser recovery behavior.");
  if (!validDate(receipt?.checked_at)
      || !validDate(tlsExpiry.expires_at)
      || !Number.isFinite(tlsExpiry.days_remaining)
      || tlsExpiry.days_remaining < policy.minimum_tls_days_remaining
      || !Number.isFinite(actualTlsDays)
      || actualTlsDays < policy.minimum_tls_days_remaining
      || Math.abs(actualTlsDays - tlsExpiry.days_remaining) > 1) {
    blockers.push("Public assurance TLS receipt does not prove the reviewed minimum lifetime and expiry chronology.");
  }
  for (const portCheck of ["companion_port_closed", "development_port_closed"]) {
    if (!CLOSED_PORT_OBSERVATIONS.has(receipt?.checks?.[portCheck]?.observed)) {
      blockers.push(`Public assurance ${portCheck} receipt does not contain an accepted closed-port observation.`);
    }
  }
}

function checkSteps(blockers, label, steps, required) {
  if (!steps || typeof steps !== "object") {
    blockers.push(`${label} steps are missing.`);
    return;
  }
  for (const step of required) if (steps[step] !== "passed") blockers.push(`${label} step ${step} has not passed.`);
}

function checkCandidateBinding(blockers, label, record, candidate, fingerprintKind) {
  const fingerprintField = fingerprintKind === "public"
    ? "candidate_public_fingerprint_sha256"
    : "candidate_artifact_fingerprint_sha256";
  const expectedFingerprint = fingerprintKind === "public"
    ? candidate.public_fingerprint_sha256
    : candidate.artifact_fingerprint_sha256;
  if (record?.candidate_commit !== candidate.commit || record?.[fingerprintField] !== expectedFingerprint) {
    blockers.push(`${label} is not bound to the exact candidate commit and ${fingerprintKind} fingerprint.`);
  }
}

function checkActionsReference(blockers, label, record, repository, expectedWorkflow) {
  if (record?.workflow_path !== expectedWorkflow
      || !expectedActionsRunUrl(record?.run_url, repository)
      || !validDate(record?.observed_at)) {
    blockers.push(`${label} lacks a dated reference bound to the exact canonical Actions workflow and run.`);
  }
}

function checkException(blockers, issue, candidateBuiltAt, now, gatingTimestamps) {
  const exception = issue.exception;
  exactKeys(blockers, `Open P1 ${issue.id ?? "unknown"} exception`, exception, EXCEPTION_FIELDS);
  if (!exception || EXCEPTION_FIELDS.some((field) => !present(exception[field]))) {
    blockers.push(`Open P1 ${issue.id ?? "unknown"} has no complete exception.`);
    return;
  }
  if (exception.accepted_by !== "George" || !validDate(exception.expiry)
      || !timestampAfterBuild(blockers, `Open P1 ${issue.id ?? "unknown"} exception acceptance`, exception.accepted_at, candidateBuiltAt, now)) {
    blockers.push(`Open P1 ${issue.id ?? "unknown"} has an invalid product-owner acceptance or expiry.`);
    return;
  }
  gatingTimestamps.push(Date.parse(exception.accepted_at));
  const expiry = Date.parse(exception.expiry);
  if (expiry <= now.getTime() || expiry > now.getTime() + 30 * 24 * 60 * 60 * 1000) {
    blockers.push(`Open P1 ${issue.id ?? "unknown"} exception must be active and expire within 30 days.`);
  }
}

function evaluatePhase5EvidenceTrusted(policy, evidence, options = {}) {
  const now = options.now ?? new Date();
  const blockers = [];
  if (!policy || policy.schema_version !== 1) blockers.push("Phase 5 policy schema is unsupported.");
  if (!evidence || evidence.schema_version !== 8) blockers.push("Phase 5 evidence schema is unsupported.");
  if (blockers.length) return { decision: "no-go", blockers };

  const productionPaths = Array.isArray(policy.production_paths) ? policy.production_paths : [];
  const previewPaths = Array.isArray(policy.preview_paths) ? policy.preview_paths : [];
  if (!productionPaths.length || productionPaths.some((pathName) => !present(pathName))) blockers.push("Phase 5 production paths are missing or invalid.");
  if (previewPaths.some((pathName) => !present(pathName)) || previewPaths.some((pathName) => productionPaths.includes(pathName))) blockers.push("Phase 5 preview paths are invalid or overlap production paths.");
  const rpcDeferralPolicy = policy.deferred_synthetic_checks?.rpc_chain_id;
  if (previewPaths.includes("evm")) {
    if (rpcDeferralPolicy?.path !== "evm" || !present(rpcDeferralPolicy.reason)
        || !Array.isArray(rpcDeferralPolicy.activation_requirements) || rpcDeferralPolicy.activation_requirements.length < 2) {
      blockers.push("DuskEVM preview lacks a complete RPC deferral and activation policy.");
    }
    if (policy.required_synthetic_checks?.includes("rpc_chain_id")) blockers.push("Deferred DuskEVM RPC cannot remain a required synthetic check.");
  }
  if (productionPaths.includes("evm")) {
    if (!policy.required_synthetic_checks?.includes("rpc_chain_id") || rpcDeferralPolicy) {
      blockers.push("DuskEVM production activation requires a reviewed policy with real RPC verification and no active deferral.");
    }
    if (!Array.isArray(policy.required_evm_smoke_steps) || !policy.required_evm_smoke_steps.length
        || !Number.isInteger(policy.pilot?.minimum_evm) || policy.pilot.minimum_evm <= 0) {
      blockers.push("DuskEVM production activation requires explicit EVM smoke steps and pilot coverage in the reviewed policy.");
    }
  }
  if (productionPaths.includes("duskds") && !policy.required_synthetic_checks?.includes("duskds_node_read")) {
    blockers.push("DuskDS production requires the native Testnet node-read synthetic check.");
  }

  exactKeys(blockers, "Phase 5 evidence", evidence, [
    "schema_version", "candidate", "owners", "reviews", "pilot", "live_smoke", "synthetics",
    "rollback", "issues", "support", "product_signoff", "npm_distribution"
  ]);
  const secretMaterial = checkForSecretMaterial(evidence);
  if (secretMaterial.length) blockers.push(`Evidence contains forbidden secret-shaped fields or values: ${secretMaterial.join(", ")}.`);

  const candidate = evidence.candidate ?? {};
  exactKeys(blockers, "Candidate evidence", candidate, [
    "artifact_fingerprint_sha256", "public_fingerprint_sha256", "commit", "release_id", "implementation_identities",
    "policy_sha256", "evaluator_commit", "manifest_url", "built_at", "source_checked_at", "source_expires_at"
  ]);
  if (!SHA256_RE.test(candidate.artifact_fingerprint_sha256 ?? "")) blockers.push("Candidate artifact fingerprint is invalid.");
  if (!SHA256_RE.test(candidate.public_fingerprint_sha256 ?? "")) blockers.push("Public artifact fingerprint is invalid.");
  if (candidate.artifact_fingerprint_sha256 !== candidate.public_fingerprint_sha256) blockers.push("Candidate and public artifact fingerprints differ.");
  if (!COMMIT_RE.test(candidate.commit ?? "")) blockers.push("Candidate must identify one clean full Git commit.");
  if (!present(candidate.release_id) || candidate.release_id.length > 128) blockers.push("Candidate release id is missing or invalid.");
  if (!SHA256_RE.test(candidate.policy_sha256 ?? "")
      || candidate.policy_sha256 !== options.policySha256
      || candidate.evaluator_commit !== candidate.commit
      || candidate.evaluator_commit !== options.evaluatorCommit) {
    blockers.push("Candidate is not bound to the exact reviewed policy bytes and evaluator commit.");
  }
  const implementationIdentities = Array.isArray(candidate.implementation_identities) ? candidate.implementation_identities : [];
  const normalizedImplementers = implementationIdentities.map(normalizeReference);
  const implementationAliasSets = implementationIdentities.map(identityAliases);
  if (!implementationIdentities.length
      || implementationIdentities.some((identity) => !present(identity))
      || new Set(normalizedImplementers).size !== implementationIdentities.length
      || aliasSetsOverlap(implementationAliasSets)) {
    blockers.push("Candidate implementation identities are missing, invalid, or duplicated.");
  }
  if (!expectedManifestUrl(candidate.manifest_url, policy.candidate_hosts ?? [])) blockers.push("Candidate manifest URL must be the exact credential-free approved HTTPS release-manifest URL.");
  const candidateBuiltAt = Date.parse(candidate.built_at);
  const sourceCheckedAt = Date.parse(candidate.source_checked_at);
  const sourceExpiresAt = Date.parse(candidate.source_expires_at);
  if (!validDate(candidate.built_at) || candidateBuiltAt > now.getTime()) blockers.push("Candidate build time is invalid or in the future.");
  if (!validDate(candidate.source_checked_at) || !validDate(candidate.source_expires_at)) blockers.push("Candidate source receipt dates are invalid.");
  else if (sourceCheckedAt > now.getTime()
      || sourceExpiresAt <= now.getTime()
      || sourceExpiresAt <= sourceCheckedAt
      || sourceExpiresAt - sourceCheckedAt > 31 * 24 * 60 * 60 * 1_000) {
    blockers.push("Candidate source receipt is future-dated, expired, chronologically invalid, or exceeds the 31-day horizon.");
  }
  const gatingTimestamps = [candidateBuiltAt, sourceCheckedAt].filter(Number.isFinite);

  const distributionPolicy = policy.npm_distribution ?? {};
  const distribution = evidence.npm_distribution ?? {};
  exactKeys(blockers, "npm distribution evidence", distribution, [
    "package_name", "package_version", "node_engine", "registry_url", "integrity",
    "package_inventory_sha256", "platform_smoke", "assurance", "publication",
    "bootstrap_controls"
  ]);
  if (distribution.package_name !== distributionPolicy.package_name
      || distribution.package_version !== distributionPolicy.package_version
      || distribution.node_engine !== distributionPolicy.node_engine
      || distribution.registry_url !== distributionPolicy.registry_url
      || !SRI_SHA512_RE.test(distribution.integrity ?? "")
      || !SHA256_RE.test(distribution.package_inventory_sha256 ?? "")) {
    blockers.push("npm distribution does not identify the exact approved public package, runtime, integrity, and inventory.");
  }
  if (!NPM_USERNAME_RE.test(distributionPolicy.expected_npm_maintainer ?? "")
      || /^(?:replace|pending|todo)/i.test(distributionPolicy.expected_npm_maintainer ?? "")
      || distributionPolicy.expected_oidc_publisher !== "GitHub Actions"
      || distributionPolicy.expected_oidc_trusted_publisher_id !== "github"
      || distributionPolicy.expected_provenance_repository !== "https://github.com/GeorgianDusk/dusk-developer-studio"
      || distributionPolicy.expected_initial_provenance_workflow !== INITIAL_NPM_PUBLICATION_WORKFLOW
      || distributionPolicy.initial_package_version !== INITIAL_NPM_PACKAGE_VERSION
      || distributionPolicy.initial_tag !== INITIAL_NPM_TAG
      || distributionPolicy.initial_publication_environment !== "npm-initial-publication"
      || distributionPolicy.publication_workflow !== OIDC_NPM_PUBLICATION_WORKFLOW
      || distributionPolicy.publication_environment !== OIDC_NPM_PUBLICATION_ENVIRONMENT
      || distributionPolicy.subsequent_workflow_path !== distributionPolicy.publication_workflow
      || distributionPolicy.subsequent_registry_authentication !== "github-oidc") {
    blockers.push("npm distribution policy lacks the confirmed maintainer, historical bootstrap identity, or active OIDC publication identity.");
  }
  const initialPublicationPolicy = distributionPolicy.initial_publication_evidence ?? {};
  exactKeys(blockers, "npm initial-publication policy evidence", initialPublicationPolicy, [
    "candidate_commit", "integrity", "package_inventory_sha256", "run_id", "artifact_id",
    "artifact_name", "artifact_expires_at", "preserved_receipt_path", "receipt_sha256", "observed_at"
  ]);
  if (!/^[0-9a-f]{40}$/u.test(initialPublicationPolicy.candidate_commit ?? "")
      || !SRI_SHA512_RE.test(initialPublicationPolicy.integrity ?? "")
      || !SHA256_RE.test(initialPublicationPolicy.package_inventory_sha256 ?? "")
      || !Number.isSafeInteger(initialPublicationPolicy.run_id)
      || initialPublicationPolicy.run_id <= 0
      || !Number.isSafeInteger(initialPublicationPolicy.artifact_id)
      || initialPublicationPolicy.artifact_id <= 0
      || initialPublicationPolicy.artifact_name
        !== `studio-npm-publication-receipt-${initialPublicationPolicy.run_id ?? "invalid"}.json`
      || !validDate(initialPublicationPolicy.artifact_expires_at)
      || initialPublicationPolicy.preserved_receipt_path
        !== `docs/evidence/npm-initial-publication-receipt-${initialPublicationPolicy.run_id ?? "invalid"}.json`
      || !SHA256_RE.test(initialPublicationPolicy.receipt_sha256 ?? "")
      || !validDate(initialPublicationPolicy.observed_at)
      || Date.parse(initialPublicationPolicy.artifact_expires_at)
        <= Date.parse(initialPublicationPolicy.observed_at)
      || Date.parse(initialPublicationPolicy.observed_at) >= candidateBuiltAt
      || Date.parse(initialPublicationPolicy.observed_at) > now.getTime()) {
    blockers.push("npm initial-publication policy evidence does not identify the preserved immutable 1.0.0 receipt, run, artifact, and chronology.");
  }
  const activePublicationWorkflow = distributionPolicy.publication_workflow;
  const activePublicationArtifact = (runId) =>
    `studio-npm-oidc-publication-receipt-${runId ?? "invalid"}.json`;
  const platformSmoke = distribution.platform_smoke ?? {};
  exactKeys(blockers, "npm platform-smoke evidence", platformSmoke, distributionPolicy.required_platforms ?? []);
  for (const platform of distributionPolicy.required_platforms ?? []) {
    const record = platformSmoke[platform];
    exactKeys(blockers, `npm platform smoke ${platform}`, record, [
      "schema_version", "status", "runner", "node_version",
      "safe_smoke", "local_actions_capability_contract_smoke",
      "direct_cli_scaffold_smoke", "local_actions_scaffold_smoke",
      "scaffold_preservation_smoke", "shutdown_smoke",
      "elevated_refusal", "candidate_commit", "integrity", "package_inventory_sha256", "observed_at"
    ]);
    if (record?.schema_version !== 2
        || record.status !== "passed"
        || record.runner !== platform
        || record.node_version !== "24.18.0"
        || record.safe_smoke !== "passed"
        || record.local_actions_capability_contract_smoke !== "passed"
        || record.direct_cli_scaffold_smoke !== "passed"
        || record.local_actions_scaffold_smoke !== "passed"
        || record.scaffold_preservation_smoke !== "passed"
        || record.shutdown_smoke !== "passed"
        || record.elevated_refusal !== "passed"
        || record.candidate_commit !== candidate.commit
        || record.integrity !== distribution.integrity
        || record.package_inventory_sha256 !== distribution.package_inventory_sha256) {
      blockers.push(`npm platform smoke ${platform} does not prove the exact candidate package and required lifecycle checks.`);
    }
    if (timestampAfterBuild(blockers, `npm platform smoke ${platform}`, record?.observed_at, candidate.built_at, now)) {
      gatingTimestamps.push(Date.parse(record.observed_at));
    }
  }

  const assurance = distribution.assurance ?? {};
  exactKeys(blockers, "npm assurance receipt", assurance, [
    "candidate_commit",
    "exact_tarball_direct_cli_scaffold_smoke",
    "exact_tarball_local_actions_scaffold_smoke",
    "exact_tarball_scaffold_preservation_smoke",
    "exact_tarball_shutdown_smoke",
    "receipt_sha256", "receipt_json", "workflow_path",
    "run_url", "artifact_name", "observed_at", "provenance"
  ]);
  if (assurance.candidate_commit !== candidate.commit) blockers.push("npm assurance is not bound to the exact candidate commit.");
  if (assurance.exact_tarball_direct_cli_scaffold_smoke !== "passed"
      || assurance.exact_tarball_local_actions_scaffold_smoke !== "passed"
      || assurance.exact_tarball_scaffold_preservation_smoke !== "passed"
      || assurance.exact_tarball_shutdown_smoke !== "passed") {
    blockers.push("npm assurance does not declare the required three-platform exact-tarball direct CLI, Local Actions scaffold, preservation, and shutdown results.");
  }
  checkActionsReference(blockers, "npm assurance", assurance, policy.monitoring_evidence?.canonical_repository, NPM_ASSURANCE_WORKFLOW);
  const assuranceRunId = actionsRunId(assurance.run_url, policy.monitoring_evidence?.canonical_repository);
  if (assurance.artifact_name !== `studio-npm-assurance-receipt-${assuranceRunId ?? "invalid"}.json`) blockers.push("npm assurance artifact name is not bound to its Actions run.");
  const assuranceReceipt = parseBoundReceipt(blockers, "npm assurance", assurance);
  exactKeys(blockers, "npm assurance receipt JSON", assuranceReceipt, [
    "schema_version", "status", "package_name", "package_version", "node_engine",
    "candidate_commit", "workflow_path", "observed_at", "integrity",
    "package_inventory_sha256", "browser_boot_and_pairing_smoke",
    "exact_tarball_direct_cli_scaffold_smoke",
    "exact_tarball_local_actions_scaffold_smoke",
    "exact_tarball_scaffold_preservation_smoke",
    "exact_tarball_shutdown_smoke",
    "platform_smoke"
  ]);
  if (assuranceReceipt.schema_version !== 2
      || assuranceReceipt.status !== "passed"
      || assuranceReceipt.package_name !== distribution.package_name
      || assuranceReceipt.package_version !== distribution.package_version
      || assuranceReceipt.node_engine !== distribution.node_engine
      || assuranceReceipt.candidate_commit !== candidate.commit
      || assuranceReceipt.workflow_path !== NPM_ASSURANCE_WORKFLOW
      || assuranceReceipt.observed_at !== assurance.observed_at
      || assuranceReceipt.integrity !== distribution.integrity
      || assuranceReceipt.package_inventory_sha256 !== distribution.package_inventory_sha256
      || assuranceReceipt.browser_boot_and_pairing_smoke !== "passed"
      || assuranceReceipt.exact_tarball_direct_cli_scaffold_smoke
        !== assurance.exact_tarball_direct_cli_scaffold_smoke
      || assuranceReceipt.exact_tarball_local_actions_scaffold_smoke
        !== assurance.exact_tarball_local_actions_scaffold_smoke
      || assuranceReceipt.exact_tarball_scaffold_preservation_smoke
        !== assurance.exact_tarball_scaffold_preservation_smoke
      || assuranceReceipt.exact_tarball_shutdown_smoke !== assurance.exact_tarball_shutdown_smoke
      || JSON.stringify(assuranceReceipt.platform_smoke) !== JSON.stringify(platformSmoke)) {
    blockers.push("npm assurance receipt does not prove the exact package inventory, browser boot and pairing, direct CLI, Local Actions scaffold, preservation, shutdown, and three-platform lifecycle smoke.");
  }
  if (timestampAfterBuild(blockers, "npm assurance", assurance.observed_at, candidate.built_at, now)) {
    gatingTimestamps.push(Date.parse(assurance.observed_at));
  }
  checkActionsProvenance(
    blockers,
    "npm assurance",
    assurance,
    candidate,
    policy.monitoring_evidence?.canonical_repository,
    ["workflow_dispatch"],
    `studio-npm-assurance-receipt-${assuranceRunId ?? "invalid"}.json`,
    now,
    gatingTimestamps
  );

  const publication = distribution.publication ?? {};
  exactKeys(blockers, "npm publication receipt", publication, [
    "candidate_commit", "receipt_sha256", "receipt_json", "workflow_path",
    "run_url", "artifact_name", "observed_at", "provenance"
  ]);
  if (publication.candidate_commit !== candidate.commit) blockers.push("npm publication is not bound to the exact candidate commit.");
  checkActionsReference(blockers, "npm publication", publication, policy.monitoring_evidence?.canonical_repository, activePublicationWorkflow);
  const publicationRunId = actionsRunId(publication.run_url, policy.monitoring_evidence?.canonical_repository);
  if (publication.artifact_name !== activePublicationArtifact(publicationRunId)) blockers.push("npm publication artifact name is not bound to its Actions run.");
  const publicationReceipt = parseBoundReceipt(blockers, "npm publication", publication);
  exactKeys(blockers, "npm publication receipt JSON", publicationReceipt, [
    "schema_version", "status", "package_name", "package_version", "node_engine",
    "registry_url", "tag", "candidate_commit", "workflow_path", "observed_at",
    "integrity", "package_inventory_sha256", "npm_maintainer", "registry_authentication",
    "npm_publisher", "trusted_publisher_id",
    "provenance_verification", "provenance_predicate_type", "provenance_subject",
    "provenance_subject_sha512", "provenance_repository", "provenance_workflow",
    "provenance_ref", "provenance_resolved_commit"
  ]);
  const expectedRegistryAuthentication = publicationReceipt.status === "published"
    ? distributionPolicy.subsequent_registry_authentication
    : "not-used-idempotent-verification";
  const expectedProvenanceSubject = `pkg:npm/${distribution.package_name}@${distribution.package_version}`;
  const expectedProvenanceSha512 = SRI_SHA512_RE.test(distribution.integrity ?? "")
    ? Buffer.from(distribution.integrity.slice("sha512-".length), "base64").toString("hex")
    : "";
  if (publicationReceipt.schema_version !== 1
      || !["published", "verified-existing"].includes(publicationReceipt.status)
      || publicationReceipt.package_name !== distribution.package_name
      || publicationReceipt.package_version !== distribution.package_version
      || publicationReceipt.node_engine !== distribution.node_engine
      || publicationReceipt.registry_url !== distribution.registry_url
      || publicationReceipt.tag !== distributionPolicy.tag
      || publicationReceipt.candidate_commit !== candidate.commit
      || publicationReceipt.workflow_path !== activePublicationWorkflow
      || publicationReceipt.observed_at !== publication.observed_at
      || publicationReceipt.integrity !== distribution.integrity
      || publicationReceipt.package_inventory_sha256 !== distribution.package_inventory_sha256
      || publicationReceipt.npm_maintainer !== distributionPolicy.expected_npm_maintainer
      || publicationReceipt.npm_publisher !== distributionPolicy.expected_oidc_publisher
      || publicationReceipt.trusted_publisher_id !== distributionPolicy.expected_oidc_trusted_publisher_id
      || publicationReceipt.registry_authentication !== expectedRegistryAuthentication
      || publicationReceipt.provenance_verification !== "npm-audit-signatures-and-slsa-source-bound"
      || publicationReceipt.provenance_predicate_type !== "https://slsa.dev/provenance/v1"
      || publicationReceipt.provenance_subject !== expectedProvenanceSubject
      || publicationReceipt.provenance_subject_sha512 !== expectedProvenanceSha512
      || publicationReceipt.provenance_repository !== distributionPolicy.expected_provenance_repository
      || publicationReceipt.provenance_workflow !== activePublicationWorkflow
      || publicationReceipt.provenance_ref !== `refs/tags/${distributionPolicy.tag}`
      || publicationReceipt.provenance_resolved_commit !== candidate.commit
      || Date.parse(publication.observed_at) < Date.parse(assurance.observed_at)) {
    blockers.push("npm publication receipt does not prove exact-tag OIDC publication or idempotent exact-byte recovery with cryptographically verified provenance and exact SLSA source binding.");
  }
  if (timestampAfterBuild(blockers, "npm publication", publication.observed_at, candidate.built_at, now)) {
    gatingTimestamps.push(Date.parse(publication.observed_at));
  }
  checkActionsProvenance(
    blockers,
    "npm publication",
    publication,
    candidate,
    policy.monitoring_evidence?.canonical_repository,
    ["push"],
    activePublicationArtifact(publicationRunId),
    now,
    gatingTimestamps
  );

  const bootstrapControls = distribution.bootstrap_controls ?? {};
  exactKeys(blockers, "npm bootstrap controls", bootstrapControls, [
    "package_version", "tag", "workflow_path", "environment", "initial_publication",
    "token_created_at", "token_permissions", "token_package_access", "token_bypass_2fa",
    "token_revoked", "token_revoked_at",
    "token_revocation_evidence_reference", "token_revocation_evidence_sha256",
    "environment_secret_removed", "environment_secret_removed_at",
    "environment_secret_removal_evidence_reference", "environment_secret_removal_evidence_sha256",
    "trusted_publisher_configured", "trusted_publisher_configured_at",
    "trusted_publisher_evidence_reference", "trusted_publisher_evidence_sha256",
    "verified_by", "verified_at"
  ]);
  const initialPublication = bootstrapControls.initial_publication ?? {};
  exactKeys(blockers, "npm initial publication receipt", initialPublication, [
    "candidate_commit", "receipt_sha256", "receipt_json", "workflow_path",
    "run_url", "artifact_name", "observed_at", "provenance"
  ]);
  checkActionsReference(
    blockers,
    "npm initial publication",
    initialPublication,
    policy.monitoring_evidence?.canonical_repository,
    INITIAL_NPM_PUBLICATION_WORKFLOW
  );
  const initialPublicationRunId = actionsRunId(
    initialPublication.run_url,
    policy.monitoring_evidence?.canonical_repository
  );
  const initialPublicationReceipt = parseBoundReceipt(
    blockers,
    "npm initial publication",
    initialPublication
  );
  exactKeys(blockers, "npm initial publication receipt JSON", initialPublicationReceipt, [
    "schema_version", "status", "package_name", "package_version", "node_engine",
    "registry_url", "tag", "candidate_commit", "workflow_path", "observed_at",
    "integrity", "package_inventory_sha256", "npm_maintainer", "registry_authentication",
    "provenance_verification", "provenance_predicate_type", "provenance_subject",
    "provenance_subject_sha512", "provenance_repository", "provenance_workflow",
    "provenance_ref", "provenance_resolved_commit"
  ]);
  const initialExpectedProvenanceSha512 = SRI_SHA512_RE.test(initialPublicationPolicy.integrity ?? "")
    ? Buffer.from(initialPublicationPolicy.integrity.slice("sha512-".length), "base64").toString("hex")
    : "";
  if (initialPublication.candidate_commit !== initialPublicationPolicy.candidate_commit
      || initialPublication.receipt_sha256 !== initialPublicationPolicy.receipt_sha256
      || String(initialPublicationRunId) !== String(initialPublicationPolicy.run_id)
      || initialPublication.artifact_name !== initialPublicationPolicy.artifact_name
      || initialPublication.observed_at !== initialPublicationPolicy.observed_at
      || initialPublicationReceipt.schema_version !== 1
      || initialPublicationReceipt.status !== "published"
      || initialPublicationReceipt.package_name !== distribution.package_name
      || initialPublicationReceipt.package_version !== distributionPolicy.initial_package_version
      || initialPublicationReceipt.node_engine !== distribution.node_engine
      || initialPublicationReceipt.registry_url !== distribution.registry_url
      || initialPublicationReceipt.tag !== distributionPolicy.initial_tag
      || initialPublicationReceipt.candidate_commit !== initialPublicationPolicy.candidate_commit
      || initialPublicationReceipt.workflow_path !== INITIAL_NPM_PUBLICATION_WORKFLOW
      || initialPublicationReceipt.observed_at !== initialPublicationPolicy.observed_at
      || initialPublicationReceipt.integrity !== initialPublicationPolicy.integrity
      || initialPublicationReceipt.package_inventory_sha256
        !== initialPublicationPolicy.package_inventory_sha256
      || initialPublicationReceipt.npm_maintainer !== distributionPolicy.expected_npm_maintainer
      || initialPublicationReceipt.registry_authentication
        !== distributionPolicy.initial_registry_authentication
      || initialPublicationReceipt.provenance_verification
        !== "npm-audit-signatures-and-slsa-source-bound"
      || initialPublicationReceipt.provenance_predicate_type !== "https://slsa.dev/provenance/v1"
      || initialPublicationReceipt.provenance_subject
        !== `pkg:npm/${distribution.package_name}@${distributionPolicy.initial_package_version}`
      || initialPublicationReceipt.provenance_subject_sha512 !== initialExpectedProvenanceSha512
      || initialPublicationReceipt.provenance_repository
        !== distributionPolicy.expected_provenance_repository
      || initialPublicationReceipt.provenance_workflow !== INITIAL_NPM_PUBLICATION_WORKFLOW
      || initialPublicationReceipt.provenance_ref !== `refs/tags/${distributionPolicy.initial_tag}`
      || initialPublicationReceipt.provenance_resolved_commit
        !== initialPublicationPolicy.candidate_commit) {
    blockers.push("Historical npm bootstrap controls are not bound to the preserved immutable 1.0.0 publication receipt and provenance identity.");
  }
  const initialProvenanceTimestamps = [];
  checkActionsProvenance(
    blockers,
    "npm initial publication",
    initialPublication,
    { commit: initialPublicationPolicy.candidate_commit },
    policy.monitoring_evidence?.canonical_repository,
    ["push"],
    initialPublicationPolicy.artifact_name,
    now,
    initialProvenanceTimestamps
  );
  if (initialPublication.provenance?.artifact_id !== initialPublicationPolicy.artifact_id
      || initialPublication.provenance?.artifact_digest_sha256
        !== initialPublicationPolicy.receipt_sha256) {
    blockers.push("npm initial publication provenance is not bound to the reviewed historical artifact ID and receipt digest.");
  }
  const initialPublicationObservedAt = Date.parse(initialPublication.observed_at);
  const initialPublicationDownloadedAt = Date.parse(initialPublication.provenance?.downloaded_at);
  const tokenCreatedAt = Date.parse(bootstrapControls.token_created_at);
  const tokenRevokedAt = Date.parse(bootstrapControls.token_revoked_at);
  const environmentSecretRemovedAt = Date.parse(bootstrapControls.environment_secret_removed_at);
  const trustedPublisherConfiguredAt = Date.parse(bootstrapControls.trusted_publisher_configured_at);
  const controlsVerifiedAt = Date.parse(bootstrapControls.verified_at);
  const maximumTokenLifetime = distributionPolicy.initial_token_max_lifetime_hours * 60 * 60 * 1_000;
  const controlReferences = [
    bootstrapControls.token_revocation_evidence_reference,
    bootstrapControls.environment_secret_removal_evidence_reference,
    bootstrapControls.trusted_publisher_evidence_reference
  ];
  const controlDigests = [
    bootstrapControls.token_revocation_evidence_sha256,
    bootstrapControls.environment_secret_removal_evidence_sha256,
    bootstrapControls.trusted_publisher_evidence_sha256
  ];
  const verifierAliases = identityAliases(bootstrapControls.verified_by);
  if (distributionPolicy.initial_registry_authentication !== "short-lived-granular-token"
      || bootstrapControls.package_version !== distributionPolicy.initial_package_version
      || bootstrapControls.tag !== distributionPolicy.initial_tag
      || bootstrapControls.workflow_path !== distributionPolicy.expected_initial_provenance_workflow
      || bootstrapControls.environment !== distributionPolicy.initial_publication_environment
      || distributionPolicy.subsequent_registry_authentication !== "github-oidc"
      || distributionPolicy.token_revocation_required !== true
      || distributionPolicy.environment_secret_removal_required !== true
      || distributionPolicy.trusted_publisher_configuration_required !== true
      || distributionPolicy.subsequent_workflow_path !== OIDC_NPM_PUBLICATION_WORKFLOW
      || !Number.isSafeInteger(distributionPolicy.initial_token_max_lifetime_hours)
      || distributionPolicy.initial_token_max_lifetime_hours <= 0
      || bootstrapControls.token_permissions !== distributionPolicy.initial_token_scope?.permissions
      || bootstrapControls.token_package_access !== distributionPolicy.initial_token_scope?.package_access
      || bootstrapControls.token_bypass_2fa !== distributionPolicy.initial_token_scope?.bypass_2fa
      || bootstrapControls.token_revoked !== true
      || bootstrapControls.environment_secret_removed !== true
      || bootstrapControls.trusted_publisher_configured !== true
      || !validDate(bootstrapControls.token_created_at)
      || !validDate(bootstrapControls.token_revoked_at)
      || !validDate(bootstrapControls.environment_secret_removed_at)
      || !validDate(bootstrapControls.trusted_publisher_configured_at)
      || !validDate(bootstrapControls.verified_at)
      || tokenCreatedAt > initialPublicationObservedAt
      || initialPublicationObservedAt > tokenRevokedAt
      || tokenRevokedAt - tokenCreatedAt > maximumTokenLifetime
      || environmentSecretRemovedAt < tokenRevokedAt
      || trustedPublisherConfiguredAt < tokenRevokedAt
      || controlsVerifiedAt < Math.max(
        tokenRevokedAt,
        environmentSecretRemovedAt,
        trustedPublisherConfiguredAt,
        initialPublicationDownloadedAt
      )
      || controlsVerifiedAt > now.getTime()
      || !present(bootstrapControls.verified_by)
      || implementationAliasSets.some((identity) => aliasesOverlap(verifierAliases, identity))
      || controlReferences.some((reference) => !validEvidenceReference(reference))
      || new Set(controlReferences.map(normalizeReference)).size !== controlReferences.length
      || controlDigests.some((value) => !SHA256_RE.test(value ?? ""))
      || new Set(controlDigests).size !== controlDigests.length) {
    blockers.push("Historical npm bootstrap controls do not independently evidence timely token revocation, environment-secret removal, and subsequent GitHub OIDC trusted-publisher configuration.");
  }

  const owners = evidence.owners ?? {};
  exactKeys(blockers, "Owner assignments", owners, policy.required_owners);
  for (const owner of policy.required_owners) if (!present(owners[owner])) blockers.push(`Required owner ${owner} is unassigned.`);
  const ownerAliasSets = Object.values(owners).filter(present).map(identityAliases);
  if (aliasSetsOverlap(ownerAliasSets)) blockers.push("Owner assignments must use distinct people under normalized identity matching.");
  const disallowedReviewerAliases = [
    ...ownerAliasSets,
    ...implementationAliasSets
  ];

  const reviews = evidence.reviews ?? {};
  exactKeys(blockers, "Independent reviews", reviews, policy.required_reviews);
  const acceptedReviewerAliases = [];
  const reviewEvidenceReferences = [];
  for (const reviewName of policy.required_reviews) {
    const review = reviews[reviewName];
    exactKeys(blockers, `Independent review ${reviewName}`, review, [
      "status", "reviewer", "reviewed_at", "independent", "evidence_reference",
      "candidate_commit", "candidate_artifact_fingerprint_sha256"
    ]);
    if (!review || review.status !== "accepted" || !present(review.reviewer) || !validDate(review.reviewed_at)) {
      blockers.push(`Independent review ${reviewName} is not accepted with reviewer/date evidence.`);
    }
    const reviewerAliases = identityAliases(review?.reviewer);
    if (review?.independent !== true || disallowedReviewerAliases.some((identity) => aliasesOverlap(reviewerAliases, identity))) {
      blockers.push(`Reviewer for ${reviewName} is not independent from every owner and implementation identity.`);
    }
    if (reviewerAliases.size) acceptedReviewerAliases.push(reviewerAliases);
    if (timestampAfterBuild(blockers, `Independent review ${reviewName}`, review?.reviewed_at, candidate.built_at, now)) {
      gatingTimestamps.push(Date.parse(review.reviewed_at));
    }
    if (!validEvidenceReference(review?.evidence_reference)) blockers.push(`Independent review ${reviewName} lacks a safe redacted evidence reference.`);
    reviewEvidenceReferences.push(normalizeReference(review?.evidence_reference));
    checkCandidateBinding(blockers, `Independent review ${reviewName}`, review, candidate, "artifact");
  }
  if (aliasSetsOverlap(acceptedReviewerAliases)) blockers.push("Security, platform, and accessibility reviews must have distinct independent reviewers.");
  if (reviewEvidenceReferences.some((reference) => !reference) || new Set(reviewEvidenceReferences).size !== reviewEvidenceReferences.length) {
    blockers.push("Security, platform, and accessibility reviews must use distinct evidence references.");
  }

  exactKeys(blockers, "Pilot evidence", evidence.pilot, ["sessions"]);
  if (!Array.isArray(evidence.pilot?.sessions)) blockers.push("Pilot sessions must be an array.");
  const sessions = Array.isArray(evidence.pilot?.sessions) ? evidence.pilot.sessions : [];
  if (sessions.length < policy.pilot.minimum_total) blockers.push(`Pilot has ${sessions.length}/${policy.pilot.minimum_total} required sessions.`);
  const duskds = sessions.filter((session) => session.path === "duskds");
  if (duskds.length < policy.pilot.minimum_duskds) blockers.push(`Pilot has ${duskds.length}/${policy.pilot.minimum_duskds} required DuskDS sessions.`);
  if (productionPaths.includes("evm")) {
    const evm = sessions.filter((session) => session.path === "evm");
    if (evm.length < policy.pilot.minimum_evm) blockers.push(`Pilot has ${evm.length}/${policy.pilot.minimum_evm} required EVM sessions.`);
  }
  if (sessions.some((session) => !productionPaths.includes(session.path))) blockers.push("Pilot evidence includes a non-production path.");
  for (const experience of policy.pilot.required_experience) if (!sessions.some((session) => session.experience === experience)) blockers.push(`Pilot lacks ${experience} experience coverage.`);
  for (const context of policy.pilot.required_contexts) if (!sessions.some((session) => session.context === context)) blockers.push(`Pilot lacks ${context} context coverage.`);
  const completionRate = sessions.length ? sessions.filter((session) => session.completed === true).length / sessions.length : 0;
  if (completionRate < policy.pilot.minimum_completion_rate) blockers.push(`Pilot completion rate ${completionRate.toFixed(2)} is below ${policy.pilot.minimum_completion_rate}.`);
  const recoveryAttempts = sessions.filter((session) => session.recovery_attempted === true);
  const recoveryRate = recoveryAttempts.length ? recoveryAttempts.filter((session) => session.recovered === true).length / recoveryAttempts.length : 0;
  if (!recoveryAttempts.length || recoveryRate < policy.pilot.minimum_recovery_rate) blockers.push(`Pilot recovery rate ${recoveryRate.toFixed(2)} is below ${policy.pilot.minimum_recovery_rate}.`);
  const trustScores = sessions.map((session) => session.trust_score).filter((score) => Number.isFinite(score));
  const averageTrust = trustScores.length === sessions.length && sessions.length ? trustScores.reduce((sum, score) => sum + score, 0) / sessions.length : 0;
  if (averageTrust < policy.pilot.minimum_average_trust_score) blockers.push(`Pilot trust score ${averageTrust.toFixed(2)} is below ${policy.pilot.minimum_average_trust_score}.`);
  const blockingConfusion = sessions.filter((session) => session.blocking_confusion === true).length;
  if (blockingConfusion > policy.pilot.maximum_blocking_confusion) blockers.push(`Pilot recorded ${blockingConfusion} blocking confusion events.`);
  if (sessions.some((session) => !PSEUDONYMOUS_ID_RE.test(session.id ?? "") || !Number.isFinite(session.duration_minutes) || session.duration_minutes <= 0)) blockers.push("Every pilot session needs a non-identifying pseudonymous id and positive duration.");
  if (new Set(sessions.map((session) => normalizeReference(session.id))).size !== sessions.length) blockers.push("Pilot session ids must be unique.");
  const attemptedRecoveryReferences = sessions
    .filter((session) => session.recovery_attempted === true)
    .map((session) => normalizeReference(session.recovery_evidence_reference));
  if (attemptedRecoveryReferences.some((reference) => !reference)
      || new Set(attemptedRecoveryReferences).size !== attemptedRecoveryReferences.length) {
    blockers.push("Every attempted pilot recovery must use its own unique evidence reference.");
  }
  const sessionRecordReferences = sessions.map((session) => normalizeReference(session.session_record_reference));
  if (sessionRecordReferences.some((reference) => !reference)
      || new Set(sessionRecordReferences).size !== sessionRecordReferences.length
      || sessionRecordReferences.some((reference) => attemptedRecoveryReferences.includes(reference))) {
    blockers.push("Every pilot session must use its own unique canonical session record reference.");
  }
  for (const session of sessions) {
    exactKeys(blockers, `Pilot session ${session.id ?? "unknown"}`, session, [
      "id", "path", "experience", "context", "completed", "controlled_failure", "failure_scenario",
      "recovery_attempted", "recovered", "recovery_evidence_reference", "started_at", "completed_at",
      "candidate_commit", "candidate_artifact_fingerprint_sha256", "trust_score",
      "blocking_confusion", "duration_minutes", "session_record_reference"
    ]);
    checkCandidateBinding(blockers, `Pilot session ${session.id ?? "unknown"}`, session, candidate, "artifact");
    if (!productionPaths.includes(session.path)
        || !policy.pilot.required_experience.includes(session.experience)
        || !policy.pilot.required_contexts.includes(session.context)
        || typeof session.completed !== "boolean"
        || typeof session.blocking_confusion !== "boolean"
        || !Number.isFinite(session.trust_score)
        || session.trust_score < 1
        || session.trust_score > 5) {
      blockers.push(`Pilot session ${session.id ?? "unknown"} has invalid path, cohort, outcome, confusion, or 1-5 trust evidence.`);
    }
    const startedAt = Date.parse(session.started_at);
    const completedAt = Date.parse(session.completed_at);
    const exactDurationMinutes = (completedAt - startedAt) / 60_000;
    if (session.controlled_failure !== true
        || session.recovery_attempted !== true
        || typeof session.recovered !== "boolean"
        || !present(session.failure_scenario)
        || !validEvidenceReference(session.recovery_evidence_reference)
        || !validEvidenceReference(session.session_record_reference)
        || !Number.isSafeInteger(session.duration_minutes)
        || session.duration_minutes !== exactDurationMinutes
        || !timestampAfterBuild(blockers, `Pilot session ${session.id ?? "unknown"} start`, session.started_at, candidate.built_at, now)
        || !timestampAfterBuild(blockers, `Pilot session ${session.id ?? "unknown"} completion`, session.completed_at, candidate.built_at, now)
        || completedAt <= startedAt) {
      blockers.push(`Pilot session ${session.id ?? "unknown"} lacks its own dated canonical session, controlled-failure, and recovery-attempt evidence.`);
    } else {
      gatingTimestamps.push(completedAt);
    }
  }

  const liveSmoke = evidence.live_smoke ?? {};
  exactKeys(blockers, "DuskDS production smoke", liveSmoke, [
    "status", "authority_reference", "redacted", "candidate_commit",
    "candidate_artifact_fingerprint_sha256", "receipt_sha256", "receipt_json",
    "workflow_path", "run_url", "artifact_name", "observed_at", "native_steps", "provenance"
  ]);
  if (liveSmoke.status !== "passed" || !present(liveSmoke.authority_reference) || liveSmoke.redacted !== true) blockers.push("DuskDS production smoke lacks passed status, explicit authority reference, or redaction evidence.");
  checkCandidateBinding(blockers, "DuskDS production smoke", liveSmoke, candidate, "artifact");
  checkActionsReference(blockers, "DuskDS production smoke", liveSmoke, policy.monitoring_evidence?.canonical_repository, NATIVE_SMOKE_WORKFLOW);
  const nativeRunId = actionsRunId(liveSmoke.run_url, policy.monitoring_evidence?.canonical_repository);
  if (liveSmoke.artifact_name !== `duskds-native-smoke-receipt-${nativeRunId ?? "invalid"}.json`) blockers.push("DuskDS production smoke artifact name is not bound to its Actions run.");
  const nativeReceipt = parseBoundReceipt(blockers, "DuskDS production smoke", liveSmoke);
  exactKeys(blockers, "DuskDS production smoke receipt", nativeReceipt, [
    "schema_version", "status", "candidate_commit", "candidate_artifact_fingerprint_sha256",
    "workflow_path", "observed_at", "contract_sha256", "data_driver_sha256", "native_steps"
  ]);
  if (nativeReceipt.schema_version !== 1
      || nativeReceipt.status !== "passed"
      || nativeReceipt.candidate_commit !== candidate.commit
      || nativeReceipt.candidate_artifact_fingerprint_sha256 !== candidate.artifact_fingerprint_sha256
      || nativeReceipt.workflow_path !== NATIVE_SMOKE_WORKFLOW
      || nativeReceipt.observed_at !== liveSmoke.observed_at
      || !SHA256_RE.test(nativeReceipt.contract_sha256 ?? "")
      || !SHA256_RE.test(nativeReceipt.data_driver_sha256 ?? "")
      || nativeReceipt.contract_sha256 === nativeReceipt.data_driver_sha256
      || JSON.stringify(nativeReceipt.native_steps) !== JSON.stringify(liveSmoke.native_steps)) {
    blockers.push("DuskDS production smoke receipt does not prove the exact candidate, workflow, timestamp, and native steps.");
  }
  if (timestampAfterBuild(blockers, "DuskDS production smoke", liveSmoke.observed_at, candidate.built_at, now)) {
    gatingTimestamps.push(Date.parse(liveSmoke.observed_at));
  }
  checkActionsProvenance(
    blockers,
    "DuskDS production smoke",
    liveSmoke,
    candidate,
    policy.monitoring_evidence?.canonical_repository,
    ["workflow_dispatch"],
    `duskds-native-smoke-receipt-${nativeRunId ?? "invalid"}.json`,
    now,
    gatingTimestamps
  );
  checkSteps(blockers, "DuskDS production smoke", liveSmoke.native_steps, policy.required_native_smoke_steps);
  if (productionPaths.includes("evm")) checkSteps(blockers, "EVM production smoke", liveSmoke.evm_steps, policy.required_evm_smoke_steps);

  const synthetics = evidence.synthetics ?? {};
  exactKeys(blockers, "Synthetic evidence", synthetics, ["public_assurance", "checks", "monitoring", "alert_delivery", "checked_at"]);
  const monitoringPolicy = policy.monitoring_evidence ?? {};
  const publicAssurance = synthetics.public_assurance ?? {};
  exactKeys(blockers, "Public assurance receipt", publicAssurance, [
    "candidate_commit", "candidate_public_fingerprint_sha256", "receipt_sha256", "receipt_json",
    "workflow_path", "run_url", "artifact_name", "observed_at", "provenance"
  ]);
  checkCandidateBinding(blockers, "Public assurance receipt", publicAssurance, candidate, "public");
  checkActionsReference(blockers, "Public assurance receipt", publicAssurance, monitoringPolicy.canonical_repository, PUBLIC_ASSURANCE_WORKFLOW);
  const publicRunId = actionsRunId(publicAssurance.run_url, monitoringPolicy.canonical_repository);
  if (publicAssurance.artifact_name !== `studio-public-synthetic-receipt-${publicRunId ?? "invalid"}.json`) blockers.push("Public assurance artifact name is not bound to its Actions run.");
  const publicReceipt = parseBoundReceipt(blockers, "Public assurance", publicAssurance);
  checkPublicReceiptShape(blockers, publicReceipt, policy, previewPaths);
  const publicReleaseParity = publicReceipt.checks?.release_parity ?? {};
  let expectedPublicOrigin = "";
  try {
    expectedPublicOrigin = new URL(candidate.manifest_url).origin;
  } catch {
    expectedPublicOrigin = "";
  }
  if (publicReceipt.schema_version !== 1
      || publicReceipt.status !== "passed"
      || publicReceipt.expected_environment !== "production"
      || publicReceipt.studio_status !== "passed"
      || publicReceipt.upstream_dependency_status !== "passed"
      || publicReceipt.checked_at !== publicAssurance.observed_at
      || synthetics.checked_at !== publicAssurance.observed_at
      || publicReceipt.target !== expectedPublicOrigin
      || !Array.isArray(publicReceipt.errors)
      || publicReceipt.errors.length
      || publicReleaseParity.status !== "passed"
      || publicReleaseParity.commit !== candidate.commit
      || publicReleaseParity.version !== candidate.release_id
      || publicReleaseParity.artifact_fingerprint_sha256 !== candidate.public_fingerprint_sha256) {
    blockers.push("Public assurance receipt does not prove the exact public candidate, origin, passed checks, and receipt timestamp.");
  }
  if (timestampAfterBuild(blockers, "Public assurance receipt", publicAssurance.observed_at, candidate.built_at, now)) {
    gatingTimestamps.push(Date.parse(publicAssurance.observed_at));
  }
  checkActionsProvenance(
    blockers,
    "Public assurance receipt",
    publicAssurance,
    candidate,
    monitoringPolicy.canonical_repository,
    ["schedule"],
    `studio-public-synthetic-receipt-${publicRunId ?? "invalid"}.json`,
    now,
    gatingTimestamps
  );

  const checks = synthetics.checks ?? {};
  const expectedCheckNames = [...policy.required_synthetic_checks];
  if (previewPaths.includes("evm") && !expectedCheckNames.includes("rpc_chain_id")) expectedCheckNames.push("rpc_chain_id");
  exactKeys(blockers, "Synthetic checks", checks, expectedCheckNames);
  for (const check of policy.required_synthetic_checks) {
    const result = checks[check];
    const commonKeys = ["status", "owner", "candidate_commit", "candidate_public_fingerprint_sha256"];
    const checkKeys = check === "duskds_node_read"
      ? [...commonKeys, "endpoint", "height", "hash", "observed_at"]
      : check === "monitor_heartbeat"
        ? [...commonKeys, "receipt_sha256", "receipt_json", "workflow_path", "guard_run_url", "artifact_name", "observed_at", "observed_public_run_url", "provenance"]
        : check === "external_dead_man"
          ? [...commonKeys, "evidence_reference", "outside_github", "success_endpoint_configured", "provider", "check_id", "alert_channel", "alert_delivery_verified", "latest_success_at", "missed_ping_rehearsed_at", "rehearsal_reference"]
          : check === "external_direct_health"
            ? [...commonKeys, "evidence_reference", "outside_github", "provider", "check_id", "target_url", "response_status", "body_match", "tls_verified", "alert_channel", "alert_delivery_verified", "latest_success_at", "alert_rehearsed_at", "recovery_verified", "recovered_at", "rehearsal_reference"]
            : commonKeys;
    exactKeys(blockers, `Synthetic check ${check}`, result, checkKeys);
    if (!result || result.status !== "passed" || !present(result.owner)) blockers.push(`Synthetic check ${check} is not passed with an owner.`);
    checkCandidateBinding(blockers, `Synthetic check ${check}`, result, candidate, "public");
    if (EXTERNAL_SYNTHETIC_CHECKS.has(check)) {
      if (!validEvidenceReference(result?.evidence_reference)) blockers.push(`Synthetic check ${check} lacks a safe independent evidence reference.`);
    } else if (check !== "monitor_heartbeat" && publicReceipt.checks?.[check]?.status !== "passed") {
      blockers.push(`Synthetic check ${check} is not passed in the bound public-assurance receipt.`);
    }
  }
  const duskDsNodeRead = checks.duskds_node_read ?? {};
  const nodeReadEvidencePolicy = policy.duskds_node_read_evidence ?? {};
  const nodeReadMaxAge = nodeReadEvidencePolicy.max_age_hours * 60 * 60 * 1_000;
  const nodeReadReceiptSkew = nodeReadEvidencePolicy.max_receipt_skew_minutes * 60 * 1_000;
  const nodeReadObservedAt = Date.parse(duskDsNodeRead.observed_at);
  const syntheticCheckedAt = Date.parse(synthetics.checked_at);
  const receiptNodeRead = publicReceipt.checks?.duskds_node_read ?? {};
  const nodeReadBoundToReceipt = Number.isFinite(nodeReadObservedAt)
    && Number.isFinite(syntheticCheckedAt)
    && nodeReadObservedAt <= syntheticCheckedAt
    && syntheticCheckedAt - nodeReadObservedAt <= nodeReadReceiptSkew;
  if (duskDsNodeRead.endpoint !== policy.duskds_testnet_graphql_url
      || !Number.isSafeInteger(duskDsNodeRead.height) || duskDsNodeRead.height <= 0
      || !DUSKDS_BLOCK_HASH_RE.test(duskDsNodeRead.hash ?? "")
      || receiptNodeRead.endpoint !== duskDsNodeRead.endpoint
      || receiptNodeRead.height !== duskDsNodeRead.height
      || receiptNodeRead.hash !== duskDsNodeRead.hash
      || receiptNodeRead.observed_at !== duskDsNodeRead.observed_at
      || !freshDate(duskDsNodeRead.observed_at, now, nodeReadMaxAge)
      || !freshDate(synthetics.checked_at, now, nodeReadMaxAge)
      || !nodeReadBoundToReceipt) {
    blockers.push("DuskDS node-read evidence lacks the exact Testnet endpoint, positive bounded height, 64-hex hash, fresh observation, or binding to the synthetic receipt.");
  }
  timestampAfterBuild(blockers, "DuskDS node-read synthetic", duskDsNodeRead.observed_at, candidate.built_at, now);
  if (previewPaths.includes("evm")) {
    const deferredRpc = checks.rpc_chain_id;
    exactKeys(blockers, "Deferred DuskEVM RPC record", deferredRpc, [
      "status", "path", "reason", "authority_reference", "candidate_commit", "candidate_public_fingerprint_sha256"
    ]);
    if (deferredRpc?.status !== "deferred" || deferredRpc.path !== "evm" || deferredRpc.reason !== rpcDeferralPolicy?.reason) {
      blockers.push("DuskEVM RPC is not recorded as the exact reviewed pre-launch deferral.");
    }
    if (publicReceipt.checks?.rpc_chain_id?.status !== deferredRpc?.status
        || publicReceipt.checks?.rpc_chain_id?.path !== deferredRpc?.path
        || publicReceipt.checks?.rpc_chain_id?.reason !== deferredRpc?.reason) {
      blockers.push("DuskEVM RPC deferral does not match the bound public-assurance receipt.");
    }
    checkCandidateBinding(blockers, "Deferred DuskEVM RPC record", deferredRpc, candidate, "public");
    if (!present(deferredRpc?.authority_reference)) blockers.push("Deferred DuskEVM RPC record lacks its reviewed policy reference.");
  }
  const monitoringEvidence = synthetics.monitoring ?? {};
  exactKeys(blockers, "Monitoring-mode evidence", monitoringEvidence, ["mode", "owner", "authority_reference"]);
  const monitoringMode = monitoringPolicy.mode;
  if (!["github-only", "external"].includes(monitoringMode)) {
    blockers.push("Monitoring policy mode must be github-only or external.");
  }
  if (monitoringEvidence.mode !== monitoringMode
      || !present(monitoringEvidence.owner)
      || !present(monitoringEvidence.authority_reference)) {
    blockers.push("Synthetic evidence is not bound to the reviewed monitoring mode, owner, and authority.");
  }
  const heartbeat = checks.monitor_heartbeat ?? {};
  const heartbeatMaxAge = monitoringPolicy.monitor_heartbeat_max_age_hours * 60 * 60 * 1_000;
  const heartbeatActionRecord = { ...heartbeat, run_url: heartbeat.guard_run_url };
  checkActionsReference(blockers, "Monitor heartbeat", heartbeatActionRecord, monitoringPolicy.canonical_repository, monitoringPolicy.schedule_guard_workflow);
  const guardRunId = actionsRunId(heartbeat.guard_run_url, monitoringPolicy.canonical_repository);
  if (heartbeat.artifact_name !== `studio-monitor-heartbeat-${guardRunId ?? "invalid"}.json`) blockers.push("Monitor heartbeat artifact name is not bound to its schedule-guard run.");
  const heartbeatReceipt = parseBoundReceipt(blockers, "Monitor heartbeat", heartbeat);
  exactKeys(blockers, "Monitor heartbeat receipt", heartbeatReceipt, [
    "schema_version", "status", "workflow_path", "checked_at", "max_age_seconds",
    "workflow_id", "workflow_state", "last_run_id", "last_run_url", "last_run_status",
    "last_run_conclusion", "last_run_created_at", "age_seconds"
  ]);
  const heartbeatCheckedAt = Date.parse(heartbeatReceipt.checked_at);
  const heartbeatLastRunCreatedAt = Date.parse(heartbeatReceipt.last_run_created_at);
  const heartbeatAgeSeconds = Math.floor((heartbeatCheckedAt - heartbeatLastRunCreatedAt) / 1_000);
  if (heartbeatReceipt.schema_version !== 1
      || heartbeatReceipt.status !== "passed"
      || heartbeatReceipt.workflow_path !== PUBLIC_ASSURANCE_WORKFLOW
      || heartbeatReceipt.checked_at !== heartbeat.observed_at
      || !validDate(heartbeatReceipt.checked_at)
      || !validDate(heartbeatReceipt.last_run_created_at)
      || !Number.isSafeInteger(heartbeatReceipt.max_age_seconds)
      || heartbeatReceipt.max_age_seconds <= 0
      || heartbeatReceipt.max_age_seconds > monitoringPolicy.monitor_heartbeat_max_age_hours * 60 * 60
      || !Number.isSafeInteger(heartbeatReceipt.age_seconds)
      || heartbeatReceipt.age_seconds !== heartbeatAgeSeconds
      || heartbeatReceipt.age_seconds < 0
      || heartbeatReceipt.age_seconds > heartbeatReceipt.max_age_seconds
      || heartbeatLastRunCreatedAt > Date.parse(publicAssurance.observed_at)
      || heartbeatReceipt.last_run_url !== publicAssurance.run_url
      || heartbeat.observed_public_run_url !== publicAssurance.run_url
      || heartbeatReceipt.last_run_status !== "completed"
      || heartbeatReceipt.last_run_conclusion !== "success"
      || Date.parse(heartbeat.observed_at) < Date.parse(publicAssurance.observed_at)
      || !freshDate(heartbeat.observed_at, now, heartbeatMaxAge)) {
    blockers.push("Monitor heartbeat receipt does not prove a fresh successful scheduled run of the bound public assurance.");
  }
  if (timestampAfterBuild(blockers, "Monitor heartbeat", heartbeat.observed_at, candidate.built_at, now)) {
    gatingTimestamps.push(Date.parse(heartbeat.observed_at));
  }
  checkActionsProvenance(
    blockers,
    "Monitor heartbeat",
    heartbeatActionRecord,
    candidate,
    monitoringPolicy.canonical_repository,
    ["schedule"],
    `studio-monitor-heartbeat-${guardRunId ?? "invalid"}.json`,
    now,
    gatingTimestamps
  );
  if (monitoringMode === "github-only") {
    const acceptedRisk = monitoringPolicy.accepted_risk ?? {};
    const externalRequired = ["external_dead_man", "external_direct_health"].filter((check) => policy.required_synthetic_checks.includes(check));
    if (externalRequired.length) blockers.push(`GitHub-only monitoring cannot require external checks: ${externalRequired.join(", ")}.`);
    const acceptedAt = Date.parse(acceptedRisk.accepted_at);
    if (acceptedRisk.owner !== "George"
        || !validDate(acceptedRisk.accepted_at)
        || acceptedAt > now.getTime()
        || !present(acceptedRisk.authority_reference)
        || monitoringEvidence.owner !== acceptedRisk.owner
        || monitoringEvidence.authority_reference !== acceptedRisk.authority_reference
        || !present(acceptedRisk.rationale)
        || !present(acceptedRisk.residual_risk)
        || !Array.isArray(acceptedRisk.revisit_triggers)
        || acceptedRisk.revisit_triggers.length < 2
        || acceptedRisk.revisit_triggers.some((trigger) => !present(trigger))) {
      blockers.push("GitHub-only monitoring lacks a complete George-approved accepted-risk record and matching evidence binding.");
    } else {
      gatingTimestamps.push(acceptedAt);
    }
  }
  if (monitoringMode === "external") {
    for (const required of ["external_dead_man", "external_direct_health"]) {
      if (!policy.required_synthetic_checks.includes(required)) blockers.push(`External monitoring policy must require ${required}.`);
    }
    const external = checks.external_dead_man ?? {};
    const externalSuccessMaxAge = monitoringPolicy.external_success_max_age_hours * 60 * 60 * 1_000;
    const externalRehearsalMaxAge = monitoringPolicy.external_rehearsal_max_age_days * 24 * 60 * 60 * 1_000;
    if (external.outside_github !== true
        || external.success_endpoint_configured !== true
        || !present(external.provider) || /github/i.test(external.provider)
        || !present(external.check_id)
        || !present(external.alert_channel) || /github/i.test(external.alert_channel)
        || external.alert_delivery_verified !== true
        || !freshDate(external.latest_success_at, now, externalSuccessMaxAge)
        || !freshDate(external.missed_ping_rehearsed_at, now, externalRehearsalMaxAge)
        || !validEvidenceReference(external.rehearsal_reference)) {
      blockers.push("External dead-man evidence lacks an outside-GitHub provider/check, fresh success, verified out-of-band alert, or recent missed-ping rehearsal.");
    }
    for (const [label, value] of [
      ["External dead-man success", external.latest_success_at],
      ["External dead-man rehearsal", external.missed_ping_rehearsed_at]
    ]) {
      if (timestampAfterBuild(blockers, label, value, candidate.built_at, now)) gatingTimestamps.push(Date.parse(value));
    }
    const directHealth = checks.external_direct_health ?? {};
    const directHealthMaxAge = monitoringPolicy.direct_health_max_age_hours * 60 * 60 * 1_000;
    const directAlertAt = Date.parse(directHealth.alert_rehearsed_at);
    const directRecoveredAt = Date.parse(directHealth.recovered_at);
    const directSuccessAt = Date.parse(directHealth.latest_success_at);
    const directRecoveryChronology = Number.isFinite(directAlertAt)
      && Number.isFinite(directRecoveredAt)
      && Number.isFinite(directSuccessAt)
      && directAlertAt < directRecoveredAt
      && directRecoveredAt < directSuccessAt;
    if (directHealth.outside_github !== true
        || !present(directHealth.provider) || /github/i.test(directHealth.provider)
        || !present(directHealth.check_id) || directHealth.check_id === external.check_id
        || !expectedDirectHealthTarget(directHealth.target_url, candidate.manifest_url)
        || directHealth.response_status !== 200
        || directHealth.body_match !== "ok"
        || directHealth.tls_verified !== true
        || !present(directHealth.alert_channel) || /github/i.test(directHealth.alert_channel)
        || directHealth.alert_delivery_verified !== true
        || !freshDate(directHealth.latest_success_at, now, directHealthMaxAge)
        || !freshDate(directHealth.alert_rehearsed_at, now, externalRehearsalMaxAge)
        || directHealth.recovery_verified !== true
        || !freshDate(directHealth.recovered_at, now, externalRehearsalMaxAge)
        || !directRecoveryChronology
        || !validEvidenceReference(directHealth.rehearsal_reference)) {
      blockers.push("External direct health evidence lacks a separate outside-GitHub /healthz check, exact target, fresh 200/ok/TLS success, or chronological verified alert-to-recovery proof.");
    }
    for (const [label, value] of [
      ["External direct-health success", directHealth.latest_success_at],
      ["External direct-health alert", directHealth.alert_rehearsed_at],
      ["External direct-health recovery", directHealth.recovered_at]
    ]) {
      if (timestampAfterBuild(blockers, label, value, candidate.built_at, now)) gatingTimestamps.push(Date.parse(value));
    }
  }
  if (!freshDate(synthetics.checked_at, now, nodeReadMaxAge)) blockers.push("Synthetic receipt timestamp is missing or stale.");
  const alertDelivery = synthetics.alert_delivery ?? {};
  exactKeys(blockers, "Synthetic alert delivery", alertDelivery, [
    "candidate_commit", "candidate_public_fingerprint_sha256", "receipt_sha256", "receipt_json",
    "workflow_path", "run_url", "artifact_name", "observed_at", "provenance"
  ]);
  checkCandidateBinding(blockers, "Synthetic alert delivery", alertDelivery, candidate, "public");
  checkActionsReference(blockers, "Synthetic alert delivery", alertDelivery, monitoringPolicy.canonical_repository, PUBLIC_ASSURANCE_WORKFLOW);
  const alertRunId = actionsRunId(alertDelivery.run_url, monitoringPolicy.canonical_repository);
  if (alertDelivery.artifact_name !== `studio-alert-delivery-receipt-${alertRunId ?? "invalid"}.json`) blockers.push("Synthetic alert-delivery artifact name is not bound to its Actions run.");
  const alertReceipt = parseBoundReceipt(blockers, "Synthetic alert delivery", alertDelivery);
  exactKeys(blockers, "Synthetic alert-delivery receipt", alertReceipt, [
    "schema_version", "status", "channel", "owner", "issue_number", "issue_closed", "run_id",
    "candidate_commit", "candidate_public_fingerprint_sha256", "workflow_path", "observed_at"
  ]);
  if (alertReceipt.schema_version !== 2
      || alertReceipt.status !== "passed"
      || alertReceipt.channel !== "github-assigned-issue"
      || alertReceipt.owner !== "George"
      || !Number.isSafeInteger(alertReceipt.issue_number)
      || alertReceipt.issue_number <= 0
      || alertReceipt.issue_closed !== true
      || String(alertReceipt.run_id) !== alertRunId
      || alertReceipt.candidate_commit !== candidate.commit
      || alertReceipt.candidate_public_fingerprint_sha256 !== candidate.public_fingerprint_sha256
      || alertReceipt.workflow_path !== PUBLIC_ASSURANCE_WORKFLOW
      || alertReceipt.observed_at !== alertDelivery.observed_at
      || !freshDate(alertDelivery.observed_at, now, nodeReadMaxAge)) {
    blockers.push("Synthetic alert-delivery receipt does not prove the exact candidate, workflow run, assigned issue, closure, and timestamp.");
  }
  if (timestampAfterBuild(blockers, "Synthetic alert delivery", alertDelivery.observed_at, candidate.built_at, now)) {
    gatingTimestamps.push(Date.parse(alertDelivery.observed_at));
  }
  checkActionsProvenance(
    blockers,
    "Synthetic alert delivery",
    alertDelivery,
    candidate,
    monitoringPolicy.canonical_repository,
    ["workflow_dispatch"],
    `studio-alert-delivery-receipt-${alertRunId ?? "invalid"}.json`,
    now,
    gatingTimestamps
  );

  exactKeys(blockers, "Rollback evidence", evidence.rollback, ["product", "platform"]);
  for (const kind of ["product", "platform"]) {
    const rollback = evidence.rollback?.[kind];
    exactKeys(blockers, `${kind} rollback`, rollback, [
      "owner", "target", "result", "duration_seconds",
      "prior_release_id", "prior_commit", "prior_fingerprint_sha256",
      "candidate_release_id", "candidate_commit", "candidate_artifact_fingerprint_sha256",
      "restored_fingerprint_sha256", "started_at", "completed_at",
      "evidence_reference", "health_proof", "data_cache_effects", "receipt_sha256", "receipt_json"
    ]);
    const startedAt = Date.parse(rollback?.started_at);
    const completedAt = Date.parse(rollback?.completed_at);
    const measuredDuration = (completedAt - startedAt) / 1_000;
    if (!rollback || rollback.target !== kind || rollback.result !== "passed" || !present(rollback.owner)
        || !Number.isSafeInteger(rollback.duration_seconds)
        || rollback.duration_seconds <= 0 || rollback.duration_seconds > policy.rollback_targets_seconds[kind]
        || rollback.duration_seconds !== measuredDuration) {
      blockers.push(`${kind} rollback has not passed within ${policy.rollback_targets_seconds[kind]} seconds with an owner.`);
    }
    checkCandidateBinding(blockers, `${kind} rollback`, rollback, candidate, "artifact");
    if (!present(rollback?.prior_release_id)
        || !present(rollback?.candidate_release_id)
        || normalizeReference(rollback?.prior_release_id) === normalizeReference(rollback?.candidate_release_id)
        || rollback?.candidate_release_id !== candidate.release_id
        || !COMMIT_RE.test(rollback?.prior_commit ?? "")
        || rollback?.prior_commit === candidate.commit
        || !SHA256_RE.test(rollback?.prior_fingerprint_sha256 ?? "")
        || rollback?.prior_fingerprint_sha256 !== rollback?.restored_fingerprint_sha256
        || !SHA256_RE.test(rollback?.restored_fingerprint_sha256 ?? "")
        || rollback?.restored_fingerprint_sha256 === candidate.artifact_fingerprint_sha256
        || !validEvidenceReference(rollback?.evidence_reference)
        || !validEvidenceReference(rollback?.health_proof)
        || !present(rollback?.data_cache_effects)) blockers.push(`${kind} rollback evidence is incomplete or not a distinct dated restore.`);
    const rollbackReceipt = parseBoundReceipt(blockers, `${kind} rollback`, rollback);
    const rollbackReceiptFields = [
      "owner", "target", "result", "duration_seconds",
      "prior_release_id", "prior_commit", "prior_fingerprint_sha256",
      "candidate_release_id", "candidate_commit", "candidate_artifact_fingerprint_sha256",
      "restored_fingerprint_sha256", "started_at", "completed_at",
      "evidence_reference", "health_proof", "data_cache_effects"
    ];
    exactKeys(blockers, `${kind} rollback receipt`, rollbackReceipt, ["schema_version", ...rollbackReceiptFields]);
    if (rollbackReceipt.schema_version !== 1
        || rollbackReceiptFields.some((field) => rollbackReceipt[field] !== rollback?.[field])) {
      blockers.push(`${kind} rollback receipt does not prove the exact A-to-B-to-A release restoration and evidence reference.`);
    }
    const startedValid = timestampAfterBuild(blockers, `${kind} rollback start`, rollback?.started_at, candidate.built_at, now);
    const completedValid = timestampAfterBuild(blockers, `${kind} rollback completion`, rollback?.completed_at, candidate.built_at, now);
    if (!startedValid || !completedValid || completedAt <= startedAt) {
      blockers.push(`${kind} rollback chronology is invalid.`);
    } else {
      gatingTimestamps.push(completedAt);
    }
  }
  const productRollback = evidence.rollback?.product ?? {};
  const platformRollback = evidence.rollback?.platform ?? {};
  if ((normalizeReference(productRollback.evidence_reference)
        && normalizeReference(productRollback.evidence_reference) === normalizeReference(platformRollback.evidence_reference))
      || (normalizeReference(productRollback.health_proof)
        && normalizeReference(productRollback.health_proof) === normalizeReference(platformRollback.health_proof))) {
    blockers.push("Product and platform rollback must use distinct evidence and health references.");
  }

  if (!Array.isArray(evidence.issues)) blockers.push("Issue evidence must be an array.");
  const issues = Array.isArray(evidence.issues) ? evidence.issues : [];
  const normalizedIssueIds = issues.map((issue) => normalizeReference(issue?.id));
  if (normalizedIssueIds.some((id) => !id) || new Set(normalizedIssueIds).size !== issues.length) blockers.push("Issue ids must be present and unique.");
  for (const issue of issues) {
    const closedHighSeverity = ["P0", "P1"].includes(issue?.severity) && issue?.status === "closed";
    const issueKeys = closedHighSeverity
      ? ["id", "severity", "status", "owner", "resolution_evidence", "closed_at", "candidate_commit", "candidate_artifact_fingerprint_sha256"]
      : Object.hasOwn(issue ?? {}, "exception")
        ? ["id", "severity", "status", "exception"]
        : ["id", "severity", "status"];
    exactKeys(blockers, `Issue ${issue?.id ?? "unknown"}`, issue, issueKeys);
    if (!["P0", "P1", "P2", "P3"].includes(issue?.severity)) blockers.push(`Issue ${issue?.id ?? "unknown"} has an invalid severity.`);
    if (!["open", "closed"].includes(issue?.status)) blockers.push(`Issue ${issue?.id ?? "unknown"} has an invalid status.`);
    if (Object.hasOwn(issue ?? {}, "exception")) {
      exactKeys(blockers, `Issue ${issue?.id ?? "unknown"} exception`, issue.exception, EXCEPTION_FIELDS);
      if (issue?.severity !== "P1") blockers.push(`Issue ${issue?.id ?? "unknown"} may not carry a P1 exception.`);
    }
    if (issue?.severity === "P0" && issue?.status !== "closed") blockers.push(`Non-closed P0 ${issue.id ?? "unknown"} blocks launch.`);
    if (issue?.severity === "P1" && issue?.status !== "closed") checkException(blockers, issue, candidate.built_at, now, gatingTimestamps);
    if (closedHighSeverity) {
      checkCandidateBinding(blockers, `Closed ${issue.severity} ${issue.id ?? "unknown"}`, issue, candidate, "artifact");
      if (!present(issue.owner) || !validEvidenceReference(issue.resolution_evidence)) {
        blockers.push(`Closed ${issue.severity} ${issue.id ?? "unknown"} lacks an owner and safe resolution evidence.`);
      }
      if (timestampAfterBuild(blockers, `Closed ${issue.severity} ${issue.id ?? "unknown"}`, issue.closed_at, candidate.built_at, now)) {
        gatingTimestamps.push(Date.parse(issue.closed_at));
      }
    }
  }

  const support = evidence.support ?? {};
  exactKeys(blockers, "Support evidence", support, ["on_call_owner", "support_channel_confirmed", "launch_message_owner", "incident_message_owner"]);
  if (!present(support.on_call_owner) || support.support_channel_confirmed !== true || !present(support.launch_message_owner) || !present(support.incident_message_owner)) blockers.push("Support/on-call/status communication ownership is incomplete.");

  const signoff = evidence.product_signoff ?? {};
  exactKeys(blockers, "Product sign-off", signoff, ["decision", "owner", "signed_at", "artifact_fingerprint_sha256"]);
  if (signoff.decision !== "go" || signoff.owner !== "George" || !validDate(signoff.signed_at) || signoff.artifact_fingerprint_sha256 !== candidate.artifact_fingerprint_sha256) {
    blockers.push("Product go/no-go sign-off is missing or does not bind the exact candidate fingerprint.");
  }
  const latestGatingTimestamp = Math.max(...gatingTimestamps);
  if (!validDate(signoff.signed_at)
      || Date.parse(signoff.signed_at) < latestGatingTimestamp
      || Date.parse(signoff.signed_at) > now.getTime()) {
    blockers.push("Product go/no-go sign-off must be no earlier than every gating record and no later than now.");
  }

  return {
    decision: blockers.length ? "no-go" : "go",
    blockers,
    metrics: {
      pilot_sessions: sessions.length,
      duskds_pilot_sessions: duskds.length,
      completion_rate: completionRate,
      recovery_rate: recoveryRate,
      average_trust_score: averageTrust,
      open_p0: issues.filter((issue) => issue.status !== "closed" && issue.severity === "P0").length,
      open_p1: issues.filter((issue) => issue.status !== "closed" && issue.severity === "P1").length
    }
  };
}

const ONLINE_PROVENANCE_BLOCKER = "Online GitHub Actions run, artifact, and receipt provenance has not been verified.";

export function evaluatePhase5Evidence(policy, evidence, options = {}) {
  const result = evaluatePhase5EvidenceTrusted(policy, evidence, options);
  return {
    ...result,
    decision: "no-go",
    blockers: result.blockers.includes(ONLINE_PROVENANCE_BLOCKER)
      ? result.blockers
      : [...result.blockers, ONLINE_PROVENANCE_BLOCKER]
  };
}

export async function evaluatePhase5EvidenceOnline(policy, evidence, options = {}) {
  const result = evaluatePhase5EvidenceTrusted(policy, evidence, options);
  if (result.decision !== "go") return result;
  try {
    const verified = await verifyPhase5GitHubProvenance(policy, evidence, options);
    return {
      ...result,
      assurance_scope: "policy-complete-under-trusted-operator-assembly",
      trusted_human_attestations: ["reviews", "pilots", "support", "rollback", "product_signoff"],
      github_actions: {
        verified_at: (options.now ?? new Date()).toISOString(),
        records: verified
      }
    };
  } catch (error) {
    return {
      ...result,
      decision: "no-go",
      blockers: [
        ...result.blockers,
        error instanceof Error ? error.message : "Online GitHub Actions provenance verification failed."
      ]
    };
  }
}
