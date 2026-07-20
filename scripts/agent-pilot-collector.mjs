import { spawn, execFileSync } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const collectorFile = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(collectorFile), "..");
const defaultPolicyPath = path.join(productRoot, "config", "phase5-policy.json");

const RECEIPT_SCHEMA_VERSION = 1;
const WRAPPER_SCHEMA_VERSION = 1;
const MAX_PLAN_BYTES = 256 * 1024;
const MAX_RECEIPT_BYTES = 512 * 1024;
const MAX_TARBALL_BYTES = 32 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 64 * 1024 * 1024;
const MAX_TAR_FILES = 1_000;
const MAX_STEPS = 64;
const MAX_STEP_OUTPUT_BYTES = 1024 * 1024;
const MAX_STEP_TIMEOUT_MS = 15 * 60 * 1_000;
const MAX_PROBE_BYTES = 64 * 1024 * 1024;
const EMPTY_SHA256 = createHash("sha256").update(Buffer.alloc(0)).digest("hex");

const SHA256_RE = /^[a-f0-9]{64}$/u;
const COMMIT_RE = /^[a-f0-9]{40}$/u;
const SRI_SHA512_RE = /^sha512-[A-Za-z0-9+/]{80,}={0,2}$/u;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SAFE_COMMANDS = new Set(["node", "cargo", "rustc", "git", "make"]);
const SAFE_ROLES = new Set([
  "setup",
  "controlled-failure",
  "recovery",
  "verification",
  "final-verification"
]);
const SAFE_STEP_KINDS = new Set(["command", "file-probe", "hash-probe"]);
const SCENARIO_KEYS = [
  "id",
  "context",
  "experience",
  "capability",
  "execution_surface",
  "failure_class"
];
const EXPECTED_PILOT_SCENARIOS = new Set([
  "win-safe-boundary",
  "win-keyboard-recovery",
  "win-containment-recovery",
  "win-overwrite-refusal",
  "wsl-managed-root-recovery",
  "wsl-native-toolchain-recovery",
  "linux-port-conflict-recovery",
  "macos-privilege-recovery"
]);
const CANDIDATE_KEYS = [
  "package_name",
  "package_version",
  "package_commit",
  "tarball_sha256",
  "npm_integrity",
  "package_inventory_sha256",
  "candidate_artifact_fingerprint_sha256"
];
const SLOW_PILOT_SCENARIOS = new Set([
  "win-safe-boundary",
  "win-containment-recovery",
  "wsl-managed-root-recovery",
  "wsl-native-toolchain-recovery",
  "linux-port-conflict-recovery",
  "macos-privilege-recovery"
]);
const SECRET_KEY_RE =
  /(?:^|[_-])(?:private[_-]?key|mnemonic|seed(?:er|[_-]?phrase)?|recovery[_-]?phrase|password|passphrase|profile[_-]?entropy|wallet[_-]?password|pairing[_-]?token|api[_-]?key|access[_-]?token|refresh[_-]?token|session[_-]?token|client[_-]?secret|authorization|cookie|credential)(?:$|[_-])/iu;
const SECRET_VALUE_RE =
  /(?:\b(?:private key|mnemonic|seed phrase|recovery phrase|password|passphrase|pairing token|api key|access token|client secret|authorization|cookie)\b\s*(?::|=)\s*\S+|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{20,})\b)/iu;
const ABSOLUTE_PATH_RE =
  /(?:^[A-Za-z]:[\\/]|^\\\\|^\/(?:Users|home|root|tmp|var|etc|opt|private)(?:\/|$)|(?:^|[=:\s])~[\\/])/u;

const RECEIPT_KEYS = [
  "schema_version",
  "evidence_class",
  "independent_execution",
  "operator_type",
  "operator_identity",
  "scenario",
  "invocation_id",
  "plan",
  "plan_sha256",
  "collector",
  "candidate",
  "environment",
  "execution",
  "github_actions_provenance_input",
  "redacted"
];

const SUMMARY_KEYS = [
  "id",
  "scenario_id",
  "path",
  "experience",
  "context",
  "capability",
  "execution_surface",
  "failure_class",
  "operator_type",
  "operator_identity",
  "completed",
  "controlled_failure",
  "recovery_attempted",
  "recovered",
  "started_at",
  "completed_at",
  "candidate_commit",
  "candidate_artifact_fingerprint_sha256",
  "agent_confidence_score",
  "blocking_confusion",
  "duration_seconds",
  "recovery_evidence_reference",
  "session_record_reference",
  "receipt_sha256",
  "receipt_json",
  "run_url",
  "artifact_name",
  "provenance"
];

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function normalizeForCanonicalJson(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot contain a non-finite number.");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) return value.map(normalizeForCanonicalJson);
  if (typeof value === "object") {
    const normalized = {};
    for (const key of Object.keys(value).sort()) {
      const entry = value[key];
      if (entry === undefined) throw new Error("Canonical JSON cannot contain undefined.");
      normalized[key] = normalizeForCanonicalJson(entry);
    }
    return normalized;
  }
  throw new Error("Canonical JSON contains an unsupported value.");
}

export function canonicalJson(value) {
  return JSON.stringify(normalizeForCanonicalJson(value));
}

export function canonicalSha256(value) {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
}

function verificationPolicy(providedPolicy) {
  if (providedPolicy !== undefined) return providedPolicy;
  let bytes;
  try {
    bytes = readFileSync(defaultPolicyPath);
  } catch {
    throw new Error("The default Phase 5 policy could not be loaded for receipt verification.");
  }
  if (bytes.byteLength > MAX_PLAN_BYTES) {
    throw new Error("The default Phase 5 policy exceeds its verification bound.");
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("The default Phase 5 policy is not valid JSON.");
  }
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sha512Integrity(value) {
  return `sha512-${createHash("sha512").update(value).digest("base64")}`;
}

function assertSafeText(value, label, maximum = 256) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > maximum
    || [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint <= 0x1f || codePoint === 0x7f;
    })
  ) {
    throw new Error(`${label} is missing, oversized, or contains control characters.`);
  }
  return value;
}

