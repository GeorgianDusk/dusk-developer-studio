import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  copyRegularTree,
  createNpmPackageManifest,
  npmPackageName,
  npmPackageVersion,
  npmCliCandidates,
  productRoot,
  readJson,
  resolveNpmCli,
  verifyBuiltNpmPackage
} from "./npm-package-core.mjs";
import {
  collectBundledProductionLicenses,
  renderBundledProductionLicenses
} from "./npm-third-party-licenses.mjs";

const cliRoot = path.join(productRoot, "packages", "cli");
const packageJson = await readJson(path.join(cliRoot, "package.json"));
assert.equal(packageJson.name, npmPackageName);
assert.equal(packageJson.version, npmPackageVersion);
for (const forbidden of [
  "private",
  "scripts",
  "dependencies",
  "optionalDependencies",
  "peerDependencies",
  "bundledDependencies"
]) {
  assert.equal(packageJson[forbidden], undefined, `Public npm metadata must omit ${forbidden}.`);
}
assert.ok(
  npmCliCandidates("/opt/hostedtoolcache/node/24.18.0/x64/bin/node", "linux", {})
    .includes("/opt/hostedtoolcache/node/24.18.0/x64/lib/node_modules/npm/bin/npm-cli.js")
);
assert.ok(
  npmCliCandidates("C:\\nvm4w\\nodejs\\node.exe", "win32", {})
    .includes("C:\\nvm4w\\nodejs\\node_modules\\npm\\bin\\npm-cli.js")
);
assert.match(await resolveNpmCli(), /npm[\\/]bin[\\/]npm-cli\.js$/iu);

