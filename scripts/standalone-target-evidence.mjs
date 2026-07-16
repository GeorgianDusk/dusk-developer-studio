import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { expectedTargetIdentity } from "./standalone-signing-evidence.mjs";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return { resolved, stat };
}

export function createStandaloneTargetEvidence({ policy, target, artifact, buildReceipt, releaseTag, identity, oidcIssuer = "", passedChecks = [] }) {
  if (!TARGETS.has(target) || !policy?.targets?.[target]) throw new Error("Unsupported standalone evidence target.");
  const artifactFile = regularFile(artifact, "Artifact");
  if (artifactFile.stat.size <= 0) throw new Error("Artifact must not be empty.");
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptFile.resolved, "utf8"));
  if (receipt.schema_version !== 2 || receipt.status !== "private-nonpublication-prototype" || receipt.channel !== "node-sea-in-process"
      || receipt.target !== target || !VERSION_RE.test(receipt.version ?? "") || !SHA256_RE.test(receipt.executable_sha256 ?? "")
      || !COMMIT_RE.test(receipt.commit ?? "") || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(receipt.executable ?? "")) throw new Error("Build receipt identity is invalid.");
  if (target !== "darwin-arm64" && path.basename(artifactFile.resolved) !== receipt.executable) throw new Error("Signed executable name does not match its build receipt.");
  const targetPolicy = policy.targets[target];
  let tagRegex;
  try { tagRegex = new RegExp(policy.release_tag_pattern); } catch { throw new Error("Signing policy release-tag pattern is invalid."); }
  if (!tagRegex.test(releaseTag ?? "")) throw new Error("Release tag does not match the signing policy.");
  const expectedIdentity = expectedTargetIdentity(policy, target, releaseTag);
  if (!expectedIdentity || identity !== expectedIdentity) throw new Error("Target platform identity does not match the signing policy.");
  if (targetPolicy.approved_oidc_issuer && oidcIssuer !== targetPolicy.approved_oidc_issuer) throw new Error("Target OIDC issuer does not match the signing policy.");
  if (target === "windows-x64" && path.extname(artifactFile.resolved).toLowerCase() !== ".exe") throw new Error("Windows artifact must be an executable.");
  if (target === "darwin-arm64" && path.extname(artifactFile.resolved).toLowerCase() !== ".zip") throw new Error("macOS artifact must be the final app ZIP.");
  const allowedChecks = new Set(targetPolicy.required_checks ?? []);
  if (new Set(passedChecks).size !== passedChecks.length) throw new Error("Target evidence contains a duplicate check.");
  if (passedChecks.some((check) => !allowedChecks.has(check))) throw new Error("Target evidence contains an unknown check.");
  const checks = Object.fromEntries([...allowedChecks].map((check) => [check, passedChecks.includes(check)]));
  const record = {
    schema_version: 1,
    target,
    release_tag: releaseTag,
    commit: receipt.commit,
    artifact_name: path.basename(artifactFile.resolved),
    artifact_bytes: artifactFile.stat.size,
    artifact_sha256: digestFile(artifactFile.resolved),
    build_receipt_sha256: digestFile(receiptFile.resolved),
    unsigned_artifact_sha256: receipt.executable_sha256,
    distribution_format: targetPolicy.distribution_format,
    signing_provider: targetPolicy.signing_provider,
    [targetPolicy.identity_field]: identity,
    ...(targetPolicy.approved_oidc_issuer ? { oidc_issuer: oidcIssuer } : {}),
    checks
  };
  return record;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    for (const name of ["target", "artifact", "build-receipt", "release-tag", "identity", "out"]) if (!args[name]) throw new Error(`Missing --${name}.`);
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
    const policy = JSON.parse(fs.readFileSync(path.join(root, "config", "companion-standalone-signing-policy.json"), "utf8"));
    const record = createStandaloneTargetEvidence({
      policy, target: args.target, artifact: args.artifact, buildReceipt: args["build-receipt"], releaseTag: args["release-tag"],
      identity: args.identity, oidcIssuer: args["oidc-issuer"] ?? "", passedChecks: String(args.checks ?? "").split(",").filter(Boolean)
    });
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "recorded", target: record.target, artifact_sha256: record.artifact_sha256, output: path.resolve(args.out) }, null, 2));
  } catch (error) { console.error(error instanceof Error ? error.message : "Standalone target evidence failed."); process.exitCode = 1; }
}