function assertSafeRelativePath(value, label) {
  assertSafeText(value, label, 512);
  if (
    value.includes("\\")
    || value.includes("\0")
    || path.posix.isAbsolute(value)
    || ABSOLUTE_PATH_RE.test(value)
  ) {
    throw new Error(`${label} must be a safe relative POSIX path.`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === "."
    || normalized.startsWith("../")
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized relative path.`);
  }
  return value;
}

function inspectPlanForSecrets(value, keyPath = "plan", seen = new Set()) {
  if (value && typeof value === "object") {
    if (seen.has(value)) throw new Error("The pilot plan must not contain cycles.");
    seen.add(value);
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => inspectPlanForSecrets(entry, `${keyPath}[${index}]`, seen));
  } else if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      if (SECRET_KEY_RE.test(key)) {
        throw new Error(`The pilot plan contains a secret-like field at ${keyPath}.`);
      }
      inspectPlanForSecrets(entry, `${keyPath}.${key}`, seen);
    }
  } else if (typeof value === "string") {
    if (SECRET_VALUE_RE.test(value)) {
      throw new Error(`The pilot plan contains a secret-like value at ${keyPath}.`);
    }
    if (ABSOLUTE_PATH_RE.test(value)) {
      throw new Error(`The pilot plan contains an absolute personal or system path at ${keyPath}.`);
    }
  }
  if (value && typeof value === "object") seen.delete(value);
}

function parseTarNumber(bytes, label) {
  if (bytes[0] & 0x80) throw new Error(`${label} uses an unsupported base-256 tar number.`);
  const value = bytes.toString("ascii").replace(/\0.*$/u, "").trim();
  if (!value) return 0;
  if (!/^[0-7]+$/u.test(value)) throw new Error(`${label} is not a valid octal tar number.`);
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error(`${label} is outside its safe range.`);
  return parsed;
}

function readTarString(bytes) {
  return bytes.toString("utf8").replace(/\0.*$/u, "");
}

function verifyTarChecksum(header) {
  const expected = parseTarNumber(header.subarray(148, 156), "Tar header checksum");
  let actual = 0;
  for (let index = 0; index < header.length; index += 1) {
    actual += index >= 148 && index < 156 ? 32 : header[index];
  }
  if (actual !== expected) throw new Error("The npm tarball contains a header checksum mismatch.");
}

function parseNpmTarball(tarballBytes) {
  let archive;
  try {
    archive = gunzipSync(tarballBytes, { maxOutputLength: MAX_UNPACKED_BYTES + 1024 * 1024 });
  } catch {
    throw new Error("The npm tarball is not a bounded valid gzip archive.");
  }
  const records = [];
  const names = new Set();
  let offset = 0;
  let zeroBlocks = 0;
  let unpackedBytes = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    offset += 512;
    if (header.every((byte) => byte === 0)) {
      zeroBlocks += 1;
      if (zeroBlocks === 2) break;
      continue;
    }
    zeroBlocks = 0;
    verifyTarChecksum(header);
    const name = readTarString(header.subarray(0, 100));
    const prefix = readTarString(header.subarray(345, 500));
    const fullName = prefix ? `${prefix}/${name}` : name;
    const size = parseTarNumber(header.subarray(124, 136), "Tar entry size");
    const type = String.fromCharCode(header[156] || 48);
    if (!fullName.startsWith("package/") || fullName.includes("\\") || fullName.includes("\0")) {
      throw new Error("The npm tarball contains an unsafe archive path.");
    }
    const relative = fullName.slice("package/".length).replace(/\/$/u, "");
    if (relative) assertSafeRelativePath(relative, "Tar entry path");
    const paddedSize = Math.ceil(size / 512) * 512;
    if (offset + paddedSize > archive.length) throw new Error("The npm tarball contains a truncated entry.");
    const content = archive.subarray(offset, offset + size);
    offset += paddedSize;
    if (type === "5") {
      if (size !== 0) throw new Error("The npm tarball contains a malformed directory entry.");
      continue;
    }
    if (type !== "0" || !relative) {
      throw new Error("The npm tarball contains a non-regular or unsupported entry.");
    }
    if (names.has(relative)) throw new Error("The npm tarball contains a duplicate file.");
    names.add(relative);
    unpackedBytes += size;
    if (records.length >= MAX_TAR_FILES || unpackedBytes > MAX_UNPACKED_BYTES) {
      throw new Error("The npm tarball exceeds its file-count or unpacked-byte limit.");
    }
    records.push({
      path: relative,
      bytes: size,
      sha256: sha256Bytes(content),
      content
    });
  }
  if (zeroBlocks < 2 || records.length === 0) {
    throw new Error("The npm tarball is missing its bounded end marker or file inventory.");
  }
  if (!archive.subarray(offset).every((byte) => byte === 0)) {
    throw new Error("The npm tarball contains data after its end marker.");
  }
  return records.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
}

function parseJsonRecord(records, recordPath) {
  const record = records.find((entry) => entry.path === recordPath);
  if (!record) throw new Error(`The npm tarball is missing ${recordPath}.`);
  try {
    return JSON.parse(record.content.toString("utf8"));
  } catch {
    throw new Error(`The npm tarball contains invalid JSON in ${recordPath}.`);
  }
}

function validateManifestFiles(records, manifest) {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error("The embedded package manifest has no file inventory.");
  }
  const actual = records
    .filter((record) => record.path !== "package-manifest.json")
    .map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 }));
  if (canonicalJson(actual) !== canonicalJson(manifest.files)) {
    throw new Error("The tarball bytes do not exact-match the embedded package manifest.");
  }
}

export async function inspectPilotTarball(tarballPath, expectedCandidate) {
  if (!hasExactKeys(expectedCandidate, [
    "package_name",
    "package_version",
    "package_commit",
    "tarball_sha256",
    "npm_integrity",
    "package_inventory_sha256",
    "candidate_artifact_fingerprint_sha256"
  ])) {
    throw new Error("The pilot plan candidate binding has unexpected or missing fields.");
  }
  if (
    !COMMIT_RE.test(expectedCandidate.package_commit ?? "")
    || !SHA256_RE.test(expectedCandidate.tarball_sha256 ?? "")
    || !SRI_SHA512_RE.test(expectedCandidate.npm_integrity ?? "")
    || !SHA256_RE.test(expectedCandidate.package_inventory_sha256 ?? "")
    || !SHA256_RE.test(expectedCandidate.candidate_artifact_fingerprint_sha256 ?? "")
  ) {
    throw new Error("The pilot plan candidate hashes, integrity, or commit are invalid.");
  }
  const stat = await fs.lstat(tarballPath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > MAX_TARBALL_BYTES) {
    throw new Error("The exact npm tarball must be a bounded regular file.");
  }
  const tarballBytes = await fs.readFile(tarballPath);
  const tarballSha256 = sha256Bytes(tarballBytes);
  const npmIntegrity = sha512Integrity(tarballBytes);
  if (
    tarballSha256 !== expectedCandidate.tarball_sha256
    || npmIntegrity !== expectedCandidate.npm_integrity
  ) {
    throw new Error("The npm tarball bytes do not match the operator-bound candidate hashes.");
  }
  const records = parseNpmTarball(tarballBytes);
  const manifest = parseJsonRecord(records, "package-manifest.json");
  const packageJson = parseJsonRecord(records, "package.json");
  if (
    manifest.package !== expectedCandidate.package_name
    || manifest.version !== expectedCandidate.package_version
    || manifest.commit !== expectedCandidate.package_commit
    || packageJson.name !== expectedCandidate.package_name
    || packageJson.version !== expectedCandidate.package_version
    || manifest.package !== packageJson.name
    || manifest.version !== packageJson.version
  ) {
    throw new Error("The embedded npm package identity does not match the exact pilot candidate.");
  }
  validateManifestFiles(records, manifest);
  const packageInventorySha256 = sha256Bytes(
    Buffer.from(`${records.map((record) => record.path).join("\n")}\n`, "utf8")
  );
  if (packageInventorySha256 !== expectedCandidate.package_inventory_sha256) {
    throw new Error("The npm tarball file inventory does not match the operator-bound candidate.");
  }
  return {
    tarball_sha256: tarballSha256,
    tarball_bytes: tarballBytes.byteLength,
    npm_integrity: npmIntegrity,
    package_inventory_sha256: packageInventorySha256,
    package_file_count: records.length,
    package_name: manifest.package,
    package_version: manifest.version,
    package_commit: manifest.commit,
    phase5_artifact_fingerprint_sha256: expectedCandidate.candidate_artifact_fingerprint_sha256
  };
}

function gitOutput(repositoryRoot, args, options = {}) {
  try {
    return execFileSync("git", ["-c", `safe.directory=${repositoryRoot}`, "-C", repositoryRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: options.timeout ?? 5_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    }).trim();
  } catch {
    throw new Error("The collector source could not be bound to an immutable Git commit.");
  }
}

export async function deriveCollectorIdentity(options = {}) {
  const repositoryRoot = path.resolve(options.repositoryRoot ?? productRoot);
  const sourceFile = path.resolve(options.collectorFile ?? collectorFile);
  const relative = path.relative(repositoryRoot, sourceFile).split(path.sep).join("/");
  assertSafeRelativePath(relative, "Collector path");
  const commit = gitOutput(repositoryRoot, ["rev-parse", "HEAD"]).toLowerCase();
  if (!COMMIT_RE.test(commit)) throw new Error("The collector Git commit is invalid.");
  gitOutput(repositoryRoot, ["cat-file", "-e", `${commit}:${relative}`]);
  try {
    execFileSync(
      "git",
      ["-c", `safe.directory=${repositoryRoot}`, "-C", repositoryRoot, "diff", "--quiet", commit, "--", relative],
      {
        stdio: ["ignore", "ignore", "ignore"],
        timeout: 5_000,
        windowsHide: true
      }
    );
  } catch {
    throw new Error("The collector source differs from its bound Git commit.");
  }
  const bytes = await fs.readFile(sourceFile);
  return {
    path: relative,
    commit,
    source_sha256: sha256Bytes(bytes)
  };
}

function exactScenario(policy, scenarioId) {
  const scenarios = policy?.pilot?.required_scenarios;
  if (
    !SAFE_ID_RE.test(scenarioId ?? "")
    || !EXPECTED_PILOT_SCENARIOS.has(scenarioId)
    || !Array.isArray(scenarios)
    || scenarios.length !== EXPECTED_PILOT_SCENARIOS.size
    || new Set(scenarios.map((scenario) => scenario?.id)).size
      !== EXPECTED_PILOT_SCENARIOS.size
    || new Set(scenarios.map((scenario) => scenario?.capability)).size
      !== EXPECTED_PILOT_SCENARIOS.size
    || new Set(scenarios.map((scenario) => scenario?.failure_class)).size
      !== EXPECTED_PILOT_SCENARIOS.size
    || scenarios.some((scenario) =>
      !hasExactKeys(scenario, SCENARIO_KEYS)
      || !EXPECTED_PILOT_SCENARIOS.has(scenario.id)
      || !SAFE_ID_RE.test(scenario.failure_class ?? "")
    )
  ) {
    throw new Error("Phase 5 policy must define the exact eight reviewed pilot scenarios.");
  }
  const matches = scenarios.filter((scenario) => scenario?.id === scenarioId);
  if (matches.length !== 1) {
    throw new Error("The plan must select exactly one required Phase 5 scenario.");
  }
  const scenario = matches[0];
  return { ...scenario };
}

function validateCanonicalCandidate(policy, candidate) {
  if (!hasExactKeys(candidate, CANDIDATE_KEYS)) {
    throw new Error("Pilot candidate has unexpected or missing fields.");
  }
  if (
    candidate.package_name !== policy?.npm_distribution?.package_name
    || candidate.package_version !== policy?.npm_distribution?.package_version
    || !COMMIT_RE.test(candidate.package_commit ?? "")
    || !SHA256_RE.test(candidate.tarball_sha256 ?? "")
    || !SRI_SHA512_RE.test(candidate.npm_integrity ?? "")
    || !SHA256_RE.test(candidate.package_inventory_sha256 ?? "")
    || !SHA256_RE.test(candidate.candidate_artifact_fingerprint_sha256 ?? "")
  ) {
    throw new Error("Pilot candidate identity, commit, or artifact digests are invalid.");
  }
  return { ...candidate };
}

export function canonicalPilotRecoveryMarker(scenario) {
  return [
    `scenario=${scenario.id}`,
    `capability=${scenario.capability}`,
    `failure_class=${scenario.failure_class}`,
    "controlled_failure_observed=true",
    "recovery_verified=true",
    ""
  ].join("\n");
}

function canonicalPilotCommandStep(id, role, scenarioId, phase, timeoutMs) {
  return {
    id,
    kind: "command",
    role,
    command: "node",
    args: [
      "scripts/agent-pilot-plan.mjs",
      "--exercise-scenario",
      scenarioId,
      "--phase",
      phase,
      "--package-root",
      "output/pilots/package",
      "--work-root",
      `output/pilots/work/${scenarioId}`
    ],
    cwd: ".",
    expect: { outcome: role === "controlled-failure" ? "failure" : "success" },
    timeout_ms: timeoutMs,
    max_output_bytes: 64 * 1024
  };
}

export function buildCanonicalAgentPilotPlan(policy, scenarioId, candidateInput) {
  const scenario = exactScenario(policy, scenarioId);
  const candidate = validateCanonicalCandidate(policy, candidateInput);
  const marker = canonicalPilotRecoveryMarker(scenario);
  const markerPath = `output/pilots/work/${scenario.id}/recovered.txt`;
  const commandTimeout = scenario.id === "wsl-native-toolchain-recovery"
    ? 15 * 60 * 1_000
    : SLOW_PILOT_SCENARIOS.has(scenario.id)
      ? 8 * 60 * 1_000
      : 2 * 60 * 1_000;
  const finalStepId = `final-${scenario.id}`;
  return {
    schema_version: 1,
    scenario_id: scenario.id,
    path: "duskds",
    agent_confidence_score: 5,
    blocking_confusion: false,
    candidate,
    steps: [
      canonicalPilotCommandStep(
        `prepare-${scenario.id}`,
        "setup",
        scenario.id,
        "prepare",
        commandTimeout
      ),
      canonicalPilotCommandStep(
        scenario.failure_class,
        "controlled-failure",
        scenario.id,
        "controlled-failure",
        commandTimeout
      ),
      canonicalPilotCommandStep(
        `recover-${scenario.capability}`,
        "recovery",
        scenario.id,
        "recovery",
        commandTimeout
      ),
      {
        id: `verify-${scenario.capability}`,
        kind: "file-probe",
        role: "verification",
        path: markerPath,
        expect: {
          exists: true,
          type: "file",
          min_bytes: Buffer.byteLength(marker),
          max_bytes: Buffer.byteLength(marker)
        }
      },
      {
        id: finalStepId,
        kind: "hash-probe",
        role: "final-verification",
        path: markerPath,
        algorithm: "sha256",
        expected_digest: sha256Bytes(Buffer.from(marker, "utf8"))
      }
    ],
    final_verification_step_id: finalStepId
  };
}

function validateStep(step, index) {
  if (!step || typeof step !== "object" || Array.isArray(step)) {
    throw new Error(`Pilot step ${index + 1} is invalid.`);
  }
  if (!SAFE_STEP_KINDS.has(step.kind) || !SAFE_ROLES.has(step.role) || !SAFE_ID_RE.test(step.id ?? "")) {
    throw new Error(`Pilot step ${index + 1} has an invalid kind, role, or id.`);
  }
  if (step.kind === "command") {
    if (!hasExactKeys(step, [
      "id", "kind", "role", "command", "args", "cwd", "expect", "timeout_ms", "max_output_bytes"
    ])) {
      throw new Error(`Command step ${step.id} has unexpected or missing fields.`);
    }
    if (
      !SAFE_COMMANDS.has(step.command)
      || !Array.isArray(step.args)
      || step.args.length > 64
      || step.args.some((argument) =>
        typeof argument !== "string"
        || argument.length > 2_048
        || [...argument].some((character) => {
          const codePoint = character.codePointAt(0);
          return codePoint === 0 || codePoint === 0x0a || codePoint === 0x0d;
        })
        || ABSOLUTE_PATH_RE.test(argument)
      )
      || !hasExactKeys(step.expect, ["outcome"])
      || !["success", "failure"].includes(step.expect.outcome)
      || !Number.isSafeInteger(step.timeout_ms)
      || step.timeout_ms < 10
      || step.timeout_ms > MAX_STEP_TIMEOUT_MS
      || !Number.isSafeInteger(step.max_output_bytes)
      || step.max_output_bytes < 0
      || step.max_output_bytes > MAX_STEP_OUTPUT_BYTES
    ) {
      throw new Error(`Command step ${step.id} is outside the allowlisted execution bounds.`);
    }
    if (step.cwd !== ".") assertSafeRelativePath(step.cwd, `Command step ${step.id} cwd`);
  } else if (step.kind === "file-probe") {
    if (
      !hasExactKeys(step, ["id", "kind", "role", "path", "expect"])
      || !hasExactKeys(step.expect, ["exists", "type", "min_bytes", "max_bytes"])
      || step.expect.exists !== true
      || !["file", "directory"].includes(step.expect.type)
      || !Number.isSafeInteger(step.expect.min_bytes)
      || step.expect.min_bytes < 0
      || !Number.isSafeInteger(step.expect.max_bytes)
      || step.expect.max_bytes < step.expect.min_bytes
      || step.expect.max_bytes > MAX_PROBE_BYTES
    ) {
      throw new Error(`File probe ${step.id} is outside the allowlisted probe bounds.`);
    }
    assertSafeRelativePath(step.path, `File probe ${step.id} path`);
  } else {
    if (
      !hasExactKeys(step, ["id", "kind", "role", "path", "algorithm", "expected_digest"])
      || step.algorithm !== "sha256"
      || !SHA256_RE.test(step.expected_digest ?? "")
    ) {
      throw new Error(`Hash probe ${step.id} is outside the allowlisted probe bounds.`);
    }
    assertSafeRelativePath(step.path, `Hash probe ${step.id} path`);
  }
}

export function validatePilotPlan(policy, plan) {
  inspectPlanForSecrets(plan);
  if (
    JSON.stringify(policy?.pilot?.required_observation_kinds)
      !== JSON.stringify(["command", "file-probe", "hash-probe"])
    || JSON.stringify(policy?.pilot?.local_operator_attested_contexts)
      !== JSON.stringify(["windows", "wsl"])
    || JSON.stringify(policy?.pilot?.github_actions_provenance_contexts)
      !== JSON.stringify(["linux", "macos"])
  ) {
    throw new Error("Phase 5 policy does not preserve the reviewed pilot observation and provenance classes.");
  }
  if (!hasExactKeys(plan, [
    "schema_version",
    "scenario_id",
    "path",
    "agent_confidence_score",
    "blocking_confusion",
    "candidate",
    "steps",
    "final_verification_step_id"
  ])) {
    throw new Error("The pilot plan has unexpected or missing top-level fields.");
  }
  if (
    plan.schema_version !== 1
    || plan.path !== "duskds"
    || !Number.isInteger(plan.agent_confidence_score)
    || plan.agent_confidence_score < 1
    || plan.agent_confidence_score > 5
    || typeof plan.blocking_confusion !== "boolean"
    || !Array.isArray(plan.steps)
    || plan.steps.length < 3
    || plan.steps.length > MAX_STEPS
  ) {
    throw new Error("The pilot plan version, path, score, outcome, or step count is invalid.");
  }
  const scenario = exactScenario(policy, plan.scenario_id);
  plan.steps.forEach(validateStep);
  const ids = plan.steps.map((step) => step.id);
  if (new Set(ids).size !== ids.length) throw new Error("Pilot step ids must be unique.");
  const controlledFailures = plan.steps.filter((step) => step.role === "controlled-failure");
  const recoveries = plan.steps.filter((step) => step.role === "recovery");
  const finalIndex = plan.steps.findIndex((step) => step.id === plan.final_verification_step_id);
  if (
    controlledFailures.length !== 1
    || controlledFailures[0].id !== scenario.failure_class
    || controlledFailures[0].kind !== "command"
    || controlledFailures[0].expect.outcome !== "failure"
    || recoveries.length === 0
    || !plan.steps.some((step) => step.kind === "file-probe")
    || !plan.steps.some((step) => step.kind === "hash-probe")
    || recoveries.some((step) => step.kind === "command" && step.expect.outcome !== "success")
    || finalIndex !== plan.steps.length - 1
    || plan.steps[finalIndex]?.role !== "final-verification"
    || (plan.steps[finalIndex]?.kind === "command"
      && plan.steps[finalIndex]?.expect.outcome !== "success")
  ) {
    throw new Error("The pilot plan must order one controlled failure, recovery, and final verification.");
  }
  const failureIndex = plan.steps.indexOf(controlledFailures[0]);
  const firstRecoveryIndex = Math.min(...recoveries.map((step) => plan.steps.indexOf(step)));
  if (failureIndex >= firstRecoveryIndex || firstRecoveryIndex >= finalIndex) {
    throw new Error("The controlled failure, recovery, and final verification order is invalid.");
  }
  const canonicalPlan = buildCanonicalAgentPilotPlan(
    policy,
    plan.scenario_id,
    plan.candidate
  );
  if (canonicalJson(plan) !== canonicalJson(canonicalPlan)) {
    throw new Error(
      "The pilot plan does not exact-match the reviewed canonical scenario plan."
    );
  }
  return scenario;
}

function derivedContext() {
  if (process.platform === "win32") return "windows";
  if (process.platform === "darwin") return "macos";
  if (
    process.platform === "linux"
    && (process.env.WSL_DISTRO_NAME || /microsoft/iu.test(os.release()))
  ) {
    return "wsl";
  }
  if (process.platform === "linux") return "linux";
  throw new Error("The pilot collector is running on an unsupported operating system.");
}

function assertSupportedNode(policy) {
  const required = policy?.npm_distribution?.node_engine;
  if (
    required !== ">=24.18.0 <25"
    || process.version !== "v24.18.0"
  ) {
    throw new Error("The pilot collector requires the exact reviewed Node.js v24.18.0 runtime.");
  }
}

function windowsPrivilege() {
  let groups;
  try {
    groups = execFileSync("whoami", ["/groups"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3_000,
      maxBuffer: 1024 * 1024,
      windowsHide: true
    });
  } catch {
    throw new Error("Windows privilege level could not be derived.");
  }
  if (/S-1-16-(?:12288|16384)\b/u.test(groups)) {
    return { level: "elevated", mechanism: "windows-integrity-level", uid: null };
  }
  if (/S-1-16-(?:4096|8192)\b/u.test(groups)) {
    return { level: "standard", mechanism: "windows-integrity-level", uid: null };
  }
  throw new Error("Windows privilege level is not represented by a recognized integrity label.");
}

function deriveEnvironment(scenario) {
  const context = derivedContext();
  if (context !== scenario.context) {
    throw new Error("The selected Phase 5 scenario does not match the actual execution environment.");
  }
  const privilege = process.platform === "win32"
    ? windowsPrivilege()
    : {
        level: process.geteuid?.() === 0 ? "elevated" : "standard",
        mechanism: "posix-euid",
        uid: process.geteuid?.() ?? null
      };
  const environment = {
    context,
    platform: process.platform,
    os_version: assertSafeText(os.version(), "Operating-system version"),
    os_release: assertSafeText(os.release(), "Operating-system release"),
    arch: assertSafeText(os.arch(), "Architecture", 32),
    node_version: process.version,
    privilege,
    environment_identity: ""
  };
  if (
    environment.privilege.level !== "standard"
    || !["x64", "arm64"].includes(environment.arch)
    || (context === "wsl"
      && !/microsoft/iu.test(`${environment.os_version} ${environment.os_release}`))
  ) {
    throw new Error("The pilot collector requires a coherent standard-user reviewed environment.");
  }
  const identityInputs = {
    context: environment.context,
    platform: environment.platform,
    os_version: environment.os_version,
    os_release: environment.os_release,
    arch: environment.arch,
    node_version: environment.node_version,
    privilege: environment.privilege
  };
  environment.environment_identity =
    `env-${canonicalSha256(identityInputs).slice(0, 24)}`;
  return environment;
}

function validateActionsEnvelope(envelope, policy, environment, candidate, scenario) {
  if (envelope === null || envelope === undefined) return null;
  if (!["linux", "macos"].includes(environment.context)) {
    throw new Error("A GitHub Actions provenance envelope is accepted only on Linux or macOS.");
  }
  const keys = [
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
  if (!hasExactKeys(envelope, keys)) {
    throw new Error("The GitHub Actions provenance envelope has unexpected or missing fields.");
  }
  inspectPlanForSecrets(envelope, "github_actions_provenance");
  if (
    envelope.schema_version !== 1
    || envelope.repository !== policy.monitoring_evidence?.canonical_repository
    || envelope.workflow_path !== ".github/workflows/studio-npm-package-assurance.yml"
    || !/^[1-9][0-9]{0,19}$/u.test(String(envelope.run_id))
    || envelope.run_attempt !== 1
    || envelope.job_name !== `agent-pilot-${scenario.id}`
    || envelope.event_name !== "workflow_dispatch"
    || envelope.ref !== "refs/heads/main"
    || envelope.sha !== candidate.package_commit
    || envelope.artifact_name
      !== `studio-agent-pilot-${scenario.id}-${String(envelope.run_id)}.json`
  ) {
    throw new Error("The GitHub Actions provenance envelope is invalid or candidate-mismatched.");
  }
  return { ...envelope, run_id: String(envelope.run_id) };
}

function sanitizedChildEnvironment() {
  const environment = {};
  const allowed = new Set([
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "WSL_DISTRO_NAME",
    "LANG",
    "LC_ALL",
    "TERM",
    "RUSTUP_HOME",
    "CARGO_HOME"
  ]);
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key) && typeof value === "string" && !SECRET_KEY_RE.test(key)) {
      environment[key] = value;
    }
  }
  environment.NO_COLOR = "1";
  environment.CI = "1";
  return environment;
}

function resolveStepRoot(workspaceRoot, relative = ".") {
  const candidate = path.resolve(workspaceRoot, ...relative.split("/"));
  const difference = path.relative(workspaceRoot, candidate);
  if (difference.startsWith("..") || path.isAbsolute(difference)) {
    throw new Error("A pilot step attempted to leave its bounded workspace.");
  }
  return candidate;
}

async function assertNoLinksFromRoot(workspaceRoot, relativePath) {
  let current = workspaceRoot;
  for (const segment of relativePath.split("/")) {
    current = path.join(current, segment);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink()) throw new Error("A pilot artifact path contains a link or reparse entry.");
  }
  return current;
}

function resolveCommand(command) {
  if (command === "node") return process.execPath;
  return command;
}

function runCommandStep(step, workspaceRoot) {
  return new Promise((resolve, reject) => {
    const startedAt = new Date();
    const stdoutHash = createHash("sha256");
    const stderrHash = createHash("sha256");
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let oversized = false;
    let spawnError = false;
    const child = spawn(resolveCommand(step.command), step.args, {
      cwd: resolveStepRoot(workspaceRoot, step.cwd),
      env: sanitizedChildEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, step.timeout_ms);
    const observe = (hash, count, chunk) => {
      hash.update(chunk);
      const next = count + chunk.byteLength;
      if (next > step.max_output_bytes) {
        oversized = true;
        child.kill("SIGKILL");
      }
      return next;
    };
    child.stdout.on("data", (chunk) => {
      stdoutBytes = observe(stdoutHash, stdoutBytes, chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderrBytes = observe(stderrHash, stderrBytes, chunk);
    });
    child.once("error", () => {
      spawnError = true;
    });
    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      const completedAt = new Date();
      const observation = {
        id: step.id,
        role: step.role,
        kind: step.kind,
      command: step.command,
      args: [...step.args],
      cwd: step.cwd,
      started_at: startedAt.toISOString(),
        completed_at: completedAt.toISOString(),
        duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
        expected_outcome: step.expect.outcome,
        observed_outcome: code === 0 ? "success" : "failure",
        exit_code: Number.isInteger(code) ? code : null,
        signal: signal ?? null,
        stdout_bytes: stdoutBytes,
        stdout_sha256: stdoutHash.digest("hex"),
        stderr_bytes: stderrBytes,
        stderr_sha256: stderrHash.digest("hex"),
        passed: false
      };
      if (spawnError) {
        reject(new Error(`Command step ${step.id} could not start safely.`));
      } else if (timedOut) {
        reject(new Error(`Command step ${step.id} exceeded its bounded timeout.`));
      } else if (oversized || stdoutBytes > step.max_output_bytes || stderrBytes > step.max_output_bytes) {
        reject(new Error(`Command step ${step.id} exceeded its bounded output limit.`));
      } else if (signal) {
        reject(new Error(`Command step ${step.id} ended with an unexpected signal.`));
      } else if (observation.observed_outcome !== step.expect.outcome) {
        reject(new Error(`Command step ${step.id} did not produce its expected outcome.`));
      } else {
        observation.passed = true;
        resolve(observation);
      }
    });
  });
}

async function runFileProbe(step, workspaceRoot) {
  const startedAt = new Date();
  const absolute = await assertNoLinksFromRoot(workspaceRoot, step.path);
  const stat = await fs.lstat(absolute);
  const observedType = stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other";
  const bytes = stat.isFile() ? stat.size : 0;
  if (
    observedType !== step.expect.type
    || bytes < step.expect.min_bytes
    || bytes > step.expect.max_bytes
  ) {
    throw new Error(`File probe ${step.id} did not match its bounded expectation.`);
  }
  const completedAt = new Date();
  return {
    id: step.id,
    role: step.role,
    kind: step.kind,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    expected_outcome: "success",
    observed_outcome: "success",
    exit_code: 0,
    stdout_bytes: 0,
    stdout_sha256: EMPTY_SHA256,
    stderr_bytes: 0,
    stderr_sha256: EMPTY_SHA256,
    artifact: {
      relative_path: step.path,
      type: observedType,
      bytes
    },
    passed: true
  };
}

async function runHashProbe(step, workspaceRoot) {
  const startedAt = new Date();
  const absolute = await assertNoLinksFromRoot(workspaceRoot, step.path);
  const stat = await fs.lstat(absolute);
  if (!stat.isFile() || stat.size > MAX_PROBE_BYTES) {
    throw new Error(`Hash probe ${step.id} requires a bounded regular file.`);
  }
  const digest = sha256Bytes(await fs.readFile(absolute));
  if (digest !== step.expected_digest) {
    throw new Error(`Hash probe ${step.id} did not match its operator-bound digest.`);
  }
  const completedAt = new Date();
  return {
    id: step.id,
    role: step.role,
    kind: step.kind,
    started_at: startedAt.toISOString(),
    completed_at: completedAt.toISOString(),
    duration_ms: Math.max(0, completedAt.getTime() - startedAt.getTime()),
    expected_outcome: "success",
    observed_outcome: "success",
    exit_code: 0,
    stdout_bytes: 0,
    stdout_sha256: EMPTY_SHA256,
    stderr_bytes: 0,
    stderr_sha256: EMPTY_SHA256,
    artifact: {
      relative_path: step.path,
      type: "file",
      bytes: stat.size,
      sha256: digest
    },
    passed: true
  };
}

async function executeStep(step, workspaceRoot) {
  if (step.kind === "command") return runCommandStep(step, workspaceRoot);
  if (step.kind === "file-probe") return runFileProbe(step, workspaceRoot);
  return runHashProbe(step, workspaceRoot);
}

async function readBoundedJson(file, maximumBytes, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`${label} must be a bounded regular JSON file.`);
  }
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function ensureOutputIsRedacted(value) {
  const serialized = canonicalJson(value);
  if (
    serialized.length > MAX_RECEIPT_BYTES
    || SECRET_VALUE_RE.test(serialized)
    || ABSOLUTE_PATH_RE.test(serialized)
  ) {
    throw new Error("The pilot collector output violates its size or redaction boundary.");
  }
  return serialized;
}

function wholeSecondIso(milliseconds) {
  return new Date(Math.floor(milliseconds / 1_000) * 1_000).toISOString();
}

async function finishAfterStartSecond(startedMilliseconds) {
  const startSecond = Math.floor(startedMilliseconds / 1_000);
  const now = Date.now();
  const completionSecond = Math.max(startSecond + 1, Math.ceil(now / 1_000));
  const completionMilliseconds = completionSecond * 1_000;
  if (completionMilliseconds > now) {
    await new Promise((resolve) => setTimeout(resolve, completionMilliseconds - now));
  }
  return completionMilliseconds;
}

export async function collectAgentPilot(options) {
  const policyPath = path.resolve(options.policyPath ?? defaultPolicyPath);
  const planPath = path.resolve(options.planPath);
  const tarballPath = path.resolve(options.tarballPath);
  const workspaceRoot = await fs.realpath(path.resolve(options.workspaceRoot));
  const workspaceStat = await fs.lstat(workspaceRoot);
  if (!workspaceStat.isDirectory() || workspaceStat.isSymbolicLink()) {
    throw new Error("The pilot workspace must be a real directory.");
  }
  const policy = await readBoundedJson(policyPath, MAX_PLAN_BYTES, "Phase 5 policy");
  const plan = await readBoundedJson(planPath, MAX_PLAN_BYTES, "Pilot plan");
  assertSupportedNode(policy);
  const scenario = validatePilotPlan(policy, plan);
  const candidate = await inspectPilotTarball(tarballPath, plan.candidate);
  const collector = await deriveCollectorIdentity({
    repositoryRoot: options.collectorRepositoryRoot,
    collectorFile: options.collectorFile
  });
  if (collector.commit !== candidate.package_commit) {
    throw new Error("The collector commit does not match the exact npm candidate commit.");
  }
  const environment = deriveEnvironment(scenario);
  const provenanceInput = options.provenanceEnvelopePath
    ? validateActionsEnvelope(
        await readBoundedJson(
          path.resolve(options.provenanceEnvelopePath),
          64 * 1024,
          "GitHub Actions provenance envelope"
        ),
        policy,
        environment,
        candidate,
        scenario
      )
    : null;
  const requiresActionsProvenance = ["linux", "macos"].includes(environment.context);
  if (requiresActionsProvenance !== Boolean(provenanceInput)) {
    throw new Error(
      requiresActionsProvenance
        ? "Linux and macOS pilot receipts require the exact GitHub Actions provenance envelope."
        : "Windows and WSL pilot receipts must remain local operator-attested evidence."
    );
  }
  const invocationId = randomBytes(16).toString("hex");
  const planSha256 = canonicalSha256(plan);
  const startedMilliseconds = Date.now();
  const startedAt = wholeSecondIso(startedMilliseconds);
  const observations = [];
  for (const step of plan.steps) observations.push(await executeStep(step, workspaceRoot));
  const completedMilliseconds = await finishAfterStartSecond(startedMilliseconds);
  const completedAt = wholeSecondIso(completedMilliseconds);
  const durationSeconds = (completedMilliseconds - Math.floor(startedMilliseconds / 1_000) * 1_000) / 1_000;
  if (!Number.isSafeInteger(durationSeconds) || durationSeconds <= 0) {
    throw new Error("The pilot collector could not derive a positive whole-second duration.");
  }
  const rawObservationBundleSha256 = canonicalSha256(observations);
  const controlledFailure = observations.find((entry) => entry.role === "controlled-failure");
  const recoveryObservations = observations.filter((entry) => entry.role === "recovery");
  const finalVerification = observations.at(-1);
  if (
    !controlledFailure
    || controlledFailure.observed_outcome !== "failure"
    || !controlledFailure.passed
    || recoveryObservations.length === 0
    || recoveryObservations.some((entry) => !entry.passed)
    || finalVerification?.id !== plan.final_verification_step_id
    || !finalVerification.passed
  ) {
    throw new Error("The pilot observations do not prove controlled failure, recovery, and final verification.");
  }
  const receipt = {
    schema_version: RECEIPT_SCHEMA_VERSION,
    evidence_class: "operator-attested-machine-collected",
    independent_execution: false,
    operator_type: policy.pilot.operator_type,
    operator_identity: policy.pilot.operator_identity,
    scenario,
    invocation_id: invocationId,
    plan,
    plan_sha256: planSha256,
    collector,
    candidate,
    environment,
    execution: {
      started_at: startedAt,
      completed_at: completedAt,
      duration_seconds: durationSeconds,
      step_count: observations.length,
      controlled_failure_step_id: controlledFailure.id,
      recovery_step_ids: recoveryObservations.map((entry) => entry.id),
      final_verification_step_id: finalVerification.id,
      observations,
      raw_observation_bundle_sha256: rawObservationBundleSha256
    },
    github_actions_provenance_input: provenanceInput,
    redacted: true
  };
  ensureOutputIsRedacted(receipt);
  const receiptJson = canonicalJson(receipt);
  const receiptSha256 = sha256Bytes(Buffer.from(receiptJson, "utf8"));
  const runUrl = provenanceInput
    ? `https://github.com/${provenanceInput.repository}/actions/runs/${provenanceInput.run_id}`
    : null;
  const phase5EmbeddingSummary = {
    id: `${scenario.id}-${invocationId.slice(0, 8)}`,
    scenario_id: scenario.id,
    path: plan.path,
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
    started_at: startedAt,
    completed_at: completedAt,
    candidate_commit: candidate.package_commit,
    candidate_artifact_fingerprint_sha256: candidate.phase5_artifact_fingerprint_sha256,
    agent_confidence_score: plan.agent_confidence_score,
    blocking_confusion: plan.blocking_confusion,
    duration_seconds: durationSeconds,
    recovery_evidence_reference:
      `agent-pilots/${scenario.id}/${rawObservationBundleSha256}.recovery.json`,
    session_record_reference: `agent-pilots/${scenario.id}/${receiptSha256}.json`,
    receipt_sha256: receiptSha256,
    receipt_json: receiptJson,
    run_url: runUrl,
    artifact_name: provenanceInput?.artifact_name ?? null,
    provenance: null
  };
  const provenanceOutput = {
    schema_version: 1,
    mode: provenanceInput ? "github-actions-envelope" : "local",
    independently_verified: false,
    input_sha256: provenanceInput ? canonicalSha256(provenanceInput) : null,
    collector_receipt_sha256: receiptSha256,
    raw_observation_bundle_sha256: rawObservationBundleSha256,
    candidate_commit: candidate.package_commit,
    tarball_sha256: candidate.tarball_sha256,
    invocation_id: invocationId,
    run_url: runUrl,
    artifact_name: provenanceInput?.artifact_name ?? null
  };
  const result = {
    schema_version: WRAPPER_SCHEMA_VERSION,
    receipt,
    receipt_sha256: receiptSha256,
    phase5_embedding_summary: phase5EmbeddingSummary,
    github_actions_provenance_output: provenanceOutput
  };
  ensureOutputIsRedacted(result);
  verifyAgentPilotResult(result, policy);
  return result;
}

function verifyReceiptEnvironment(environment) {
  if (!hasExactKeys(environment, [
    "context",
    "platform",
    "os_version",
    "os_release",
    "arch",
    "node_version",
    "privilege",
    "environment_identity"
  ]) || !hasExactKeys(environment?.privilege, ["level", "mechanism", "uid"])) {
    throw new Error("The agent pilot environment has an invalid shape.");
  }
  const platform = {
    windows: "win32",
    wsl: "linux",
    linux: "linux",
    macos: "darwin"
  }[environment.context];
  const isWindows = environment.context === "windows";
  const coherentPrivilege = isWindows
    ? environment.privilege.level === "standard"
      && environment.privilege.mechanism === "windows-integrity-level"
      && environment.privilege.uid === null
    : environment.privilege.level === "standard"
      && environment.privilege.mechanism === "posix-euid"
      && Number.isSafeInteger(environment.privilege.uid)
      && environment.privilege.uid > 0;
  const identityInputs = {
    context: environment.context,
    platform: environment.platform,
    os_version: environment.os_version,
    os_release: environment.os_release,
    arch: environment.arch,
    node_version: environment.node_version,
    privilege: environment.privilege
  };
  if (
    environment.platform !== platform
    || environment.node_version !== "v24.18.0"
    || !["x64", "arm64"].includes(environment.arch)
    || !coherentPrivilege
    || (environment.context === "wsl"
      && !/microsoft/iu.test(`${environment.os_version} ${environment.os_release}`))
    || environment.environment_identity
      !== `env-${canonicalSha256(identityInputs).slice(0, 24)}`
  ) {
    throw new Error("The agent pilot environment tuple or identity is incoherent.");
  }
}

function verifyReceiptObservation(observation, step, previousCompletedAt, execution) {
  const commonKeys = [
    "id",
    "role",
    "kind",
    "started_at",
    "completed_at",
    "duration_ms",
    "expected_outcome",
    "observed_outcome",
    "exit_code",
    "stdout_bytes",
    "stdout_sha256",
    "stderr_bytes",
    "stderr_sha256",
    "passed"
  ];
  const expectedKeys = step.kind === "command"
    ? [...commonKeys, "command", "args", "cwd", "signal"]
    : [...commonKeys, "artifact"];
  if (!hasExactKeys(observation, expectedKeys)) {
    throw new Error(`Pilot observation ${step.id} has an invalid exact shape.`);
  }
  const started = Date.parse(observation.started_at);
  const completed = Date.parse(observation.completed_at);
  const executionStarted = Date.parse(execution.started_at);
  const executionCompleted = Date.parse(execution.completed_at);
  if (
    observation.id !== step.id
    || observation.role !== step.role
    || observation.kind !== step.kind
    || !Number.isFinite(started)
    || !Number.isFinite(completed)
    || started < executionStarted
    || completed > executionCompleted
    || completed < started
    || (previousCompletedAt !== null && started < previousCompletedAt)
    || observation.duration_ms !== completed - started
    || observation.passed !== true
    || !Number.isSafeInteger(observation.stdout_bytes)
    || observation.stdout_bytes < 0
    || observation.stdout_bytes > MAX_STEP_OUTPUT_BYTES
    || !Number.isSafeInteger(observation.stderr_bytes)
    || observation.stderr_bytes < 0
    || observation.stderr_bytes > MAX_STEP_OUTPUT_BYTES
    || !SHA256_RE.test(observation.stdout_sha256 ?? "")
    || !SHA256_RE.test(observation.stderr_sha256 ?? "")
    || (observation.stdout_bytes === 0 && observation.stdout_sha256 !== EMPTY_SHA256)
    || (observation.stderr_bytes === 0 && observation.stderr_sha256 !== EMPTY_SHA256)
  ) {
    throw new Error(`Pilot observation ${step.id} is internally inconsistent.`);
  }
  if (step.kind === "command") {
    const expectedSuccess = step.expect.outcome === "success";
    if (
      observation.command !== step.command
      || canonicalJson(observation.args) !== canonicalJson(step.args)
      || observation.cwd !== step.cwd
      || observation.expected_outcome !== step.expect.outcome
      || observation.observed_outcome !== step.expect.outcome
      || observation.signal !== null
      || !Number.isInteger(observation.exit_code)
      || (expectedSuccess ? observation.exit_code !== 0 : observation.exit_code === 0)
    ) {
      throw new Error(`Pilot command observation ${step.id} is not bound to its executed plan step.`);
    }
  } else {
    if (
      observation.expected_outcome !== "success"
      || observation.observed_outcome !== "success"
      || observation.exit_code !== 0
      || observation.stdout_bytes !== 0
      || observation.stderr_bytes !== 0
      || observation.artifact?.relative_path !== step.path
      || observation.artifact?.type !== (step.kind === "hash-probe" ? "file" : step.expect.type)
      || !Number.isSafeInteger(observation.artifact?.bytes)
      || observation.artifact.bytes < 0
      || observation.artifact.bytes > MAX_PROBE_BYTES
    ) {
      throw new Error(`Pilot probe observation ${step.id} is not bound to its plan step.`);
    }
    if (step.kind === "file-probe") {
      if (
        !hasExactKeys(observation.artifact, ["relative_path", "type", "bytes"])
        || observation.artifact.bytes < step.expect.min_bytes
        || observation.artifact.bytes > step.expect.max_bytes
      ) {
        throw new Error(`Pilot file observation ${step.id} violates its bounded expectation.`);
      }
    } else if (
      !hasExactKeys(observation.artifact, ["relative_path", "type", "bytes", "sha256"])
      || observation.artifact.sha256 !== step.expected_digest
    ) {
      throw new Error(`Pilot hash observation ${step.id} violates its digest expectation.`);
    }
  }
  return completed;
}

export function verifyAgentPilotResult(result, providedPolicy) {
  if (!hasExactKeys(result, [
    "schema_version",
    "receipt",
    "receipt_sha256",
    "phase5_embedding_summary",
    "github_actions_provenance_output"
  ]) || result.schema_version !== WRAPPER_SCHEMA_VERSION) {
    throw new Error("The agent pilot result wrapper has an invalid shape or version.");
  }
  if (
    !hasExactKeys(result.receipt, RECEIPT_KEYS)
    || result.receipt.schema_version !== RECEIPT_SCHEMA_VERSION
    || result.receipt.evidence_class !== "operator-attested-machine-collected"
    || result.receipt.independent_execution !== false
    || canonicalSha256(result.receipt.plan) !== result.receipt.plan_sha256
    || result.receipt.redacted !== true
  ) {
    throw new Error("The agent pilot receipt has an invalid shape or assurance label.");
  }
  const plan = result.receipt.plan;
  if (
    !hasExactKeys(plan, [
      "schema_version",
      "scenario_id",
      "path",
      "agent_confidence_score",
      "blocking_confusion",
      "candidate",
      "steps",
      "final_verification_step_id"
    ])
    || !hasExactKeys(plan?.candidate, [
      "package_name",
      "package_version",
      "package_commit",
      "tarball_sha256",
      "npm_integrity",
      "package_inventory_sha256",
      "candidate_artifact_fingerprint_sha256"
    ])
    || !Array.isArray(plan.steps)
    || plan.steps.length < 3
    || plan.steps.length > MAX_STEPS
    || plan.candidate.package_name !== result.receipt.candidate.package_name
    || plan.candidate.package_version !== result.receipt.candidate.package_version
    || plan.candidate.package_commit !== result.receipt.candidate.package_commit
    || plan.candidate.tarball_sha256 !== result.receipt.candidate.tarball_sha256
    || plan.candidate.npm_integrity !== result.receipt.candidate.npm_integrity
    || plan.candidate.package_inventory_sha256
      !== result.receipt.candidate.package_inventory_sha256
    || plan.candidate.candidate_artifact_fingerprint_sha256
      !== result.receipt.candidate.phase5_artifact_fingerprint_sha256
  ) {
    throw new Error("The embedded agent pilot plan is malformed or candidate-mismatched.");
  }
  const policy = verificationPolicy(providedPolicy);
  let reviewedScenario;
  try {
    reviewedScenario = validatePilotPlan(policy, plan);
  } catch {
    throw new Error(
      "The embedded agent pilot plan does not exact-match the canonical policy scenario and candidate."
    );
  }
  if (canonicalJson(result.receipt.scenario) !== canonicalJson(reviewedScenario)) {
    throw new Error(
      "The agent pilot receipt scenario does not exact-match the canonical policy scenario."
    );
  }
  const receiptJson = canonicalJson(result.receipt);
  const receiptSha256 = sha256Bytes(Buffer.from(receiptJson, "utf8"));
  if (receiptSha256 !== result.receipt_sha256) {
    throw new Error("The agent pilot receipt digest does not match its canonical bytes.");
  }
  verifyReceiptEnvironment(result.receipt.environment);
  const execution = result.receipt.execution;
  const planSteps = Array.isArray(plan?.steps) ? plan.steps : [];
  const recoveryStepIds = planSteps
    .filter((step) => step?.role === "recovery")
    .map((step) => step.id);
  if (
    !Array.isArray(execution?.observations)
    || execution.observations.length !== execution.step_count
    || execution.observations.length !== planSteps.length
    || plan?.scenario_id !== result.receipt.scenario.id
    || plan?.final_verification_step_id !== execution.final_verification_step_id
    || execution.controlled_failure_step_id !== result.receipt.scenario.failure_class
    || new Set(execution.recovery_step_ids ?? []).size !== execution.recovery_step_ids?.length
    || canonicalJson(execution.recovery_step_ids) !== canonicalJson(recoveryStepIds)
    || canonicalSha256(execution.observations) !== execution.raw_observation_bundle_sha256
    || execution.observations.some((entry) => entry.passed !== true)
  ) {
    throw new Error("The agent pilot raw observation bundle digest is invalid.");
  }
  let previousCompletedAt = null;
  for (let index = 0; index < planSteps.length; index += 1) {
    previousCompletedAt = verifyReceiptObservation(
      execution.observations[index],
      planSteps[index],
      previousCompletedAt,
      execution
    );
  }
  const summary = result.phase5_embedding_summary;
  if (
    !hasExactKeys(summary, SUMMARY_KEYS)
    || summary.receipt_sha256 !== receiptSha256
    || summary.receipt_json !== receiptJson
    || summary.scenario_id !== result.receipt.scenario.id
    || summary.candidate_commit !== result.receipt.candidate.package_commit
    || summary.candidate_artifact_fingerprint_sha256
      !== result.receipt.candidate.phase5_artifact_fingerprint_sha256
    || summary.started_at !== execution.started_at
    || summary.completed_at !== execution.completed_at
    || summary.duration_seconds !== execution.duration_seconds
    || summary.recovery_evidence_reference
      !== `agent-pilots/${reviewedScenario.id}/${execution.raw_observation_bundle_sha256}.recovery.json`
    || summary.session_record_reference
      !== `agent-pilots/${reviewedScenario.id}/${receiptSha256}.json`
  ) {
    throw new Error("The Phase 5 embedding summary is not bound to the machine receipt.");
  }
  const provenance = result.github_actions_provenance_output;
  if (
    provenance?.collector_receipt_sha256 !== receiptSha256
    || provenance?.raw_observation_bundle_sha256 !== execution.raw_observation_bundle_sha256
    || provenance?.candidate_commit !== result.receipt.candidate.package_commit
    || provenance?.tarball_sha256 !== result.receipt.candidate.tarball_sha256
    || provenance?.invocation_id !== result.receipt.invocation_id
  ) {
    throw new Error("The GitHub Actions provenance output slot is not bound to the machine receipt.");
  }
  ensureOutputIsRedacted(result);
  return true;
}

function parseCliArguments(argumentsList) {
  const allowed = new Set([
    "--plan",
    "--tarball",
    "--workspace",
    "--output",
    "--policy",
    "--provenance-envelope"
  ]);
  const parsed = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(key) || typeof value !== "string" || value.length === 0) {
      throw new Error("Pilot collector CLI arguments are incomplete or unsupported.");
    }
    if (Object.hasOwn(parsed, key)) throw new Error("Pilot collector CLI arguments must be unique.");
    parsed[key] = value;
  }
  for (const required of ["--plan", "--tarball", "--workspace", "--output"]) {
    if (!parsed[required]) throw new Error("Pilot collector CLI is missing a required argument.");
  }
  return parsed;
}

