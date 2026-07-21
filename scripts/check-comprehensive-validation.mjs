import fs from "node:fs/promises";
import path from "node:path";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { gunzipSync } from "node:zlib";
import { downloadGitHubActionsReceipt } from "./github-actions-provenance.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(scriptDirectory, "..");
const defaultPolicyPath = path.join(productRoot, "config", "comprehensive-validation-policy.json");
const defaultEvidencePath = path.join(
  productRoot,
  "docs",
  "evidence",
  "comprehensive-validation-evidence-2026-07-20.json"
);
const execFileAsync = promisify(execFile);

const PILOT_ID = /^CV-(?:CORE|NPM|UI|RES|SEC)-\d{2}$/u;
const EXECUTION_ID = /^CV-X-[A-Z0-9._-]+$/u;
const RETEST_ID = /^CV-R-[A-Z0-9._-]+$/u;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u;
const COMMIT_SHA = /^[a-f0-9]{40}$/u;
const PACKAGE_SHA256 = /^[a-f0-9]{64}$/u;
const COUNTED_CLASS = "black-box-pilot";
const FINAL_DEFECT_STATES = new Set(["verified", "invalidated"]);
const FINAL_RESULTS = new Set(["passed", "failed", "blocked"]);
const CLEAN_STATE_RESULTS = new Set(["passed", "failed", "not-applicable"]);
const TRACE_OUTCOMES = new Set(["success", "failure-recovery", "final-candidate"]);
const RECEIPT_EVIDENCE_CLASSES = Object.freeze({
  "black-box-pilot": "black-box-pilot",
  "defect-retest": "operator-receipt",
  "automated-regression": "automated-regression",
  "challenge-review": "challenge-review",
  "final-package-assurance": "package-lifecycle-smoke",
  "registry-verification": "operator-receipt",
  "production-verification": "operator-receipt"
});
const RECEIPT_PRODUCERS = Object.freeze({
  "black-box-pilot": ["codex-source-blind-pilot", "validator-test-fixture"],
  "defect-retest": ["codex-defect-retest", "validator-test-fixture"],
  "automated-regression": ["ci-automation", "validator-test-fixture"],
  "challenge-review": ["codex-independent-challenge", "validator-test-fixture"],
  "final-package-assurance": ["ci-package-assurance", "validator-test-fixture"],
  "registry-verification": ["npm-registry-verifier", "validator-test-fixture"],
  "production-verification": ["production-verifier", "validator-test-fixture"]
});
const RECEIPT_CAPTURE_MODES = Object.freeze({
  "black-box-pilot": ["source-blind-machine-observed", "validator-test-fixture"],
  "defect-retest": ["machine-observed", "validator-test-fixture"],
  "automated-regression": ["machine-observed", "validator-test-fixture"],
  "challenge-review": ["independent-adversarial", "validator-test-fixture"],
  "final-package-assurance": ["machine-observed", "validator-test-fixture"],
  "registry-verification": ["external-observation", "validator-test-fixture"],
  "production-verification": ["external-observation", "validator-test-fixture"]
});
const TRACE_OUTCOME_CLASSES = Object.freeze({
  success: new Set(["black-box-pilot", "automated-regression"]),
  "failure-recovery": new Set(["black-box-pilot", "operator-receipt", "automated-regression"]),
  "final-candidate": new Set(["black-box-pilot", "operator-receipt", "automated-regression"])
});
const TAR_BLOCK_BYTES = 512;
const DEFAULT_MAX_TAR_FILES = 512;
const DEFAULT_MAX_TAR_ARCHIVE_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TAR_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const MAX_DURABLE_RECEIPT_BYTES = 4 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set([
  "confidence",
  "confidence_score",
  "confusion",
  "confusion_score",
  "trust",
  "trust_rating"
]);

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function collectForbiddenKeys(value, trail = "$", findings = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectForbiddenKeys(item, `${trail}[${index}]`, findings));
    return findings;
  }
  if (!isObject(value)) return findings;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) findings.push(`${trail}.${key}`);
    collectForbiddenKeys(nested, `${trail}.${key}`, findings);
  }
  return findings;
}

function duplicateValues(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return [...duplicates];
}

function requiredSurfaceIds(policy) {
  const groups = policy.required_product_surfaces;
  if (!isObject(groups)) return [];
  return [...new Set(Object.values(groups).flatMap((items) => Array.isArray(items) ? items : []))];
}

