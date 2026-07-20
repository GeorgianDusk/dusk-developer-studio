import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_DATABASE_AGE_MS = 30 * DAY_MS;
const MAX_REVIEW_WINDOW_MS = 32 * DAY_MS;
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;
const RUSTSEC_ID = /^RUSTSEC-\d{4}-\d{4}$/u;
const WARNING_TOKEN = /^[a-z0-9][a-z0-9_-]*$/u;
const VERSION_TOKEN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;

function isPlainObject(value) {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.getPrototypeOf(value) === Object.prototype;
}

function parseIsoDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) {
    throw new Error(`${label} must be an ISO timestamp.`);
  }
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`${label} must be a valid ISO timestamp.`);
  }
  return milliseconds;
}

function warningIdentity({ advisory_id: advisoryId, kind, package: packageName, version }) {
  return `${kind}|${packageName}|${version}|${advisoryId}`;
}

function validateText(value, label) {
  if (typeof value !== "string" || value.trim().length < 12 || value.length > 1000) {
    throw new Error(`${label} must contain a bounded review explanation.`);
  }
}

function validatePolicyWarning(record, nowMs) {
  if (!isPlainObject(record)) throw new Error("Cargo warning reviews must be objects.");
  if (!WARNING_TOKEN.test(record.kind ?? "")) {
    throw new Error("Cargo warning review kind is invalid.");
  }
  if (!WARNING_TOKEN.test(record.package ?? "")) {
    throw new Error("Cargo warning review package is invalid.");
  }
  if (!VERSION_TOKEN.test(record.version ?? "")) {
    throw new Error("Cargo warning review version is invalid.");
  }
  if (!RUSTSEC_ID.test(record.advisory_id ?? "")) {
    throw new Error("Cargo warning review advisory ID is invalid.");
  }
  validateText(record.owner, "Cargo warning review owner");
  validateText(record.reachability, "Cargo warning reachability");
  validateText(record.upstream_tracking, "Cargo warning upstream tracking");
  const reviewedMs = parseIsoDate(record.reviewed_on, "Cargo warning reviewed_on");
  const expiresMs = parseIsoDate(record.expires_on, "Cargo warning expires_on");
  if (reviewedMs > nowMs + FUTURE_TOLERANCE_MS) {
    throw new Error(`Cargo warning review is future-dated: ${record.advisory_id}.`);
  }
  if (expiresMs <= nowMs) {
    throw new Error(`Cargo warning review expired: ${record.advisory_id}.`);
  }
  if (expiresMs <= reviewedMs || expiresMs - reviewedMs > MAX_REVIEW_WINDOW_MS) {
    throw new Error(`Cargo warning review window is invalid: ${record.advisory_id}.`);
  }
  return warningIdentity(record);
}

function flattenReportWarnings(warnings) {
  if (!isPlainObject(warnings)) throw new Error("Cargo audit warnings are missing.");
  const records = [];
  for (const [kind, entries] of Object.entries(warnings)) {
    if (!WARNING_TOKEN.test(kind) || !Array.isArray(entries)) {
      throw new Error("Cargo audit warning groups are malformed.");
    }
    for (const entry of entries) {
      if (
        !isPlainObject(entry)
        || entry.kind !== kind
        || !isPlainObject(entry.package)
        || !isPlainObject(entry.advisory)
        || !WARNING_TOKEN.test(entry.package.name ?? "")
        || !VERSION_TOKEN.test(entry.package.version ?? "")
        || !RUSTSEC_ID.test(entry.advisory.id ?? "")
      ) {
        throw new Error("Cargo audit warning entry is malformed.");
      }
      records.push(warningIdentity({
        advisory_id: entry.advisory.id,
        kind,
        package: entry.package.name,
        version: entry.package.version
      }));
    }
  }
  return records;
}

