import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";

const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return { resolved, stat };
}

function safePackagePath(value, label) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
      || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} package path is unsafe.`);
  }
  return normalized;
}

function fileRecord(file, name, extra = {}) {
  const record = regularFile(file, name);
  return { ...extra, name: safePackagePath(name, "Signed launcher"), bytes: record.stat.size, sha256: digestFile(record.resolved) };
}

export function createSignedLauncherIndex({
  target, safeLauncher, localActionsLauncher, safeName, localActionsName, buildReceipt,
  safeAttestation, localActionsAttestation
}) {
  if (!TARGETS.has(target)) throw new Error("Unsupported signed-launcher target.");
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptFile.resolved, "utf8"));
  validateStandaloneBuildReceipt(receipt, target);
  const launchers = {
    safe: fileRecord(safeLauncher, safeName ?? path.basename(safeLauncher), { mode: "safe" }),
    local_actions: fileRecord(localActionsLauncher, localActionsName ?? path.basename(localActionsLauncher), { mode: "local-actions" })
  };
  if (launchers.safe.name === launchers.local_actions.name || launchers.safe.sha256 === launchers.local_actions.sha256) {
    throw new Error("Signed launcher index requires two distinct mode-bound files.");
  }
  const attestations = {};
  for (const [key, file] of [["safe", safeAttestation], ["local_actions", localActionsAttestation]]) {
    if (!file) continue;
    const attestation = regularFile(file, `${key} launcher attestation`);
    attestations[key] = { name: safePackagePath(`attestations/${path.basename(attestation.resolved)}`, "Attestation"), bytes: attestation.stat.size, sha256: digestFile(attestation.resolved) };
  }
  if (target === "linux-x64" && Object.keys(attestations).length !== 2) throw new Error("Linux launcher index requires two Sigstore bundles.");
  if (target !== "linux-x64" && Object.keys(attestations).length) throw new Error("Only Linux launcher indexes accept detached attestations.");
  return {
    schema_version: 1,
    target,
    version: receipt.version,
    commit: receipt.commit,
    unsigned_asset_index_sha256: receipt.unsigned_asset_index_sha256,
    launchers,
    ...(Object.keys(attestations).length ? { attestations } : {})
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    for (const name of ["target", "safe-launcher", "local-actions-launcher", "build-receipt", "out"]) {
      if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    const result = createSignedLauncherIndex({
      target: args.target,
      safeLauncher: args["safe-launcher"],
      localActionsLauncher: args["local-actions-launcher"],
      safeName: args["safe-name"],
      localActionsName: args["local-actions-name"],
      buildReceipt: args["build-receipt"],
      safeAttestation: args["safe-attestation"],
      localActionsAttestation: args["local-actions-attestation"]
    });
    fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(result, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "indexed", target: result.target, launchers: Object.keys(result.launchers) }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Signed launcher index creation failed.");
    process.exitCode = 1;
  }
}