function pushMissingObjectFields(value, fields, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object.`);
    return;
  }
  for (const field of fields) {
    if (!(field in value)) errors.push(`${label}.${field} is required.`);
  }
}

function isNonEmptyStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every((item) => typeof item === "string" && item.trim() !== "");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map((item) => canonicalize(item));
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
  );
}

function valuesMatch(left, right) {
  return JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));
}

function canonicalSha256(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function parseTimestamp(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(Z|([+-])(\d{2}):(\d{2}))$/u.exec(value ?? "");
  if (!match || !ISO_TIMESTAMP.test(value)) return null;
  const [, yearText, monthText, dayText, hourText, minuteText, secondText, , zone, sign, offsetHourText, offsetMinuteText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const offsetHour = zone === "Z" ? 0 : Number(offsetHourText);
  const offsetMinute = zone === "Z" ? 0 : Number(offsetMinuteText);
  if (
    month < 1 || month > 12
    || day < 1 || day > 31
    || hour > 23
    || minute > 59
    || second > 59
    || offsetHour > 14
    || offsetMinute > 59
    || (offsetHour === 14 && offsetMinute !== 0)
  ) return null;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return null;
  const signedOffsetMinutes = zone === "Z"
    ? 0
    : (sign === "+" ? 1 : -1) * (offsetHour * 60 + offsetMinute);
  const local = new Date(milliseconds + signedOffsetMinutes * 60 * 1_000);
  if (
    local.getUTCFullYear() !== year
    || local.getUTCMonth() + 1 !== month
    || local.getUTCDate() !== day
    || local.getUTCHours() !== hour
    || local.getUTCMinutes() !== minute
    || local.getUTCSeconds() !== second
  ) return null;
  return milliseconds;
}

function validationNowMilliseconds(value) {
  if (value === undefined) return Date.now();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  return Date.parse(value);
}

function validateTimestamp(value, label, errors, nowMilliseconds, futureSkewMilliseconds) {
  const milliseconds = parseTimestamp(value);
  if (milliseconds === null) {
    errors.push(`${label} must be an explicit valid ISO-8601 value.`);
    return null;
  }
  if (milliseconds > nowMilliseconds + futureSkewMilliseconds) {
    errors.push(`${label} must not be in the future.`);
  }
  return milliseconds;
}

function validateChronology(startedAt, endedAt, label, errors, nowMilliseconds, futureSkewMilliseconds) {
  const start = validateTimestamp(startedAt, `${label}.started_at`, errors, nowMilliseconds, futureSkewMilliseconds);
  const end = validateTimestamp(endedAt, `${label}.ended_at`, errors, nowMilliseconds, futureSkewMilliseconds);
  if (start !== null && end !== null && end < start) {
    errors.push(`${label}.ended_at must be at or after started_at.`);
  }
  return { start, end };
}

function validateFreshness(value, key, label, policy, errors, nowMilliseconds) {
  const maximumHours = policy.final_evidence_freshness_hours?.[key];
  const milliseconds = parseTimestamp(value);
  if (!Number.isFinite(maximumHours) || maximumHours <= 0) {
    errors.push(`policy.final_evidence_freshness_hours.${key} must be a positive number.`);
    return;
  }
  if (milliseconds !== null && nowMilliseconds - milliseconds > maximumHours * 60 * 60 * 1_000) {
    errors.push(`${label} exceeds the ${maximumHours}-hour final-evidence freshness window.`);
  }
}

function readTarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  const boundedEnd = end === -1 || end > offset + length ? offset + length : end;
  const value = buffer.subarray(offset, boundedEnd).toString("utf8");
  if (value.includes("\uFFFD")) throw new Error("The npm tarball contains invalid UTF-8 metadata.");
  return value;
}

function readTarOctal(buffer, offset, length, label) {
  const raw = readTarString(buffer, offset, length).trim();
  if (!/^[0-7]+$/u.test(raw)) throw new Error(`The npm tarball has an invalid ${label}.`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`The npm tarball has an unsafe ${label}.`);
  return value;
}

function safeTarPackagePath(value) {
  if (
    typeof value !== "string"
    || !value.startsWith("package/")
    || value.includes("\\")
    || value.includes("\u0000")
    || path.posix.isAbsolute(value)
  ) return null;
  const relative = value.slice("package/".length).replace(/\/$/u, "");
  if (!relative || path.posix.normalize(relative) !== relative || relative.startsWith("../")) return null;
  return relative;
}

function parseTarEntries(packageBytes, options = {}) {
  const maximumArchiveBytes = options.maxArchiveBytes ?? DEFAULT_MAX_TAR_ARCHIVE_BYTES;
  const maximumBytes = options.maxUncompressedBytes ?? DEFAULT_MAX_TAR_UNCOMPRESSED_BYTES;
  const maximumFiles = options.maxFiles ?? DEFAULT_MAX_TAR_FILES;
  if (
    !Buffer.isBuffer(packageBytes)
    || packageBytes.byteLength <= 0
    || packageBytes.byteLength > maximumArchiveBytes
  ) {
    throw new Error("The npm tarball has an invalid or oversized compressed payload.");
  }
  const tar = gunzipSync(packageBytes, { maxOutputLength: maximumBytes });
  if (tar.byteLength === 0 || tar.byteLength > maximumBytes || tar.byteLength % TAR_BLOCK_BYTES !== 0) {
    throw new Error("The npm tarball has an invalid or oversized uncompressed payload.");
  }
  const files = new Map();
  let offset = 0;
  let zeroBlocks = 0;
  while (offset + TAR_BLOCK_BYTES <= tar.byteLength) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES);
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      offset += TAR_BLOCK_BYTES;
      if (zeroBlocks >= 2) break;
      continue;
    }
    if (zeroBlocks > 0) throw new Error("The npm tarball contains data after an end marker.");
    const storedChecksum = readTarOctal(header, 148, 8, "header checksum");
    let computedChecksum = 0;
    for (let index = 0; index < TAR_BLOCK_BYTES; index += 1) {
      computedChecksum += index >= 148 && index < 156 ? 32 : header[index];
    }
    if (storedChecksum !== computedChecksum) throw new Error("The npm tarball header checksum is invalid.");
    if (readTarString(header, 257, 6) !== "ustar") {
      throw new Error("The npm tarball is not in the required ustar format.");
    }
    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const tarPath = prefix ? `${prefix}/${name}` : name;
    const relative = safeTarPackagePath(tarPath);
    if (!relative) throw new Error("The npm tarball contains an unsafe package path.");
    const size = readTarOctal(header, 124, 12, "file size");
    const type = String.fromCharCode(header[156] || 48);
    const contentOffset = offset + TAR_BLOCK_BYTES;
    const contentEnd = contentOffset + size;
    if (contentEnd > tar.byteLength) throw new Error("The npm tarball file payload is truncated.");
    if (type === "0") {
      if (files.has(relative)) throw new Error("The npm tarball contains a duplicate file path.");
      files.set(relative, Buffer.from(tar.subarray(contentOffset, contentEnd)));
      if (files.size > maximumFiles) throw new Error("The npm tarball exceeds its file-count limit.");
    } else if (type !== "5") {
      throw new Error("The npm tarball contains an unsupported non-regular entry.");
    }
    offset = contentOffset + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES;
  }
  if (zeroBlocks < 2) throw new Error("The npm tarball is missing its complete end marker.");
  if (tar.subarray(offset).some((byte) => byte !== 0)) {
    throw new Error("The npm tarball contains nonzero data after its end marker.");
  }
  return files;
}

function parseBoundedJson(bytes, label) {
  if (!bytes || bytes.byteLength === 0 || bytes.byteLength > 2 * 1024 * 1024) {
    throw new Error(`${label} is missing or oversized.`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

export function inspectNpmTarballBytes(packageBytes, options = {}) {
  const files = parseTarEntries(packageBytes, options);
  const packageJson = parseBoundedJson(files.get("package.json"), "The npm tarball package.json");
  const manifest = parseBoundedJson(files.get("package-manifest.json"), "The npm tarball package manifest");
  if (
    !isObject(packageJson)
    || typeof packageJson.name !== "string"
    || typeof packageJson.version !== "string"
    || "dependencies" in packageJson
    || "optionalDependencies" in packageJson
    || "bundleDependencies" in packageJson
    || "bundledDependencies" in packageJson
    || Object.keys(packageJson.scripts ?? {}).some((name) => ["preinstall", "install", "postinstall"].includes(name))
  ) {
    throw new Error("The npm tarball package.json violates the self-contained release contract.");
  }
  if (
    !isObject(manifest)
    || manifest.schema_version !== 1
    || manifest.package !== packageJson.name
    || manifest.version !== packageJson.version
    || manifest.channel !== "npm"
    || !COMMIT_SHA.test(manifest.commit ?? "")
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
  ) {
    throw new Error("The npm tarball package manifest identity is invalid.");
  }
  const actualInventory = [...files.entries()]
    .filter(([relative]) => relative !== "package-manifest.json")
    .map(([relative, bytes]) => ({
      path: relative,
      bytes: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex")
    }))
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (!valuesMatch(manifest.files, actualInventory)) {
    throw new Error("The npm tarball exact file inventory does not match its package manifest.");
  }
  return {
    package_name: packageJson.name,
    package_version: packageJson.version,
    package_node_engine: packageJson.engines?.node,
    package_repository: packageJson.repository?.url,
    manifest_package: manifest.package,
    manifest_version: manifest.version,
    manifest_commit: manifest.commit,
    manifest_channel: manifest.channel,
    manifest_node_engine: manifest.node?.required_range,
    inventory_sha256: canonicalSha256(actualInventory),
    inventory_file_count: actualInventory.length,
    inventory_total_bytes: actualInventory.reduce((total, entry) => total + entry.bytes, 0),
    inventory_verified: true
  };
}

function receiptPathIsSafe(policy, value) {
  if (typeof value !== "string" || value.includes("\\") || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  const root = policy.receipt_root;
  return typeof root === "string"
    && normalized === value
    && !normalized.startsWith("../")
    && normalized.startsWith(`${root}/`);
}

function candidatePackagePathIsSafe(value) {
  if (typeof value !== "string" || value.includes("\\") || path.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value
    && !normalized.startsWith("../")
    && normalized.startsWith("output/npm/")
    && normalized.endsWith(".tgz");
}

function validateReceiptBinding(record, label, policy, receiptDigests, errors) {
  pushMissingObjectFields(record, ["receipt_path", "receipt_sha256"], label, errors);
  if (!receiptPathIsSafe(policy, record?.receipt_path)) {
    errors.push(`${label}.receipt_path must be a safe repository-relative path under ${policy.receipt_root}.`);
    return;
  }
  if (!PACKAGE_SHA256.test(record?.receipt_sha256 ?? "")) {
    errors.push(`${label}.receipt_sha256 must be a lowercase SHA-256 digest.`);
    return;
  }
  const observedDigest = receiptDigests instanceof Map ? receiptDigests.get(record.receipt_path) : undefined;
  if (observedDigest !== record.receipt_sha256) {
    errors.push(`${label} receipt bytes are missing or do not match receipt_sha256.`);
  }
}

function validateFinalPackageAssuranceProvenance(
  receipt,
  expectedRecord,
  policy,
  finalCandidate,
  liveVerification,
  label,
  errors
) {
  const provenance = receipt?.github_actions_provenance;
  const payloadJson = receipt?.evidence_payload_json;
  const payload = receipt?.evidence_payload;
  const runnerMap = policy?.native_ci_runner_map;
  let parsedPayload;
  try {
    parsedPayload = typeof payloadJson === "string" ? JSON.parse(payloadJson) : undefined;
  } catch {
    parsedPayload = undefined;
  }
  const payloadSha256 = typeof payloadJson === "string"
    ? createHash("sha256").update(payloadJson, "utf8").digest("hex")
    : undefined;
  const runId = provenance?.run_id;
  const artifactId = provenance?.artifact_id;
  const expectedArtifactName = `studio-npm-assurance-evidence-${runId}.json`;
  const expectedRunUrl = `https://github.com/${policy?.canonical_identity?.repository}/actions/runs/${runId}`;
  const expectedArtifactUrl = `${expectedRunUrl}/artifacts/${artifactId}`;
  if (
    !isObject(provenance)
    || provenance.schema_version !== 1
    || provenance.mode !== "github-actions-upload-artifact-v7"
    || provenance.repository !== policy?.canonical_identity?.repository
    || provenance.workflow_path !== policy?.intended_final_candidate?.assurance_workflow_path
    || !/^[1-9][0-9]{0,19}$/u.test(runId ?? "")
    || provenance.run_attempt !== 1
    || provenance.run_event !== "push"
    || provenance.run_ref !== "refs/heads/main"
    || provenance.run_commit !== finalCandidate?.source_commit
    || provenance.run_url !== expectedRunUrl
    || provenance.job_name !== "aggregate-assurance"
    || !/^[1-9][0-9]{0,19}$/u.test(artifactId ?? "")
    || provenance.artifact_name !== expectedArtifactName
    || provenance.artifact_url !== expectedArtifactUrl
    || !PACKAGE_SHA256.test(provenance.artifact_digest_sha256 ?? "")
    || provenance.artifact_digest_sha256 !== payloadSha256
    || receipt.evidence_payload_sha256 !== payloadSha256
    || typeof payloadJson !== "string"
    || payloadJson.endsWith("\n")
    || payloadJson.endsWith("\r")
    || !isObject(payload)
    || !valuesMatch(parsedPayload, payload)
    || !valuesMatch(payload.record, expectedRecord)
  ) {
    errors.push(`${label} must contain a directly consumable GitHub Actions artifact provenance envelope bound to the exact evidence payload bytes.`);
    return;
  }
  if (
    liveVerification?.verified !== true
    || liveVerification.repository !== provenance.repository
    || liveVerification.workflow_path !== provenance.workflow_path
    || String(liveVerification.run_id) !== runId
    || liveVerification.run_url !== provenance.run_url
    || liveVerification.run_attempt !== provenance.run_attempt
    || liveVerification.run_event !== provenance.run_event
    || liveVerification.run_ref !== provenance.run_ref
    || liveVerification.run_commit !== provenance.run_commit
    || String(liveVerification.artifact_id) !== artifactId
    || liveVerification.artifact_name !== provenance.artifact_name
    || liveVerification.artifact_digest_sha256 !== payloadSha256
    || liveVerification.evidence_payload_sha256 !== payloadSha256
    || !valuesMatch(liveVerification.evidence_payload, payload)
  ) {
    errors.push(`${label} must be independently reverified against the exact successful GitHub run and downloaded artifact bytes${liveVerification?.error ? `: ${liveVerification.error}` : "."}`);
    return;
  }
  const nativeEvidence = payload.native_ci_evidence;
  const expectedRunners = isObject(runnerMap) ? Object.values(runnerMap) : [];
  const observedRunners = isObject(nativeEvidence?.platform_smoke)
    ? Object.keys(nativeEvidence.platform_smoke)
    : [];
  if (
    payload.schema_version !== 1
    || nativeEvidence?.browser_boot_and_pairing_smoke !== "passed"
    || nativeEvidence?.local_actions_preflight_verified !== true
    || !PACKAGE_SHA256.test(nativeEvidence?.consumer_contract_source_sha256 ?? "")
    || !valuesMatch(observedRunners.sort(), [...expectedRunners].sort())
  ) {
    errors.push(`${label} GitHub Actions evidence payload does not contain the exact browser, preflight, and native runner assurance set.`);
    return;
  }
  for (const [platform, runner] of Object.entries(runnerMap ?? {})) {
    const record = nativeEvidence.platform_smoke?.[runner];
    if (
      !policy.required_package_platforms?.includes(platform)
      || record?.status !== "passed"
      || record?.runner !== runner
      || record?.install_smoke !== "passed"
      || record?.candidate_commit !== finalCandidate?.source_commit
      || record?.integrity !== finalCandidate?.npm_integrity
      || record?.package_inventory_sha256 !== finalCandidate?.package_inventory_sha256
      || record?.package_file_count !== finalCandidate?.package_file_count
      || record?.local_actions_preflight_verified !== true
      || record?.local_actions_preflight_consumer_contract_source_sha256
        !== nativeEvidence.consumer_contract_source_sha256
      || record?.cleanup_smoke !== "passed"
    ) {
      errors.push(`${label} GitHub Actions evidence payload contains an invalid ${platform} native runner receipt.`);
    }
  }
  const checkFields = {
    install: ["install_smoke"],
    safe: ["safe_smoke"],
    "local-actions": [
      "local_actions_capability_contract_smoke",
      "local_actions_preflight_verified",
      "local_actions_preflight_loopback_services_stopped"
    ],
    "create-duskds": [
      "direct_cli_scaffold_smoke",
      "local_actions_scaffold_smoke",
      "scaffold_preservation_smoke"
    ],
    shutdown: ["shutdown_smoke"],
    cleanup: ["cleanup_smoke"]
  };
  for (const result of payload.record?.check_results ?? []) {
    const fields = checkFields[result?.check];
    const expectedRefs = Object.entries(nativeEvidence.platform_smoke ?? {}).map(
      ([runner, platformRecord]) => {
        if (!fields?.every((field) => platformRecord[field] === "passed" || platformRecord[field] === true)) {
          return null;
        }
        const digest = createHash("sha256")
          .update(JSON.stringify(platformRecord), "utf8")
          .digest("hex");
        return `${expectedRecord.evidence_id}:check:${result.check}:${runner}:${digest}`;
      }
    );
    if (
      !fields
      || !Array.isArray(result?.evidence_refs)
      || expectedRefs.some((value) => value === null)
      || !valuesMatch([...(result?.evidence_refs ?? [])].sort(), expectedRefs.sort())
    ) {
      errors.push(`${label} GitHub Actions evidence payload does not independently prove the ${result?.check ?? "unknown"} package check on every native runner.`);
    }
  }
}

