import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import { buildRelease } from "./companion-core.mjs";
import { buildNpmPrototype, buildSeaPrototype } from "./companion-prototype-core.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dusk-distribution-prototype-test-"));
const commit = "b".repeat(40);

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

function run(file, args) {
  return spawnSync(file, args, { encoding: "utf8", shell: false, windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
}

try {
  assert.equal(process.versions.node, "24.11.0", "Prototype fixtures require the pinned build runtime.");
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
  assert.deepEqual(fs.readFileSync(seaOne.executable), fs.readFileSync(seaTwo.executable));
  assert.equal(seaOne.receipt.contains_second_embedded_runtime, false);
  assert.equal(seaOne.receipt.externalized_runtime.path, process.platform === "win32" ? "runtime/node.exe" : "runtime/node");
  assert.ok(seaOne.receipt.externalized_runtime.bytes_removed_from_bundle > 0);
  assert.ok(seaOne.bytes < fs.statSync(process.execPath).size * 1.25, "V2 must not re-embed a compressed copy of the host runtime.");
  const seaRun = run(seaOne.executable, ["--no-open", "--fixture"]);
  assert.equal(seaRun.status, 0, [seaRun.stdout, seaRun.stderr].join("\n"));
  assert.match(seaRun.stdout, /"fixture":true/);
  assert.match(seaRun.stdout, /"external":true/);
  assert.match(seaRun.stdout, /"args":\["--no-open","--fixture"\]/);
  if (process.platform !== "darwin" || process.arch !== "arm64") {
    assert.throws(() => buildSeaPrototype({ releaseDir: darwinRelease, target: "darwin-arm64", outDir: path.join(root, "sea-darwin-nonnative") }), /native darwin-arm64 signing runner/);
  }

  fs.appendFileSync(path.join(windowsRelease, "payload", "studio", "index.html"), "tampered");
  assert.throws(() => buildNpmPrototype({ windowsRelease, linuxRelease, outDir: path.join(root, "tampered") }), /parity failed/);

  console.log("Private npm and Node SEA distribution prototype fixtures passed.");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
