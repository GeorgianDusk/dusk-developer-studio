"use strict";

const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { Buffer } = require("node:buffer");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getAssetKeys, getRawAsset, isSea } = require("node:sea");
const { pathToFileURL } = require("node:url");
const { gunzipSync } = require("node:zlib");

const ASSET_KEY = "release.bundle.gz";
const LAUNCHER_MODE_ASSET_KEY = "launcher-mode.txt";
const TEMP_PREFIX = "dusk-studio-sea-";
const SHA256_RE = /^[a-f0-9]{64}$/;

// BEGIN ELEVATED LAUNCH GUARD
const ELEVATED_LAUNCH_DENIAL = "Dusk Developer Studio refuses elevated or root execution.";

function denyElevatedLaunch() {
  throw new Error(ELEVATED_LAUNCH_DENIAL);
}

const ZERO_LINUX_CAPABILITY_SETS = {
  permitted: 0n,
  effective: 0n,
  ambient: 0n
};

function parseLinuxCapabilityField(status, label, record) {
  const candidates = status.split("\n").filter((line) => line.startsWith(`${label}:`));
  if (candidates.length !== 1) denyElevatedLaunch();
  const match = candidates[0].match(record);
  if (!match) denyElevatedLaunch();
  try {
    return BigInt(`0x${match[1]}`);
  } catch {
    denyElevatedLaunch();
  }
}

function parseLinuxCapabilitySets(status) {
  if (typeof status !== "string") denyElevatedLaunch();
  return {
    permitted: parseLinuxCapabilityField(status, "CapPrm", /^CapPrm:[ \t]*([0-9A-Fa-f]+)[ \t]*\r?$/),
    effective: parseLinuxCapabilityField(status, "CapEff", /^CapEff:[ \t]*([0-9A-Fa-f]+)[ \t]*\r?$/),
    ambient: parseLinuxCapabilityField(status, "CapAmb", /^CapAmb:[ \t]*([0-9A-Fa-f]+)[ \t]*\r?$/)
  };
}

function assertPosixLaunchIdentity(uid, euid, gid, egid, capabilitySets = ZERO_LINUX_CAPABILITY_SETS) {
  const capabilities = capabilitySets;
  if (!Number.isSafeInteger(uid) || !Number.isSafeInteger(euid)
      || !Number.isSafeInteger(gid) || !Number.isSafeInteger(egid)
      || uid < 0 || euid < 0 || gid < 0 || egid < 0
      || uid === 0 || euid === 0 || uid !== euid || gid !== egid
      || typeof capabilitySets !== "object" || capabilitySets === null
      || typeof capabilities?.permitted !== "bigint" || capabilities.permitted !== 0n
      || typeof capabilities.effective !== "bigint" || capabilities.effective !== 0n
      || typeof capabilities.ambient !== "bigint" || capabilities.ambient !== 0n) {
    denyElevatedLaunch();
  }
}

