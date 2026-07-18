import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath } from "node:url";
import { verifyCandidatePackageManifest } from "./standalone-candidate-package-manifest.mjs";
import { validateStandaloneBuildReceipt } from "./standalone-build-receipt.mjs";
import { cli } from "./companion-core.mjs";

const TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
const MODES = {
  safe: { receiptKey: "safe", mode: "safe", capabilities: false },
  local_actions: { receiptKey: "local_actions", mode: "local-actions", capabilities: true }
};
const RESULT_PREFIX = "DUSK_STUDIO_SIGNED_RC_LIFECYCLE=";
const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return { resolved, stat };
}

function within(root, child) {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeLeaf(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(path.basename(value))) throw new Error(`${label} has an unsafe name.`);
}

function existingBoundedPath(ephemeralRoot, value, label, kind) {
  const resolved = path.resolve(value);
  if (!within(ephemeralRoot, resolved)) throw new Error(`${label} is outside the ephemeral runner root.`);
  let cursor = ephemeralRoot;
  for (const segment of path.relative(ephemeralRoot, resolved).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symlink or reparse boundary.`);
  }
  const stat = fs.lstatSync(resolved);
  if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) throw new Error(`${label} has the wrong filesystem type.`);
  return resolved;
}

function newDirectChild(ephemeralRoot, value, label) {
  const resolved = path.resolve(value);
  if (path.dirname(resolved) !== ephemeralRoot) throw new Error(`${label} must be a direct child of the ephemeral runner root.`);
  safeLeaf(resolved, label);
  if (fs.existsSync(resolved)) throw new Error(`${label} must not already exist.`);
  return resolved;
}

function exactKeys(value, expected, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)
      || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${label} has an unexpected shape.`);
  }
}

export function validateStandaloneSelfTestResult(value, { mode, release }) {
  exactKeys(value, [
    "schema_version", "mode", "release", "bootstrap_succeeded", "bootstrap_replay_denied",
    "authenticated_session_verified", "exact_release_parity_verified", "capability_contract_verified",
    "expected_studio_listening_endpoints", "unexpected_studio_listening_endpoints", "isolated_project_root_verified",
    "studio_loopback_services_stopped"
  ], `${mode} lifecycle result`);
  exactKeys(value.release, ["product", "version", "commit", "channel"], `${mode} lifecycle release`);
  if (value.schema_version !== 1 || value.mode !== mode
      || value.release.product !== "Dusk Developer Studio" || value.release.version !== release.version
      || value.release.commit !== release.commit || value.release.channel !== "portable"
      || value.bootstrap_succeeded !== true || value.bootstrap_replay_denied !== true
      || value.authenticated_session_verified !== true || value.exact_release_parity_verified !== true
      || value.capability_contract_verified !== true || value.isolated_project_root_verified !== true
      || value.studio_loopback_services_stopped !== true
      || JSON.stringify(value.expected_studio_listening_endpoints) !== JSON.stringify(["127.0.0.1:5173", "127.0.0.1:8788"])
      || !Array.isArray(value.unexpected_studio_listening_endpoints) || value.unexpected_studio_listening_endpoints.length !== 0) {
    throw new Error(`${mode} signed-RC lifecycle result is invalid.`);
  }
  return value;
}

function terminateProcessTree(child) {
  if (!child.pid) return true;
  if (process.platform === "win32") {
    const result = spawnSync("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
      encoding: "utf8", windowsHide: true, timeout: 15_000
    });
    return result.status === 0 || child.exitCode !== null;
  }
  try { process.kill(-child.pid, "SIGTERM"); } catch (error) {
    if (error?.code !== "ESRCH") return false;
  }
  return true;
}

