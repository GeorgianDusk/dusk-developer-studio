import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const npmOutputRoot = path.join(productRoot, "output", "npm");
export const npmPackageRoot = path.join(npmOutputRoot, "package");
export const npmPackageName = "dusk-developer-studio";
export const npmPackageVersion = "1.0.3";
export const requiredNodeRange = ">=24.18.0 <25";
export const supportedTargets = Object.freeze(["windows-x64", "linux-x64", "darwin-arm64"]);

export function compareCodePoints(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function npmCliCandidates(
  nodeExecutable = process.execPath,
  platform = process.platform,
  environment = process.env
) {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const nodeDirectory = paths.dirname(nodeExecutable);
  const candidates = [];
  const npmExecPath = environment.npm_execpath;
  if (
    typeof npmExecPath === "string"
    && /(?:^|[\\/])npm(?:-cli)?\.(?:c?js)$/iu.test(npmExecPath)
    && !/(?:^|[\\/])pnpm(?:\.c?js)?$/iu.test(npmExecPath)
  ) {
    candidates.push(npmExecPath);
  }
  if (platform === "win32") {
    candidates.push(
      paths.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
      paths.resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")
    );
  } else {
    candidates.push(
      paths.resolve(nodeDirectory, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
      paths.join(nodeDirectory, "node_modules", "npm", "bin", "npm-cli.js")
    );
  }
  return [...new Set(candidates)];
}

export async function resolveNpmCli() {
  for (const candidate of npmCliCandidates()) {
    try {
      const real = await fs.realpath(candidate);
      const stat = await fs.lstat(real);
      if (stat.isFile() && !stat.isSymbolicLink()) return real;
    } catch {
      // Try the next trusted Node distribution layout.
    }
  }
  throw new Error("Could not resolve npm-cli.js from the active Node.js installation.");
}

const PACKAGE_JSON_KEYS = [
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
];
const MANIFEST_KEYS = [
  "schema_version",
  "product",
  "package",
  "version",
  "commit",
  "channel",
  "node",
  "supported_targets",
  "files"
];
const REQUIRED_FILES = [
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
  "templates/foundry-counter-dusk-evm/test/Counter.t.sol",
  "templates/duskds-counter-forge/.gitignore.template",
  "templates/duskds-counter-forge/Cargo.lock",
  "templates/duskds-counter-forge/Cargo.toml",
  "templates/duskds-counter-forge/LICENSE-MPL-2.0.txt",
  "templates/duskds-counter-forge/Makefile",
  "templates/duskds-counter-forge/PROVENANCE.md",
  "templates/duskds-counter-forge/README.md",
  "templates/duskds-counter-forge/rust-toolchain.toml",
  "templates/duskds-counter-forge/src/lib.rs",
  "templates/duskds-counter-forge/tests/contract.rs"
];
const MAX_FILE_COUNT = 10_000;
const MAX_PACKAGE_BYTES = 64 * 1024 * 1024;
const COMMIT_RE = /^[a-f0-9]{40}$/;
const VERSION_RE = /^\d+\.\d+\.\d+$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const RESERVED_WINDOWS_NAME_RE =
  /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function hasExactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function safeRelativePath(value) {
  if (!value || value.includes("\\") || value.includes("\0") || path.posix.isAbsolute(value)) {
    throw new Error(`Unsafe npm package path: ${value || "(empty)"}.`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === "."
    || normalized.startsWith("../")
    || value.split("/").some((segment) =>
      !segment
      || segment === "."
      || segment === ".."
      || segment.includes(":")
      || segment.endsWith(".")
      || segment.endsWith(" ")
      || RESERVED_WINDOWS_NAME_RE.test(segment)
    )
  ) {
    throw new Error(`Non-portable npm package path: ${value}.`);
  }
  return normalized;
}

function ensureInside(parent, candidate) {
  const resolvedParent = path.resolve(parent);
  const resolvedCandidate = path.resolve(candidate);
  const relative = path.relative(resolvedParent, resolvedCandidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing an unsafe filesystem target: ${resolvedCandidate}.`);
  }
  return resolvedCandidate;
}

function hashBytes(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

export async function writeJson(file, value) {
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function runFile(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? productRoot,
      env: options.env ?? process.env,
      shell: false,
      stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
      windowsHide: true,
      windowsVerbatimArguments: options.windowsVerbatimArguments ?? false
    });
    let stdout = "";
    let stderr = "";
    if (options.capture) {
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
    }
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      reject(new Error(
        `${command} ${args.join(" ")} failed${signal ? ` with signal ${signal}` : ` with exit code ${code}`}`
        + (stderr.trim() ? `:\n${stderr.trim()}` : ".")
      ));
    });
  });
}

export function readGitIdentity() {
  const commit = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: productRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim().toLowerCase();
  if (!COMMIT_RE.test(commit)) throw new Error("Git did not return a full release commit.");
  const status = execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    cwd: productRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }).trim();
  return { commit, clean: status.length === 0, status };
}

export async function recreateDirectory(directory) {
  const destination = ensureInside(npmOutputRoot, directory);
  await fs.mkdir(npmOutputRoot, { recursive: true });
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
}

async function copyRegularTreeRecursive(sourceRoot, destinationRoot, directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
    const source = path.join(directory, entry.name);
    const relative = safeRelativePath(path.relative(sourceRoot, source).split(path.sep).join("/"));
    const destination = path.join(destinationRoot, ...relative.split("/"));
    const stat = await fs.lstat(source);
    if (stat.isSymbolicLink()) throw new Error(`Refusing to package a symlink or reparse entry: ${source}.`);
    if (stat.isDirectory()) {
      await fs.mkdir(destination, { recursive: true });
    } else if (stat.isFile()) {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.copyFile(source, destination);
    } else {
      throw new Error(`Refusing to package an unsupported filesystem entry: ${source}.`);
    }
    if (stat.isDirectory()) await copyRegularTreeRecursive(sourceRoot, destinationRoot, source);
  }
}

export async function copyRegularTree(source, destination) {
  const sourceStat = await fs.lstat(source);
  if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
    throw new Error(`Package source must be a real directory: ${source}.`);
  }
  await fs.mkdir(destination, { recursive: true });
  await copyRegularTreeRecursive(source, destination, source);
}

async function walkRegularFiles(root, directory = root) {
  const files = [];
  const entries = await fs.readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => compareCodePoints(left.name, right.name))) {
    const absolute = path.join(directory, entry.name);
    const stat = await fs.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new Error(`The npm package contains a symlink or reparse entry: ${absolute}.`);
    }
    if (stat.isDirectory()) {
      files.push(...await walkRegularFiles(root, absolute));
    } else if (stat.isFile()) {
      files.push(safeRelativePath(path.relative(root, absolute).split(path.sep).join("/")));
    } else {
      throw new Error(`The npm package contains an unsupported filesystem entry: ${absolute}.`);
    }
    if (files.length > MAX_FILE_COUNT) throw new Error("The npm package exceeds its file-count limit.");
  }
  return files.sort(compareCodePoints);
}

function validatePackageJson(packageJson, version) {
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
    !hasExactKeys(packageJson, PACKAGE_JSON_KEYS)
    || packageJson.name !== npmPackageName
    || packageJson.version !== version
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
    || !hasExactKeys(packageJson.engines, ["node"])
    || packageJson.engines.node !== requiredNodeRange
    || JSON.stringify(packageJson.bin) !== JSON.stringify(expectedBin)
    || JSON.stringify(packageJson.files) !== JSON.stringify(expectedFiles)
    || !hasExactKeys(packageJson.publishConfig, ["access", "provenance"])
    || packageJson.publishConfig.access !== "public"
    || packageJson.publishConfig.provenance !== true
  ) {
    throw new Error("The npm package metadata does not match the release contract.");
  }
}

function validateManifest(manifest, version, expectedCommit) {
  if (
    !hasExactKeys(manifest, MANIFEST_KEYS)
    || manifest.schema_version !== 1
    || manifest.product !== "Dusk Developer Studio Local"
    || manifest.package !== npmPackageName
    || manifest.version !== version
    || !VERSION_RE.test(manifest.version)
    || !COMMIT_RE.test(manifest.commit ?? "")
    || (expectedCommit && manifest.commit !== expectedCommit)
    || manifest.channel !== "npm"
    || !hasExactKeys(manifest.node, ["required_range"])
    || manifest.node.required_range !== requiredNodeRange
    || JSON.stringify(manifest.supported_targets) !== JSON.stringify(supportedTargets)
    || !Array.isArray(manifest.files)
    || manifest.files.length === 0
    || manifest.files.length > MAX_FILE_COUNT
  ) {
    throw new Error("The npm package manifest identity is invalid.");
  }

  let prior = "";
  let totalBytes = 0;
  for (const record of manifest.files) {
    if (
      !hasExactKeys(record, ["path", "bytes", "sha256"])
      || typeof record.path !== "string"
      || safeRelativePath(record.path) !== record.path
      || record.path === "package-manifest.json"
      || (prior && compareCodePoints(record.path, prior) <= 0)
      || !Number.isInteger(record.bytes)
      || record.bytes < 0
      || !SHA256_RE.test(record.sha256 ?? "")
    ) {
      throw new Error("The npm package file inventory is invalid.");
    }
    prior = record.path;
    totalBytes += record.bytes;
  }
  if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("The npm package exceeds its byte limit.");
}

async function inventoryPackageFiles(root) {
  const paths = (await walkRegularFiles(root)).filter((relative) => relative !== "package-manifest.json");
  const records = [];
  let totalBytes = 0;
  for (const relative of paths) {
    const bytes = await fs.readFile(path.join(root, ...relative.split("/")));
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_PACKAGE_BYTES) throw new Error("The npm package exceeds its byte limit.");
    records.push({ path: relative, bytes: bytes.byteLength, sha256: hashBytes(bytes) });
  }
  return records;
}

function htmlAttribute(tag, name) {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]+)"|'([^']+)')`, "iu").exec(tag);
  return match?.[1] ?? match?.[2] ?? "";
}

function localStudioAsset(value, extension) {
  const candidate = value.startsWith("/") ? value.slice(1) : value;
  if (
    !candidate.startsWith("assets/")
    || !candidate.endsWith(extension)
    || candidate.includes("?")
    || candidate.includes("#")
  ) {
    throw new Error(`Studio index contains an invalid ${extension} asset reference.`);
  }
  return safeRelativePath(`studio/${candidate}`);
}

async function verifyStudioAssetGraph(root, inventory) {
  const index = await fs.readFile(path.join(root, "studio", "index.html"), "utf8");
  if (!index || Buffer.byteLength(index) > 1024 * 1024) {
    throw new Error("Studio index is empty or exceeds its size limit.");
  }
  const scripts = [...index.matchAll(/<script\b[^>]*>/giu)];
  const scriptAssets = scripts.map((match) => {
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

export async function createNpmPackageManifest(root, commit) {
  if (!COMMIT_RE.test(commit)) throw new Error("The npm package requires a full Git commit.");
  const packageJson = await readJson(path.join(root, "package.json"));
  validatePackageJson(packageJson, npmPackageVersion);
  const manifest = {
    schema_version: 1,
    product: "Dusk Developer Studio Local",
    package: npmPackageName,
    version: npmPackageVersion,
    commit,
    channel: "npm",
    node: { required_range: requiredNodeRange },
    supported_targets: [...supportedTargets],
    files: await inventoryPackageFiles(root)
  };
  validateManifest(manifest, npmPackageVersion, commit);
  await writeJson(path.join(root, "package-manifest.json"), manifest);
  return manifest;
}

export async function verifyBuiltNpmPackage(root, options = {}) {
  const realRoot = await fs.realpath(path.resolve(root));
  const rootStat = await fs.lstat(realRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("The npm package root is unsafe.");
  }
  const packageJson = await readJson(path.join(realRoot, "package.json"));
  const manifest = await readJson(path.join(realRoot, "package-manifest.json"));
  validatePackageJson(packageJson, options.expectedVersion ?? npmPackageVersion);
  validateManifest(
    manifest,
    options.expectedVersion ?? npmPackageVersion,
    options.expectedCommit
  );
  const actual = await inventoryPackageFiles(realRoot);
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) {
    throw new Error("The npm package exact file set or content does not match its manifest.");
  }
  for (const required of REQUIRED_FILES) {
    if (!actual.some((record) => record.path === required)) {
      throw new Error(`The npm package is missing ${required}.`);
    }
  }
  await verifyStudioAssetGraph(realRoot, actual);
  return { packageJson, manifest, totalBytes: actual.reduce((sum, record) => sum + record.bytes, 0) };
}
