import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const SHA256_RE = /^[a-f0-9]{64}$/;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const NODE_VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/;
const MAX_PACKAGE_FILES = 10_000;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const REQUIRED_NODE_RANGE = ">=24.18.0 <25";
const REQUIRED_PACKAGE_FILES = [
  "LICENSE",
  "NOTICE",
  "README.md",
  "THIRD-PARTY-LICENSES.txt",
  "app/runtime.mjs",
  "bin/dusk-developer-studio.mjs",
  "package.json",
  "studio/index.html",
  "templates/foundry-counter-dusk-evm/.env.example",
  "templates/foundry-counter-dusk-evm/.gitignore.template",
  "templates/foundry-counter-dusk-evm/README.md",
  "templates/foundry-counter-dusk-evm/foundry.toml",
  "templates/foundry-counter-dusk-evm/src/Counter.sol",
  "templates/foundry-counter-dusk-evm/test/Counter.t.sol"
] as const;
const SUPPORTED_TARGETS = ["windows-x64", "linux-x64", "darwin-arm64"] as const;

export type NpmTarget = typeof SUPPORTED_TARGETS[number];

export interface NpmPackageFileRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface NpmPackageManifest {
  schema_version: 1;
  product: "Dusk Developer Studio Local";
  package: "dusk-developer-studio";
  version: string;
  commit: string;
  channel: "npm";
  node: {
    required_range: typeof REQUIRED_NODE_RANGE;
  };
  supported_targets: NpmTarget[];
  files: NpmPackageFileRecord[];
}

export interface NpmPackageVerificationOptions {
  nodeVersion?: string;
  platform?: NodeJS.Platform;
  architecture?: string;
}

interface PackageJson {
  name?: unknown;
  version?: unknown;
  description?: unknown;
  author?: unknown;
  keywords?: unknown;
  license?: unknown;
  type?: unknown;
  repository?: { type?: unknown; url?: unknown };
  homepage?: unknown;
  bugs?: { url?: unknown };
  engines?: { node?: unknown };
  bin?: unknown;
  files?: unknown;
  publishConfig?: { access?: unknown; provenance?: unknown };
  private?: unknown;
  scripts?: unknown;
  dependencies?: unknown;
  optionalDependencies?: unknown;
  peerDependencies?: unknown;
  bundledDependencies?: unknown;
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

function compareCodePoints(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSafeRelativePath(value: string): boolean {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) return false;
  const normalized = path.posix.normalize(value);
  return normalized === value
    && normalized !== "."
    && !normalized.startsWith("../")
    && value.split("/").every((part) => part !== "" && part !== "." && part !== ".." && !part.endsWith(" "));
}

async function sha256File(file: string): Promise<{ bytes: number; sha256: string }> {
  const contents = await fs.readFile(file);
  return {
    bytes: contents.byteLength,
    sha256: createHash("sha256").update(contents).digest("hex")
  };
}

function htmlAttribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2] ?? "";
}

function localStudioAsset(value: string, extension: ".js" | ".css"): string {
  const candidate = value.startsWith("/") ? value.slice(1) : value;
  if (
    !candidate.startsWith("assets/")
    || !candidate.endsWith(extension)
    || candidate.includes("?")
    || candidate.includes("#")
  ) {
    throw new Error(`Studio index contains an invalid ${extension} asset reference.`);
  }
  const relative = `studio/${candidate}`;
  if (!isSafeRelativePath(relative)) {
    throw new Error(`Studio index contains an unsafe ${extension} asset reference.`);
  }
  return relative;
}