export function validateCargoAdvisoryReview({
  lockBytes,
  now = new Date(),
  policy,
  report,
  scannerVersion
}) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) throw new Error("Cargo advisory review time is invalid.");
  if (!isPlainObject(policy) || policy.schema_version !== 1) {
    throw new Error("Cargo advisory review policy schema is invalid.");
  }
  if (
    typeof policy.lock_path !== "string"
    || policy.lock_path.includes("\\")
    || policy.lock_path.startsWith("/")
    || policy.lock_path.split("/").some((part) => part === "" || part === "." || part === "..")
  ) {
    throw new Error("Cargo advisory review lock path is unsafe.");
  }
  if (!/^[0-9a-f]{64}$/u.test(policy.lock_sha256 ?? "")) {
    throw new Error("Cargo advisory review lock hash is invalid.");
  }
  if (!Buffer.isBuffer(lockBytes)) throw new Error("Cargo advisory lock bytes are missing.");
  const observedLockHash = createHash("sha256").update(lockBytes).digest("hex");
  if (observedLockHash !== policy.lock_sha256) {
    throw new Error("Cargo advisory review is not bound to the current lockfile.");
  }
  if (!Number.isInteger(policy.lock_dependency_count) || policy.lock_dependency_count < 1) {
    throw new Error("Cargo advisory review dependency count is invalid.");
  }
  if (
    !isPlainObject(policy.scanner)
    || policy.scanner.name !== "cargo-audit"
    || !VERSION_TOKEN.test(policy.scanner.version ?? "")
    || scannerVersion !== `${policy.scanner.name} ${policy.scanner.version}`
  ) {
    throw new Error("Cargo advisory scanner identity does not match policy.");
  }
  if (!Array.isArray(policy.accepted_informational_warnings)) {
    throw new Error("Cargo advisory warning reviews are missing.");
  }
  const expectedWarnings = policy.accepted_informational_warnings
    .map((record) => validatePolicyWarning(record, nowMs));
  if (new Set(expectedWarnings).size !== expectedWarnings.length) {
    throw new Error("Cargo advisory warning reviews contain duplicate identities.");
  }

  if (!isPlainObject(report)) throw new Error("Cargo audit JSON report is malformed.");
  if (
    !isPlainObject(report.database)
    || !Number.isInteger(report.database["advisory-count"])
    || report.database["advisory-count"] < 1
    || !/^[0-9a-f]{40}$/u.test(report.database["last-commit"] ?? "")
  ) {
    throw new Error("Cargo audit database metadata is incomplete.");
  }
  const databaseUpdatedMs = parseIsoDate(
    report.database["last-updated"],
    "Cargo audit database last-updated"
  );
  if (
    databaseUpdatedMs > nowMs + FUTURE_TOLERANCE_MS
    || nowMs - databaseUpdatedMs > MAX_DATABASE_AGE_MS
  ) {
    throw new Error("Cargo audit advisory database is stale or future-dated.");
  }
  if (
    !isPlainObject(report.lockfile)
    || report.lockfile["dependency-count"] !== policy.lock_dependency_count
  ) {
    throw new Error("Cargo audit dependency count does not match policy.");
  }
  if (
    !isPlainObject(report.settings)
    || !Array.isArray(report.settings.target_arch)
    || report.settings.target_arch.length !== 0
    || !Array.isArray(report.settings.target_os)
    || report.settings.target_os.length !== 0
    || report.settings.severity !== null
    || !Array.isArray(report.settings.ignore)
    || report.settings.ignore.length !== 0
    || !Array.isArray(report.settings.informational_warnings)
    || JSON.stringify([...report.settings.informational_warnings].sort())
      !== JSON.stringify(["notice", "unmaintained", "unsound"])
  ) {
    throw new Error("Cargo audit settings filter or ignore advisory coverage.");
  }
  if (
    !isPlainObject(report.vulnerabilities)
    || report.vulnerabilities.found !== false
    || report.vulnerabilities.count !== 0
    || !Array.isArray(report.vulnerabilities.list)
    || report.vulnerabilities.list.length !== 0
  ) {
    throw new Error("Cargo audit reported a dependency vulnerability.");
  }

  const observedWarnings = flattenReportWarnings(report.warnings);
  if (new Set(observedWarnings).size !== observedWarnings.length) {
    throw new Error("Cargo audit report contains duplicate warning identities.");
  }
  const expectedSorted = [...expectedWarnings].sort();
  const observedSorted = [...observedWarnings].sort();
  if (JSON.stringify(observedSorted) !== JSON.stringify(expectedSorted)) {
    throw new Error(
      `Cargo audit warning set changed. Expected ${expectedSorted.join(", ")}; observed ${observedSorted.join(", ")}.`
    );
  }

  return {
    advisory_database_commit: report.database["last-commit"],
    advisory_database_count: report.database["advisory-count"],
    dependency_count: report.lockfile["dependency-count"],
    reviewed_warning_count: observedSorted.length,
    status: "passed"
  };
}