function windowsDescendantPids(rootPid) {
  const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const command = [
    "$ErrorActionPreference='Stop'",
    "$all=@(Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId)",
    `$frontier=@([uint32]${rootPid})`,
    "$seen=@{}",
    "$descendants=@()",
    "while($frontier.Count -gt 0){",
    "  $children=@($all | Where-Object { $frontier -contains [uint32]$_.ParentProcessId -and -not $seen.ContainsKey([string]$_.ProcessId) })",
    "  if($children.Count -eq 0){ break }",
    "  foreach($child in $children){ $seen[[string]$child.ProcessId]=$true; $descendants += [uint32]$child.ProcessId }",
    "  $frontier=@($children | ForEach-Object { [uint32]$_.ProcessId })",
    "}",
    "$descendants | Sort-Object -Unique | ConvertTo-Json -Compress"
  ].join("; ");
  const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], {
    encoding: "utf8", windowsHide: true, timeout: 15_000
  });
  if (result.status !== 0) return undefined;
  if (!result.stdout.trim()) return [];
  try {
    const parsed = JSON.parse(result.stdout);
    const values = Array.isArray(parsed) ? parsed : [parsed];
    return values.filter((value) => Number.isSafeInteger(value) && value > 0);
  } catch {
    return undefined;
  }
}

function forceKillProcessGroup(pid, rejectIfFound = false) {
  if (!pid) return true;
  if (process.platform === "win32") {
    const descendants = windowsDescendantPids(pid);
    if (!descendants) return false;
    if (!descendants.length) return true;
    for (const descendant of descendants) {
      spawnSync("taskkill.exe", ["/pid", String(descendant), "/t", "/f"], {
        encoding: "utf8", windowsHide: true, timeout: 15_000
      });
    }
    const remaining = windowsDescendantPids(pid);
    return Boolean(remaining && remaining.length === 0 && !rejectIfFound);
  }
  try { process.kill(-pid, 0); } catch (error) { return error?.code === "ESRCH"; }
  try { process.kill(-pid, "SIGKILL"); } catch (error) { if (error?.code !== "ESRCH") return false; }
  try { process.kill(-pid, 0); return false; } catch (error) { return error?.code === "ESRCH"; }
}