const binDirectory = path.join(cliRoot, "bin");
for (const file of [
  "launch.mjs",
  "dusk-developer-studio.mjs"
]) {
  const result = spawnSync(process.execPath, ["--check", path.join(binDirectory, file)], {
    cwd: productRoot,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0, `${file} must be valid JavaScript:\n${result.stderr}`);
}

const { resolveCliInvocation } = await import(
  `${pathToFileURL(path.join(binDirectory, "launch.mjs")).href}?test=${Date.now()}`
);
assert.deepEqual(resolveCliInvocation([]), {
  kind: "run",
  capabilitiesEnabled: false,
  runtimeArgs: []
});
assert.deepEqual(resolveCliInvocation(["--no-open"]), {
  kind: "run",
  capabilitiesEnabled: false,
  runtimeArgs: ["--no-open"]
});
assert.deepEqual(resolveCliInvocation(["local-actions", "--no-open"]), {
  kind: "run",
  capabilitiesEnabled: true,
  runtimeArgs: ["--no-open"]
});
assert.deepEqual(resolveCliInvocation(["create-duskds", "my-counter"]), {
  kind: "create-duskds",
  projectName: "my-counter"
});
assert.throws(
  () => resolveCliInvocation(["create-duskds"]),
  /create-duskds <project-name>/
);
assert.throws(
  () => resolveCliInvocation(["create-duskds", "counter", "extra"]),
  /create-duskds <project-name>/
);
assert.deepEqual(resolveCliInvocation(["--no-open", "local-actions"]), {
  kind: "run",
  capabilitiesEnabled: false,
  runtimeArgs: ["--no-open", "local-actions"]
});
assert.deepEqual(resolveCliInvocation(["--help"]), { kind: "help" });
assert.deepEqual(resolveCliInvocation(["-v"]), { kind: "version" });
assert.throws(
  () => resolveCliInvocation(["--help", "--no-open"]),
  /cannot be combined/
);

const primaryBin = path.join(binDirectory, "dusk-developer-studio.mjs");
for (const flag of ["--version", "-v"]) {
  const result = spawnSync(process.execPath, [primaryBin, flag], {
    cwd: productRoot,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), npmPackageVersion);
}
for (const flag of ["--help", "-h"]) {
  const result = spawnSync(process.execPath, [primaryBin, flag], {
    cwd: productRoot,
    encoding: "utf8",
    windowsHide: true
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /npx dusk-developer-studio \[local-actions\] \[--no-open\]/);
  assert.match(result.stdout, /npx dusk-developer-studio create-duskds <project-name>/);
}
const mixedInformation = spawnSync(process.execPath, [primaryBin, "--help", "--no-open"], {
  cwd: productRoot,
  encoding: "utf8",
  windowsHide: true
});
assert.equal(mixedInformation.status, 1);
assert.match(mixedInformation.stderr, /cannot be combined/);

const bundledLicenses = await collectBundledProductionLicenses();
const bundledLicenseText = renderBundledProductionLicenses(bundledLicenses);
for (const packageName of [
  "esbuild",
  "lucide-react",
  "react",
  "react-dom",
  "rollup",
  "viem",
  "vite",
  "zod"
]) {
  assert.ok(
    bundledLicenses.some((record) => record.name === packageName),
    `Third-party license coverage must include ${packageName}.`
  );
}
assert.match(bundledLicenseText, /Permission is hereby granted/);

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-studio-npm-package-"));
try {
  await copyRegularTree(cliRoot, fixture);
  await Promise.all([
    fs.mkdir(path.join(fixture, "app"), { recursive: true }),
    fs.mkdir(path.join(fixture, "studio", "assets"), { recursive: true }),
    fs.mkdir(path.join(fixture, "templates", "foundry-counter-dusk-evm", "src"), { recursive: true }),
    fs.mkdir(path.join(fixture, "templates", "foundry-counter-dusk-evm", "test"), { recursive: true })
  ]);
  await copyRegularTree(
    path.join(productRoot, "packages", "templates", "duskds-counter-forge"),
    path.join(fixture, "templates", "duskds-counter-forge")
  );
  await Promise.all([
    fs.writeFile(path.join(fixture, "app", "runtime.mjs"), "export const runtime = true;\n", "utf8"),
    fs.writeFile(
      path.join(fixture, "studio", "index.html"),
      "<!doctype html><link rel=\"stylesheet\" href=\"/assets/app.css\"><script type=\"module\" src=\"/assets/app.js\"></script>\n",
      "utf8"
    ),
    fs.writeFile(path.join(fixture, "studio", "assets", "app.css"), "body { color: white; }\n", "utf8"),
    fs.writeFile(
      path.join(fixture, "studio", "assets", "app.js"),
      "document.documentElement.dataset.booted = 'true';\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "templates", "foundry-counter-dusk-evm", "foundry.toml"),
      "[profile.default]\nsrc = \"src\"\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "templates", "foundry-counter-dusk-evm", ".env.example"),
      "DUSK_EVM_TESTNET_RPC_URL=\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "templates", "foundry-counter-dusk-evm", ".gitignore.template"),
      "broadcast/\ncache/\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "templates", "foundry-counter-dusk-evm", "README.md"),
      "# Counter\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "templates", "foundry-counter-dusk-evm", "src", "Counter.sol"),
      "contract Counter {}\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "templates", "foundry-counter-dusk-evm", "test", "Counter.t.sol"),
      "contract CounterTest {}\n",
      "utf8"
    ),
    fs.writeFile(
      path.join(fixture, "THIRD-PARTY-LICENSES.txt"),
      bundledLicenseText,
      "utf8"
    ),
    fs.copyFile(path.join(productRoot, "LICENSE"), path.join(fixture, "LICENSE")),
    fs.copyFile(path.join(productRoot, "NOTICE"), path.join(fixture, "NOTICE"))
  ]);

  const commit = "a".repeat(40);
  await createNpmPackageManifest(fixture, commit);
  const verified = await verifyBuiltNpmPackage(fixture, {
    expectedCommit: commit,
    expectedVersion: npmPackageVersion
  });
  assert.equal(verified.manifest.channel, "npm");
  assert.deepEqual(verified.manifest.supported_targets, [
    "windows-x64",
    "linux-x64",
    "darwin-arm64"
  ]);
  assert.deepEqual(verified.manifest.files.slice(0, 4).map((file) => file.path), [
    "LICENSE",
    "NOTICE",
    "README.md",
    "THIRD-PARTY-LICENSES.txt"
  ]);
  assert.ok(
    verified.manifest.files.some((file) =>
      file.path === "templates/duskds-counter-forge/LICENSE-MPL-2.0.txt"
    )
  );
  assert.ok(
    verified.manifest.files.some((file) =>
      file.path === "templates/duskds-counter-forge/Cargo.lock"
    )
  );

  await fs.appendFile(path.join(fixture, "app", "runtime.mjs"), "// tampered\n", "utf8");
  await assert.rejects(
    () => verifyBuiltNpmPackage(fixture, { expectedCommit: commit }),
    /exact file set or content/
  );
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}

console.log("Npm package metadata, command syntax, mode selection, manifest, and tamper checks passed.");