function validateReceiptContentBinding(
  record,
  label,
  kind,
  idField,
  fields,
  receiptContents,
  errors,
  {
    policySha256,
    policy,
    finalCandidate,
    finalPackageProvenanceVerification,
    allowTestFixtures = false
  } = {}
) {
  const receipt = receiptContents instanceof Map
    ? receiptContents.get(record?.receipt_path)
    : undefined;
  const expectedRecord = Object.fromEntries(fields.map((field) => [field, record?.[field]]));
  const expectedEvidenceClass = RECEIPT_EVIDENCE_CLASSES[kind];
  const fixtureProvenance = receipt?.producer === "validator-test-fixture"
    || receipt?.capture_mode === "validator-test-fixture";
  const expectedValidationContext = {
    policy_sha256: policySha256,
    source_commit: finalCandidate?.source_commit,
    package_name: finalCandidate?.package_name,
    package_version: finalCandidate?.package_version,
    package_sha256: finalCandidate?.package_sha256,
    npm_integrity: finalCandidate?.npm_integrity,
    repository_tag: finalCandidate?.repository_tag
  };
  if (
    !isObject(receipt)
    || receipt.schema_version !== 1
    || receipt.kind !== kind
    || receipt.record_id !== record?.[idField]
    || receipt.evidence_class !== expectedEvidenceClass
    || !RECEIPT_PRODUCERS[kind]?.includes(receipt.producer)
    || !RECEIPT_CAPTURE_MODES[kind]?.includes(receipt.capture_mode)
    || receipt.test_fixture !== fixtureProvenance
    || !valuesMatch(receipt.validation_context, expectedValidationContext)
    || !isObject(receipt.record)
    || !valuesMatch(receipt.record, expectedRecord)
  ) {
    errors.push(`${label} receipt contents must bind the exact ${kind} record.`);
  }
  if (isObject(receipt) && kind === "final-package-assurance") {
    validateFinalPackageAssuranceProvenance(
      receipt,
      expectedRecord,
      policy,
      finalCandidate,
      finalPackageProvenanceVerification,
      label,
      errors
    );
  }
  if (
    isObject(receipt)
    && (fixtureProvenance || receipt.test_fixture === true)
    && !allowTestFixtures
  ) {
    errors.push(`${label} uses validator-test-fixture receipt provenance, which is forbidden by the production final gate.`);
  }
}

function evidenceRefsAreAnchored(record, id, fields = ["evidence_refs"]) {
  return fields.every((field) => isNonEmptyStringArray(record?.[field])
    && record[field].every((ref) => ref.startsWith(`${id}:`)));
}

function exactCandidateIdentityMatches(identity, candidate) {
  return isObject(identity)
    && identity.source_commit === candidate?.source_commit
    && identity.package_version === candidate?.package_version
    && identity.npm_integrity === candidate?.npm_integrity
    && identity.production_url === candidate?.production_url;
}