function runCandidate(candidate, args, env, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(candidate, args, {
      cwd,
      env,
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let bytes = 0;
    let abortReason;
    let settled = false;
    const abort = (error) => {
      if (abortReason || settled) return;
      abortReason = error;
      const terminationStarted = terminateProcessTree(child);
      if (!terminationStarted) error.cleanupSafe = false;
      setTimeout(() => {
        if (settled) return;
        const forced = forceKillProcessGroup(child.pid);
        const unconfirmed = new Error(`${error.message} Candidate shutdown could not be confirmed.`);
        unconfirmed.cleanupSafe = false;
        settled = true;
        reject(forced ? error : unconfirmed);
      }, 15_000).unref();
    };
    const append = (stream, chunk) => {
      const text = String(chunk);
      bytes += Buffer.byteLength(text);
      if (bytes > 256 * 1024) {
        abort(new Error("Signed-RC lifecycle output exceeded its bound."));
        return stream;
      }
      return stream + text;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      abort(new Error("Signed-RC lifecycle self-test timed out."));
    }, 120_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      error.cleanupSafe = false;
      reject(error);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (!forceKillProcessGroup(child.pid, true)) {
        const error = new Error("Signed-RC candidate left a live tracked process group or its shutdown could not be confirmed.");
        error.cleanupSafe = false;
        reject(error);
        return;
      }
      if (abortReason) {
        reject(abortReason);
        return;
      }
      if (code !== 0) {
        reject(new Error(`Signed-RC candidate exited unsuccessfully (${code ?? signal ?? "unknown"}): ${stderr.trim().slice(0, 2_000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function expectedProjectRoot(target, modeRoot) {
  if (target === "windows-x64") return path.join(modeRoot, "user-data", "Dusk", "DeveloperStudio", "projects");
  if (target === "darwin-arm64") return path.join(modeRoot, "home", "Library", "Application Support", "Dusk", "DeveloperStudio", "projects");
  return path.join(modeRoot, "user-data", "dusk", "developer-studio", "projects");
}

function isolatedEnvironment(target, modeRoot) {
  const temp = path.join(modeRoot, "temp");
  const home = path.join(modeRoot, "home");
  const data = path.join(modeRoot, "user-data");
  for (const directory of [temp, home, data]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env = {};
  const inherited = new Map(Object.entries(process.env).map(([key, value]) => [key.toLowerCase(), [key, value]]));
  for (const name of ["PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "LANG", "LC_ALL", "TZ"]) {
    const entry = inherited.get(name.toLowerCase());
    if (entry?.[1]) env[entry[0]] = entry[1];
  }
  const pathEntry = inherited.get("path");
  if (pathEntry?.[1]) {
    const absoluteSegments = pathEntry[1].split(path.delimiter).filter((segment) => segment && path.isAbsolute(segment));
    env[pathEntry[0]] = absoluteSegments.join(path.delimiter);
  }
  Object.assign(env, { HOME: home, USERPROFILE: home, TEMP: temp, TMP: temp, TMPDIR: temp });
  if (target === "windows-x64") {
    env.LOCALAPPDATA = data;
    env.APPDATA = path.join(data, "Roaming");
  } else if (target === "linux-x64") {
    env.XDG_DATA_HOME = data;
  }
  return { env, temp, cwd: modeRoot, projectRoot: expectedProjectRoot(target, modeRoot) };
}

function noExtractionRoots(temp) {
  return !fs.readdirSync(temp, { withFileTypes: true }).some((entry) => entry.isDirectory() && entry.name.startsWith("dusk-studio-sea-"));
}

function captureDirectoryIdentity(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular directory.`);
  return { realpath: fs.realpathSync(directory), dev: String(stat.dev), ino: String(stat.ino) };
}

function removeVerifiedTree(ephemeralRoot, directory, identity, label, { allowMissing = false } = {}) {
  if (!fs.existsSync(directory)) {
    if (allowMissing) return;
    throw new Error(`${label} disappeared before verified cleanup.`);
  }
  const bounded = existingBoundedPath(ephemeralRoot, directory, label, "directory");
  const observed = captureDirectoryIdentity(bounded, label);
  if (observed.realpath !== identity.realpath || observed.dev !== identity.dev || observed.ino !== identity.ino) {
    throw new Error(`${label} identity changed before verified cleanup.`);
  }
  const pending = [bounded];
  let entries = 0;
  while (pending.length) {
    const current = pending.pop();
    for (const name of fs.readdirSync(current)) {
      entries += 1;
      if (entries > 50_000) throw new Error(`${label} exceeded the cleanup entry bound.`);
      const child = path.join(current, name);
      const stat = fs.lstatSync(child);
      if (stat.isSymbolicLink()) throw new Error(`${label} contains a symlink or reparse entry and will not be recursively removed.`);
      if (stat.isDirectory()) pending.push(child);
      else if (!stat.isFile()) throw new Error(`${label} contains a non-regular entry and will not be recursively removed.`);
    }
  }
  fs.rmSync(bounded, { recursive: true, force: false });
  if (fs.existsSync(bounded)) throw new Error(`${label} verified cleanup failed.`);
}

function validateSignedLauncherIndex(index, {
  target, receipt, safeLauncher, localActionsLauncher, safeAttestation, localActionsAttestation
}) {
  const expectedKeys = target === "linux-x64"
    ? ["schema_version", "target", "version", "commit", "unsigned_asset_index_sha256", "launchers", "attestations"]
    : ["schema_version", "target", "version", "commit", "unsigned_asset_index_sha256", "launchers"];
  exactKeys(index, expectedKeys, "Signed launcher index");
  exactKeys(index.launchers, ["safe", "local_actions"], "Signed launcher index inventory");
  if (index.schema_version !== 1 || index.target !== target || index.version !== receipt.version
      || index.commit !== receipt.commit || index.unsigned_asset_index_sha256 !== receipt.unsigned_asset_index_sha256) {
    throw new Error("Signed launcher index identity does not match the build receipt.");
  }
  for (const [key, mode, file] of [["safe", "safe", safeLauncher], ["local_actions", "local-actions", localActionsLauncher]]) {
    const launcher = index.launchers[key];
    exactKeys(launcher, ["mode", "name", "bytes", "sha256"], `${mode} signed launcher index`);
    const candidate = regularFile(file, `${mode} signed launcher`);
    if (launcher.mode !== mode || !/^[A-Za-z0-9][A-Za-z0-9 ._/-]{0,299}$/.test(launcher.name ?? "")
        || launcher.name.startsWith("/") || launcher.name.split("/").some((part) => part === "." || part === "..")
        || launcher.bytes !== candidate.stat.size || launcher.sha256 !== digestFile(candidate.resolved)) {
      throw new Error(`${mode} signed launcher does not match its signed index.`);
    }
  }
  if (target === "linux-x64") {
    exactKeys(index.attestations, ["safe", "local_actions"], "Linux launcher attestations");
    for (const [key, file] of [["safe", safeAttestation], ["local_actions", localActionsAttestation]]) {
      const attestation = regularFile(file, `${key} launcher attestation`);
      const record = index.attestations[key];
      exactKeys(record, ["name", "bytes", "sha256"], `${key} launcher attestation index`);
      if (!record.name.startsWith("attestations/") || record.bytes !== attestation.stat.size || record.sha256 !== digestFile(attestation.resolved)) {
        throw new Error(`${key} launcher attestation does not match its signed index.`);
      }
    }
  }
  return index.launchers;
}

export async function runStandaloneCandidateLifecycle({
  target, candidatePackage, safeLauncher, localActionsLauncher, buildReceipt, signedLauncherIndex,
  packageManifest, safeAttestation, localActionsAttestation, ephemeralRoot, cleanupRoot, workspace, output
}) {
  if (!TARGETS.has(target)) throw new Error("Unsupported standalone lifecycle target.");
  const hostTarget = process.platform === "win32" ? "windows-x64"
    : process.platform === "darwin" && process.arch === "arm64" ? "darwin-arm64"
      : process.platform === "linux" && process.arch === "x64" ? "linux-x64" : "unsupported";
  if (target !== hostTarget) throw new Error("Standalone lifecycle target does not match this fresh runner.");
  const ephemeralInput = path.resolve(ephemeralRoot);
  const ephemeralStat = fs.lstatSync(ephemeralInput);
  if (!ephemeralStat.isDirectory() || ephemeralStat.isSymbolicLink()) throw new Error("Ephemeral runner root must be a pre-existing non-symlink directory.");
  const ephemeral = fs.realpathSync(ephemeralInput);
  const cleanupInput = path.resolve(cleanupRoot);
  if (path.dirname(cleanupInput) !== ephemeral || !/^(?:installed|candidate)-[A-Za-z0-9._-]+$/.test(path.basename(cleanupInput))) {
    throw new Error("Cleanup root must be a safely named direct child of the ephemeral runner root.");
  }
  const cleanup = existingBoundedPath(ephemeral, cleanupInput, "Cleanup root", "directory");
  const sandbox = newDirectChild(ephemeral, workspace, "Lifecycle workspace");
  const out = newDirectChild(ephemeral, output, "Lifecycle output");
  const packagePath = existingBoundedPath(ephemeral, candidatePackage, "Candidate package", "file");
  if (within(cleanup, packagePath)) throw new Error("Candidate package must remain outside the removable install root.");
  const packageFile = regularFile(packagePath, "Candidate package");
  const receiptPath = existingBoundedPath(ephemeral, buildReceipt, "Build receipt", "file");
  const receiptFile = regularFile(receiptPath, "Build receipt");
  const receipt = JSON.parse(fs.readFileSync(receiptFile.resolved, "utf8"));
  validateStandaloneBuildReceipt(receipt, target);
  const packageRecord = { name: path.basename(packageFile.resolved), bytes: packageFile.stat.size, sha256: digestFile(packageFile.resolved) };
  const receiptSha256 = digestFile(receiptFile.resolved);
  const indexPath = existingBoundedPath(ephemeral, signedLauncherIndex, "Signed launcher index", "file");
  const indexFile = regularFile(indexPath, "Signed launcher index");
  const manifestPath = existingBoundedPath(ephemeral, packageManifest, "Candidate package manifest", "file");
  const manifestFile = regularFile(manifestPath, "Candidate package manifest");
  const index = JSON.parse(fs.readFileSync(indexFile.resolved, "utf8"));
  const launchers = {
    safe: regularFile(existingBoundedPath(ephemeral, safeLauncher, "Safe signed launcher", "file"), "Safe signed launcher"),
    local_actions: regularFile(existingBoundedPath(ephemeral, localActionsLauncher, "Local-actions signed launcher", "file"), "Local-actions signed launcher")
  };
  const attestations = target === "linux-x64" ? {
    safe: regularFile(existingBoundedPath(ephemeral, safeAttestation, "Safe launcher attestation", "file"), "Safe launcher attestation"),
    local_actions: regularFile(existingBoundedPath(ephemeral, localActionsAttestation, "Local-actions launcher attestation", "file"), "Local-actions launcher attestation")
  } : {};
  const signedLaunchers = validateSignedLauncherIndex(index, {
    target,
    receipt,
    safeLauncher: launchers.safe.resolved,
    localActionsLauncher: launchers.local_actions.resolved,
    safeAttestation: attestations.safe?.resolved,
    localActionsAttestation: attestations.local_actions?.resolved
  });
  const indexSha256 = digestFile(indexFile.resolved);
  const packageManifestSha256 = digestFile(manifestFile.resolved);
  if (within(cleanup, packageFile.resolved) || within(cleanup, out) || within(sandbox, out)
      || !within(cleanup, launchers.safe.resolved) || !within(cleanup, launchers.local_actions.resolved)
      || !within(cleanup, indexFile.resolved) || !within(cleanup, receiptFile.resolved) || !within(cleanup, manifestFile.resolved)
      || launchers.safe.resolved === launchers.local_actions.resolved) {
    throw new Error("Lifecycle paths are not safely isolated.");
  }
  if (target === "linux-x64" && (!within(cleanup, attestations.safe.resolved) || !within(cleanup, attestations.local_actions.resolved))) {
    throw new Error("Linux attestation paths are not safely isolated.");
  }
  verifyCandidatePackageManifest({
    root: cleanup,
    target,
    buildReceipt: receiptFile.resolved,
    signedLauncherIndex: indexFile.resolved,
    manifestFile: manifestFile.resolved
  });
  fs.mkdirSync(sandbox, { recursive: true, mode: 0o700 });
  const cleanupIdentity = captureDirectoryIdentity(cleanup, "Candidate install root");
  const sandboxIdentity = captureDirectoryIdentity(sandbox, "Lifecycle workspace");
  const results = {};
  let cleanupVerified = false;
  let cleanupAllowed = true;
  try {
    for (const [key, definition] of Object.entries(MODES)) {
      const modeRoot = path.join(sandbox, key);
      const isolated = isolatedEnvironment(target, modeRoot);
      const modeIdentity = captureDirectoryIdentity(modeRoot, `${definition.mode} isolated root`);
      const candidate = launchers[key].resolved;
      const run = await runCandidate(candidate, ["--signed-rc-self-test"], isolated.env, isolated.cwd);
      const resultLines = run.stdout.split(/\r?\n/).filter((line) => line.startsWith(RESULT_PREFIX));
      if (resultLines.length !== 1) throw new Error(`${definition.mode} candidate did not emit exactly one lifecycle result.`);
      const result = JSON.parse(resultLines[0].slice(RESULT_PREFIX.length));
      results[key] = validateStandaloneSelfTestResult(result, {
        mode: definition.mode,
        release: { version: receipt.version, commit: receipt.commit }
      });
      const projectStat = fs.lstatSync(isolated.projectRoot);
      if (!projectStat.isDirectory() || projectStat.isSymbolicLink() || !within(modeRoot, isolated.projectRoot)) {
        throw new Error(`${definition.mode} candidate did not use its isolated user-data root.`);
      }
      if (!noExtractionRoots(isolated.temp)) throw new Error(`${definition.mode} candidate left a SEA extraction root.`);
      removeVerifiedTree(ephemeral, modeRoot, modeIdentity, `${definition.mode} isolated root`);
    }
    removeVerifiedTree(ephemeral, cleanup, cleanupIdentity, "Candidate install root");
    removeVerifiedTree(ephemeral, sandbox, sandboxIdentity, "Lifecycle workspace");
    cleanupVerified = true;
  } catch (error) {
    if (error?.cleanupSafe === false) cleanupAllowed = false;
    throw error;
  } finally {
    if (!cleanupVerified && cleanupAllowed) {
      removeVerifiedTree(ephemeral, sandbox, sandboxIdentity, "Lifecycle workspace", { allowMissing: true });
      removeVerifiedTree(ephemeral, cleanup, cleanupIdentity, "Candidate install root", { allowMissing: true });
    }
  }
  const checks = {
    bootstrap_one_time_verified: results.safe.bootstrap_replay_denied === true && results.local_actions.bootstrap_replay_denied === true,
    authenticated_session_verified: results.safe.authenticated_session_verified === true && results.local_actions.authenticated_session_verified === true,
    safe_mode_local_action_denied: results.safe.capability_contract_verified === true,
    local_actions_preflight_verified: results.local_actions.capability_contract_verified === true,
    release_parity_verified: results.safe.exact_release_parity_verified === true && results.local_actions.exact_release_parity_verified === true,
    studio_listening_endpoints_verified: results.safe.expected_studio_listening_endpoints.length === 2 && results.local_actions.expected_studio_listening_endpoints.length === 2,
    unexpected_studio_listening_ports_absent: results.safe.unexpected_studio_listening_endpoints.length === 0 && results.local_actions.unexpected_studio_listening_endpoints.length === 0,
    isolated_user_data_roots_verified: results.safe.isolated_project_root_verified === true && results.local_actions.isolated_project_root_verified === true,
    studio_loopback_services_stopped: results.safe.studio_loopback_services_stopped === true && results.local_actions.studio_loopback_services_stopped === true,
    extraction_cleanup_verified: true,
    install_cleanup_verified: cleanupVerified,
    install_rollback_verified: cleanupVerified
  };
  if (Object.values(checks).some((value) => value !== true)) throw new Error("Lifecycle verification did not satisfy every required check.");
  const record = {
    schema_version: 1,
    target,
    release: { version: receipt.version, commit: receipt.commit, channel: "portable" },
    candidate_package: packageRecord,
    signed_launchers: signedLaunchers,
    build_receipt_sha256: receiptSha256,
    unsigned_asset_index_sha256: receipt.unsigned_asset_index_sha256,
    signed_launcher_index_sha256: indexSha256,
    candidate_package_manifest_sha256: packageManifestSha256,
    modes: results,
    checks
  };
  fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`, { flag: "wx" });
  return record;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMain) {
  try {
    const args = cli(process.argv.slice(2));
    for (const name of [
      "target", "candidate-package", "safe-launcher", "local-actions-launcher", "build-receipt",
      "signed-launcher-index", "package-manifest", "ephemeral-root", "cleanup-root", "workspace", "out"
    ]) {
      if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    if (args.target === "linux-x64") {
      for (const name of ["safe-attestation", "local-actions-attestation"]) if (!args[name]) throw new Error(`Missing --${name}.`);
    }
    const record = await runStandaloneCandidateLifecycle({
      target: args.target,
      candidatePackage: args["candidate-package"],
      safeLauncher: args["safe-launcher"],
      localActionsLauncher: args["local-actions-launcher"],
      buildReceipt: args["build-receipt"],
      signedLauncherIndex: args["signed-launcher-index"],
      packageManifest: args["package-manifest"],
      safeAttestation: args["safe-attestation"],
      localActionsAttestation: args["local-actions-attestation"],
      ephemeralRoot: args["ephemeral-root"],
      cleanupRoot: args["cleanup-root"],
      workspace: args.workspace,
      output: args.out
    });
    console.log(JSON.stringify({ status: "lifecycle-verified", target: record.target, candidate_package_sha256: record.candidate_package.sha256 }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Standalone candidate lifecycle verification failed.");
    process.exitCode = 1;
  }
}
