import fs from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";
import {
  copyRegularTree,
  createNpmPackageManifest,
  npmPackageRoot,
  npmPackageVersion,
  productRoot,
  readGitIdentity,
  readJson,
  recreateDirectory,
  runFile,
  verifyBuiltNpmPackage
} from "./npm-package-core.mjs";
import { writeBundledProductionLicenses } from "./npm-third-party-licenses.mjs";

const allowedArguments = new Set(["--strict"]);
const unknown = process.argv.slice(2).filter((argument) => !allowedArguments.has(argument));
if (unknown.length) throw new Error(`Unsupported npm build argument: ${unknown[0]}.`);
const strict = process.argv.includes("--strict");
const git = readGitIdentity();
if (strict && !git.clean) {
  throw new Error("The npm release package must be built from a clean Git worktree.");
}
if (!git.clean) {
  console.warn("Building a local npm package preview from a dirty worktree; it cannot be published.");
}

const rootPackageJson = await readJson(path.join(productRoot, "package.json"));
const cliPackageJson = await readJson(path.join(productRoot, "packages", "cli", "package.json"));
if (
  rootPackageJson.version !== npmPackageVersion
  || cliPackageJson.version !== npmPackageVersion
) {
  throw new Error(`The repository and public npm package must both be version ${npmPackageVersion}.`);
}

const pnpmCli = process.env.npm_execpath;
if (!pnpmCli) {
  throw new Error("Run the npm package build through `pnpm build:npm`.");
}
await runFile(process.execPath, [pnpmCli, "--filter", "@dusk/studio", "build"], {
  env: {
    ...process.env,
    DUSK_STUDIO_ARTIFACT_CHANNEL: "npm",
    DUSK_STUDIO_RELEASE_COMMIT: git.commit
  }
});

await recreateDirectory(npmPackageRoot);
await copyRegularTree(path.join(productRoot, "packages", "cli"), npmPackageRoot);
await copyRegularTree(
  path.join(productRoot, "apps", "studio", "dist"),
  path.join(npmPackageRoot, "studio")
);
await Promise.all([
  fs.rm(path.join(npmPackageRoot, "studio", "assurance-receipt.json"), { force: true }),
  fs.rm(path.join(npmPackageRoot, "studio", "release-manifest.json"), { force: true })
]);
const templateSource = path.join(
  productRoot,
  "packages",
  "templates",
  "foundry-counter-dusk-evm"
);
const templateDestination = path.join(
  npmPackageRoot,
  "templates",
  "foundry-counter-dusk-evm"
);
for (const [source, destination] of [
  [".env.example", ".env.example"],
  [".gitignore", ".gitignore.template"],
  ["README.md", "README.md"],
  ["foundry.toml", "foundry.toml"],
  ["src/Counter.sol", "src/Counter.sol"],
  ["test/Counter.t.sol", "test/Counter.t.sol"]
]) {
  const output = path.join(templateDestination, ...destination.split("/"));
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.copyFile(path.join(templateSource, ...source.split("/")), output);
}
await fs.mkdir(path.join(npmPackageRoot, "app"), { recursive: true });
await build({
  entryPoints: [path.join(productRoot, "packages", "local-runtime", "src", "main.ts")],
  outfile: path.join(npmPackageRoot, "app", "runtime.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  packages: "bundle",
  sourcemap: false,
  minify: false,
  legalComments: "eof",
  banner: {
    js: "// Dusk Developer Studio local runtime; generated from the repository source."
  }
});
await Promise.all([
  fs.copyFile(path.join(productRoot, "LICENSE"), path.join(npmPackageRoot, "LICENSE")),
  fs.copyFile(path.join(productRoot, "NOTICE"), path.join(npmPackageRoot, "NOTICE")),
  writeBundledProductionLicenses(path.join(npmPackageRoot, "THIRD-PARTY-LICENSES.txt"))
]);
await fs.chmod(path.join(npmPackageRoot, "bin", "dusk-developer-studio.mjs"), 0o755);

const manifest = await createNpmPackageManifest(npmPackageRoot, git.commit);
const verified = await verifyBuiltNpmPackage(npmPackageRoot, {
  expectedCommit: git.commit,
  expectedVersion: npmPackageVersion
});
console.log(JSON.stringify({
  package: manifest.package,
  version: manifest.version,
  commit: manifest.commit,
  channel: manifest.channel,
  files: manifest.files.length,
  bytes: verified.totalBytes,
  directory: npmPackageRoot,
  publishable: git.clean
}, null, 2));
