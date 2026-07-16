import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const REQUIRED_COVERED_FILES = [
  "data/dusk/capabilities.json",
  "data/dusk/networks.evm.json",
  "data/dusk/resources.json",
  "data/dusk/troubleshooting.json"
];
const RECORD_KEYS = ["capabilities", "networks", "resources", "troubleshooting"];
const SHA256_RE = /^[a-f0-9]{64}$/i;

function parseDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error(`${label} must be YYYY-MM-DD.`);
  const date = new Date(value + "T00:00:00.000Z");
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new Error(`${label} is not a valid date.`);
  return date;
}

function collectUrls(value, output = []) {
  if (typeof value === "string" && /^(?:https|wss):\/\//.test(value)) output.push(value);
  else if (Array.isArray(value)) for (const item of value) collectUrls(item, output);
  else if (value && typeof value === "object") for (const item of Object.values(value)) collectUrls(item, output);
  return output;
}

export function validateSourceFreshness(receipt, options = {}) {
  const now = options.now ?? new Date();
  const fileExists = options.fileExists ?? (() => true);
  const fileHash = options.fileHash;
  const readJson = options.readJson;
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new Error("Freshness evaluation time is invalid.");
  if (typeof fileHash !== "function") throw new Error("Source freshness validation requires a content-hash reader.");
  if (typeof readJson !== "function") throw new Error("Source freshness validation requires a structured-data reader.");
  if (!receipt || receipt.schema_version !== 3) throw new Error("Unsupported source freshness schema version.");
  if (receipt.policy !== "fail-build") throw new Error("Source freshness policy must fail the build.");
  if (receipt.status !== "verified") throw new Error("Source freshness receipt is not verified.");
  const reviewedAt = parseDate(receipt.reviewed_at, "reviewed_at");
  const expiresAt = parseDate(receipt.expires_at, "expires_at");
  if (expiresAt < reviewedAt) throw new Error("Source freshness expiry predates its review.");
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (reviewedAt > today) throw new Error("Source freshness review date is in the future.");
  if (today > expiresAt) throw new Error(`Source freshness receipt expired on ${receipt.expires_at}.`);
  if (!Array.isArray(receipt.covered_files) || receipt.covered_files.length !== REQUIRED_COVERED_FILES.length) {
    throw new Error("Source freshness receipt does not cover the required data files.");
  }
  const coveredFiles = new Map();
  for (const coveredFile of receipt.covered_files) {
    if (!coveredFile || typeof coveredFile.path !== "string" || !SHA256_RE.test(coveredFile.sha256 ?? "")) {
      throw new Error("Source freshness coverage contains an invalid path or SHA-256 digest.");
    }
    if (coveredFiles.has(coveredFile.path)) throw new Error(`Source freshness coverage duplicates ${coveredFile.path}.`);
    coveredFiles.set(coveredFile.path, coveredFile.sha256.toLowerCase());
  }
  for (const requiredFile of REQUIRED_COVERED_FILES) {
    const expectedHash = coveredFiles.get(requiredFile);
    if (!expectedHash || !fileExists(requiredFile)) throw new Error(`Source freshness coverage is missing ${requiredFile}.`);
    const actualHash = fileHash(requiredFile);
    if (typeof actualHash !== "string" || !SHA256_RE.test(actualHash) || actualHash.toLowerCase() !== expectedHash) {
      throw new Error(`Source freshness content changed for ${requiredFile}.`);
    }
  }
  if (!Array.isArray(receipt.sources) || receipt.sources.length === 0) throw new Error("Source freshness receipt has no primary sources.");
  if (!receipt.provenance || !Array.isArray(receipt.provenance.approved_hosts) || !receipt.provenance.record_counts) {
    throw new Error("Source freshness provenance coverage is incomplete.");
  }
  const approvedHosts = new Set(receipt.provenance.approved_hosts);
  if (approvedHosts.size !== receipt.provenance.approved_hosts.length || approvedHosts.size === 0) {
    throw new Error("Source freshness approved hosts must be unique and non-empty.");
  }
  for (const source of receipt.sources) {
    if (!source || typeof source.id !== "string" || !source.id) throw new Error("Source freshness entry is missing an id.");
    if (source.status !== "verified") throw new Error(`Source ${source.id} is not verified.`);
    const url = new URL(source.url);
    if (url.protocol !== "https:") throw new Error(`Source ${source.id} must use HTTPS.`);
    if (!approvedHosts.has(url.hostname)) throw new Error(`Source ${source.id} uses an unapproved host.`);
    const checkedAt = parseDate(source.checked_at, `source ${source.id} checked_at`);
    if (checkedAt < reviewedAt || checkedAt > expiresAt) throw new Error(`Source ${source.id} check is outside the receipt window.`);
    if (checkedAt > today) throw new Error(`Source ${source.id} check date is in the future.`);
  }
  const data = {
    capabilities: readJson("data/dusk/capabilities.json"),
    networks: readJson("data/dusk/networks.evm.json"),
    resources: readJson("data/dusk/resources.json"),
    troubleshooting: readJson("data/dusk/troubleshooting.json")
  };
  let recordCount = 0;
  for (const key of RECORD_KEYS) {
    if (!Array.isArray(data[key])) throw new Error(`Structured data ${key} must be an array.`);
    const expectedCount = receipt.provenance.record_counts[key];
    if (!Number.isInteger(expectedCount) || data[key].length !== expectedCount) throw new Error(`Source freshness record count changed for ${key}.`);
    recordCount += data[key].length;
  }
  for (const urlText of collectUrls(data)) {
    const url = new URL(urlText);
    if (!new Set(["https:", "wss:"]).has(url.protocol)) throw new Error(`Structured data URL protocol is not approved: ${urlText}`);
    if (!approvedHosts.has(url.hostname)) throw new Error(`Structured data uses unapproved host ${url.hostname}.`);
  }
  return { reviewedAt: receipt.reviewed_at, expiresAt: receipt.expires_at, sourceCount: receipt.sources.length, recordCount };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const root = process.cwd();
    const receiptPath = path.join(root, "data", "dusk", "source-freshness.json");
    const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
    const result = validateSourceFreshness(receipt, {
      now: process.env.DUSK_STUDIO_FRESHNESS_NOW ? new Date(process.env.DUSK_STUDIO_FRESHNESS_NOW) : new Date(),
      fileExists: (relativePath) => fs.existsSync(path.join(root, relativePath)),
      fileHash: (relativePath) => createHash("sha256").update(fs.readFileSync(path.join(root, relativePath))).digest("hex"),
      readJson: (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), "utf8"))
    });
    console.log(`Source freshness verified through ${result.expiresAt} across ${result.sourceCount} primary sources and ${result.recordCount} structured records.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Source freshness validation failed.");
    process.exitCode = 1;
  }
}