function validateComprehensiveCampaignInternal(
  policy,
  evidence,
  {
    final = false,
    receiptDigests = new Map(),
    receiptContents = new Map(),
    policySha256,
    authoritativeState,
    finalPackageProvenanceVerification,
    now,
    allowTestFixtures = false
  } = {}
) {
  const errors = [];
  if (!isObject(policy) || policy.schema_version !== 1) {
    return ["Policy must be a schema_version 1 object."];
  }
  if (!isObject(evidence) || evidence.schema_version !== 1) {
    return ["Evidence must be a schema_version 1 object."];
  }
  if (policy.campaign_id !== evidence.campaign_id) {
    errors.push("Policy and evidence campaign_id values must match.");
  }
  const nowMilliseconds = validationNowMilliseconds(now);
  if (!Number.isFinite(nowMilliseconds)) {
    errors.push("The validation clock must be a valid timestamp.");
  }
  const futureSkewMinutes = policy.maximum_future_skew_minutes;
  if (!Number.isFinite(futureSkewMinutes) || futureSkewMinutes < 0 || futureSkewMinutes > 15) {
    errors.push("policy.maximum_future_skew_minutes must be between 0 and 15.");
  }
  const futureSkewMilliseconds = Number.isFinite(futureSkewMinutes)
    ? futureSkewMinutes * 60 * 1_000
    : 0;

  const forbiddenPolicy = collectForbiddenKeys(policy);
  const forbiddenEvidence = collectForbiddenKeys(evidence);
  if (forbiddenPolicy.length || forbiddenEvidence.length) {
    errors.push(`Human-like confidence, confusion, or trust fields are forbidden: ${[
      ...forbiddenPolicy,
      ...forbiddenEvidence
    ].join(", ")}.`);
  }

  const pilots = Array.isArray(policy.pilots) ? policy.pilots : [];
  if (pilots.length !== policy.minimum_counted_pilots || pilots.length !== 32) {
    errors.push("Policy must define exactly 32 required pilot scenarios.");
  }
  const pilotIds = pilots.map((pilot) => pilot?.id);
  const duplicatePilotIds = duplicateValues(pilotIds);
  if (duplicatePilotIds.length) errors.push(`Duplicate pilot ids: ${duplicatePilotIds.join(", ")}.`);
  const knownPilotIds = new Set(pilotIds);
  const cleanStateProfiles = isObject(policy.clean_state_profiles) ? policy.clean_state_profiles : {};
  const categoryCounts = new Map();
  for (const [index, pilot] of pilots.entries()) {
    const label = `policy.pilots[${index}]`;
    pushMissingObjectFields(
      pilot,
      ["id", "category", "persona", "task", "required_context", "required_surfaces", "clean_state_profile"],
      label,
      errors
    );
    if (!PILOT_ID.test(pilot?.id ?? "")) errors.push(`${label}.id is invalid.`);
    if (!Array.isArray(pilot?.required_surfaces) || pilot.required_surfaces.length === 0) {
      errors.push(`${label}.required_surfaces must be a non-empty array.`);
    }
    if (!Array.isArray(cleanStateProfiles[pilot?.clean_state_profile])) {
      errors.push(`${label}.clean_state_profile is unknown.`);
    }
    categoryCounts.set(pilot?.category, (categoryCounts.get(pilot?.category) ?? 0) + 1);
  }
  if (!isNonEmptyStringArray(policy.required_completion_fields)) {
    errors.push("policy.required_completion_fields must be a non-empty string array.");
  }
  if (!isNonEmptyStringArray(policy.required_package_platforms)) {
    errors.push("policy.required_package_platforms must be a non-empty string array.");
  }
  if (!isNonEmptyStringArray(policy.required_package_checks)) {
    errors.push("policy.required_package_checks must be a non-empty string array.");
  }
  if (
    !isNonEmptyStringArray(policy.final_evidence_ledger_paths)
    || duplicateValues(policy.final_evidence_ledger_paths ?? []).length
    || !(policy.final_evidence_ledger_paths ?? []).every((value) => {
      const directory = value.endsWith("/");
      const candidate = directory ? value.slice(0, -1) : value;
      return candidate.length > 0
        && !candidate.includes("\\")
        && !path.posix.isAbsolute(candidate)
        && path.posix.normalize(candidate) === candidate
        && !candidate.startsWith("../");
    })
    || !policy.final_evidence_ledger_paths.includes(`${policy.receipt_root}/`)
  ) {
    errors.push("policy.final_evidence_ledger_paths must contain unique safe repository-relative evidence paths including receipt_root/.");
  }
  pushMissingObjectFields(
    policy.intended_final_candidate,
    ["package_name", "package_version", "repository_tag", "assurance_workflow_path"],
    "policy.intended_final_candidate",
    errors
  );
  if (
    isObject(policy.intended_final_candidate)
    && (
      policy.intended_final_candidate.package_name !== policy.canonical_identity?.package_name
      || policy.intended_final_candidate.repository_tag !== `v${policy.intended_final_candidate.package_version}`
      || policy.intended_final_candidate.assurance_workflow_path !== ".github/workflows/studio-npm-package-assurance.yml"
    )
  ) {
    errors.push("policy.intended_final_candidate must name the canonical package and matching version tag.");
  }
  if (
    !isObject(policy.native_ci_runner_map)
    || !valuesMatch(Object.keys(policy.native_ci_runner_map), policy.required_package_platforms)
    || !isNonEmptyStringArray(Object.values(policy.native_ci_runner_map))
    || duplicateValues(Object.values(policy.native_ci_runner_map)).length
  ) {
    errors.push("policy.native_ci_runner_map must map every required package platform to one unique runner.");
  }
  for (const key of [
    "pilot_execution",
    "defect_retest",
    "automated_regression",
    "package_assurance",
    "registry_verification",
    "production_verification",
    "duskds_public_node",
    "challenge_review"
  ]) {
    if (!Number.isFinite(policy.final_evidence_freshness_hours?.[key]) || policy.final_evidence_freshness_hours[key] <= 0) {
      errors.push(`policy.final_evidence_freshness_hours.${key} must be a positive number.`);
    }
  }
  if (
    !Number.isSafeInteger(policy.candidate_tarball_limits?.maximum_files)
    || policy.candidate_tarball_limits.maximum_files <= 0
    || !Number.isSafeInteger(policy.candidate_tarball_limits?.maximum_archive_bytes)
    || policy.candidate_tarball_limits.maximum_archive_bytes <= 0
    || !Number.isSafeInteger(policy.candidate_tarball_limits?.maximum_uncompressed_bytes)
    || policy.candidate_tarball_limits.maximum_uncompressed_bytes <= 0
  ) {
    errors.push("policy.candidate_tarball_limits must define positive integer file, archive-byte and uncompressed-byte limits.");
  }
  if (!Array.isArray(policy.required_defect_ids) || duplicateValues(policy.required_defect_ids).length) {
    errors.push("policy.required_defect_ids must be a duplicate-free array.");
  }
  for (const [category, minimum] of Object.entries(policy.category_minimums ?? {})) {
    if ((categoryCounts.get(category) ?? 0) < minimum) {
      errors.push(`Policy category ${category} does not meet its minimum of ${minimum}.`);
    }
  }

  const classDefinitions = policy.evidence_classes;
  if (!isObject(classDefinitions) || classDefinitions[COUNTED_CLASS]?.counts_toward_minimum !== true) {
    errors.push("black-box-pilot must be the sole countable evidence class.");
  } else {
    for (const [name, definition] of Object.entries(classDefinitions)) {
      if (name !== COUNTED_CLASS && definition?.counts_toward_minimum !== false) {
        errors.push(`Evidence class ${name} must not count toward the pilot minimum.`);
      }
    }
  }

  pushMissingObjectFields(
    evidence.baseline,
    ["repository", "commit", "branch", "production_url", "package_name", "package_version", "npm_integrity", "collected_at"],
    "evidence.baseline",
    errors
  );
  const canonical = policy.canonical_identity ?? {};
  if (
    evidence.baseline?.repository !== canonical.repository
    || evidence.baseline?.commit !== canonical.baseline_commit
    || evidence.baseline?.production_url !== canonical.production_url
    || evidence.baseline?.package_name !== canonical.package_name
    || evidence.baseline?.package_version !== canonical.baseline_package_version
    || evidence.baseline?.npm_integrity !== canonical.baseline_npm_integrity
  ) {
    errors.push("Evidence baseline must bind to the exact canonical baseline identity.");
  }
  validateTimestamp(
    evidence.baseline?.collected_at,
    "evidence.baseline.collected_at",
    errors,
    nowMilliseconds,
    futureSkewMilliseconds
  );

  const allowedClasses = new Set(Object.keys(classDefinitions ?? {}));
  for (const collection of ["automation_evidence", "challenge_reviews"]) {
    if (!Array.isArray(evidence[collection])) {
      errors.push(`evidence.${collection} must be an array.`);
      continue;
    }
    for (const [index, item] of evidence[collection].entries()) {
      if (!allowedClasses.has(item?.evidence_class)) {
        errors.push(`evidence.${collection}[${index}] uses an unknown evidence class.`);
      }
      if (item?.evidence_class === COUNTED_CLASS) {
        errors.push(`evidence.${collection}[${index}] cannot count as a black-box pilot.`);
      }
      if (item?.observed_at !== undefined) {
        validateTimestamp(
          item.observed_at,
          `evidence.${collection}[${index}].observed_at`,
          errors,
          nowMilliseconds,
          futureSkewMilliseconds
        );
      }
    }
  }

  const executions = Array.isArray(evidence.pilot_executions) ? evidence.pilot_executions : [];
  if (!Array.isArray(evidence.pilot_executions)) errors.push("evidence.pilot_executions must be an array.");
  const executionIds = executions.map((execution) => execution?.execution_id);
  const duplicateExecutionIds = duplicateValues(executionIds);
  if (duplicateExecutionIds.length) {
    errors.push(`Duplicate execution ids: ${duplicateExecutionIds.join(", ")}.`);
  }

  const countedPasses = [];
  const requiredCleanStateChecks = Array.isArray(policy.clean_state_requirements)
    ? policy.clean_state_requirements
    : [];
  for (const [index, execution] of executions.entries()) {
    const label = `evidence.pilot_executions[${index}]`;
    pushMissingObjectFields(
      execution,
      [
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
        "evidence_refs",
        "cleanup"
      ],
      label,
      errors
    );
    if (!EXECUTION_ID.test(execution?.execution_id ?? "")) errors.push(`${label}.execution_id is invalid.`);
    if (!knownPilotIds.has(execution?.scenario_id)) errors.push(`${label}.scenario_id is not in policy.`);
    const scenario = pilots.find((pilot) => pilot.id === execution?.scenario_id);
    if (!FINAL_RESULTS.has(execution?.status)) errors.push(`${label}.status is invalid.`);
    validateChronology(
      execution?.started_at,
      execution?.ended_at,
      label,
      errors,
      nowMilliseconds,
      futureSkewMilliseconds
    );
    const shouldCount = execution?.evidence_class === COUNTED_CLASS && execution?.status === "passed";
    if (execution?.counted !== shouldCount) {
      errors.push(`${label}.counted must be true only for a passing black-box pilot and false otherwise.`);
    }
    pushMissingObjectFields(
      execution?.identity,
      ["source_commit", "package_version", "npm_integrity", "production_url", "os", "node", "browser"],
      `${label}.identity`,
      errors
    );
    if (!Array.isArray(execution?.clean_state_checks) || execution.clean_state_checks.length === 0) {
      errors.push(`${label}.clean_state_checks must be a non-empty array.`);
    } else if (execution.clean_state_checks.some((check) =>
      !isObject(check)
      || typeof check.requirement !== "string"
      || !CLEAN_STATE_RESULTS.has(check.result)
    )) {
      errors.push(`${label}.clean_state_checks contain an invalid requirement record.`);
    } else {
      const observedCleanStateChecks = execution.clean_state_checks.map((check) => check.requirement);
      const duplicateChecks = duplicateValues(observedCleanStateChecks);
      const missingChecks = requiredCleanStateChecks.filter(
        (requirement) => !observedCleanStateChecks.includes(requirement)
      );
      const unknownChecks = observedCleanStateChecks.filter(
        (requirement) => !requiredCleanStateChecks.includes(requirement)
      );
      if (duplicateChecks.length || missingChecks.length || unknownChecks.length) {
        errors.push(`${label}.clean_state_checks must contain each policy requirement exactly once.`);
      }
      if (
        execution?.status === "passed"
        && execution.clean_state_checks.some((check) => check.result === "failed")
      ) {
        errors.push(`${label} cannot pass with a failed clean-state requirement.`);
      }
      if (execution?.status === "passed") {
        const allowedNotApplicable = new Set(cleanStateProfiles[scenario?.clean_state_profile] ?? []);
        const unsupportedNotApplicable = execution.clean_state_checks
          .filter((check) => check.result === "not-applicable" && !allowedNotApplicable.has(check.requirement))
          .map((check) => check.requirement);
        if (unsupportedNotApplicable.length) {
          errors.push(`${label} uses unapproved not-applicable clean-state results: ${unsupportedNotApplicable.join(", ")}.`);
        }
      }
    }
    if (!isNonEmptyStringArray(execution?.task_observations)) {
      errors.push(`${label}.task_observations must be a non-empty array.`);
    }
    if (!evidenceRefsAreAnchored(execution, execution?.execution_id ?? "")) {
      errors.push(`${label}.evidence_refs must be non-empty and anchored to its execution_id.`);
    }
    pushMissingObjectFields(
      execution?.cleanup,
      ["ports_closed", "processes_stopped", "temporary_state_disposition"],
      `${label}.cleanup`,
      errors
    );
    if (execution?.status === "passed") {
      const verifiedSurfaces = Array.isArray(execution?.surfaces_verified)
        ? execution.surfaces_verified
        : [];
      const missingSurfaces = (scenario?.required_surfaces ?? []).filter(
        (surface) => !verifiedSurfaces.includes(surface)
      );
      if (missingSurfaces.length) {
        errors.push(`${label} is missing required pilot surfaces: ${missingSurfaces.join(", ")}.`);
      }
      if (execution.identity?.os !== scenario?.required_context) {
        errors.push(`${label}.identity.os must exactly match scenario required_context ${scenario?.required_context}.`);
      }
      if (final) {
        validateReceiptBinding(execution, label, policy, receiptDigests, errors);
        validateReceiptContentBinding(
          execution,
          label,
          "black-box-pilot",
          "execution_id",
          [
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
          ],
          receiptContents,
          errors,
          {
            policy,
            policySha256,
            finalCandidate: evidence.final_candidate,
            finalPackageProvenanceVerification,
            allowTestFixtures
          }
        );
        validateFreshness(
          execution.ended_at,
          "pilot_execution",
          `${label}.ended_at`,
          policy,
          errors,
          nowMilliseconds
        );
      }
    }
    if (execution?.counted === true && execution?.status === "passed") countedPasses.push(execution);
  }

  const defects = Array.isArray(evidence.defects) ? evidence.defects : [];
  if (!Array.isArray(evidence.defects)) errors.push("evidence.defects must be an array.");
  const defectIds = defects.map((defect) => defect?.defect_id);
  const duplicateDefectIds = duplicateValues(defectIds);
  if (duplicateDefectIds.length) {
    errors.push(`Duplicate defect ids: ${duplicateDefectIds.join(", ")}.`);
  }
  for (const [index, defect] of defects.entries()) {
    pushMissingObjectFields(
      defect,
      ["defect_id", "severity", "status", "summary"],
      `evidence.defects[${index}]`,
      errors
    );
  }

  const retests = Array.isArray(evidence.retests) ? evidence.retests : [];
  if (!Array.isArray(evidence.retests)) errors.push("evidence.retests must be an array.");
  const retestIds = retests.map((retest) => retest?.retest_id);
  const duplicateRetestIds = duplicateValues(retestIds);
  if (duplicateRetestIds.length) {
    errors.push(`Duplicate retest ids: ${duplicateRetestIds.join(", ")}.`);
  }
  for (const [index, retest] of retests.entries()) {
    const label = `evidence.retests[${index}]`;
    pushMissingObjectFields(
      retest,
      [
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
      ],
      label,
      errors
    );
    if (!RETEST_ID.test(retest?.retest_id ?? "")) errors.push(`${label}.retest_id is invalid.`);
    if (!defectIds.includes(retest?.defect_id)) errors.push(`${label}.defect_id is unknown.`);
    if (retest?.evidence_class !== "operator-receipt") errors.push(`${label}.evidence_class must be operator-receipt.`);
    if (!FINAL_RESULTS.has(retest?.status)) errors.push(`${label}.status is invalid.`);
    validateChronology(
      retest?.started_at,
      retest?.ended_at,
      label,
      errors,
      nowMilliseconds,
      futureSkewMilliseconds
    );
    pushMissingObjectFields(
      retest?.identity,
      ["source_commit", "package_version", "npm_integrity", "production_url", "os", "node", "browser"],
      `${label}.identity`,
      errors
    );
    if (!isNonEmptyStringArray(retest?.surfaces_verified)) {
      errors.push(`${label}.surfaces_verified must be a non-empty string array.`);
    }
    if (!evidenceRefsAreAnchored(
      retest,
      retest?.retest_id ?? "",
      ["evidence_refs", "adjacent_flow_evidence_refs"]
    )) {
      errors.push(`${label} evidence references must be non-empty and anchored to its retest_id.`);
    }
    if (final && retest?.status === "passed") {
      validateReceiptBinding(retest, label, policy, receiptDigests, errors);
      validateReceiptContentBinding(
        retest,
        label,
        "defect-retest",
        "retest_id",
        [
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
        ],
        receiptContents,
        errors,
        { policy, policySha256, finalCandidate: evidence.final_candidate, allowTestFixtures }
      );
      validateFreshness(
        retest.ended_at,
        "defect_retest",
        `${label}.ended_at`,
        policy,
        errors,
        nowMilliseconds
      );
    }
  }
  if (!Array.isArray(evidence.traceability)) errors.push("evidence.traceability must be an array.");

  if (final) {
    const clearChallenges = evidence.challenge_reviews
      .filter((review) => review?.evidence_class === "challenge-review" && review?.result === "clear");
    const passingAutomation = evidence.automation_evidence
      .filter((record) => record?.evidence_class === "automated-regression" && record?.status === "passed");
    for (const [index, record] of passingAutomation.entries()) {
      const label = `evidence.automation_evidence[passing:${index}]`;
      pushMissingObjectFields(
        record,
        [
          "evidence_id",
          "evidence_class",
          "scope",
          "status",
          "observed_at",
          "identity",
          "summary",
          "surfaces_verified",
          "evidence_refs",
          "receipt_path",
          "receipt_sha256"
        ],
        label,
        errors
      );
      validateTimestamp(record?.observed_at, `${label}.observed_at`, errors, nowMilliseconds, futureSkewMilliseconds);
      if (!exactCandidateIdentityMatches(record?.identity, evidence.final_candidate)) {
        errors.push(`${label}.identity must match the exact final candidate.`);
      }
      if (typeof record?.summary !== "string" || record.summary.trim() === "") errors.push(`${label}.summary is required.`);
      if (!isNonEmptyStringArray(record?.surfaces_verified)) {
        errors.push(`${label}.surfaces_verified must be a non-empty string array.`);
      }
      if (!evidenceRefsAreAnchored(record, record?.evidence_id ?? "")) {
        errors.push(`${label}.evidence_refs must be non-empty and anchored to its evidence_id.`);
      }
      validateReceiptBinding(record, label, policy, receiptDigests, errors);
      validateReceiptContentBinding(
        record,
        label,
        "automated-regression",
        "evidence_id",
        [
          "evidence_id",
          "evidence_class",
          "scope",
          "status",
          "observed_at",
          "identity",
          "summary",
          "surfaces_verified",
          "evidence_refs"
        ],
        receiptContents,
        errors,
        { policy, policySha256, finalCandidate: evidence.final_candidate, allowTestFixtures }
      );
      validateFreshness(
        record.observed_at,
        "automated_regression",
        `${label}.observed_at`,
        policy,
        errors,
        nowMilliseconds
      );
    }
    const passingAutomationScopes = new Set(passingAutomation.map((record) => record.scope));
    for (const scope of policy.required_automation_scopes ?? []) {
      if (!passingAutomationScopes.has(scope)) {
        errors.push(`Final validation requires passing exact-candidate automation for ${scope}.`);
      }
    }
    const receiptBoundRecords = [
      ...countedPasses,
      ...retests.filter((retest) => retest?.status === "passed"),
      ...clearChallenges,
      ...passingAutomation,
      ...(isObject(evidence.final_package_assurance) ? [evidence.final_package_assurance] : []),
      ...(isObject(evidence.registry_verification) ? [evidence.registry_verification] : []),
      ...(isObject(evidence.production_verification) ? [evidence.production_verification] : [])
    ];
    const duplicateReceiptPaths = duplicateValues(
      receiptBoundRecords.map((record) => record?.receipt_path).filter(Boolean)
    );
    if (duplicateReceiptPaths.length) {
      errors.push(`Final receipt paths must be unique per bound record: ${duplicateReceiptPaths.join(", ")}.`);
    }
    const traceClaims = [];
    const traceClaimRecords = [
      ...countedPasses,
      ...retests.filter((retest) => retest?.status === "passed"),
      ...passingAutomation
    ];
    for (const review of clearChallenges) {
      const receipt = receiptContents instanceof Map ? receiptContents.get(review.receipt_path) : undefined;
      if (isObject(receipt) && receipt.trace_claims !== undefined) {
        errors.push(`Challenge receipt ${review.receipt_path} must not contain product success, failure-recovery, or final-candidate trace claims.`);
      }
    }
    for (const record of traceClaimRecords) {
      const receipt = receiptContents instanceof Map ? receiptContents.get(record.receipt_path) : undefined;
      if (!isObject(receipt) || receipt.trace_claims === undefined) continue;
      const claims = receipt.trace_claims;
      const recordId = record.execution_id ?? record.retest_id ?? record.evidence_id ?? "unknown";
      const recordEvidenceClass = record.evidence_class;
      const recordSurfaces = new Set(Array.isArray(record.surfaces_verified) ? record.surfaces_verified : []);
      const allowedRefs = new Set([
        ...(Array.isArray(record.evidence_refs) ? record.evidence_refs : []),
        ...(Array.isArray(record.adjacent_flow_evidence_refs) ? record.adjacent_flow_evidence_refs : [])
      ]);
      if (!Array.isArray(claims) || claims.length === 0) {
        errors.push(`Receipt ${record.receipt_path} trace_claims must be a non-empty array when present.`);
        continue;
      }
      for (const [claimIndex, claim] of claims.entries()) {
        const label = `receipt ${record.receipt_path} trace_claims[${claimIndex}]`;
        const keys = isObject(claim) ? Object.keys(claim).sort() : [];
        if (
          !isObject(claim)
          || !valuesMatch(keys, ["evidence_class", "outcome", "record_id", "ref", "surface_id"])
          || typeof claim.ref !== "string"
          || !allowedRefs.has(claim.ref)
          || claim.record_id !== recordId
          || claim.evidence_class !== recordEvidenceClass
          || !requiredSurfaceIds(policy).includes(claim.surface_id)
          || !recordSurfaces.has(claim.surface_id)
          || !TRACE_OUTCOMES.has(claim.outcome)
          || !TRACE_OUTCOME_CLASSES[claim.outcome]?.has(recordEvidenceClass)
          || (claim.outcome === "final-candidate" && !exactCandidateIdentityMatches(record.identity, evidence.final_candidate))
        ) {
          errors.push(`${label} must bind one exact record reference, compatible evidence class, verified surface, and typed outcome.`);
          continue;
        }
        traceClaims.push({
          ...claim,
          record_id: recordId,
          receipt_path: record.receipt_path,
          exact_candidate: exactCandidateIdentityMatches(record.identity, evidence.final_candidate)
        });
      }
    }
    const duplicateTraceRefs = duplicateValues(traceClaims.map((claim) => claim.ref));
    if (duplicateTraceRefs.length) {
      errors.push(`Each trace evidence reference may prove only one surface/outcome claim: ${duplicateTraceRefs.join(", ")}.`);
    }
    if (evidence.status !== "final") errors.push("Final validation requires evidence.status=final.");
    if (!PACKAGE_SHA256.test(evidence.policy_sha256 ?? "") || evidence.policy_sha256 !== policySha256) {
      errors.push("Final validation requires policy_sha256 to match the exact policy bytes used by the validator.");
    }
    const completedAtMilliseconds = validateTimestamp(
      evidence.completed_at,
      "evidence.completed_at",
      errors,
      nowMilliseconds,
      futureSkewMilliseconds
    );
    pushMissingObjectFields(
      evidence.final_candidate,
      [
        "source_commit",
        "package_name",
        "package_version",
        "package_sha256",
        "package_inventory_sha256",
        "package_file_count",
        "npm_integrity",
        "production_url",
        "repository_tag",
        "deployed_at"
      ],
      "evidence.final_candidate",
      errors
    );
    const finalCandidate = evidence.final_candidate;
    if (isObject(finalCandidate)) {
      if (!COMMIT_SHA.test(finalCandidate.source_commit ?? "")) {
        errors.push("evidence.final_candidate.source_commit must be a full lowercase Git commit SHA.");
      }
      if (!PACKAGE_SHA256.test(finalCandidate.package_sha256 ?? "")) {
        errors.push("evidence.final_candidate.package_sha256 must be a lowercase SHA-256 digest.");
      }
      if (!PACKAGE_SHA256.test(finalCandidate.package_inventory_sha256 ?? "")) {
        errors.push("evidence.final_candidate.package_inventory_sha256 must be a lowercase SHA-256 digest.");
      }
      if (
        finalCandidate.package_name !== canonical.package_name
        || finalCandidate.package_name !== policy.intended_final_candidate?.package_name
        || finalCandidate.package_version !== policy.intended_final_candidate?.package_version
        || finalCandidate.production_url !== canonical.production_url
        || finalCandidate.repository_tag !== policy.intended_final_candidate?.repository_tag
        || finalCandidate.repository_tag !== `v${finalCandidate.package_version}`
        || !Number.isSafeInteger(finalCandidate.package_file_count)
        || finalCandidate.package_file_count <= 0
        || typeof finalCandidate.npm_integrity !== "string"
        || !finalCandidate.npm_integrity.startsWith("sha512-")
        || validateTimestamp(
          finalCandidate.deployed_at,
          "evidence.final_candidate.deployed_at",
          errors,
          nowMilliseconds,
          futureSkewMilliseconds
        ) === null
      ) {
        errors.push("Final candidate identity is incomplete or inconsistent with the intended release contract.");
      }
      for (const execution of countedPasses) {
        if (!exactCandidateIdentityMatches(execution.identity, finalCandidate)) {
          errors.push(`Passing pilot ${execution.execution_id} is not bound to the exact final candidate identity.`);
        }
      }
      if (!isObject(authoritativeState) || authoritativeState.error) {
        errors.push(`Final validation requires authoritative local candidate inspection${authoritativeState?.error ? `: ${authoritativeState.error}` : "."}`);
      } else if (
        authoritativeState.clean_worktree !== true
        || authoritativeState.tag_commit !== finalCandidate.source_commit
        || authoritativeState.source_is_ancestor_of_evidence !== true
        || authoritativeState.release_source_unchanged !== true
        || authoritativeState.package_sha256 !== finalCandidate.package_sha256
        || authoritativeState.npm_integrity !== finalCandidate.npm_integrity
        || authoritativeState.package_path !== evidence.final_package_assurance?.package_path
        || authoritativeState.tarball?.inventory_verified !== true
        || authoritativeState.tarball?.package_name !== finalCandidate.package_name
        || authoritativeState.tarball?.package_version !== finalCandidate.package_version
        || authoritativeState.tarball?.package_node_engine !== canonical.node_engine
        || authoritativeState.tarball?.package_repository !== `git+https://github.com/${canonical.repository}.git`
        || authoritativeState.tarball?.manifest_package !== finalCandidate.package_name
        || authoritativeState.tarball?.manifest_version !== finalCandidate.package_version
        || authoritativeState.tarball?.manifest_commit !== finalCandidate.source_commit
        || authoritativeState.tarball?.manifest_channel !== "npm"
        || authoritativeState.tarball?.manifest_node_engine !== canonical.node_engine
        || authoritativeState.tarball?.inventory_sha256 !== finalCandidate.package_inventory_sha256
        || authoritativeState.tarball?.inventory_file_count !== finalCandidate.package_file_count
      ) {
        errors.push("Final candidate must match its immutable repository tag, computed tarball bytes, package.json, package manifest and exact inventory, while the clean descendant evidence ledger changes only approved evidence/report paths.");
      }
    }
    pushMissingObjectFields(
      evidence.final_package_assurance,
      [
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
        "check_results",
        "receipt_path",
        "receipt_sha256"
      ],
      "evidence.final_package_assurance",
      errors
    );
    const packageAssurance = evidence.final_package_assurance;
    if (isObject(packageAssurance) && isObject(finalCandidate)) {
      if (
        packageAssurance.source_commit !== finalCandidate.source_commit
        || packageAssurance.package_name !== finalCandidate.package_name
        || packageAssurance.package_version !== finalCandidate.package_version
        || packageAssurance.package_sha256 !== finalCandidate.package_sha256
        || packageAssurance.package_inventory_sha256 !== finalCandidate.package_inventory_sha256
        || packageAssurance.package_file_count !== finalCandidate.package_file_count
        || packageAssurance.npm_integrity !== finalCandidate.npm_integrity
      ) {
        errors.push("Final package assurance must bind to the exact final candidate identity and package bytes.");
      }
      if (!candidatePackagePathIsSafe(packageAssurance.package_path)) {
        errors.push("Final package assurance package_path must be a safe repository-relative npm tarball path.");
      }
      validateTimestamp(
        packageAssurance.observed_at,
        "evidence.final_package_assurance.observed_at",
        errors,
        nowMilliseconds,
        futureSkewMilliseconds
      );
      validateFreshness(
        packageAssurance.observed_at,
        "package_assurance",
        "evidence.final_package_assurance.observed_at",
        policy,
        errors,
        nowMilliseconds
      );
      const requiredPlatforms = policy.required_package_platforms ?? [];
      const requiredChecks = policy.required_package_checks ?? [];
      if (!valuesMatch(packageAssurance.platforms_verified, requiredPlatforms)) {
        errors.push("Final package assurance platforms_verified must exactly match the required platform list.");
      }
      if (!valuesMatch(packageAssurance.checks_verified, requiredChecks)) {
        errors.push("Final package assurance checks_verified must exactly match the required check list.");
      }
      const validateAssuranceResults = (results, required, key, label) => {
        if (!Array.isArray(results) || results.length !== required.length) {
          errors.push(`Final package assurance ${label} must contain one result per required ${label === "platform_results" ? "platform" : "check"}.`);
          return;
        }
        const observed = results.map((result) => result?.[key]);
        if (duplicateValues(observed).length || !valuesMatch(observed, required)) {
          errors.push(`Final package assurance ${label} identities must exactly match policy.`);
        }
        for (const [index, result] of results.entries()) {
          if (
            !isObject(result)
            || result.status !== "passed"
            || !isNonEmptyStringArray(result.evidence_refs)
            || !result.evidence_refs.every((ref) => ref.startsWith(`${packageAssurance.evidence_id}:`))
          ) {
            errors.push(`Final package assurance ${label}[${index}] must be a passed, evidence-anchored result.`);
          }
        }
      };
      validateAssuranceResults(packageAssurance.platform_results, requiredPlatforms, "platform", "platform_results");
      validateAssuranceResults(packageAssurance.check_results, requiredChecks, "check", "check_results");
      const packageResultRefs = [
        ...(Array.isArray(packageAssurance.platform_results)
          ? packageAssurance.platform_results.flatMap((result) => result?.evidence_refs ?? [])
          : []),
        ...(Array.isArray(packageAssurance.check_results)
          ? packageAssurance.check_results.flatMap((result) => result?.evidence_refs ?? [])
          : [])
      ];
      if (duplicateValues(packageResultRefs).length) {
        errors.push("Final package assurance evidence references must be unique per platform/check result.");
      }
      validateReceiptBinding(packageAssurance, "evidence.final_package_assurance", policy, receiptDigests, errors);
      validateReceiptContentBinding(
        packageAssurance,
        "evidence.final_package_assurance",
        "final-package-assurance",
        "evidence_id",
        [
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
        ],
        receiptContents,
        errors,
        {
          policy,
          policySha256,
          finalCandidate,
          finalPackageProvenanceVerification,
          allowTestFixtures
        }
      );
    }
    pushMissingObjectFields(
      evidence.registry_verification,
      [
        "evidence_id",
        "source_commit",
        "package_name",
        "package_version",
        "package_sha256",
        "npm_integrity",
        "repository_tag",
        "registry_url",
        "provenance_url",
        "observed_at",
        "receipt_path",
        "receipt_sha256"
      ],
      "evidence.registry_verification",
      errors
    );
    const registryVerification = evidence.registry_verification;
    if (isObject(registryVerification) && isObject(finalCandidate)) {
      if (
        registryVerification.source_commit !== finalCandidate.source_commit
        || registryVerification.package_name !== finalCandidate.package_name
        || registryVerification.package_version !== finalCandidate.package_version
        || registryVerification.package_sha256 !== finalCandidate.package_sha256
        || registryVerification.npm_integrity !== finalCandidate.npm_integrity
        || registryVerification.repository_tag !== finalCandidate.repository_tag
        || typeof registryVerification.registry_url !== "string"
        || !registryVerification.registry_url.startsWith("https://registry.npmjs.org/")
        || typeof registryVerification.provenance_url !== "string"
        || !registryVerification.provenance_url.startsWith("https://github.com/GeorgianDusk/dusk-developer-studio/")
        || validateTimestamp(
          registryVerification.observed_at,
          "evidence.registry_verification.observed_at",
          errors,
          nowMilliseconds,
          futureSkewMilliseconds
        ) === null
      ) {
        errors.push("Registry verification must bind immutable npm metadata and provenance to the exact final candidate.");
      }
      validateReceiptBinding(registryVerification, "evidence.registry_verification", policy, receiptDigests, errors);
      validateReceiptContentBinding(
        registryVerification,
        "evidence.registry_verification",
        "registry-verification",
        "evidence_id",
        [
          "evidence_id",
          "source_commit",
          "package_name",
          "package_version",
          "package_sha256",
          "npm_integrity",
          "repository_tag",
          "registry_url",
          "provenance_url",
          "observed_at"
        ],
        receiptContents,
        errors,
        { policy, policySha256, finalCandidate, allowTestFixtures }
      );
      validateFreshness(
        registryVerification.observed_at,
        "registry_verification",
        "evidence.registry_verification.observed_at",
        policy,
        errors,
        nowMilliseconds
      );
    }
    pushMissingObjectFields(
      evidence.production_verification,
      [
        "evidence_id",
        "source_commit",
        "package_version",
        "npm_integrity",
        "production_url",
        "release_manifest_sha256",
        "tls_verified",
        "health_verified",
        "assets_verified",
        "rollback_verified",
        "duskds_public_node_verified",
        "duskds_public_node_observed_at",
        "observed_at",
        "receipt_path",
        "receipt_sha256"
      ],
      "evidence.production_verification",
      errors
    );
    const productionVerification = evidence.production_verification;
    if (isObject(productionVerification) && isObject(finalCandidate)) {
      if (
        productionVerification.source_commit !== finalCandidate.source_commit
        || productionVerification.package_version !== finalCandidate.package_version
        || productionVerification.npm_integrity !== finalCandidate.npm_integrity
        || productionVerification.production_url !== finalCandidate.production_url
        || !PACKAGE_SHA256.test(productionVerification.release_manifest_sha256 ?? "")
        || productionVerification.tls_verified !== true
        || productionVerification.health_verified !== true
        || productionVerification.assets_verified !== true
        || productionVerification.rollback_verified !== true
        || productionVerification.duskds_public_node_verified !== true
        || validateTimestamp(
          productionVerification.duskds_public_node_observed_at,
          "evidence.production_verification.duskds_public_node_observed_at",
          errors,
          nowMilliseconds,
          futureSkewMilliseconds
        ) === null
        || validateTimestamp(
          productionVerification.observed_at,
          "evidence.production_verification.observed_at",
          errors,
          nowMilliseconds,
          futureSkewMilliseconds
        ) === null
      ) {
        errors.push("Production verification must prove TLS, health, assets, rollback, DuskDS public-node behavior, and release-manifest identity for the exact final candidate.");
      }
      validateReceiptBinding(productionVerification, "evidence.production_verification", policy, receiptDigests, errors);
      validateReceiptContentBinding(
        productionVerification,
        "evidence.production_verification",
        "production-verification",
        "evidence_id",
        [
          "evidence_id",
          "source_commit",
          "package_version",
          "npm_integrity",
          "production_url",
          "release_manifest_sha256",
          "tls_verified",
          "health_verified",
          "assets_verified",
          "rollback_verified",
          "duskds_public_node_verified",
          "duskds_public_node_observed_at",
          "observed_at"
        ],
        receiptContents,
        errors,
        { policy, policySha256, finalCandidate, allowTestFixtures }
      );
      validateFreshness(
        productionVerification.observed_at,
        "production_verification",
        "evidence.production_verification.observed_at",
        policy,
        errors,
        nowMilliseconds
      );
      validateFreshness(
        productionVerification.duskds_public_node_observed_at,
        "duskds_public_node",
        "evidence.production_verification.duskds_public_node_observed_at",
        policy,
        errors,
        nowMilliseconds
      );
    }
    if (countedPasses.length < policy.minimum_counted_pilots) {
      errors.push(`Final validation requires at least ${policy.minimum_counted_pilots} counted passing pilots.`);
    }
    const countedScenarioIds = countedPasses.map((execution) => execution.scenario_id);
    const duplicateCountedScenarios = duplicateValues(countedScenarioIds);
    if (duplicateCountedScenarios.length) {
      errors.push(`A scenario cannot be double-counted: ${duplicateCountedScenarios.join(", ")}.`);
    }
    for (const pilotId of knownPilotIds) {
      if (!countedScenarioIds.includes(pilotId)) errors.push(`Missing passing pilot: ${pilotId}.`);
    }
    for (const [category, minimum] of Object.entries(policy.category_minimums ?? {})) {
      const passedInCategory = countedPasses.filter((execution) =>
        pilots.find((pilot) => pilot.id === execution.scenario_id)?.category === category
      ).length;
      if (passedInCategory < minimum) {
        errors.push(`Passing category ${category} has ${passedInCategory}; requires ${minimum}.`);
      }
    }
    const contexts = new Set(countedPasses.map((execution) => execution.identity?.os));
    for (const context of policy.required_execution_contexts ?? []) {
      if (!contexts.has(context)) errors.push(`Missing executed context: ${context}.`);
    }
    const surfaceClaims = new Set(countedPasses.flatMap((execution) =>
      Array.isArray(execution.surfaces_verified) ? execution.surfaces_verified : []
    ));
    for (const browser of policy.required_browser_claims ?? []) {
      if (!surfaceClaims.has(browser)) errors.push(`Missing browser claim evidence: ${browser}.`);
    }
    for (const viewport of policy.required_viewports ?? []) {
      if (!surfaceClaims.has(viewport)) errors.push(`Missing viewport evidence: ${viewport}.`);
    }
    const traceability = new Map(
      evidence.traceability.map((record) => [record?.surface_id, record])
    );
    const traceClaimMatches = (surfaceId, outcome, ref, exactCandidate = false) => traceClaims.some((claim) =>
      claim.surface_id === surfaceId
      && claim.outcome === outcome
      && claim.ref === ref
      && (!exactCandidate || claim.exact_candidate)
    );
    for (const surfaceId of requiredSurfaceIds(policy)) {
      const record = traceability.get(surfaceId);
      if (
        !record
        || record.status !== "verified"
        || !Array.isArray(record.success_evidence_refs)
        || record.success_evidence_refs.length === 0
        || !Array.isArray(record.failure_recovery_evidence_refs)
        || record.failure_recovery_evidence_refs.length === 0
        || !Array.isArray(record.final_candidate_evidence_refs)
        || record.final_candidate_evidence_refs.length === 0
      ) {
        errors.push(`Traceability is incomplete for ${surfaceId}.`);
      } else {
        const mistypedSuccessRefs = record.success_evidence_refs
          .filter((ref) => !traceClaimMatches(surfaceId, "success", ref));
        if (mistypedSuccessRefs.length) {
          errors.push(`Traceability for ${surfaceId} contains success references without a matching receipt claim: ${mistypedSuccessRefs.join(", ")}.`);
        }
        const mistypedRecoveryRefs = record.failure_recovery_evidence_refs
          .filter((ref) => !traceClaimMatches(surfaceId, "failure-recovery", ref));
        if (mistypedRecoveryRefs.length) {
          errors.push(`Traceability for ${surfaceId} contains failure/recovery references without a matching receipt claim: ${mistypedRecoveryRefs.join(", ")}.`);
        }
        const mistypedFinalRefs = record.final_candidate_evidence_refs
          .filter((ref) => !traceClaimMatches(surfaceId, "final-candidate", ref, true));
        if (mistypedFinalRefs.length) {
          errors.push(`Traceability for ${surfaceId} contains final-candidate references without a matching exact-candidate receipt claim: ${mistypedFinalRefs.join(", ")}.`);
        }
      }
    }
    const requiredDefectIds = new Set(policy.required_defect_ids ?? []);
    const observedDefectIds = new Set(defectIds);
    const missingDefectIds = [...requiredDefectIds].filter((id) => !observedDefectIds.has(id));
    const unexpectedDefectIds = [...observedDefectIds].filter((id) => !requiredDefectIds.has(id));
    if (missingDefectIds.length || unexpectedDefectIds.length) {
      errors.push(`Final defect ledger must exactly match policy.required_defect_ids; missing: ${missingDefectIds.join(", ") || "none"}; unexpected: ${unexpectedDefectIds.join(", ") || "none"}.`);
    }
    for (const defect of defects) {
      if (!FINAL_DEFECT_STATES.has(defect?.status)) {
        errors.push(`Defect ${defect?.defect_id ?? "unknown"} is not verified or invalidated.`);
        continue;
      }
      if (defect.status === "verified") {
        for (const field of ["root_cause", "fix", "regression_test"]) {
          if (typeof defect[field] !== "string" || defect[field].trim() === "") {
            errors.push(`Verified defect ${defect.defect_id} requires ${field}.`);
          }
        }
        const passingRetest = retests.find((retest) =>
          retest.defect_id === defect.defect_id
          && retest.status === "passed"
          && exactCandidateIdentityMatches(retest.identity, finalCandidate)
        );
        if (!passingRetest) {
          errors.push(`Verified defect ${defect.defect_id} must have a passing exact-candidate retest.`);
        }
      } else if (
        typeof defect.qualification !== "string"
        || !Array.isArray(defect.invalidation_evidence)
        || defect.invalidation_evidence.length === 0
      ) {
        errors.push(`Invalidated defect ${defect.defect_id} requires qualification and invalidation evidence.`);
      }
    }
    const completion = evidence.completion;
    if (!isObject(completion)) {
      errors.push("evidence.completion must be an object.");
    } else {
      for (const key of policy.required_completion_fields ?? []) {
        if (!(key in completion)) errors.push(`Final completion flag ${key} is required.`);
        else if (completion[key] !== true) errors.push(`Final completion flag ${key} must be true.`);
      }
      if (completion.counted_pilots !== countedPasses.length) {
        errors.push("completion.counted_pilots must equal the validated counted pass total.");
      }
      if (completion.minimum_counted_pilots !== policy.minimum_counted_pilots) {
        errors.push("completion.minimum_counted_pilots must equal the policy minimum.");
      }
    }
    const clearChallengeScopes = new Set(clearChallenges.map((review) => review.scope));
    for (const [index, review] of clearChallenges.entries()) {
      const label = `evidence.challenge_reviews[clear:${index}]`;
      pushMissingObjectFields(
        review,
        [
          "evidence_id",
          "scope",
          "observed_at",
          "result",
          "independent_execution",
          "identity",
          "summary",
          "evidence_refs",
          "receipt_path",
          "receipt_sha256"
        ],
        label,
        errors
      );
      validateTimestamp(review?.observed_at, `${label}.observed_at`, errors, nowMilliseconds, futureSkewMilliseconds);
      if (review?.independent_execution !== true) errors.push(`${label}.independent_execution must be true.`);
      if (!exactCandidateIdentityMatches(review?.identity, finalCandidate)) {
        errors.push(`${label}.identity must match the exact final candidate.`);
      }
      if (typeof review?.summary !== "string" || review.summary.trim() === "") errors.push(`${label}.summary is required.`);
      if (!evidenceRefsAreAnchored(review, review?.evidence_id ?? "")) {
        errors.push(`${label}.evidence_refs must be non-empty and anchored to its evidence_id.`);
      }
      validateReceiptBinding(review, label, policy, receiptDigests, errors);
      validateReceiptContentBinding(
        review,
        label,
        "challenge-review",
        "evidence_id",
        [
          "evidence_id",
          "evidence_class",
          "scope",
          "observed_at",
          "result",
          "independent_execution",
          "identity",
          "summary",
          "evidence_refs"
        ],
        receiptContents,
        errors,
        { policy, policySha256, finalCandidate, allowTestFixtures }
      );
      validateFreshness(
        review.observed_at,
        "challenge_review",
        `${label}.observed_at`,
        policy,
        errors,
        nowMilliseconds
      );
    }
    for (const scope of policy.required_final_challenge_scopes ?? []) {
      if (!clearChallengeScopes.has(scope)) {
        errors.push(`Final validation requires a clear challenge review for ${scope}.`);
      }
    }
    const preChallengeTimes = [
      ...executions
        .filter((record) => exactCandidateIdentityMatches(record?.identity, finalCandidate))
        .map((record) => parseTimestamp(record.ended_at)),
      ...retests
        .filter((record) => exactCandidateIdentityMatches(record?.identity, finalCandidate))
        .map((record) => parseTimestamp(record.ended_at)),
      ...evidence.automation_evidence
        .filter((record) => exactCandidateIdentityMatches(record?.identity, finalCandidate))
        .map((record) => parseTimestamp(record.observed_at)),
      parseTimestamp(packageAssurance?.observed_at),
      parseTimestamp(registryVerification?.observed_at),
      parseTimestamp(productionVerification?.observed_at),
      parseTimestamp(productionVerification?.duskds_public_node_observed_at)
    ].filter((value) => value !== null);
    const latestPreChallenge = preChallengeTimes.length ? Math.max(...preChallengeTimes) : null;
    for (const review of clearChallenges) {
      const reviewTime = parseTimestamp(review.observed_at);
      if (latestPreChallenge !== null && reviewTime !== null && reviewTime <= latestPreChallenge) {
        errors.push(`Challenge review ${review.evidence_id} must be rerun after all final-candidate pilot, retest, automation, package, registry, and production evidence.`);
      }
    }
    const deployedAt = parseTimestamp(finalCandidate?.deployed_at);
    const productionObservedAt = parseTimestamp(productionVerification?.observed_at);
    const nodeObservedAt = parseTimestamp(productionVerification?.duskds_public_node_observed_at);
    if (deployedAt !== null && productionObservedAt !== null && productionObservedAt < deployedAt) {
      errors.push("Production verification must occur at or after the final candidate deployment.");
    }
    if (
      nodeObservedAt !== null
      && (
        (deployedAt !== null && nodeObservedAt < deployedAt)
        || (productionObservedAt !== null && nodeObservedAt > productionObservedAt)
      )
    ) {
      errors.push("DuskDS public-node verification must occur after deployment and no later than the enclosing production verification.");
    }
    const allFinalTimes = [
      ...preChallengeTimes,
      ...clearChallenges.map((review) => parseTimestamp(review.observed_at)),
      deployedAt
    ].filter((value) => value !== null);
    if (
      completedAtMilliseconds !== null
      && allFinalTimes.some((timestamp) => timestamp > completedAtMilliseconds)
    ) {
      errors.push("evidence.completed_at must be at or after every final-candidate evidence observation.");
    }
  }

  return errors;
}

