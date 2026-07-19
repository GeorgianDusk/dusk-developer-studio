import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import { compareCodePoints, productRoot, readJson } from "./npm-package-core.mjs";

const PRODUCT_MANIFESTS = [
  path.join(productRoot, "apps", "studio", "package.json"),
  path.join(productRoot, "packages", "core", "package.json"),
  path.join(productRoot, "packages", "local-agent", "package.json"),
  path.join(productRoot, "packages", "local-runtime", "package.json")
];
const BUILD_RUNTIME_REQUESTS = [
  {
    name: "vite",
    requiringManifest: path.join(productRoot, "apps", "studio", "package.json")
  },
  {
    name: "esbuild",
    requiringManifest: path.join(productRoot, "package.json")
  }
];
const LICENSE_FILE_RE = /^(?:licen[cs]e|copying|notice)(?:[._-].*)?$/i;
const MAX_LICENSE_BYTES = 512 * 1024;

async function findPackageJsonFromEntry(entry, expectedName) {
  let directory = path.dirname(await fs.realpath(entry));
  while (true) {
    const candidate = path.join(directory, "package.json");
    try {
      const manifest = await readJson(candidate);
      if (manifest.name === expectedName) return candidate;
    } catch {
      // Continue toward the filesystem root.
    }
    const parent = path.dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`Could not locate package metadata for ${expectedName}.`);
}

async function resolvePackageJson(name, requiringManifest) {
  const require = createRequire(requiringManifest);
  try {
    return await fs.realpath(require.resolve(`${name}/package.json`));
  } catch {
    return findPackageJsonFromEntry(require.resolve(name), name);
  }
}

function repositoryUrl(repository) {
  if (typeof repository === "string") return repository;
  if (repository && typeof repository === "object" && typeof repository.url === "string") {
    return repository.url;
  }
  return "";
}

async function readLicenseSources(packageJsonPath) {
  const packageRoot = path.dirname(packageJsonPath);
  const entries = await fs.readdir(packageRoot, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && LICENSE_FILE_RE.test(entry.name))
    .map((entry) => entry.name)
    .sort(compareCodePoints);
  if (!files.length) {
    throw new Error(`Production dependency has no packaged license text: ${packageJsonPath}.`);
  }
  const sources = [];
  for (const file of files) {
    const bytes = await fs.readFile(path.join(packageRoot, file));
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LICENSE_BYTES || bytes.includes(0)) {
      throw new Error(`Production dependency license text is invalid: ${packageJsonPath} (${file}).`);
    }
    sources.push({
      file,
      text: bytes.toString("utf8").replace(/\r\n?/g, "\n").trim()
    });
  }
  return sources;
}

export async function collectBundledProductionLicenses() {
  const pending = [];
  for (const manifestPath of PRODUCT_MANIFESTS) {
    const manifest = await readJson(manifestPath);
    for (const name of Object.keys(manifest.dependencies ?? {}).sort(compareCodePoints)) {
      if (!name.startsWith("@dusk/")) {
        pending.push({ name, requiringManifest: manifestPath, traverseDependencies: true });
      }
    }
  }
  pending.push(...BUILD_RUNTIME_REQUESTS.map((request) => ({
    ...request,
    traverseDependencies: false
  })));

  const visited = new Set();
  const packages = [];
  while (pending.length) {
    const request = pending.shift();
    const packageJsonPath = await resolvePackageJson(request.name, request.requiringManifest);
    if (visited.has(packageJsonPath)) continue;
    visited.add(packageJsonPath);
    const manifest = await readJson(packageJsonPath);
    if (
      manifest.name !== request.name
      || typeof manifest.version !== "string"
      || typeof manifest.license !== "string"
      || !manifest.license.trim()
    ) {
      throw new Error(`Production dependency metadata is incomplete: ${packageJsonPath}.`);
    }
    packages.push({
      name: manifest.name,
      version: manifest.version,
      license: manifest.license,
      repository: repositoryUrl(manifest.repository),
      sources: await readLicenseSources(packageJsonPath)
    });
    if (manifest.name === "vite") {
      pending.push({
        name: "rollup",
        requiringManifest: packageJsonPath,
        traverseDependencies: false
      });
    }
    if (!request.traverseDependencies) continue;
    const dependencies = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.optionalDependencies ?? {})
    };
    for (const name of Object.keys(dependencies).sort(compareCodePoints)) {
      if (!name.startsWith("@dusk/")) {
        try {
          await resolvePackageJson(name, packageJsonPath);
          pending.push({ name, requiringManifest: packageJsonPath, traverseDependencies: true });
        } catch {
          if (manifest.dependencies?.[name] !== undefined) throw new Error(
            `Required production dependency is not installed: ${manifest.name} -> ${name}.`
          );
        }
      }
    }
  }
  return packages.sort((left, right) =>
    compareCodePoints(`${left.name}@${left.version}`, `${right.name}@${right.version}`)
  );
}

export function renderBundledProductionLicenses(packages) {
  const sections = packages.map((record) => [
    "=".repeat(78),
    `${record.name}@${record.version}`,
    `Declared license: ${record.license}`,
    ...(record.repository ? [`Source: ${record.repository}`] : []),
    ...record.sources.flatMap((source) => [
      `License file: ${source.file}`,
      "-".repeat(78),
      source.text
    ])
  ].join("\n"));
  return [
    "Dusk Developer Studio - Third-Party Licenses",
    "",
    "This file contains the license notices shipped by every installed",
    "production dependency bundled into the Local Studio runtime or browser",
    "application, plus the Vite, Rollup, and esbuild build-runtime code that can",
    "appear in generated browser or server bundles. The dependency set is resolved",
    "from the frozen pnpm workspace installation.",
    "",
    ...sections,
    ""
  ].join("\n");
}

export async function writeBundledProductionLicenses(destination) {
  const packages = await collectBundledProductionLicenses();
  await fs.writeFile(destination, renderBundledProductionLicenses(packages), "utf8");
  return packages;
}
