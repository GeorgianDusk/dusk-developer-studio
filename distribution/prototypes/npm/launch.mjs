import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMP_PREFIX = "dusk-studio-npm-";
const SHA256_RE = /^[a-f0-9]{64}$/;

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