async function verifyStudioAssetGraph(
  root: string,
  inventory: NpmPackageFileRecord[]
): Promise<void> {
  const index = await fs.readFile(path.join(root, "studio", "index.html"), "utf8");
  if (!index || Buffer.byteLength(index) > 1024 * 1024) {
    throw new Error("Studio index is empty or exceeds its size limit.");
  }
  const scriptAssets = [...index.matchAll(/<script\b[^>]*>/giu)].map((match) => {
    const tag = match[0];
    if (htmlAttribute(tag, "type").toLowerCase() !== "module") {
      throw new Error("Studio index scripts must use the module type.");
    }
    const source = htmlAttribute(tag, "src");
    if (!source) throw new Error("Studio index contains an inline or missing script source.");
    return localStudioAsset(source, ".js");
  });
  const stylesheetAssets = [...index.matchAll(/<link\b[^>]*>/giu)]
    .map((match) => match[0])
    .filter((tag) => htmlAttribute(tag, "rel").toLowerCase().split(/\s+/u).includes("stylesheet"))
    .map((tag) => localStudioAsset(htmlAttribute(tag, "href"), ".css"));
  if (scriptAssets.length === 0 || stylesheetAssets.length === 0) {
    throw new Error("Studio index must reference at least one module script and stylesheet.");
  }
  const records = new Map(inventory.map((record) => [record.path, record]));
  for (const asset of [...scriptAssets, ...stylesheetAssets]) {
    const record = records.get(asset);
    if (!record || record.bytes <= 0) {
      throw new Error(`Studio index references a missing or empty asset: ${asset}.`);
    }
  }
}

async function walkRegularFiles(root: string, directory = root): Promise<string[]> {
  const files: string[] = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) throw new Error("The npm package contains a symlink or reparse entry.");
    if (stat.isDirectory()) files.push(...await walkRegularFiles(root, absolute));
    else if (stat.isFile()) files.push(path.relative(root, absolute).split(path.sep).join("/"));
    else throw new Error("The npm package contains an unsupported filesystem entry.");
    if (files.length > MAX_PACKAGE_FILES) throw new Error("The npm package exceeds its file-count limit.");
  }
  return files.sort();
}

function targetFor(platform: NodeJS.Platform, architecture: string): NpmTarget | "unsupported" {
  if (platform === "win32" && architecture === "x64") return "windows-x64";
  if (platform === "linux" && architecture === "x64") return "linux-x64";
  if (platform === "darwin" && architecture === "arm64") return "darwin-arm64";
  return "unsupported";
}

export function assertSupportedNodeVersion(version = process.versions.node): void {
  const match = NODE_VERSION_RE.exec(version);
  if (!match) throw new Error(`Dusk Developer Studio requires Node.js ${REQUIRED_NODE_RANGE}.`);
  const [, major, minor] = match.map(Number);
  if (major !== 24 || minor < 18) {
    throw new Error(`Dusk Developer Studio requires Node.js ${REQUIRED_NODE_RANGE}.`);
  }
}

function validatePackageJson(packageJson: PackageJson, manifest: NpmPackageManifest): void {
  const engines = packageJson.engines as { node?: unknown } | undefined;
  const publishConfig = packageJson.publishConfig as {
    access?: unknown;
    provenance?: unknown;
  } | undefined;
  const expectedBin = {
    "dusk-developer-studio": "bin/dusk-developer-studio.mjs"
  };
  const expectedFiles = [
    "app",
    "bin",
    "studio",
    "templates",
    "package-manifest.json",
    "README.md",
    "LICENSE",
    "NOTICE",
    "THIRD-PARTY-LICENSES.txt"
  ];
  if (
    !hasExactKeys(packageJson, [
      "name",
      "version",
      "description",
      "author",
      "keywords",
      "license",
      "type",
      "repository",
      "homepage",
      "bugs",
      "engines",
      "bin",
      "files",
      "publishConfig"
    ])
    || packageJson.name !== manifest.package
    || packageJson.version !== manifest.version
    || packageJson.description !== "Local developer Studio for DuskEVM reference and DuskDS workflows."
    || packageJson.author !== "GeorgianDusk"
    || JSON.stringify(packageJson.keywords) !== JSON.stringify([
      "dusk",
      "duskevm",
      "duskds",
      "developer-tools",
      "blockchain"
    ])
    || packageJson.license !== "Apache-2.0"
    || packageJson.type !== "module"
    || !hasExactKeys(packageJson.repository, ["type", "url"])
    || packageJson.repository.type !== "git"
    || packageJson.repository.url !== "git+https://github.com/GeorgianDusk/dusk-developer-studio.git"
    || packageJson.homepage !== "https://github.com/GeorgianDusk/dusk-developer-studio#readme"
    || !hasExactKeys(packageJson.bugs, ["url"])
    || packageJson.bugs.url !== "https://github.com/GeorgianDusk/dusk-developer-studio/issues"
    || engines?.node !== REQUIRED_NODE_RANGE
    || JSON.stringify(packageJson.bin) !== JSON.stringify(expectedBin)
    || JSON.stringify(packageJson.files) !== JSON.stringify(expectedFiles)
    || publishConfig?.access !== "public"
    || publishConfig?.provenance !== true
    || packageJson.private !== undefined
  ) {
    throw new Error("The npm package metadata does not match the Local Studio release contract.");
  }
  for (const forbidden of [
    packageJson.scripts,
    packageJson.dependencies,
    packageJson.optionalDependencies,
    packageJson.peerDependencies,
    packageJson.bundledDependencies
  ]) {
    if (forbidden !== undefined) {
      throw new Error("The npm package must not contain runtime dependencies or lifecycle scripts.");
    }
  }
}

