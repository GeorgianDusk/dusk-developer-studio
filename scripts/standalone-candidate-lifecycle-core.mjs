import { Buffer } from "node:buffer";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

export const STANDALONE_TARGETS = new Set(["windows-x64", "linux-x64", "darwin-arm64"]);
export const STANDALONE_MODES = {
  safe: { mode: "safe", capabilities: false },
  local_actions: { mode: "local-actions", capabilities: true }
};
// The embedded prototype currently emits this legacy protocol marker. It is a
// lifecycle-test marker only; callers must establish trust independently.
export const STANDALONE_LIFECYCLE_RESULT_PREFIX = "DUSK_STUDIO_SIGNED_RC_LIFECYCLE=";
export const digestFile = (file) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function regularFile(file, label) {
  const resolved = path.resolve(file);
  const stat = fs.lstatSync(resolved);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${label} must be a regular non-symlink file.`);
  return { resolved, stat };
}

export function within(root, child) {
  const relative = path.relative(path.resolve(root), path.resolve(child));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function safeLeaf(value, label) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(path.basename(value))) {
    throw new Error(`${label} has an unsafe name.`);
  }
}

export function existingBoundedPath(ephemeralRoot, value, label, kind) {
  const resolved = path.resolve(value);
  if (!within(ephemeralRoot, resolved)) throw new Error(`${label} is outside the ephemeral runner root.`);
  let cursor = ephemeralRoot;
  for (const segment of path.relative(ephemeralRoot, resolved).split(path.sep)) {
    cursor = path.join(cursor, segment);
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error(`${label} contains a symlink or reparse boundary.`);
  }
  const stat = fs.lstatSync(resolved);
  if ((kind === "file" && !stat.isFile()) || (kind === "directory" && !stat.isDirectory())) {
    throw new Error(`${label} has the wrong filesystem type.`);
  }
  return resolved;
}

export function newDirectChild(ephemeralRoot, value, label) {
  const resolved = path.resolve(value);
  if (path.dirname(resolved) !== ephemeralRoot) {
    throw new Error(`${label} must be a direct child of the ephemeral runner root.`);
  }
  safeLeaf(resolved, label);
  if (fs.existsSync(resolved)) throw new Error(`${label} must not already exist.`);
  return resolved;
}

export function exactKeys(value, expected, label) {
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
      || !Array.isArray(value.unexpected_studio_listening_endpoints)
      || value.unexpected_studio_listening_endpoints.length !== 0) {
    throw new Error(`${mode} candidate lifecycle result is invalid.`);
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
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
  }
  return true;
}

function boundedWindowsProbeText(value) {
  return `${value ?? ""}`
    .replace(/\p{Cc}+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 512);
}

function windowsProbeFailure(result, elapsedMs) {
  const category = result.error?.code === "ETIMEDOUT"
    ? "timeout"
    : result.error
      ? "spawn_error"
      : Number.isInteger(result.status)
        ? `exit_${result.status}`
        : "unavailable";
  const details = [
    `category=${category}`,
    `elapsed_ms=${Math.max(0, Math.min(Math.round(elapsedMs), 60_000))}`
  ];
  if (typeof result.signal === "string" && /^[A-Z0-9]+$/.test(result.signal)) {
    details.push(`signal=${result.signal}`);
  }
  const stderr = boundedWindowsProbeText(result.stderr);
  if (stderr) details.push(`stderr=${stderr}`);
  return details.join(", ");
}

function windowsDescendantInventory(rootPid) {
  const powershell = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe"
  );
  const command = [
    "$ErrorActionPreference='Stop'",
    "$rows=@(Get-CimInstance -Query 'SELECT ProcessId, ParentProcessId FROM Win32_Process' -OperationTimeoutSec 45 -ErrorAction Stop | ForEach-Object { [pscustomobject]@{ process_id=[uint32]$_.ProcessId; parent_process_id=[uint32]$_.ParentProcessId } })",
    "$rows | ConvertTo-Json -Compress"
  ].join("; ");
  const startedAt = Date.now();
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 60_000,
      maxBuffer: 1_048_576
    }
  );
  const elapsedMs = Date.now() - startedAt;
  if (result.status !== 0) {
    return { failure: windowsProbeFailure(result, elapsedMs) };
  }
  if (!result.stdout.trim()) {
    return { failure: "category=empty_output" };
  }
  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    if (rows.length === 0 || rows.length > 65_536) {
      return { failure: "category=invalid_row_count" };
    }
    const parentToChildren = new Map();
    const processIds = new Set();
    for (const row of rows) {
      exactKeys(row, ["process_id", "parent_process_id"], "Windows process inventory row");
      if (!Number.isSafeInteger(row.process_id) || row.process_id < 0
          || !Number.isSafeInteger(row.parent_process_id) || row.parent_process_id < 0
          || processIds.has(row.process_id)) {
        return { failure: "category=invalid_row" };
      }
      processIds.add(row.process_id);
      const children = parentToChildren.get(row.parent_process_id) ?? [];
      children.push(row.process_id);
      parentToChildren.set(row.parent_process_id, children);
    }
    const descendants = [];
    const seen = new Set();
    let frontier = [rootPid];
    while (frontier.length !== 0) {
      const next = [];
      for (const parentPid of frontier) {
        for (const childPid of parentToChildren.get(parentPid) ?? []) {
          if (seen.has(childPid)) continue;
          seen.add(childPid);
          descendants.push(childPid);
          next.push(childPid);
        }
      }
      frontier = next;
    }
    return { pids: descendants };
  } catch {
    return { failure: "category=invalid_output" };
  }
}

function windowsDescendantPids(rootPid) {
  return windowsDescendantInventory(rootPid).pids;
}

function windowsProcessExists(pid) {
  const powershell = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32", "WindowsPowerShell", "v1.0", "powershell.exe"
  );
  const command = [
    "$ErrorActionPreference='Stop'",
    `$items=@(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop)`,
    "if($items.Count -eq 0){'false'}elseif($items.Count -eq 1){'true'}else{throw 'Process identifier matched multiple instances.'}"
  ].join("; ");
  const result = spawnSync(
    powershell,
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    { encoding: "utf8", windowsHide: true, timeout: 15_000 }
  );
  if (result.status !== 0) return undefined;
  if (result.stdout.trim() === "true") return true;
  if (result.stdout.trim() === "false") return false;
  return undefined;
}

function waitForWindowsProcessTreeExit(pid, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  while (Date.now() <= deadline) {
    const rootExists = windowsProcessExists(pid);
    const descendants = windowsDescendantPids(pid);
    if (rootExists === undefined || !descendants) return false;
    if (!rootExists && descendants.length === 0) return true;
    Atomics.wait(signal, 0, 0, 50);
  }
  return false;
}

export function forceKillProcessGroup(pid, rejectIfFound = false) {
  if (!pid) return true;
  if (process.platform === "win32") {
    if (rejectIfFound && waitForWindowsProcessTreeExit(pid)) return true;
    const descendants = windowsDescendantPids(pid);
    const rootExists = windowsProcessExists(pid);
    if (!descendants || rootExists === undefined) return false;
    if (!rootExists && !descendants.length) return true;
    if (rootExists) {
      spawnSync("taskkill.exe", ["/pid", String(pid), "/t", "/f"], {
        encoding: "utf8", windowsHide: true, timeout: 15_000
      });
    } else {
      for (const descendant of descendants) {
        spawnSync("taskkill.exe", ["/pid", String(descendant), "/t", "/f"], {
          encoding: "utf8", windowsHide: true, timeout: 15_000
        });
      }
    }
    return waitForWindowsProcessTreeExit(pid) && !rejectIfFound;
  }
  try {
    process.kill(-pid, 0);
  } catch (error) {
    return error?.code === "ESRCH";
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch (error) {
    if (error?.code !== "ESRCH") return false;
  }
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH" && !rejectIfFound;
  }
}

export function runCandidate(candidate, args, env, cwd) {
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
        abort(new Error("Candidate lifecycle output exceeded its bound."));
        return stream;
      }
      return stream + text;
    };
    child.stdout.on("data", (chunk) => { stdout = append(stdout, chunk); });
    child.stderr.on("data", (chunk) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      abort(new Error("Candidate lifecycle self-test timed out."));
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
      if (process.platform === "win32") {
        // The close event proves the exact root handle exited. Re-querying that
        // bare PID can observe WMI lag or a reused PID, so only inventory
        // descendants here. The outer Windows assurance lane independently
        // rejects any process still owned by its one-use standard-user SID.
        const inventory = windowsDescendantInventory(child.pid);
        if (!inventory.pids) {
          const error = new Error(
            `Candidate closed, but Windows descendant inventory was unavailable (${inventory.failure}).`
          );
          error.cleanupSafe = false;
          reject(error);
          return;
        }
        const descendants = inventory.pids;
        if (descendants.length !== 0) {
          const error = new Error("Candidate left a live tracked descendant process.");
          error.cleanupSafe = false;
          reject(error);
          return;
        }
      } else if (!forceKillProcessGroup(child.pid, true)) {
        const error = new Error("Candidate left a live tracked process group or its shutdown could not be confirmed.");
        error.cleanupSafe = false;
        reject(error);
        return;
      }
      if (abortReason) {
        reject(abortReason);
        return;
      }
      if (code !== 0) {
        reject(new Error(`Candidate exited unsuccessfully (${code ?? signal ?? "unknown"}): ${stderr.trim().slice(0, 2_000)}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function expectedProjectRoot(target, modeRoot) {
  if (target === "windows-x64") {
    return path.join(modeRoot, "user-data", "Dusk", "DeveloperStudio", "projects");
  }
  if (target === "darwin-arm64") {
    return path.join(modeRoot, "home", "Library", "Application Support", "Dusk", "DeveloperStudio", "projects");
  }
  return path.join(modeRoot, "user-data", "dusk", "developer-studio", "projects");
}

export function isolatedEnvironment(target, modeRoot) {
  const temp = path.join(modeRoot, "temp");
  const home = path.join(modeRoot, "home");
  const data = path.join(modeRoot, "user-data");
  for (const directory of [temp, home, data]) fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const env = {};
  const inherited = new Map(Object.entries(process.env).map(([key, value]) => [key.toLowerCase(), [key, value]]));
  for (const name of [
    "PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "SystemDrive", "LANG", "LC_ALL", "TZ"
  ]) {
    const entry = inherited.get(name.toLowerCase());
    if (entry?.[1]) env[entry[0]] = entry[1];
  }
  const pathEntry = inherited.get("path");
  if (pathEntry?.[1]) {
    const absoluteSegments = pathEntry[1].split(path.delimiter)
      .filter((segment) => segment && path.isAbsolute(segment));
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

export function noExtractionRoots(temp) {
  return !fs.readdirSync(temp, { withFileTypes: true })
    .some((entry) => entry.isDirectory() && entry.name.startsWith("dusk-studio-sea-"));
}

export function captureDirectoryIdentity(directory, label) {
  const stat = fs.lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(`${label} is not a regular directory.`);
  return { realpath: fs.realpathSync(directory), dev: String(stat.dev), ino: String(stat.ino) };
}

export function removeVerifiedTree(ephemeralRoot, directory, identity, label, { allowMissing = false } = {}) {
  if (!fs.existsSync(directory)) {
    if (allowMissing) return;
    throw new Error(`${label} disappeared before verified cleanup.`);
  }
  const bounded = existingBoundedPath(ephemeralRoot, directory, label, "directory");
  const observed = captureDirectoryIdentity(bounded, label);
  if (observed.realpath !== identity.realpath
      || observed.dev !== identity.dev
      || observed.ino !== identity.ino) {
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
      if (stat.isSymbolicLink()) {
        throw new Error(`${label} contains a symlink or reparse entry and will not be recursively removed.`);
      }
      if (stat.isDirectory()) pending.push(child);
      else if (!stat.isFile()) throw new Error(`${label} contains a non-regular entry and will not be recursively removed.`);
    }
  }
  fs.rmSync(bounded, { recursive: true, force: false });
  if (fs.existsSync(bounded)) throw new Error(`${label} verified cleanup failed.`);
}
