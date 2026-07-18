import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP_PREFIX = "dusk-studio-npm-";
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

function hostTarget() {
  if (process.arch !== "x64") throw new Error("Dusk Developer Studio Local supports x64 hosts only.");
  if (process.platform === "win32") return "windows-x64";
  if (process.platform === "linux") return "linux-x64";
  throw new Error("This npm prototype supports Windows x64 and Linux x64 only.");
}

function requireRegularFile(file, label) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular packaged file.`);
}

function safeRelative(value) {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../")
    && value.split("/").every((part) => part && part !== "." && part !== "..");
}

function decodeBundle(file) {
  requireRegularFile(file, "Target bundle");
  const bundle = gunzipSync(fs.readFileSync(file), { maxOutputLength: 536_870_912 });
  if (bundle.length < 4) throw new Error("The packaged release bundle is truncated.");
  const headerBytes = bundle.readUInt32BE(0);
  if (headerBytes < 2 || headerBytes > 16 * 1024 * 1024 || 4 + headerBytes > bundle.length) throw new Error("The packaged release header is invalid.");
  const header = JSON.parse(bundle.subarray(4, 4 + headerBytes).toString("utf8"));
  if (header.schema_version !== 1 || !Array.isArray(header.files) || !header.files.length || header.files.length > 10_000) throw new Error("The packaged release inventory is invalid.");
  const records = [];
  let cursor = 4 + headerBytes;
  let prior = "";
  for (const record of header.files) {
    if (!safeRelative(record.path) || (prior && record.path.localeCompare(prior) <= 0)
      || !Number.isInteger(record.bytes) || record.bytes < 0 || !SHA256_RE.test(record.sha256)
      || ![0o644, 0o755].includes(record.mode)) throw new Error("The packaged release inventory contains an unsafe record.");
    prior = record.path;
    const end = cursor + record.bytes;
    if (end > bundle.length) throw new Error("The packaged release file data is truncated.");
    const body = bundle.subarray(cursor, end);
    if (createHash("sha256").update(body).digest("hex") !== record.sha256) throw new Error(`Packaged release file mismatch: ${record.path}`);
    records.push({ ...record, body });
    cursor = end;
  }
  if (cursor !== bundle.length) throw new Error("The packaged release contains undeclared trailing data.");
  return records;
}

function removePrivateRoot(root) {
  const parent = path.resolve(os.tmpdir());
  const resolved = path.resolve(root);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(TEMP_PREFIX)) throw new Error("Refusing to remove an unexpected extraction directory.");
  fs.rmSync(resolved, { recursive: true, force: true });
}

export async function launch({ capabilitiesEnabled }) {
  assertNonElevatedLaunch();
  const args = process.argv.slice(2);
  if (!capabilitiesEnabled && args.includes("--enable-local-actions")) throw new Error("Use dusk-studio-local-actions to enable local tool checks and starter creation.");
  const target = hostTarget();
  const records = decodeBundle(path.join(packageRoot, "bundles", `${target}.bundle.gz`));
  const manifestRecord = records.find((record) => record.path === "payload-manifest.json");
  if (!manifestRecord) throw new Error("The packaged release manifest is missing.");
  const manifest = JSON.parse(manifestRecord.body.toString("utf8"));
  if (manifest.product !== "Dusk Developer Studio Local" || manifest.channel !== "portable" || manifest.target !== target) throw new Error("The packaged release identity does not match this host.");
  const releaseRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  fs.chmodSync(releaseRoot, 0o700);
  let child;
  let forwardInt;
  let forwardTerm;
  try {
    for (const record of records) {
      const destination = path.join(releaseRoot, ...record.path.split("/"));
      if (!path.resolve(destination).startsWith(`${path.resolve(releaseRoot)}${path.sep}`)) throw new Error("Packaged asset escaped the private extraction root.");
      fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
      fs.writeFileSync(destination, record.body, { flag: "wx", mode: record.mode });
      try { fs.chmodSync(destination, record.mode); } catch { /* Windows does not enforce POSIX mode bits. */ }
    }
    const runtime = path.join(releaseRoot, ...manifest.runtime.binary_path.split("/"));
    const companion = path.join(releaseRoot, "app", "companion.mjs");
    requireRegularFile(runtime, "Bundled runtime");
    requireRegularFile(companion, "Companion entrypoint");
    const childArgs = [companion, ...(capabilitiesEnabled ? ["--enable-local-actions"] : []), ...args.filter((arg) => arg !== "--enable-local-actions")];
    if (capabilitiesEnabled) {
      console.log("Dusk Developer Studio will be allowed to check local tools and create starter files.");
      console.log("No wallet signing or funded-account action is enabled.");
    }
    child = spawn(runtime, childArgs, { cwd: releaseRoot, env: process.env, shell: false, stdio: "inherit", windowsHide: false });
    forwardInt = () => { if (!child.killed) child.kill("SIGINT"); };
    forwardTerm = () => { if (!child.killed) child.kill("SIGTERM"); };
    process.once("SIGINT", forwardInt);
    process.once("SIGTERM", forwardTerm);
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", (code, signal) => resolve({ code, signal }));
    });
    process.exitCode = result.code ?? (result.signal === "SIGINT" ? 130 : 143);
  } finally {
    if (forwardInt) process.removeListener("SIGINT", forwardInt);
    if (forwardTerm) process.removeListener("SIGTERM", forwardTerm);
    if (child && !child.killed && child.exitCode === null) child.kill("SIGTERM");
    removePrivateRoot(releaseRoot);
  }
}
