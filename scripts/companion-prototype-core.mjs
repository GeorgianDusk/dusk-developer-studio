import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { verifyRelease } from "./companion-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const POSTJECT_VERSION = "1.0.0-alpha.6";
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const SIDECARS = new Set(["SHA256SUMS", "companion-provenance.json", "companion-sbom.cdx.json", "payload-manifest.json", "payload-manifest.sig.json"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function ensureNewDirectory(directory) {
  const resolved = path.resolve(directory);
  if (fs.existsSync(resolved)) throw new Error(`Prototype output already exists: ${resolved}`);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function safeRelative(value) {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) throw new Error(`Unsafe prototype path: ${value}`);
  const normalized = path.posix.normalize(value);
  if (normalized !== value || normalized === "." || normalized.startsWith("../") || value.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Unsafe prototype path: ${value}`);
  }
  return value;
}

function walkRegularFiles(root, directory = root) {
  const records = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const absolute = path.join(directory, entry.name);
    const stat = fs.lstatSync(absolute);
    const relative = safeRelative(path.relative(root, absolute).split(path.sep).join("/"));
    if (stat.isSymbolicLink()) throw new Error(`Prototype input contains a symlink or reparse entry: ${relative}`);
    if (stat.isDirectory()) records.push(...walkRegularFiles(root, absolute));
    else if (stat.isFile()) records.push({ absolute, relative, mode: stat.mode, bytes: stat.size });
    else throw new Error(`Prototype input contains a non-regular entry: ${relative}`);
  }
  return records.sort((a, b) => a.relative.localeCompare(b.relative));
}

function put(file, bytes, mode = 0o644) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes, { flag: "wx", mode });
  try { fs.chmodSync(file, mode); } catch { /* Windows records but does not enforce POSIX mode bits. */ }
}

function copyRecords(records, destination, prefix = "") {
  for (const record of records) {
    const relative = safeRelative(prefix ? `${prefix}/${record.relative}` : record.relative);
    put(path.join(destination, ...relative.split("/")), fs.readFileSync(record.absolute), record.mode & 0o111 ? 0o755 : 0o644);
  }
}

export function copyVerifiedReleaseFlat({ releaseDir, outDir }) {
  const source = path.resolve(releaseDir);
  const output = path.resolve(outDir);
  const before = verifyRelease({ productRoot, releaseDir: source, executeRuntime: false });
  if (fs.existsSync(output)) throw new Error(`Flattened prototype release already exists: ${output}`);
  fs.mkdirSync(output, { recursive: true });
  try {
    const payload = path.join(source, "payload");
    if (fs.existsSync(payload)) {
      copyRecords(walkRegularFiles(payload), output);
      const sidecars = walkRegularFiles(source).filter((record) => !record.relative.startsWith("payload/") && record.relative !== "payload-manifest.json");
      if (sidecars.some((record) => !SIDECARS.has(record.relative))) throw new Error("Prototype release envelope contains an unexpected sidecar.");
      copyRecords(sidecars, output);
    } else {
      copyRecords(walkRegularFiles(source), output);
    }
    const after = verifyRelease({ productRoot, releaseDir: output, executeRuntime: false });
    if (before.fingerprint !== after.fingerprint || before.manifest.target !== after.manifest.target) throw new Error("Flattened prototype release changed identity.");
    return after;
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

function executablePathsFor(manifest) {
  const paths = new Set([manifest.runtime.binary_path]);
  if (manifest.target === "linux-x64") {
    paths.add("bin/dusk-studio");
    paths.add("bin/dusk-studio-local-actions");
  }
  return paths;
}

function createReleaseBundle(records, executablePaths) {
  const bodies = [];
  const files = records.map((record) => {
    const body = fs.readFileSync(record.absolute);
    bodies.push(body);
    const executable = executablePaths.has(record.relative) || (record.mode & 0o111) !== 0;
    return { path: record.relative, bytes: body.length, sha256: sha256(body), mode: executable ? 0o755 : 0o644 };
  });
  const header = jsonBytes({ schema_version: 1, files });
  const length = Buffer.alloc(4);
  length.writeUInt32BE(header.length);
  return gzipSync(Buffer.concat([length, header, ...bodies]), { level: 9, mtime: 0 });
}

function runCommand(file, args, options = {}) {
  const result = spawnSync(file, args, { encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: 120_000, ...options });
  if (result.error || result.status !== 0) {
    const details = [result.error?.message, result.stdout, result.stderr].filter(Boolean).join("\n").trim();
    throw new Error(details || `Command failed: ${file} ${args.join(" ")}`);
  }
  return result;
}

function runNode(args, options = {}) {
  return runCommand(process.execPath, args, options);
}

function npmCli() {
  const candidate = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (!fs.existsSync(candidate)) throw new Error("The npm prototype builder requires the npm CLI installed beside Node.js.");
  return candidate;
}

function npmVersion(version, commit) {
  const base = version.split("-", 1)[0];
  return `${base}-internal.${commit.slice(0, 8)}`;
}

export function buildNpmPrototype({ windowsRelease, linuxRelease, outDir }) {
  const output = ensureNewDirectory(outDir);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-npm-prototype-"));
  try {
    const packageRoot = path.join(output, "package");
    fs.mkdirSync(packageRoot);
    const verified = {};
    const bundles = {};
    for (const [target, release] of [["windows-x64", windowsRelease], ["linux-x64", linuxRelease]]) {
      if (!release) throw new Error(`The npm prototype requires a verified ${target} release.`);
      const flattened = path.join(temporary, target);
      verified[target] = copyVerifiedReleaseFlat({ releaseDir: release, outDir: flattened });
      if (verified[target].manifest.target !== target) throw new Error(`The ${target} npm input has the wrong target identity.`);
      const bytes = createReleaseBundle(walkRegularFiles(flattened), executablePathsFor(verified[target].manifest));
      const relative = `bundles/${target}.bundle.gz`;
      put(path.join(packageRoot, ...relative.split("/")), bytes);
      bundles[target] = { path: relative, bytes: bytes.length, sha256: sha256(bytes) };
    }
    const win = verified["windows-x64"].manifest;
    const linux = verified["linux-x64"].manifest;
    if (win.product !== linux.product || win.version !== linux.version || win.commit !== linux.commit || win.signing_status !== linux.signing_status) {
      throw new Error("The npm prototype requires exact Windows/Linux release parity.");
    }
    const npmPrototype = path.join(productRoot, "distribution", "prototypes", "npm");
    for (const name of ["launch.mjs", "dusk-studio.mjs", "dusk-studio-local-actions.mjs"]) {
      const mode = name === "launch.mjs" ? 0o644 : 0o755;
      put(path.join(packageRoot, "bin", name), fs.readFileSync(path.join(npmPrototype, name)), mode);
    }
    const packageVersion = npmVersion(win.version, win.commit);
    const packageJson = {
      name: "@dusk-network/developer-studio",
      version: packageVersion,
      private: true,
      description: "Private distribution prototype for Dusk Developer Studio Local.",
      license: "Apache-2.0",
      type: "module",
      engines: { node: ">=22.14.0" },
      os: ["win32", "linux"],
      cpu: ["x64"],
      bin: {
        "dusk-studio": "bin/dusk-studio.mjs",
        "dusk-studio-local-actions": "bin/dusk-studio-local-actions.mjs"
      },
      files: ["bin", "bundles", "README.md", "prototype-receipt.json"]
    };
    const receipt = {
      schema_version: 1,
      status: "private-unsigned-prototype",
      channel: "npm-universal",
      package: packageJson.name,
      package_version: packageVersion,
      source_version: win.version,
      source_commit: win.commit,
      runtime_dependencies: 0,
      install_scripts: 0,
      embedded_targets: Object.fromEntries(Object.entries(verified).map(([target, result]) => [target, {
        fingerprint_sha256: result.fingerprint,
        signing_status: result.manifest.signing_status,
        bundle: bundles[target]
      }]))
    };
    put(path.join(packageRoot, "package.json"), jsonBytes(packageJson));
    put(path.join(packageRoot, "prototype-receipt.json"), jsonBytes(receipt));
    put(path.join(packageRoot, "README.md"), Buffer.from("# Dusk Developer Studio npm distribution prototype\n\nInternal evaluation artifact only. It is private, unsigned, not a supported release, and must not be published. The default `dusk-studio` command starts safe mode; `dusk-studio-local-actions` explicitly enables allowlisted local checks and starter creation.\n"));
    const pack = runNode([npmCli(), "pack", "--ignore-scripts", "--json", "--pack-destination", output], {
      cwd: packageRoot,
      env: { ...process.env, NPM_CONFIG_OFFLINE: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" }
    });
    const packResult = JSON.parse(pack.stdout);
    if (!Array.isArray(packResult) || packResult.length !== 1 || !packResult[0].filename) throw new Error("npm pack did not return one prototype tarball.");
    const tarball = path.join(output, packResult[0].filename);
    return { output, packageRoot, tarball, packageJson, receipt, sha256: sha256(fs.readFileSync(tarball)), bytes: fs.statSync(tarball).size };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

function postjectCli() {
  const packageJson = JSON.parse(fs.readFileSync(path.join(productRoot, "node_modules", "postject", "package.json"), "utf8"));
  if (packageJson.version !== POSTJECT_VERSION) throw new Error(`Expected postject ${POSTJECT_VERSION}.`);
  return path.join(productRoot, "node_modules", "postject", "dist", "cli.js");
}

export function buildSeaPrototype({ releaseDir, target, outDir }) {
  const output = ensureNewDirectory(outDir);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-sea-build-"));
  try {
    const flattened = path.join(temporary, "release");
    const verified = copyVerifiedReleaseFlat({ releaseDir, outDir: flattened });
    const manifest = verified.manifest;
    if (manifest.target !== target) throw new Error("The standalone prototype target does not match its embedded release.");
    if (process.versions.node !== manifest.runtime.version) throw new Error(`SEA generation requires build Node ${manifest.runtime.version}.`);
    if (target === "darwin-arm64" && (process.platform !== "darwin" || process.arch !== "arm64")) throw new Error("macOS Apple Silicon SEA generation requires a native darwin-arm64 signing runner.");
    const allRecords = walkRegularFiles(flattened);
    const runtimeRecord = allRecords.find((record) => record.relative === manifest.runtime.binary_path);
    if (!runtimeRecord || sha256(fs.readFileSync(runtimeRecord.absolute)) !== manifest.runtime.binary_sha256) throw new Error("The externalized runtime is not bound to the verified portable receipt.");
    const records = allRecords.filter((record) => record.relative !== manifest.runtime.binary_path);
    if (records.length !== allRecords.length - 1) throw new Error("The standalone prototype must externalize exactly one runtime binary.");
    const releaseBundle = path.join(temporary, "release.bundle.gz");
    const releaseBundleBytes = createReleaseBundle(records, executablePathsFor(manifest));
    fs.writeFileSync(releaseBundle, releaseBundleBytes);
    const blob = path.join(temporary, "sea-preparation.blob");
    const config = path.join(temporary, "sea-config.json");
    const bootstrap = path.join(productRoot, "distribution", "prototypes", "sea", "bootstrap-bundle.cjs");
    fs.writeFileSync(config, jsonBytes({ main: bootstrap, output: blob, disableExperimentalSEAWarning: true, useSnapshot: false, useCodeCache: false, assets: { "release.bundle.gz": releaseBundle } }));
    runNode(["--experimental-sea-config", config], { cwd: temporary });
    const executableName = `dusk-developer-studio-local-${manifest.version}-${target}-private-v2${target === "windows-x64" ? ".exe" : ""}`;
    const executable = path.join(output, executableName);
    fs.copyFileSync(runtimeRecord.absolute, executable, fs.constants.COPYFILE_EXCL);
    try { fs.chmodSync(executable, 0o755); } catch { /* Windows executable mode is not POSIX. */ }
    if (target === "darwin-arm64") runCommand("codesign", ["--remove-signature", executable], { cwd: temporary });
    const postjectArgs = [postjectCli(), executable, "NODE_SEA_BLOB", blob, "--sentinel-fuse", SEA_FUSE, ...(target === "darwin-arm64" ? ["--macho-segment-name", "NODE_JS"] : [])];
    runNode(postjectArgs, { cwd: temporary });
    if (target === "darwin-arm64") runCommand("codesign", ["--sign", "-", "--force", executable], { cwd: temporary });
    const receipt = {
      schema_version: 2,
      status: "private-nonpublication-prototype",
      channel: "node-sea-in-process",
      target,
      version: manifest.version,
      commit: manifest.commit,
      embedded_release_fingerprint_sha256: verified.fingerprint,
      embedded_runtime_version: manifest.runtime.version,
      contains_second_embedded_runtime: false,
      externalized_runtime: { path: manifest.runtime.binary_path, bytes_removed_from_bundle: runtimeRecord.bytes, sha256: manifest.runtime.binary_sha256 },
      embedded_file_count: records.length,
      embedded_release_bundle_bytes: releaseBundleBytes.length,
      embedded_release_bundle_sha256: sha256(releaseBundleBytes),
      postject_version: POSTJECT_VERSION,
      platform_signature_status: target === "darwin-arm64" ? "adhoc-development-only" : "unsigned",
      executable: executableName,
      executable_sha256: sha256(fs.readFileSync(executable)),
      executable_bytes: fs.statSync(executable).size
    };
    fs.writeFileSync(path.join(output, "prototype-receipt.json"), jsonBytes(receipt));
    return { output, executable, receipt, sha256: receipt.executable_sha256, bytes: receipt.executable_bytes };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}