function redactError(error) {
  const message = error instanceof Error ? error.message : "Unknown collector failure.";
  return message
    .replace(/[A-Za-z]:[\\/][^\s"'<>]+/gu, "[redacted-path]")
    .replace(/\/(?:Users|home|root|tmp|var|etc|opt|private)\/[^\s"'<>]+/gu, "[redacted-path]")
    .slice(0, 1_000);
}

async function main() {
  const cli = parseCliArguments(process.argv.slice(2));
  const result = await collectAgentPilot({
    planPath: cli["--plan"],
    tarballPath: cli["--tarball"],
    workspaceRoot: cli["--workspace"],
    policyPath: cli["--policy"],
    provenanceEnvelopePath: cli["--provenance-envelope"]
  });
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (Buffer.byteLength(output) > MAX_RECEIPT_BYTES) {
    throw new Error("The formatted pilot receipt exceeds its output bound.");
  }
  await fs.writeFile(path.resolve(cli["--output"]), output, {
    encoding: "utf8",
    flag: "wx"
  });
  process.stdout.write(`${JSON.stringify({
    status: "passed",
    scenario_id: result.phase5_embedding_summary.scenario_id,
    receipt_sha256: result.receipt_sha256,
    output: "written"
  })}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === collectorFile) {
  main().catch((error) => {
    process.stderr.write(`Pilot collector failed: ${redactError(error)}\n`);
    process.exitCode = 1;
  });
}
