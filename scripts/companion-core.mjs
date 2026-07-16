import { Buffer } from "node:buffer";
import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SHA_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const RESERVED_RE = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const SECRET_RES = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:PRIVATE[_-]?KEY|MNEMONIC|SEED[_-]?(?:PHRASE|ER)?|API[_-]?KEY|PAIRING[_-]?TOKEN)\s*[:=]\s*["']?(?!replace|example|your-|<|\$\{|process\.|undefined|null|false)[A-Za-z0-9_+/=.-]{16,}/i,
  /\beyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/
];
const HOST_PATH_RES = [/[A-Za-z]:[\\/]Users[\\/](?!%|\$|\{|\[)[^\\/\s"'<>]+/, /\/(?:home|Users)\/(?!\$|\{|\[)[^/\s"'<>]+/];

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function safePath(value, policy) {
  const relative = value.replaceAll("\\", "/").replace(/^\.\//, "");
  if (!relative || relative.startsWith("/") || /^[A-Za-z]:/.test(relative) || relative.includes("\0")) throw new Error(`Unsafe payload path: ${value}`);
  const forbidden = new Set(policy.payload.forbidden_segments.map((item) => item.toLowerCase()));
  for (const segment of relative.split("/")) {
    if (!segment || segment === "." || segment === ".." || segment.includes(":") || segment.endsWith(".") || segment.endsWith(" ")) throw new Error(`Non-portable payload path: ${value}`);
    if (RESERVED_RE.test(segment)) throw new Error(`Reserved Windows payload path: ${value}`);
    if (forbidden.has(segment.toLowerCase()) || (/^\.env(?:\..+)?$/i.test(segment) && segment.toLowerCase() !== ".env.example")) throw new Error(`Forbidden payload segment in ${value}`);
  }
  return relative;
}

export function validateRuntimeArchiveEntry(value, archiveRoot) {
  const relative = value.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/+$/, "");
  if (!relative || relative.startsWith("/") || /^[A-Za-z]:/.test(relative) || relative.includes("\0")) {
    throw new Error(`Unsafe runtime archive path: ${value}`);
  }
  const segments = relative.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error(`Unsafe runtime archive path: ${value}`);
  }
  if (segments[0] !== archiveRoot) throw new Error(`Runtime archive entry is outside ${archiveRoot}: ${value}`);
  return relative;
}

export function selectRuntimeArchiveEntries(listing, config) {
  const entries = new Set(listing.split(/\r?\n/).filter(Boolean).map((entry) => validateRuntimeArchiveEntry(entry, config.archive_root)));
  const selected = [
    `${config.archive_root}/${config.source_binary_path}`,
    `${config.archive_root}/LICENSE`
  ].map((entry) => validateRuntimeArchiveEntry(entry, config.archive_root));
  for (const entry of selected) {
    if (!entries.has(entry)) throw new Error(`Verified runtime archive is missing ${entry}.`);
  }
  return selected;
}

function scanText(relative, bytes, runtimePath) {
  if (relative === runtimePath || bytes.subarray(0, Math.min(bytes.length, 16_384)).includes(0)) return;
  const text = bytes.toString("utf8");
  if (SECRET_RES.some((pattern) => pattern.test(text))) throw new Error(`${relative} contains secret-like material.`);
  if (HOST_PATH_RES.some((pattern) => pattern.test(text))) throw new Error(`${relative} contains an absolute build-host path.`);
}

function walk(root, policy, runtimePath = "") {
  if (!fs.existsSync(root)) throw new Error(`Required directory does not exist: ${root}`);
  const files = [];
  const folded = new Map();
  const pending = [{ absolute: root, relative: "" }];
  while (pending.length) {
    const item = pending.pop();
    const stat = fs.lstatSync(item.absolute);
    if (stat.isSymbolicLink()) throw new Error(`Symlink or reparse entry is forbidden: ${item.relative || "."}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(item.absolute).sort().reverse()) {
        const relative = safePath(item.relative ? `${item.relative}/${name}` : name, policy);
        pending.push({ absolute: path.join(item.absolute, name), relative });
      }
    } else if (stat.isFile()) {
      const relative = safePath(item.relative, policy);
      const key = relative.toLowerCase();
      if (folded.has(key)) throw new Error(`Case-colliding paths: ${folded.get(key)} and ${relative}`);
      folded.set(key, relative);
      const bytes = fs.readFileSync(item.absolute);
      scanText(relative, bytes, runtimePath);
      files.push({ absolute: item.absolute, path: relative, bytes: bytes.length, sha256: digest(bytes) });
    } else throw new Error(`Non-regular payload entry is forbidden: ${item.relative}`);
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function put(file, bytes, executable = false) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  try { fs.chmodSync(file, executable ? 0o755 : 0o644); } catch { /* best effort on Windows */ }
}

function copyTree(source, payload, prefix, policy) {
  for (const record of walk(source, policy)) put(path.join(payload, ...safePath(`${prefix}/${record.path}`, policy).split("/")), fs.readFileSync(record.absolute));
}

function locateRuntime(root, config, relative) {
  const direct = path.join(root, ...relative.split("/"));
  const nested = path.join(root, config.archive_root, ...relative.split("/"));
  if (fs.existsSync(direct)) return direct;
  if (fs.existsSync(nested)) return nested;
  throw new Error(`Verified runtime root is missing ${relative}.`);
}

function unpackRuntime(archive, config) {
  if (digest(fs.readFileSync(archive)) !== config.archive_sha256) throw new Error("Runtime archive does not match its pinned official SHA-256.");
  const listing = spawnSync("tar", ["-tf", archive], { encoding: "utf8", shell: false, windowsHide: true });
  if (listing.status !== 0) throw new Error("Verified runtime archive requires a system tar implementation for extraction.");
  const selected = selectRuntimeArchiveEntries(listing.stdout, config);
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-runtime-"));
  const result = spawnSync("tar", ["-xf", archive, "-C", temporary, ...selected], { encoding: "utf8", shell: false, windowsHide: true });
  if (result.status !== 0) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw new Error("Verified runtime archive extraction failed.");
  }
  return temporary;
}

const hostTarget = (target) => (target === "windows-x64" && process.platform === "win32" && process.arch === "x64")
  || (target === "linux-x64" && process.platform === "linux" && process.arch === "x64")
  || (target === "darwin-arm64" && process.platform === "darwin" && process.arch === "arm64");

function verifyRuntimeVersion(binary, version, target, enabled) {
  if (!enabled || !hostTarget(target)) return;
  const result = spawnSync(binary, ["--version"], { encoding: "utf8", shell: false, windowsHide: true, timeout: 10_000 });
  if (result.status !== 0 || result.stdout.trim() !== `v${version}`) throw new Error(`Runtime did not report pinned Node.js v${version}.`);
}

function lockComponents(productRoot) {
  const file = path.join(productRoot, "pnpm-lock.yaml");
  if (!fs.existsSync(file)) return [];
  const text = fs.readFileSync(file, "utf8");
  const start = text.indexOf("\npackages:\n");
  const end = text.indexOf("\nsnapshots:\n", start + 1);
  if (start < 0) return [];
  const found = new Map();
  for (const line of text.slice(start, end < 0 ? text.length : end).split(/\r?\n/)) {
    const match = line.match(/^ {2}(?:'([^']+)'|([^:][^:]*)):\s*$/);
    const key = (match?.[1] ?? match?.[2] ?? "").trim();
    const at = key.lastIndexOf("@");
    if (at <= 0) continue;
    const name = key.slice(0, at); const version = key.slice(at + 1);
    if (!version || version.includes("(")) continue;
    found.set(key, { type: "library", name, version, purl: `pkg:npm/${encodeURIComponent(name)}@${version}` });
  }
  return [...found.values()].sort((a, b) => `${a.name}@${a.version}`.localeCompare(`${b.name}@${b.version}`));
}

function makeSbom(productRoot, manifest, manifestBytes) {
  return {
    bomFormat: "CycloneDX", specVersion: "1.6", serialNumber: `urn:uuid:${digest(manifestBytes).slice(0, 8)}-${digest(manifestBytes).slice(8, 12)}-5${digest(manifestBytes).slice(13, 16)}-a${digest(manifestBytes).slice(17, 20)}-${digest(manifestBytes).slice(20, 32)}`, version: 1,
    metadata: { component: { type: "application", name: manifest.product, version: manifest.version } },
    components: [{ type: "framework", name: "node", version: manifest.runtime.version, hashes: [{ alg: "SHA-256", content: manifest.runtime.binary_sha256 }], externalReferences: [{ type: "distribution", url: manifest.runtime.archive_url }] }, ...lockComponents(productRoot)]
  };
}

function makeProvenance(productRoot, manifest, manifestBytes, sbomBytes, epoch) {
  const dependencies = [{ uri: `git+local#${manifest.commit}`, digest: { sha1: manifest.commit } }, { uri: manifest.runtime.archive_url, digest: { sha256: manifest.runtime.archive_sha256 } }];
  const lock = path.join(productRoot, "pnpm-lock.yaml");
  if (fs.existsSync(lock)) dependencies.push({ uri: "file:pnpm-lock.yaml", digest: { sha256: digest(fs.readFileSync(lock)) } });
  const stamp = new Date(epoch * 1000).toISOString();
  return { _type: "https://in-toto.io/Statement/v1", subject: [{ name: "payload-manifest.json", digest: { sha256: digest(manifestBytes) } }, { name: "companion-sbom.cdx.json", digest: { sha256: digest(sbomBytes) } }], predicateType: "https://slsa.dev/provenance/v1", predicate: { buildDefinition: { buildType: "https://dusk.network/buildtypes/developer-studio-local-portable/v1", externalParameters: { version: manifest.version, commit: manifest.commit, target: manifest.target, channel: manifest.channel }, internalParameters: { source_date_epoch: epoch }, resolvedDependencies: dependencies }, runDetails: { builder: { id: "https://dusk.network/builders/developer-studio-companion-release/v1" }, metadata: { invocationId: digest(Buffer.concat([manifestBytes, sbomBytes])), startedOn: stamp, finishedOn: stamp } } } };
}

function signManifest(bytes, keyFile) {
  const privateKey = createPrivateKey(fs.readFileSync(keyFile));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Signing key must be Ed25519.");
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  return { schema_version: 1, algorithm: "ed25519", public_key_spki_sha256: digest(publicDer), signature: sign(null, bytes, privateKey).toString("base64") };
}

function cleanCommit(root) {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().toLowerCase();
  const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal", "--", "."], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (dirty) throw new Error("Companion releases require a clean product worktree or explicit fixture commit.");
  return commit;
}

export function buildRelease(options) {
  const root = path.resolve(options.productRoot);
  const runtimeLock = readJson(path.join(root, "config", "companion-runtime-lock.json"));
  const policy = readJson(path.join(root, "config", "companion-release-policy.json"));
  const target = options.target;
  if (runtimeLock.schema_version !== 1 || policy.schema_version !== 1 || !policy.supported_targets.includes(target)) throw new Error("Unsupported companion configuration or target.");
  const config = runtimeLock.runtime.targets[target];
  const mode = options.releaseMode ?? "internal-rc";
  if (!new Set(["internal-rc", "publication"]).has(mode)) throw new Error("Release mode must be internal-rc or publication.");
  if (mode === "publication" && !options.signingPrivateKey) throw new Error("Publication releases require an Ed25519 signing key.");
  if (!options.runtimeArchive && (!options.runtimeRoot || options.runtimeRootVerified !== true)) throw new Error("Provide a checksum-verified runtime archive or attest a verified pre-extracted runtime root.");
  const out = path.resolve(options.outDir);
  if (fs.existsSync(out)) throw new Error(`Release output already exists: ${out}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const stage = fs.mkdtempSync(path.join(path.dirname(out), `.${path.basename(out)}-stage-`));
  const payload = path.join(stage, "payload"); fs.mkdirSync(payload);
  let temporaryRuntime;
  try {
    const runtimeRoot = options.runtimeArchive ? (temporaryRuntime = unpackRuntime(path.resolve(options.runtimeArchive), config)) : path.resolve(options.runtimeRoot);
    const runtimeBinary = locateRuntime(runtimeRoot, config, config.source_binary_path);
    const runtimeLicense = locateRuntime(runtimeRoot, config, "LICENSE");
    verifyRuntimeVersion(runtimeBinary, runtimeLock.runtime.version, target, options.executeRuntime !== false);
    copyTree(path.resolve(options.launcherBundle), payload, "app", policy);
    copyTree(path.resolve(options.studioDist ?? path.join(root, "apps", "studio", "dist")), payload, "studio", policy);
    copyTree(path.resolve(options.templateRoot ?? path.join(root, "packages", "templates", "foundry-counter-dusk-evm")), payload, "templates/foundry-counter-dusk-evm", policy);
    const distribution = path.join(root, "distribution");
    const entry = policy.entrypoints[target];
    const actionEntry = policy.action_entrypoints[target];
    const launcher = path.join(distribution, "launchers", target, target === "windows-x64" ? "dusk-studio.cmd" : "dusk-studio");
    const actionLauncher = path.join(distribution, "launchers", target, target === "windows-x64" ? "dusk-studio-local-actions.cmd" : "dusk-studio-local-actions");
    for (const [source, destination, executable] of [[launcher, entry, true], [actionLauncher, actionEntry, true], [path.join(distribution, "README.txt"), "README.txt", false], [path.join(distribution, "THIRD-PARTY-NOTICES.txt"), "licenses/THIRD-PARTY-NOTICES.txt", false], [runtimeLicense, "licenses/NODE-LICENSE.txt", false], [runtimeBinary, config.payload_binary_path, true]]) {
      const stat = fs.lstatSync(source); if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Release input is not a regular file: ${source}`);
      put(path.join(payload, ...safePath(destination, policy).split("/")), fs.readFileSync(source), executable);
    }
    if (!fs.existsSync(path.join(payload, ...policy.launcher_entry.split("/")))) throw new Error(`Launcher bundle must contain ${policy.launcher_entry.replace(/^app\//, "")}.`);
    const records = walk(payload, policy, config.payload_binary_path);
    const total = records.reduce((sum, file) => sum + file.bytes, 0);
    if (records.length > policy.payload.maximum_files || total > policy.payload.maximum_bytes) throw new Error("Payload exceeds release policy limits.");
    const commit = (options.commit ?? cleanCommit(root)).toLowerCase(); if (!COMMIT_RE.test(commit)) throw new Error("Release commit must be a full 40-character SHA.");
    const signed = Boolean(options.signingPrivateKey);
    const binary = records.find((file) => file.path === config.payload_binary_path);
    const manifest = { schema_version: 1, product: policy.product, version: options.version ?? readJson(path.join(root, "package.json")).version, commit, channel: "portable", target, runtime: { name: "node", version: runtimeLock.runtime.version, archive_url: config.archive_url, archive_sha256: config.archive_sha256, binary_path: config.payload_binary_path, binary_sha256: binary.sha256 }, unsigned_rc: !signed, signing_status: signed ? "signed" : "unsigned-rc", files: records.map(({ path: filePath, bytes, sha256 }) => ({ path: filePath, bytes, sha256 })) };
    const manifestBytes = jsonBytes(manifest);
    put(path.join(payload, "payload-manifest.json"), manifestBytes);
    put(path.join(stage, "payload-manifest.json"), manifestBytes);
    const sbomBytes = jsonBytes(makeSbom(root, manifest, manifestBytes)); put(path.join(stage, "companion-sbom.cdx.json"), sbomBytes);
    const epoch = Number(options.sourceDateEpoch ?? process.env.SOURCE_DATE_EPOCH ?? 0); if (!Number.isInteger(epoch) || epoch < 0) throw new Error("SOURCE_DATE_EPOCH must be a non-negative integer.");
    put(path.join(stage, "companion-provenance.json"), jsonBytes(makeProvenance(root, manifest, manifestBytes, sbomBytes, epoch)));
    if (signed) put(path.join(stage, "payload-manifest.sig.json"), jsonBytes(signManifest(manifestBytes, path.resolve(options.signingPrivateKey))));
    const sidecars = ["companion-provenance.json", "companion-sbom.cdx.json", "payload-manifest.json", ...(signed ? ["payload-manifest.sig.json"] : [])].sort();
    const sums = Buffer.from(`${sidecars.map((name) => `${digest(fs.readFileSync(path.join(stage, name)))}  ${name}`).join("\n")}\n`); put(path.join(stage, "SHA256SUMS"), sums);
    fs.renameSync(stage, out); if (temporaryRuntime) fs.rmSync(temporaryRuntime, { recursive: true, force: true });
    return { outDir: out, manifest, fingerprint: digest(sums), deterministicArchive: null };
  } catch (error) {
    if (temporaryRuntime) fs.rmSync(temporaryRuntime, { recursive: true, force: true });
    fs.rmSync(stage, { recursive: true, force: true }); throw error;
  }
}

function checksumMap(file) {
  const result = new Map();
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) {
    const match = line.match(/^([a-f0-9]{64}) {2}([A-Za-z0-9._-]+)$/); if (!match || result.has(match[2])) throw new Error("Invalid or duplicate SHA256SUMS record.");
    result.set(match[2], match[1]);
  }
  return result;
}

function verifySignature(release, bytes, keyFile) {
  if (!keyFile) throw new Error("Signed verification requires a trusted Ed25519 public key.");
  const record = readJson(path.join(release, "payload-manifest.sig.json"));
  const key = createPublicKey(fs.readFileSync(keyFile)); if (key.asymmetricKeyType !== "ed25519") throw new Error("Trusted key must be Ed25519.");
  const identity = digest(key.export({ type: "spki", format: "der" }));
  if (record.schema_version !== 1 || record.algorithm !== "ed25519" || record.public_key_spki_sha256 !== identity || !verify(null, bytes, key, Buffer.from(record.signature ?? "", "base64"))) throw new Error("Manifest signature or trusted key identity is invalid.");
}

export function verifyRelease(options) {
  const root = path.resolve(options.productRoot); const release = path.resolve(options.releaseDir);
  const lock = readJson(path.join(root, "config", "companion-runtime-lock.json")); const policy = readJson(path.join(root, "config", "companion-release-policy.json"));
  const manifestBytes = fs.readFileSync(path.join(release, "payload-manifest.json")); const manifest = JSON.parse(manifestBytes);
  if (manifest.schema_version !== 1 || manifest.product !== "Dusk Developer Studio Local" || manifest.channel !== "portable" || !COMMIT_RE.test(manifest.commit ?? "") || !policy.supported_targets.includes(manifest.target)) throw new Error("Manifest identity, commit, or target is invalid.");
  const signed = manifest.signing_status === "signed" && manifest.unsigned_rc === false; const unsigned = manifest.signing_status === "unsigned-rc" && manifest.unsigned_rc === true;
  if (!signed && !unsigned) throw new Error("Manifest signing state is inconsistent.");
  if (options.publication && !signed) throw new Error("Unsigned RCs cannot pass publication verification.");
  const allowed = new Set(["SHA256SUMS", "companion-provenance.json", "companion-sbom.cdx.json", "payload-manifest.json", ...(signed ? ["payload-manifest.sig.json"] : [])]);
  const payloadPath = path.join(release, "payload"); const enveloped = fs.existsSync(payloadPath);
  if (enveloped && !fs.lstatSync(payloadPath).isDirectory()) throw new Error("Release payload entry is not a directory.");
  const payloadRoot = enveloped ? payloadPath : release;
  const config = lock.runtime.targets[manifest.target];
  const expectedRuntime = { name: "node", version: lock.runtime.version, archive_url: config.archive_url, archive_sha256: config.archive_sha256, binary_path: config.payload_binary_path };
  for (const [key, value] of Object.entries(expectedRuntime)) if (manifest.runtime?.[key] !== value) throw new Error(`Runtime ${key} does not match the lock.`);
  if (!SHA_RE.test(manifest.runtime?.binary_sha256 ?? "") || !Array.isArray(manifest.files)) throw new Error("Runtime digest or payload file list is invalid.");
  const declared = new Map(); let prior = "";
  for (const file of manifest.files) { const relative = safePath(file.path, policy); if ((prior && relative.localeCompare(prior) <= 0) || !Number.isInteger(file.bytes) || file.bytes < 0 || !SHA_RE.test(file.sha256 ?? "")) throw new Error("Payload records must be valid, unique, and sorted."); prior = relative; declared.set(relative, file); }
  const payloadTopLevel = new Set([...declared.keys()].map((relative) => relative.split("/")[0]));
  for (const entry of fs.readdirSync(release, { withFileTypes: true })) {
    const allowedEnvelopeEntry = enveloped && ((entry.name === "payload" && entry.isDirectory()) || (entry.isFile() && allowed.has(entry.name)));
    const allowedFlatEntry = !enveloped && ((entry.isFile() && allowed.has(entry.name)) || payloadTopLevel.has(entry.name));
    if (!allowedEnvelopeEntry && !allowedFlatEntry) throw new Error(`Undeclared release-root entry: ${entry.name}`);
  }
  const payloadManifestBytes = fs.readFileSync(path.join(payloadRoot, "payload-manifest.json"));
  if (!payloadManifestBytes.equals(manifestBytes)) throw new Error("Executable payload manifest does not match the release sidecar.");
  const actual = walk(payloadRoot, policy, config.payload_binary_path).filter((file) => file.path !== "payload-manifest.json" && (enveloped || !allowed.has(file.path))); if (actual.length !== declared.size) throw new Error("Payload has undeclared or missing files.");
  for (const file of actual) { const expected = declared.get(file.path); if (!expected || expected.bytes !== file.bytes || expected.sha256 !== file.sha256) throw new Error(`Payload parity failed for ${file.path}.`); }
  if (declared.get(config.payload_binary_path)?.sha256 !== manifest.runtime.binary_sha256) throw new Error("Runtime binary digest is not bound to its payload record.");
  for (const required of [policy.entrypoints[manifest.target], policy.action_entrypoints[manifest.target], policy.launcher_entry]) if (!declared.has(required)) throw new Error(`Missing required entrypoint ${required}.`);
  verifyRuntimeVersion(path.join(payloadRoot, ...config.payload_binary_path.split("/")), lock.runtime.version, manifest.target, options.executeRuntime !== false);
  const sums = checksumMap(path.join(release, "SHA256SUMS")); if (sums.size !== allowed.size - 1 || [...sums.keys()].some((name) => name === "SHA256SUMS" || !allowed.has(name))) throw new Error("SHA256SUMS does not declare the exact sidecar set.");
  for (const [name, hash] of sums) if (digest(fs.readFileSync(path.join(release, name))) !== hash) throw new Error(`Sidecar checksum failed for ${name}.`);
  const sbom = readJson(path.join(release, "companion-sbom.cdx.json")); if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6" || sbom.metadata?.component?.name !== manifest.product || !sbom.components?.some((component) => component.name === "node" && component.version === lock.runtime.version && component.hashes?.some((hash) => hash.content === manifest.runtime.binary_sha256))) throw new Error("SBOM does not bind the product and runtime.");
  const provenance = readJson(path.join(release, "companion-provenance.json")); if (provenance.predicateType !== "https://slsa.dev/provenance/v1" || provenance.subject?.find((item) => item.name === "payload-manifest.json")?.digest?.sha256 !== digest(manifestBytes)) throw new Error("Provenance does not bind the manifest.");
  if (signed) verifySignature(release, manifestBytes, options.trustedPublicKey);
  return { manifest, signed, fileCount: actual.length, totalBytes: actual.reduce((sum, file) => sum + file.bytes, 0), fingerprint: digest(fs.readFileSync(path.join(release, "SHA256SUMS"))) };
}

export function cli(argv) {
  const result = {};
  for (const argument of argv) { if (!argument.startsWith("--")) throw new Error(`Unexpected argument: ${argument}`); const at = argument.indexOf("="); if (at < 0) result[argument.slice(2)] = true; else result[argument.slice(2, at)] = argument.slice(at + 1); }
  return result;
}