function resolveWindowsWhoami(systemRoot) {
  if (typeof systemRoot !== "string" || systemRoot.length === 0 || systemRoot !== systemRoot.trim()
      || !/^[A-Za-z]:[\\/]/.test(systemRoot) || systemRoot.slice(2).includes(":")
      || /[\0\r\n<>"|?*]/.test(systemRoot)) {
    denyElevatedLaunch();
  }
  const normalizedRoot = path.win32.normalize(systemRoot);
  const parsedRoot = path.win32.parse(normalizedRoot).root;
  if (!path.win32.isAbsolute(normalizedRoot) || !/^[A-Za-z]:\\$/.test(parsedRoot)) {
    denyElevatedLaunch();
  }
  const whoami = path.win32.join(normalizedRoot, "System32", "whoami.exe");
  if (!path.win32.isAbsolute(whoami)) denyElevatedLaunch();
  return whoami;
}

function parseIntegrityRid(output) {
  if (typeof output !== "string") denyElevatedLaunch();
  const prefixes = output.match(/S-1-16-/gi) ?? [];
  const matches = [...output.matchAll(/(^|[^A-Za-z0-9-])S-1-16-(0|[1-9][0-9]*)(?![A-Za-z0-9-])/gi)];
  if (prefixes.length !== 1 || matches.length !== 1) denyElevatedLaunch();
  const rid = Number(matches[0][2]);
  if (!Number.isSafeInteger(rid) || rid < 0) denyElevatedLaunch();
  return rid;
}

function assertWindowsNonElevatedLaunch() {
  const whoami = resolveWindowsWhoami(process.env.SystemRoot);
  let identity;
  try {
    identity = fs.lstatSync(whoami);
  } catch {
    denyElevatedLaunch();
  }
  if (!identity.isFile() || identity.isSymbolicLink()) denyElevatedLaunch();
  let result;
  try {
    result = spawnSync(whoami, ["/groups"], {
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000,
      maxBuffer: 1_048_576
    });
  } catch {
    denyElevatedLaunch();
  }
  if (result.error || result.status !== 0 || result.signal) denyElevatedLaunch();
  if (parseIntegrityRid(result.stdout) >= 12_288) denyElevatedLaunch();
}

function assertNonElevatedLaunch() {
  if (process.platform === "win32") {
    assertWindowsNonElevatedLaunch();
    return;
  }
  if (process.platform === "linux" || process.platform === "darwin") {
    if (typeof process.getuid !== "function" || typeof process.geteuid !== "function"
        || typeof process.getgid !== "function" || typeof process.getegid !== "function") {
      denyElevatedLaunch();
    }
    let uid;
    let euid;
    let gid;
    let egid;
    try {
      uid = process.getuid();
      euid = process.geteuid();
      gid = process.getgid();
      egid = process.getegid();
    } catch {
      denyElevatedLaunch();
    }
    let capabilitySets = ZERO_LINUX_CAPABILITY_SETS;
    if (process.platform === "linux") {
      try {
        capabilitySets = parseLinuxCapabilitySets(fs.readFileSync("/proc/self/status", "utf8"));
      } catch {
        denyElevatedLaunch();
      }
    }
    assertPosixLaunchIdentity(uid, euid, gid, egid, capabilitySets);
    return;
  }
  denyElevatedLaunch();
}
// END ELEVATED LAUNCH GUARD

function safeRelative(value) {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function expectedTarget() {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  throw new Error("This executable prototype supports Windows x64, Linux x64, and macOS Apple Silicon only.");
}

function decodeBundle() {
  const keys = getAssetKeys();
  if (keys.length !== 2 || !keys.includes(ASSET_KEY) || !keys.includes(LAUNCHER_MODE_ASSET_KEY)) {
    throw new Error("The executable has an unexpected embedded asset set.");
  }
  const bundle = gunzipSync(Buffer.from(getRawAsset(ASSET_KEY)), { maxOutputLength: 536_870_912 });
  if (bundle.length < 4) throw new Error("The embedded release bundle is truncated.");
  const headerBytes = bundle.readUInt32BE(0);
  if (headerBytes < 2 || headerBytes > 16 * 1024 * 1024 || 4 + headerBytes > bundle.length) throw new Error("The embedded release header is invalid.");
  const header = JSON.parse(bundle.subarray(4, 4 + headerBytes).toString("utf8"));
  if (header.schema_version !== 1 || !Array.isArray(header.files) || !header.files.length || header.files.length > 10_000) throw new Error("The embedded release inventory is invalid.");
  const records = [];
  let cursor = 4 + headerBytes;
  let prior = "";
  for (const record of header.files) {
    if (!safeRelative(record.path) || (prior && record.path.localeCompare(prior) <= 0)
      || !Number.isInteger(record.bytes) || record.bytes < 0 || !SHA256_RE.test(record.sha256)
      || ![0o644, 0o755].includes(record.mode)) throw new Error("The embedded release inventory contains an unsafe record.");
    prior = record.path;
    const end = cursor + record.bytes;
    if (end > bundle.length) throw new Error("The embedded release file data is truncated.");
    const body = bundle.subarray(cursor, end);
    if (createHash("sha256").update(body).digest("hex") !== record.sha256) throw new Error(`Embedded release file mismatch: ${record.path}`);
    records.push({ ...record, body });
    cursor = end;
  }
  if (cursor !== bundle.length) throw new Error("The embedded release contains undeclared trailing data.");
  return records;
}

function launcherMode() {
  const mode = Buffer.from(getRawAsset(LAUNCHER_MODE_ASSET_KEY)).toString("utf8");
  if (mode === "safe\n") return "safe";
  if (mode === "local-actions\n") return "local-actions";
  throw new Error("The executable has an invalid embedded launcher mode.");
}

function removePrivateRoot(root) {
  const parent = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(TEMP_PREFIX)) throw new Error("Refusing to remove an unexpected extraction directory.");
  fs.rmSync(resolved, { recursive: true, force: true });
}

function runtimeArgs() {
  const args = process.argv.slice(1);
  if (!args.length || args[0].startsWith("--")) return args;
  const normalize = (value) => {
    const resolved = path.resolve(value);
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (normalize(args[0]) === normalize(process.execPath)) return args.slice(1);
  return args;
}

async function main() {
  assertNonElevatedLaunch();
  if (!isSea()) throw new Error("The standalone bootstrap must run from a Node single executable.");
  const mode = launcherMode();
  const records = decodeBundle();
  const manifestRecord = records.find((record) => record.path === "payload-manifest.json");
  if (!manifestRecord) throw new Error("The embedded release manifest is missing.");
  const manifest = JSON.parse(manifestRecord.body.toString("utf8"));
  const target = expectedTarget();
  if (manifest.product !== "Dusk Developer Studio Local" || manifest.channel !== "portable" || manifest.target !== target) throw new Error("The embedded release identity does not match this host.");
  if (process.versions.node !== manifest.runtime?.version || !safeRelative(manifest.runtime?.binary_path ?? "")) throw new Error("The SEA host runtime does not match the pinned portable runtime identity.");
  if (records.some((record) => record.path === manifest.runtime.binary_path)) throw new Error("The standalone bundle unexpectedly contains a duplicate runtime.");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  fs.chmodSync(root, 0o700);
  try {
    for (const record of records) {
      const destination = path.join(root, ...record.path.split("/"));
      if (!path.resolve(destination).startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Embedded asset escaped the private extraction root.");
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, record.body, { flag: "wx", mode: record.mode });
      try { fs.chmodSync(destination, record.mode); } catch { /* Windows does not enforce POSIX mode bits. */ }
    }
    const companion = path.join(root, "app", "companion.mjs");
    const stat = fs.lstatSync(companion);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("The embedded companion entrypoint is invalid.");
    const userArgs = runtimeArgs();
    if (userArgs.some((argument) => argument === "--enable-local-actions" || argument.startsWith("--enable-local-actions="))) {
      throw new Error(mode === "safe"
        ? "Safe mode cannot be escalated with a command-line flag. Start the separate Local Actions executable."
        : "Local Actions mode is fixed by this executable. Do not pass --enable-local-actions.");
    }
    const args = mode === "local-actions" ? [...userArgs, "--enable-local-actions"] : userArgs;
    if (mode === "local-actions") {
      console.log("Dusk Developer Studio will be allowed to check local tools and create starter files.");
      console.log("No wallet signing or funded-account action is enabled.");
    }
    const companionModule = await import(pathToFileURL(companion).href);
    if (typeof companionModule.runPortableRuntimeCli !== "function") throw new Error("The embedded companion does not expose the standalone runtime entrypoint.");
    await companionModule.runPortableRuntimeCli({
      distributionRoot: root,
      args,
      verification: { externalRuntime: { name: "node", version: process.versions.node, binaryPath: manifest.runtime.binary_path } }
    });
  } finally {
    removePrivateRoot(root);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Dusk Developer Studio Local could not start.");
  process.exitCode = 1;
});