export function validateComprehensiveCampaign(policy, evidence, options = {}) {
  const productionOptions = { ...options };
  delete productionOptions.allowTestFixtures;
  return validateComprehensiveCampaignInternal(policy, evidence, {
    ...productionOptions,
    allowTestFixtures: false
  });
}

async function loadReceiptDigests(policy, evidence) {
  const records = [
    ...(Array.isArray(evidence.pilot_executions) ? evidence.pilot_executions : []),
    ...(Array.isArray(evidence.retests) ? evidence.retests : []),
    ...(Array.isArray(evidence.automation_evidence) ? evidence.automation_evidence : []),
    ...(Array.isArray(evidence.challenge_reviews) ? evidence.challenge_reviews : []),
    ...(isObject(evidence.final_package_assurance) ? [evidence.final_package_assurance] : []),
    ...(isObject(evidence.registry_verification) ? [evidence.registry_verification] : []),
    ...(isObject(evidence.production_verification) ? [evidence.production_verification] : [])
  ];
  const paths = new Set(records.map((record) => record?.receipt_path).filter((value) => receiptPathIsSafe(policy, value)));
  const digests = new Map();
  const contents = new Map();
  for (const receiptPath of paths) {
    try {
      const absolutePath = path.resolve(productRoot, receiptPath);
      const stat = await fs.lstat(absolutePath);
      if (
        !stat.isFile()
        || stat.isSymbolicLink()
        || stat.size <= 0
        || stat.size > MAX_DURABLE_RECEIPT_BYTES
      ) continue;
      const bytes = await fs.readFile(absolutePath);
      digests.set(receiptPath, createHash("sha256").update(bytes).digest("hex"));
      try {
        contents.set(receiptPath, JSON.parse(bytes.toString("utf8")));
      } catch {
        // General receipts may be non-JSON; package assurance is checked separately.
      }
    } catch {
      // A missing receipt remains absent and is reported by validateReceiptBinding.
    }
  }
  return { digests, contents };
}

