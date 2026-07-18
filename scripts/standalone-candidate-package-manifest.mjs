import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cli } from "./companion-core.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";

const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const MANIFEST_NAME = "candidate-package-manifest.json";
const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function safeRelative(value) {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:/.test(normalized)
      || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe candidate package path: ${value}`);
  }
  return normalized;
}

function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return { resolved, stat };
}

function inventory(root, allowExistingManifest = false) {
  const files = [];
  const folded = new Set();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length) {
    const item = pending.pop();
    const stat = fs.lstatSync(item.absolute);
    if (stat.isSymbolicLink()) throw new Error(`Candidate package contains a symlink or reparse entry: ${item.relative || "."}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(item.absolute).sort().reverse()) {
        pending.push({ absolute: path.join(item.absolute, name), relative: safeRelative(item.relative ? `${item.relative}/${name}` : name) });
      }
    } else if (stat.isFile()) {
      if (item.relative === MANIFEST_NAME) {
        if (allowExistingManifest) continue;
        throw new Error(`${MANIFEST_NAME} must not exist before inventory creation.`);
      }
      const key = item.relative.toLowerCase();
      if (folded.has(key)) throw new Error(`Candidate package contains a case-colliding path: ${item.relative}`);
      folded.add(key);
      files.push({ path: item.relative, bytes: stat.size, sha256: digestFile(item.absolute) });
    } else {
      throw new Error(`Candidate package contains a non-regular entry: ${item.relative}`);
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function validateInventoryPolicy({ packageRoot, target, receiptFile, indexFile, index, files }) {
  const receiptPath = safeRelative(path.relative(packageRoot, receiptFile.resolved));
  const indexPath = safeRelative(path.relative(packageRoot, indexFile.resolved));
  if (receiptPath !== "evidence/prototype-receipt.json" || indexPath !== "signed-launcher-index.json") {
    throw new Error("Candidate package evidence paths do not match the fixed package contract.");
  }
  const safe = safeRelative(index.launchers?.safe?.name ?? "");
  const actions = safeRelative(index.launchers?.local_actions?.name ?? "");
  const required = new Set([receiptPath, indexPath, safe, actions]);
  const allowed = new Set(required);
  if (target === "linux-x64") {
    const safeAttestation = safeRelative(index.attestations?.safe?.name ?? "");
    const actionsAttestation = safeRelative(index.attestations?.local_actions?.name ?? "");
    required.add(safeAttestation); required.add(actionsAttestation);
    allowed.add(safeAttestation); allowed.add(actionsAttestation);
  } else if (target === "darwin-arm64") {
    for (const launcher of [safe, actions]) {
      const marker = "/Contents/MacOS/";
      const at = launcher.indexOf(marker);
      if (at <= 0 || !launcher.slice(0, at).endsWith(".app")) throw new Error("macOS signed launcher path is not inside an app bundle.");
      const app = launcher.slice(0, at);
      const plist = `${app}/Contents/Info.plist`;
      const signature = `${app}/Contents/_CodeSignature/CodeResources`;
      const notarizationTicket = `${app}/Contents/CodeResources`;
      required.add(plist); required.add(signature); required.add(notarizationTicket);
      allowed.add(plist); allowed.add(signature); allowed.add(notarizationTicket);
    }
    for (const evidence of ["evidence/macos-app-receipt.json", "evidence/notarization.json"]) {
      required.add(evidence); allowed.add(evidence);
    }
  }
  const actual = new Set(files.map((record) => record.path));
  if ([...required].some((name) => !actual.has(name)) || [...actual].some((name) => !allowed.has(name))) {
    throw new Error("Candidate package contains a missing or unexpected inventory entry.");
  }
}

export function createCandidatePackageManifest({ root, target, buildReceipt, signedLauncherIndex }) {
  if (!TARGETS.has(target)) throw new Error("Unsupported candidate package target.");
  const packageRoot = path.resolve(root);
  const rootStat = fs.lstatSync(packageRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("Candidate package root must be a non-symlink directory.");
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const indexFile = regularFile(signedLauncherIndex, "Signed launcher index");
  for (const file of [receiptFile.resolved, indexFile.resolved]) {
    const relative = path.relative(packageRoot, file);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Candidate package evidence must be inside the package root.");
  }
  const receipt = JSON.parse(fs.readFileSync(receiptFile.resolved, "utf8"));
  const index = JSON.parse(fs.readFileSync(indexFile.resolved, "utf8"));
  validateStandaloneBuildReceipt(receipt, target);
  if (index.schema_version !== 1 || index.target !== target || index.version !== receipt.version
      || index.commit !== receipt.commit || index.unsigned_asset_index_sha256 !== receipt.unsigned_asset_index_sha256) {
    throw new Error("Candidate package receipt and signed launcher index do not agree.");
  }
  const files = inventory(packageRoot);
  validateInventoryPolicy({ packageRoot, target, receiptFile, indexFile, index, files });
  return {
    schema_version: 1,
    target,
    version: receipt.version,
    commit: receipt.commit,
    unsigned_asset_index_sha256: receipt.unsigned_asset_index_sha256,
    signed_launcher_index_sha256: digestFile(indexFile.resolved),
    files
  };
}

export function verifyCandidatePackageManifest({ root, target, buildReceipt, signedLauncherIndex, manifestFile }) {
  const packageRoot = path.resolve(root);
  const manifest = regularFile(manifestFile, "Candidate package manifest");
  if (path.resolve(manifest.resolved) !== path.join(packageRoot, MANIFEST_NAME)) {
    throw new Error("Candidate package manifest is not at the package root.");
  }
  const expected = createCandidatePackageManifestForVerification({ root: packageRoot, target, buildReceipt, signedLauncherIndex });
  const observed = JSON.parse(fs.readFileSync(manifest.resolved, "utf8"));
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw new Error("Candidate package inventory or file digest does not match its manifest.");
  return observed;
}

function createCandidatePackageManifestForVerification({ root, target, buildReceipt, signedLauncherIndex }) {
  if (!TARGETS.has(target)) throw new Error("Unsupported candidate package target.");
  const receiptFile = regularFile(buildReceipt, "Build receipt");
  const indexFile = regularFile(signedLauncherIndex, "Signed launcher index");
  const receipt = JSON.parse(fs.readFileSync(receiptFile.resolved, "utf8"));
  const index = JSON.parse(fs.readFileSync(indexFile.resolved, "utf8"));
  validateStandaloneBuildReceipt(receipt, target);
  if (index.schema_version !== 1 || index.target !== target
      || index.version !== receipt.version || index.commit !== receipt.commit
      || index.unsigned_asset_index_sha256 !== receipt.unsigned_asset_index_sha256) {
    throw new Error("Candidate package receipt and signed launcher index do not agree.");
  }
  const files = inventory(path.resolve(root), true);
  validateInventoryPolicy({ packageRoot: path.resolve(root), target, receiptFile, indexFile, index, files });
  return {
    schema_version: 1,
    target,
    version: receipt.version,
    commit: receipt.commit,
    unsigned_asset_index_sha256: receipt.unsigned_asset_index_sha256,
    signed_launcher_index_sha256: digestFile(indexFile.resolved),
    files
  };
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    for (const name of ["root", "target", "build-receipt", "signed-launcher-index", "out"]) {
      if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    const expected = path.join(path.resolve(args.root), MANIFEST_NAME);
    if (path.resolve(args.out) !== expected) throw new Error(`Candidate package manifest output must be ${expected}.`);
    const manifest = createCandidatePackageManifest({
      root: args.root,
      target: args.target,
      buildReceipt: args["build-receipt"],
      signedLauncherIndex: args["signed-launcher-index"]
    });
    fs.writeFileSync(expected, `${JSON.stringify(manifest, null, 2)}\n`, { flag: "wx" });
    console.log(JSON.stringify({ status: "inventoried", target: manifest.target, files: manifest.files.length }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Candidate package inventory failed.");
    process.exitCode = 1;
  }
}