function validateManifest(value: unknown): NpmPackageManifest {
  if (!hasExactKeys(value, [
    "schema_version",
    "product",
    "package",
    "version",
    "commit",
    "channel",
    "node",
    "supported_targets",
    "files"
  ])) {
    throw new Error("The npm package manifest shape is invalid.");
  }
  if (
    value.schema_version !== 1
    || value.product !== "Dusk Developer Studio Local"
    || value.package !== "dusk-developer-studio"
    || typeof value.version !== "string"
    || !VERSION_RE.test(value.version)
    || typeof value.commit !== "string"
    || !COMMIT_RE.test(value.commit)
    || value.channel !== "npm"
    || !hasExactKeys(value.node, ["required_range"])
    || value.node.required_range !== REQUIRED_NODE_RANGE
    || JSON.stringify(value.supported_targets) !== JSON.stringify(SUPPORTED_TARGETS)
    || !Array.isArray(value.files)
    || value.files.length === 0
    || value.files.length > MAX_PACKAGE_FILES
  ) {
    throw new Error("The npm package manifest identity is invalid.");
  }

  let prior = "";
  let totalBytes = 0;
  for (const record of value.files) {
    if (
      !hasExactKeys(record, ["path", "bytes", "sha256"])
      || typeof record.path !== "string"
      || !isSafeRelativePath(record.path)
      || record.path === "package-manifest.json"
      || (prior !== "" && compareCodePoints(record.path, prior) <= 0)
      || !Number.isInteger(record.bytes)
      || (record.bytes as number) < 0
      || typeof record.sha256 !== "string"
      || !SHA256_RE.test(record.sha256)
    ) {
      throw new Error("The npm package file inventory is invalid.");
    }
    prior = record.path;
    totalBytes += record.bytes as number;
  }
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("The npm package exceeds its byte limit.");
  return value as unknown as NpmPackageManifest;
}

export async function verifyNpmPackage(
  packageRoot: string,
  options: NpmPackageVerificationOptions = {}
): Promise<NpmPackageManifest> {
  assertSupportedNodeVersion(options.nodeVersion ?? process.versions.node);
  const target = targetFor(options.platform ?? process.platform, options.architecture ?? process.arch);
  if (target === "unsupported") {
    throw new Error("Dusk Developer Studio supports Windows x64, Linux x64, and macOS Apple Silicon.");
  }

  const root = await fs.realpath(path.resolve(packageRoot));
  const rootStat = await fs.lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("The npm package root is unsafe.");

  const manifest = validateManifest(JSON.parse(await fs.readFile(path.join(root, "package-manifest.json"), "utf8")));
  if (!manifest.supported_targets.includes(target)) throw new Error("This npm package does not support the current platform.");
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8")) as PackageJson;
  validatePackageJson(packageJson, manifest);

  const actualPaths = (await walkRegularFiles(root)).filter((relative) => relative !== "package-manifest.json");
  const declaredPaths = manifest.files.map((record) => record.path);
  if (JSON.stringify(actualPaths) !== JSON.stringify(declaredPaths)) {
    throw new Error("The npm package exact file set does not match its manifest.");
  }
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!declaredPaths.includes(required)) throw new Error(`The npm package is missing ${required}.`);
  }
  await verifyStudioAssetGraph(root, manifest.files);
  for (const record of manifest.files) {
    const actual = await sha256File(path.join(root, ...record.path.split("/")));
    if (actual.bytes !== record.bytes || actual.sha256 !== record.sha256) {
      throw new Error(`The npm package file does not match its manifest: ${record.path}`);
    }
  }
  return manifest;
}

export const npmPackageContract = Object.freeze({
  nodeRange: REQUIRED_NODE_RANGE,
  supportedTargets: [...SUPPORTED_TARGETS]
});