async function verifyFinalPackageAssuranceArtifact(evidence, policy, receiptEvidence) {
  try {
    const record = evidence.final_package_assurance;
    const receipt = receiptEvidence.contents.get(record?.receipt_path);
    const provenance = receipt?.github_actions_provenance;
    const payloadJson = receipt?.evidence_payload_json;
    if (!isObject(record) || !isObject(receipt) || !isObject(provenance) || typeof payloadJson !== "string") {
      throw new Error("the final package receipt or its GitHub evidence payload is missing");
    }
    const payloadSha256 = createHash("sha256").update(payloadJson, "utf8").digest("hex");
    const downloaded = await downloadGitHubActionsReceipt(
      {
        label: "Final package assurance",
        repository: policy.canonical_identity.repository,
        workflowPath: policy.intended_final_candidate.assurance_workflow_path,
        event: "push",
        expectedRef: "refs/heads/main",
        candidateCommit: record.source_commit,
        artifactName: provenance.artifact_name,
        record: {
          run_url: provenance.run_url,
          artifact_name: provenance.artifact_name,
          receipt_sha256: payloadSha256,
          receipt_json: payloadJson,
          observed_at: record.observed_at,
          provenance: {}
        }
      },
      {
        token: process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN ?? "",
        requireRecordedProvenance: false
      }
    );
    return {
      verified: true,
      repository: downloaded.provenance.repository,
      workflow_path: downloaded.provenance.workflow_path,
      run_id: downloaded.provenance.run_id,
      run_url: downloaded.provenance.run_url,
      run_attempt: downloaded.provenance.run_attempt,
      run_event: downloaded.provenance.run_event,
      run_ref: "refs/heads/main",
      run_commit: downloaded.provenance.run_commit,
      artifact_id: downloaded.provenance.artifact_id,
      artifact_name: downloaded.provenance.artifact_name,
      artifact_digest_sha256: downloaded.provenance.artifact_digest_sha256,
      evidence_payload_sha256: payloadSha256,
      evidence_payload: downloaded.receipt,
      verified_at: downloaded.provenance.downloaded_at
    };
  } catch (error) {
    return {
      verified: false,
      error: error instanceof Error ? error.message.slice(0, 256) : "GitHub verification failed"
    };
  }
}

