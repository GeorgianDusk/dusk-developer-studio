import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const MANIFEST_NAME = "release-manifest.json";
const ASSURANCE_NAME = "assurance-receipt.json";
const SHA256_RE = /^[a-f0-9]{64}$/;
const RESULT_VALUES = new Set(["not-run", "passed", "failed"]);
const REQUIRED_PRODUCTION_ASSURANCE = ["dependency_audit", "secret_scan", "browser_matrix", "source_access", "live_smoke"];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function readCommit(root, environment) {
  const override = process.env.DUSK_STUDIO_RELEASE_COMMIT?.trim();
  if (override) {
    if (!/^[a-f0-9]{40}$/i.test(override)) throw new Error("Release commit override must be a full 40-character Git SHA.");
    return override.toLowerCase();
  }
  try {
    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase();
    const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", "."], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().length > 0;
    if (environment === "production" && dirty) throw new Error("Production release manifests require a clean committed product worktree.");
    return dirty ? `${commit}-dirty` : commit;
  } catch (error) {
    if (error instanceof Error && error.message.includes("clean committed")) throw error;
    if (environment === "production") throw new Error("Production release manifests require a verifiable Git commit.");
    return "unknown";
  }
}

function walkFiles(directory, base = directory) {
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute, base));
    else if (entry.isFile() && entry.name !== MANIFEST_NAME) files.push(path.relative(base, absolute).replaceAll(path.sep, "/"));
  }
  return files.sort();
}

function readAssurance(options, environment) {
  const assurance = {
    dependency_audit: options.dependencyAudit ?? process.env.DUSK_STUDIO_DEPENDENCY_AUDIT ?? "not-run",
    secret_scan: options.secretScan ?? process.env.DUSK_STUDIO_SECRET_SCAN ?? "not-run",
    browser_matrix: options.browserMatrix ?? process.env.DUSK_STUDIO_BROWSER_MATRIX ?? "not-run",
    source_access: options.sourceAccess ?? process.env.DUSK_STUDIO_SOURCE_ACCESS ?? "not-run",
    live_smoke: options.liveSmoke ?? process.env.DUSK_STUDIO_LIVE_SMOKE ?? "not-run"
  };
  for (const [name, result] of Object.entries(assurance)) {
    if (!RESULT_VALUES.has(result)) throw new Error(`Assurance result ${name} is invalid.`);
  }
  if (environment === "production") {
    const missing = REQUIRED_PRODUCTION_ASSURANCE.filter((name) => assurance[name] !== "passed");
    if (missing.length) throw new Error(`Production release manifests require passed assurance: ${missing.join(", ")}.`);
  }
  return assurance;
}

function assertFreshSource(root, environment, now) {
  if (environment !== "production") return;
  const receipt = JSON.parse(fs.readFileSync(path.join(root, "data", "dusk", "source-freshness.json"), "utf8"));
  const expires = Date.parse(`${receipt.expires_at}T23:59:59.999Z`);
  if (!Number.isFinite(expires) || now.getTime() > expires) throw new Error("Production release manifests require a current source freshness receipt.");
}

export function collectArtifacts(distDir) {
  if (!fs.existsSync(distDir)) throw new Error(`Build artifact directory does not exist: ${distDir}`);
  return walkFiles(distDir).map((relativePath) => {
    const contents = fs.readFileSync(path.join(distDir, relativePath));
    return { path: relativePath, sha256: sha256(contents), bytes: contents.byteLength };
  });
}

export function createReleaseManifest(root, options = {}) {
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const sourceReceipt = fs.readFileSync(path.join(root, "data", "dusk", "source-freshness.json"));
  const assuranceReceipt = fs.readFileSync(path.join(root, "apps", "studio", "dist", ASSURANCE_NAME));
  const environment = options.environment ?? process.env.DUSK_STUDIO_RELEASE_ENV ?? "local-preview";
  const now = options.now ?? new Date();
  const assurance = readAssurance(options, environment);
  assertFreshSource(root, environment, now);
  return {
    schema_version: 2,
    product: "Dusk Developer Studio",
    version: packageJson.version,
    commit: readCommit(root, environment),
    built_at: now.toISOString(),
    environment,
    dependency_audit: assurance.dependency_audit,
    assurance,
    source_freshness_receipt_sha256: sha256(sourceReceipt),
    assurance_receipt_sha256: sha256(assuranceReceipt),
    artifacts: collectArtifacts(path.join(root, "apps", "studio", "dist"))
  };
}

export function writeReleaseManifest(root, options = {}) {
  const manifest = createReleaseManifest(root, options);
  const destination = path.join(root, "apps", "studio", "dist", MANIFEST_NAME);
  fs.writeFileSync(destination, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  return { manifest, destination };
}

export function validateReleaseManifest(root, manifest) {
  if (!manifest || manifest.schema_version !== 2) throw new Error("Unsupported release manifest schema.");
  if (manifest.product !== "Dusk Developer Studio") throw new Error("Release manifest product identity is invalid.");
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  if (manifest.version !== packageJson.version) throw new Error("Release manifest version does not match package.json.");
  if (typeof manifest.commit !== "string" || manifest.commit.length < 7) throw new Error("Release manifest commit is invalid.");
  if (manifest.environment === "production" && !/^[a-f0-9]{40}$/.test(manifest.commit)) throw new Error("Production release manifest must identify one clean full Git commit.");
  if (Number.isNaN(new Date(manifest.built_at).getTime())) throw new Error("Release manifest build time is invalid.");
  if (!manifest.assurance || REQUIRED_PRODUCTION_ASSURANCE.some((name) => !RESULT_VALUES.has(manifest.assurance[name]))) throw new Error("Release manifest assurance results are invalid.");
  if (manifest.dependency_audit !== manifest.assurance.dependency_audit) throw new Error("Release manifest dependency audit fields disagree.");
  if (manifest.environment === "production") {
    const missing = REQUIRED_PRODUCTION_ASSURANCE.filter((name) => manifest.assurance[name] !== "passed");
    if (missing.length) throw new Error(`Production release manifest has incomplete assurance: ${missing.join(", ")}.`);
    assertFreshSource(root, "production", new Date(manifest.built_at));
  }
  const receiptDigest = sha256(fs.readFileSync(path.join(root, "data", "dusk", "source-freshness.json")));
  if (manifest.source_freshness_receipt_sha256 !== receiptDigest) throw new Error("Release manifest source receipt digest is stale.");
  const assuranceDigest = sha256(fs.readFileSync(path.join(root, "apps", "studio", "dist", ASSURANCE_NAME)));
  if (manifest.assurance_receipt_sha256 !== assuranceDigest) throw new Error("Release manifest assurance receipt digest is stale.");
  const actual = collectArtifacts(path.join(root, "apps", "studio", "dist"));
  if (JSON.stringify(manifest.artifacts) !== JSON.stringify(actual)) throw new Error("Release artifact parity check failed.");
  for (const artifact of manifest.artifacts) {
    if (!artifact.path || !SHA256_RE.test(artifact.sha256) || !Number.isInteger(artifact.bytes) || artifact.bytes < 0) {
      throw new Error("Release manifest contains an invalid artifact record.");
    }
  }
  return { artifactCount: actual.length, version: manifest.version, commit: manifest.commit };
}
