import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SHA256_RE = /^[a-f0-9]{64}$/;
const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const RELEASE_SIDECARS = new Set(["SHA256SUMS", "companion-provenance.json", "companion-sbom.cdx.json", "payload-manifest.sig.json"]);

export interface PayloadFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface PayloadManifest {
  schema_version: 1;
  product: "Dusk Developer Studio Local";
  version: string;
  commit: string;
  channel: "portable";
  target: "windows-x64" | "linux-x64" | "darwin-arm64";
  signing_status: "unsigned-rc" | "signed";
  runtime: {
    name: "node";
    version: string;
    archive_url: string;
    archive_sha256: string;
    binary_path: string;
    binary_sha256: string;
  };
  files: PayloadFileRecord[];
}

export interface PayloadVerificationOptions {
  externalRuntime?: {
    name: "node";
    version: string;
    binaryPath: string;
  };
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value && normalized !== "." && !normalized.startsWith("../")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== "..");
}

async function sha256File(file: string): Promise<{ bytes: number; sha256: string }> {
  const contents = await fs.readFile(file);
  return { bytes: contents.byteLength, sha256: createHash("sha256").update(contents).digest("hex") };
}

async function walkFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("Portable payload contains a symlink or reparse entry.");
    if (stat.isDirectory()) files.push(...await walkFiles(root, absolute));
    else if (stat.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error("Portable payload contains an unsupported filesystem entry.");
  }
  return files.sort();
}

export async function verifyPayload(distributionRoot: string, options: PayloadVerificationOptions = {}): Promise<PayloadManifest> {
  const root = path.resolve(distributionRoot);
  const manifestPath = path.join(root, "payload-manifest.json");
  const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8")) as PayloadManifest;
  if (manifest.schema_version !== 1 || manifest.product !== "Dusk Developer Studio Local" || manifest.channel !== "portable") {
    throw new Error("Portable payload manifest identity is invalid.");
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version) || !/^[a-f0-9]{40}$/.test(manifest.commit)) {
    throw new Error("Portable payload release identity is invalid.");
  }
  if (!TARGETS.has(manifest.target) || !["unsigned-rc", "signed"].includes(manifest.signing_status)) {
    throw new Error("Portable payload target or signing status is invalid.");
  }
  if (manifest.runtime?.name !== "node" || !/^v?\d+\.\d+\.\d+$/.test(manifest.runtime.version)
    || !manifest.runtime.archive_url.startsWith("https://nodejs.org/")
    || !SHA256_RE.test(manifest.runtime.archive_sha256)
    || !isSafeRelativePath(manifest.runtime.binary_path)
    || !SHA256_RE.test(manifest.runtime.binary_sha256)) {
    throw new Error("Portable payload runtime receipt is invalid.");
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) throw new Error("Portable payload file inventory is missing.");
  const expectedPaths = new Set<string>();
  for (const record of manifest.files) {
    if (!isSafeRelativePath(record.path) || record.path === "payload-manifest.json" || expectedPaths.has(record.path)
      || !Number.isInteger(record.bytes) || record.bytes < 0 || !SHA256_RE.test(record.sha256)) {
      throw new Error("Portable payload file inventory is invalid.");
    }
    expectedPaths.add(record.path);
  }
  const runtimeRecord = manifest.files.find((record) => record.path === manifest.runtime.binary_path);
  if (!runtimeRecord || runtimeRecord.sha256 !== manifest.runtime.binary_sha256) throw new Error("Portable payload runtime record is not bound to its receipt.");
  const externalRuntime = options.externalRuntime;
  if (externalRuntime) {
    if (externalRuntime.name !== "node" || externalRuntime.version !== manifest.runtime.version || externalRuntime.binaryPath !== manifest.runtime.binary_path) {
      throw new Error("External SEA runtime identity does not match the portable runtime receipt.");
    }
    expectedPaths.delete(manifest.runtime.binary_path);
  }
  const actualPaths = (await walkFiles(root)).filter((relative) => relative !== "payload-manifest.json" && !RELEASE_SIDECARS.has(relative));
  if (JSON.stringify(actualPaths) !== JSON.stringify([...expectedPaths].sort())) {
    throw new Error("Portable payload exact file set does not match its manifest.");
  }
  for (const record of manifest.files) {
    if (externalRuntime && record.path === manifest.runtime.binary_path) continue;
    const actual = await sha256File(path.join(root, ...record.path.split("/")));
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) throw new Error(`Portable payload file mismatch: ${record.path}`);
  }
  if (!externalRuntime) {
    const runtime = await sha256File(path.join(root, ...manifest.runtime.binary_path.split("/")));
    if (runtime.sha256 !== manifest.runtime.binary_sha256) throw new Error("Bundled runtime digest does not match the runtime receipt.");
  }
  return manifest;
}