async function inspectAuthoritativeLocalCandidate(evidence, policy) {
  try {
    const candidate = evidence.final_candidate;
    const packagePath = evidence.final_package_assurance?.package_path;
    if (!isObject(candidate) || !candidatePackagePathIsSafe(packagePath)) {
      throw new Error("final candidate or safe package_path is missing");
    }
    const packageAbsolutePath = path.resolve(productRoot, packagePath);
    const [{ stdout: status }, { stdout: head }, { stdout: tagCommit }, packageStat] = await Promise.all([
      execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], { cwd: productRoot, encoding: "utf8" }),
      execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd: productRoot, encoding: "utf8" }),
      execFileAsync("git", ["rev-parse", "--verify", `refs/tags/${candidate.repository_tag}^{commit}`], { cwd: productRoot, encoding: "utf8" }),
      fs.lstat(packageAbsolutePath)
    ]);
    if (
      !packageStat.isFile()
      || packageStat.isSymbolicLink()
      || packageStat.size <= 0
      || packageStat.size > policy.candidate_tarball_limits.maximum_archive_bytes
    ) {
      throw new Error("final package_path is not a bounded regular archive");
    }
    const packageBytes = await fs.readFile(packageAbsolutePath);
    const sourceCommit = tagCommit.trim().toLowerCase();
    const evidenceCommit = head.trim().toLowerCase();
    await execFileAsync(
      "git",
      ["merge-base", "--is-ancestor", sourceCommit, evidenceCommit],
      { cwd: productRoot, encoding: "utf8" }
    );
    const { stdout: changedOutput } = await execFileAsync(
      "git",
      ["diff", "--name-only", "--diff-filter=ACDMRTUXB", `${sourceCommit}..${evidenceCommit}`, "--"],
      { cwd: productRoot, encoding: "utf8" }
    );
    const changedPaths = changedOutput.split(/\r?\n/u).filter(Boolean);
    const allowedPaths = policy.final_evidence_ledger_paths ?? [];
    const unexpectedChangedPaths = changedPaths.filter((changedPath) => !allowedPaths.some(
      (allowedPath) => allowedPath.endsWith("/")
        ? changedPath.startsWith(allowedPath)
        : changedPath === allowedPath
    ));
    const tarball = inspectNpmTarballBytes(packageBytes, {
      maxFiles: policy.candidate_tarball_limits?.maximum_files,
      maxArchiveBytes: policy.candidate_tarball_limits?.maximum_archive_bytes,
      maxUncompressedBytes: policy.candidate_tarball_limits?.maximum_uncompressed_bytes
    });
    return {
      clean_worktree: status.trim() === "",
      evidence_ledger_commit: evidenceCommit,
      tag_commit: sourceCommit,
      source_is_ancestor_of_evidence: true,
      release_source_unchanged: unexpectedChangedPaths.length === 0,
      changed_paths: changedPaths,
      unexpected_changed_paths: unexpectedChangedPaths,
      package_path: packagePath,
      package_sha256: createHash("sha256").update(packageBytes).digest("hex"),
      npm_integrity: `sha512-${createHash("sha512").update(packageBytes).digest("base64")}`,
      tarball
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message.slice(0, 256) : "authoritative candidate inspection failed"
    };
  }
}

