import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildRelease } from "./companion-core.mjs";
import { buildNpmPrototype, buildSeaPrototype } from "./companion-prototype-core.mjs";
import { createMacosStandaloneApp } from "./standalone-macos-app.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-distribution-prototype-test-"));
const prototypeCoreSource = fs.readFileSync(
  path.join(process.cwd(), "scripts", "companion-prototype-core.mjs"),
  "utf8"
);
assert.match(prototypeCoreSource, /--macho-segment-name", "NODE_SEA"/);
assert.doesNotMatch(prototypeCoreSource, /--macho-segment-name", "NODE_JS"/);
const seaBootstrapSource = fs.readFileSync(
  path.join(process.cwd(), "distribution", "prototypes", "sea", "bootstrap-bundle.cjs"),
  "utf8"
);
const npmLaunchSource = fs.readFileSync(
  path.join(process.cwd(), "distribution", "prototypes", "npm", "launch.mjs"),
  "utf8"
);
const canonicalPrivilegeSource = fs.readFileSync(
  path.join(process.cwd(), "packages", "local-runtime", "src", "launchPrivilege.ts"),
  "utf8"
);
function elevatedGuardBlock(source) {
  return source.match(/\/\/ BEGIN ELEVATED LAUNCH GUARD\n([\s\S]*?)\/\/ END ELEVATED LAUNCH GUARD/)?.[1] ?? "";
}
const seaGuard = elevatedGuardBlock(seaBootstrapSource);
const npmGuard = elevatedGuardBlock(npmLaunchSource);
assert.ok(seaGuard);
assert.equal(seaGuard, npmGuard, "SEA and npm launchers must use the exact same elevation guard.");
assert.match(seaGuard, /Dusk Developer Studio refuses elevated or root execution\./);
assert.match(seaGuard, /path\.win32\.join\(normalizedRoot, "System32", "whoami\.exe"\)/);
assert.match(seaGuard, /spawnSync\(whoami, \["\/groups"\], \{[\s\S]*?shell: false/);
assert.match(seaGuard, /identity\.isFile\(\) \|\| identity\.isSymbolicLink\(\)/);
assert.match(seaGuard, /parseIntegrityRid\(result\.stdout\) >= 12_288/);
for (const contract of [
  /Dusk Developer Studio refuses elevated or root execution\./,
  /uid !== euid/,
  /gid !== egid/,
  /capabilities\.permitted !== 0n/,
  /capabilities\.effective !== 0n/,
  /capabilities\.ambient !== 0n/,
  /\^CapPrm:/,
  /\^CapEff:/,
  /\^CapAmb:/,
  /process\.getgid/,
  /process\.getegid/,
  /readFileSync\("\/proc\/self\/status", "utf8"\)/,
  /parseIntegrityRid\(result\.stdout\) >= 12_288/
]) {
  assert.match(canonicalPrivilegeSource, contract);
  assert.match(seaGuard, contract);
}
assert.doesNotMatch(seaGuard, /shell: true|ALLOW_|BYPASS|SKIP_/i);
const seaMain = seaBootstrapSource.slice(
  seaBootstrapSource.indexOf("async function main()"),
  seaBootstrapSource.indexOf("main().catch")
);
const npmLaunch = npmLaunchSource.slice(npmLaunchSource.indexOf("export async function launch"));
for (const [label, source, firstSensitiveAction] of [
  ["SEA", seaMain, "decodeBundle()"],
  ["npm", npmLaunch, "hostTarget()"]
]) {
  const guard = source.indexOf("assertNonElevatedLaunch();");
  assert.ok(guard >= 0, `${label} launcher must invoke its elevation guard.`);
  assert.ok(guard < source.indexOf(firstSensitiveAction), `${label} launcher must guard before host/runtime verification.`);
  assert.ok(guard < source.indexOf("fs.mkdtempSync"), `${label} launcher must guard before extraction.`);
}
const localRuntimeSource = fs.readFileSync(
  path.join(process.cwd(), "packages", "local-runtime", "src", "main.ts"),
  "utf8"
);
const stoppedProbe = localRuntimeSource.match(
  /async function assertStudioLoopbackServicesStopped\(\): Promise<void> \{([\s\S]*?)\n\}\n\nasync function runSignedRcLifecycleSelfTest/
)?.[1] ?? "";
assert.match(stoppedProbe, /net\.createConnection/);
assert.match(stoppedProbe, /error\.code === "ECONNREFUSED"/);
assert.doesNotMatch(stoppedProbe, /selfTestRequest/);
const commit = "b".repeat(40);
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function put(relative, contents, mode) {
  const file = path.join(root, ...relative.split("/"));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
  if (mode) fs.chmodSync(file, mode);
  return file;
}

function fixtureRelease(target) {
  const runtimeRoot = path.join(root, `runtime-${target}`);
  fs.mkdirSync(runtimeRoot, { recursive: true });
  const runtime = target === "windows-x64" ? path.join(runtimeRoot, "node.exe") : path.join(runtimeRoot, "bin", "node");
  fs.mkdirSync(path.dirname(runtime), { recursive: true });
  fs.copyFileSync(process.execPath, runtime);
  fs.chmodSync(runtime, 0o755);
  put(`runtime-${target}/LICENSE`, "Fixture Node license\n");
  const launcher = path.join(root, "launcher");
  const studio = path.join(root, "studio");
  const template = path.join(root, "template");
  if (!fs.existsSync(launcher)) {
    put("launcher/companion.mjs", "export async function runPortableRuntimeCli(options = {}) { console.log(JSON.stringify({ fixture: true, args: options.args ?? process.argv.slice(2), external: Boolean(options.verification?.externalRuntime) })); }\nif (process.argv[1]?.endsWith('companion.mjs')) runPortableRuntimeCli();\n");
    put("studio/index.html", "<!doctype html><title>Dusk fixture</title>\n");
    put("template/.env.example", "RPC_URL=https://example.invalid\n");
    put("template/foundry.toml", "[profile.default]\nsrc = 'src'\n");
  }
  return buildRelease({
    productRoot,
    target,
    outDir: path.join(root, `release-${target}`),
    launcherBundle: launcher,
    runtimeRoot,
    runtimeRootVerified: true,
    studioDist: studio,
    templateRoot: template,
    commit,
    sourceDateEpoch: 1_700_000_000,
    executeRuntime: false
  }).outDir;
}

function run(file, args, env = process.env) {
  return spawnSync(file, args, { encoding: "utf8", env, shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
}

try {
  assert.equal(process.versions.node, "24.18.0", "Prototype fixtures require the pinned build runtime.");
  const windowsRelease = fixtureRelease("windows-x64");
  const linuxRelease = fixtureRelease("linux-x64");
  const darwinRelease = fixtureRelease("darwin-arm64");

  const bundleRoot = path.join(root, "actual-bundle");
  const bundleBuild = run(process.execPath, [path.join(productRoot, "scripts", "companion-bundle.mjs"), `--out=${bundleRoot}`]);
  assert.equal(bundleBuild.status, 0, bundleBuild.stderr);
  const bundleProbe = run(process.execPath, [path.join(bundleRoot, "companion.mjs"), "--no-open"]);
  assert.notEqual(bundleProbe.status, 0);
  assert.match(`${bundleProbe.stdout}
${bundleProbe.stderr}`, /payload-manifest\.json/);
  assert.doesNotMatch(`${bundleProbe.stdout}
${bundleProbe.stderr}`, /DUSK_STUDIO_PAIRING_TOKEN/);

  const npmOne = buildNpmPrototype({ windowsRelease, linuxRelease, outDir: path.join(root, "npm-one") });
  const npmTwo = buildNpmPrototype({ windowsRelease, linuxRelease, outDir: path.join(root, "npm-two") });
  assert.equal(npmOne.sha256, npmTwo.sha256);
  assert.deepEqual(fs.readFileSync(npmOne.tarball), fs.readFileSync(npmTwo.tarball));
  assert.equal(npmOne.packageJson.private, true);
  assert.equal(npmOne.packageJson.name, "@georgiandusk/dusk-developer-studio");
  assert.equal(npmOne.packageJson.license, "Apache-2.0");
  assert.equal(npmOne.packageJson.dependencies, undefined);
  assert.equal(npmOne.packageJson.optionalDependencies, undefined);
  assert.equal(npmOne.packageJson.scripts, undefined);
  assert.equal(npmOne.receipt.runtime_dependencies, 0);
  assert.equal(npmOne.receipt.install_scripts, 0);
  const linuxBundle = gunzipSync(fs.readFileSync(path.join(npmOne.packageRoot, "bundles", "linux-x64.bundle.gz")));
  const linuxHeaderBytes = linuxBundle.readUInt32BE(0);
  const linuxHeader = JSON.parse(linuxBundle.subarray(4, 4 + linuxHeaderBytes).toString("utf8"));
  for (const executable of ["runtime/node", "bin/dusk-studio", "bin/dusk-studio-local-actions"]) {
    assert.equal(linuxHeader.files.find((file) => file.path === executable)?.mode, 0o755, executable + " must remain executable across build hosts.");
  }
  const listing = run("tar", ["-tf", npmOne.tarball]);
  assert.equal(listing.status, 0, listing.stderr);
  assert.match(listing.stdout, /package\/bundles\/windows-x64\.bundle\.gz/);
  assert.match(listing.stdout, /package\/bundles\/linux-x64\.bundle\.gz/);
  assert.doesNotMatch(listing.stdout, /package\/targets\/|node_modules|\.env\.local|package-lock/);
  const unpacked = path.join(root, "npm-packed-extraction");
  fs.mkdirSync(unpacked);
  const extraction = run("tar", ["-xf", npmOne.tarball, "-C", unpacked]);
  assert.equal(extraction.status, 0, extraction.stderr);
  const packedRoot = path.join(unpacked, "package");

  const npmSafe = run(process.execPath, [path.join(packedRoot, "bin", "dusk-studio.mjs"), "--no-open", "--fixture"]);
  assert.equal(npmSafe.status, 0, npmSafe.stderr);
  assert.match(npmSafe.stdout, /"fixture":true/);
  assert.doesNotMatch(npmSafe.stdout, /enable-local-actions/);
  const npmEscalation = run(process.execPath, [path.join(packedRoot, "bin", "dusk-studio.mjs"), "--enable-local-actions"]);
  assert.notEqual(npmEscalation.status, 0);
  assert.match(npmEscalation.stderr, /dusk-studio-local-actions/);
  const npmActions = run(process.execPath, [path.join(packedRoot, "bin", "dusk-studio-local-actions.mjs"), "--no-open"]);
  assert.equal(npmActions.status, 0, npmActions.stderr);
  assert.match(npmActions.stdout, /enable-local-actions/);

  const currentTarget = process.platform === "win32" ? "windows-x64" : process.platform === "darwin" ? "darwin-arm64" : "linux-x64";
  const currentRelease = currentTarget === "windows-x64" ? windowsRelease : currentTarget === "darwin-arm64" ? darwinRelease : linuxRelease;
  const seaOne = buildSeaPrototype({ releaseDir: currentRelease, target: currentTarget, outDir: path.join(root, "sea-one") });
  const seaTwo = buildSeaPrototype({ releaseDir: currentRelease, target: currentTarget, outDir: path.join(root, "sea-two") });
  assert.equal(seaOne.sha256, seaTwo.sha256);
  assert.deepEqual(fs.readFileSync(seaOne.executables.safe), fs.readFileSync(seaTwo.executables.safe));
  assert.deepEqual(fs.readFileSync(seaOne.executables.localActions), fs.readFileSync(seaTwo.executables.localActions));
  assert.notEqual(seaOne.receipt.launchers.safe.sha256, seaOne.receipt.launchers.local_actions.sha256);
  assert.match(seaOne.receipt.launchers.safe.name, /^dusk-developer-studio-safe-.+-internal-rc(?:\.exe)?$/);
  assert.match(seaOne.receipt.launchers.local_actions.name, /^dusk-developer-studio-local-actions-.+-internal-rc(?:\.exe)?$/);
  assert.equal(seaOne.receipt.launchers.safe.mode, "safe");
  assert.equal(seaOne.receipt.launchers.local_actions.mode, "local-actions");
  assert.equal(seaOne.receipt.launchers.safe.bytes, fs.statSync(seaOne.executables.safe).size);
  assert.equal(seaOne.receipt.launchers.local_actions.bytes, fs.statSync(seaOne.executables.localActions).size);
  assert.equal(seaOne.receipt.launchers.safe.sha256, sha256(fs.readFileSync(seaOne.executables.safe)));
  assert.equal(seaOne.receipt.launchers.local_actions.sha256, sha256(fs.readFileSync(seaOne.executables.localActions)));
  assert.equal(
    seaOne.receipt.unsigned_asset_index_sha256,
    sha256(Buffer.from(`${JSON.stringify([seaOne.receipt.launchers.safe, seaOne.receipt.launchers.local_actions], null, 2)}\n`))
  );
  assert.equal(seaOne.receipt.status, "internal-nonpublication-rc");
  assert.equal(seaOne.receipt.embedded_payload_trust.standalone_platform_trust, "not-established");
  assert.equal(seaOne.receipt.embedded_payload_trust.publication_eligible, false);
  assert.equal(seaOne.executable, seaOne.executables.safe);
  assert.equal(seaOne.receipt.executable, seaOne.receipt.launchers.safe.name);
  assert.equal(seaOne.receipt.contains_second_embedded_runtime, false);
  assert.equal(seaOne.receipt.externalized_runtime.path, process.platform === "win32" ? "runtime/node.exe" : "runtime/node");
  assert.ok(seaOne.receipt.externalized_runtime.bytes_removed_from_bundle > 0);
  assert.ok(seaOne.receipt.launchers.safe.bytes < fs.statSync(process.execPath).size * 1.25, "Safe SEA must not re-embed a compressed copy of the host runtime.");
  assert.ok(seaOne.receipt.launchers.local_actions.bytes < fs.statSync(process.execPath).size * 1.25, "Local-actions SEA must not re-embed a compressed copy of the host runtime.");
  const seaSafe = run(seaOne.executables.safe, ["--no-open", "--fixture"]);
  assert.equal(seaSafe.status, 0, [seaSafe.stdout, seaSafe.stderr].join("\n"));
  assert.match(seaSafe.stdout, /"fixture":true/);
  assert.match(seaSafe.stdout, /"external":true/);
  assert.match(seaSafe.stdout, /"args":\["--no-open","--fixture"\]/);
  assert.doesNotMatch(seaSafe.stdout, /allowed to check local tools/);
  const nodeOptionsProbe = put("node-options-probe.cjs", "process.stdout.write('NODE_OPTIONS_INJECTED\\n');\n");
  const nodeOptionsAttempt = run(seaOne.executables.safe, ["--no-open", "--fixture"], {
    ...process.env,
    NODE_OPTIONS: `--require=${nodeOptionsProbe}`
  });
  assert.equal(nodeOptionsAttempt.status, 0, [nodeOptionsAttempt.stdout, nodeOptionsAttempt.stderr].join("\n"));
  assert.doesNotMatch(`${nodeOptionsAttempt.stdout}\n${nodeOptionsAttempt.stderr}`, /NODE_OPTIONS_INJECTED/);
  const seaSafeEscalation = run(seaOne.executables.safe, ["--enable-local-actions"]);
  assert.notEqual(seaSafeEscalation.status, 0);
  assert.match(seaSafeEscalation.stderr, /Safe mode cannot be escalated/);
  const seaActions = run(seaOne.executables.localActions, ["--no-open", "--fixture"]);
  assert.equal(seaActions.status, 0, [seaActions.stdout, seaActions.stderr].join("\n"));
  assert.match(seaActions.stdout, /allowed to check local tools/);
  assert.match(seaActions.stdout, /"args":\["--no-open","--fixture","--enable-local-actions"\]/);
  const seaActionsEscalation = run(seaOne.executables.localActions, ["--enable-local-actions"]);
  assert.notEqual(seaActionsEscalation.status, 0);
  assert.match(seaActionsEscalation.stderr, /mode is fixed by this executable/);

  const macFixture = path.join(root, "mac-dual-launcher");
  fs.mkdirSync(macFixture);
  const macSafeName = "dusk-developer-studio-safe-0.1.0-darwin-arm64-internal-rc";
  const macActionsName = "dusk-developer-studio-local-actions-0.1.0-darwin-arm64-internal-rc";
  const macSafe = put(`mac-dual-launcher/${macSafeName}`, "safe macOS SEA");
  const macActions = put(`mac-dual-launcher/${macActionsName}`, "local-actions macOS SEA");
  const macLaunchers = {
    safe: { mode: "safe", name: macSafeName, bytes: fs.statSync(macSafe).size, sha256: sha256(fs.readFileSync(macSafe)) },
    local_actions: { mode: "local-actions", name: macActionsName, bytes: fs.statSync(macActions).size, sha256: sha256(fs.readFileSync(macActions)) }
  };
  const macReceipt = {
    schema_version: 3,
    status: "internal-nonpublication-rc",
    channel: "node-sea-in-process",
    target: "darwin-arm64",
    version: "0.1.0",
    commit,
    embedded_release_fingerprint_sha256: "1".repeat(64),
    embedded_runtime_version: "24.18.0",
    contains_second_embedded_runtime: false,
    externalized_runtime: { path: "runtime/node", bytes_removed_from_bundle: 1, sha256: "2".repeat(64) },
    embedded_file_count: 1,
    embedded_release_bundle_bytes: 1,
    embedded_release_bundle_sha256: "3".repeat(64),
    postject_version: "1.0.0-alpha.6",
    platform_signature_status: "adhoc-development-only",
    embedded_payload_trust: {
      portable_manifest_signing_status: "unsigned-rc",
      standalone_platform_trust: "not-established",
      publication_eligible: false
    },
    launchers: macLaunchers,
    unsigned_asset_index_sha256: sha256(Buffer.from(`${JSON.stringify([macLaunchers.safe, macLaunchers.local_actions], null, 2)}\n`)),
    executable: macLaunchers.safe.name,
    executable_bytes: macLaunchers.safe.bytes,
    executable_sha256: macLaunchers.safe.sha256
  };
  const macReceiptFile = put("mac-dual-launcher/prototype-receipt.json", `${JSON.stringify(macReceipt, null, 2)}\n`);
  const macApps = createMacosStandaloneApp({
    safeExecutable: macSafe,
    localActionsExecutable: macActions,
    buildReceipt: macReceiptFile,
    outDir: path.join(root, "mac-dual-apps")
  });
  assert.equal(macApps.receipt.schema_version, 2);
  assert.equal(macApps.receipt.launchers.safe.bundle_id, "io.github.georgiandusk.dusk-developer-studio");
  assert.equal(macApps.receipt.launchers.local_actions.bundle_id, "io.github.georgiandusk.dusk-developer-studio.local-actions");
  assert.equal(fs.readFileSync(macApps.executable, "utf8"), "safe macOS SEA");
  assert.equal(fs.readFileSync(macApps.localActionsExecutable, "utf8"), "local-actions macOS SEA");
  assert.match(fs.readFileSync(path.join(macApps.app, "Contents", "Info.plist"), "utf8"), /Dusk Developer Studio/);
  assert.match(fs.readFileSync(path.join(macApps.localActionsApp, "Contents", "Info.plist"), "utf8"), /Dusk Developer Studio Local Actions/);
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    assert.throws(() => buildSeaPrototype({ releaseDir: darwinRelease, target: "darwin-arm64", outDir: path.join(root, "sea-darwin-nonnative") }), /native darwin-arm64 signing runner/);
  }

  fs.appendFileSync(path.join(windowsRelease, "payload", "studio", "index.html"), "tampered");
  assert.throws(() => buildNpmPrototype({ windowsRelease, linuxRelease, outDir: path.join(root, "tampered") }), /parity failed/);

  console.log("Private npm and Node SEA distribution prototype fixtures passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