function parseArguments(args) {
  const values = {
    policy: defaultPolicyPath,
    evidence: defaultEvidencePath,
    final: false
  };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--final") values.final = true;
    else if (argument === "--policy") values.policy = path.resolve(args[++index]);
    else if (argument === "--evidence") values.evidence = path.resolve(args[++index]);
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return values;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const [policyText, evidenceText] = await Promise.all([
    fs.readFile(options.policy, "utf8"),
    fs.readFile(options.evidence, "utf8")
  ]);
  const policy = JSON.parse(policyText);
  const evidence = JSON.parse(evidenceText);
  const policySha256 = createHash("sha256").update(policyText).digest("hex");
  const receiptEvidence = options.final
    ? await loadReceiptDigests(policy, evidence)
    : { digests: new Map(), contents: new Map() };
  const authoritativeState = options.final
    ? await inspectAuthoritativeLocalCandidate(evidence, policy)
    : undefined;
  const finalPackageProvenanceVerification = options.final
    ? await verifyFinalPackageAssuranceArtifact(evidence, policy, receiptEvidence)
    : undefined;
  const errors = validateComprehensiveCampaign(policy, evidence, {
    final: options.final,
    receiptDigests: receiptEvidence.digests,
    receiptContents: receiptEvidence.contents,
    policySha256,
    authoritativeState,
    finalPackageProvenanceVerification
  });
  if (errors.length) {
    for (const error of errors) process.stderr.write(`- ${error}\n`);
    process.exitCode = 1;
    return;
  }
  const counted = evidence.pilot_executions.filter((execution) =>
    execution.evidence_class === COUNTED_CLASS
    && execution.counted === true
    && execution.status === "passed"
  ).length;
  process.stdout.write(
    options.final
      ? `Comprehensive validation complete with ${counted} counted pilots.\n`
      : `Comprehensive validation evidence is structurally valid (${counted}/32 counted passing pilots; campaign in progress).\n`
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
