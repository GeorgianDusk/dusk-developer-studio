import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  buildCanonicalAgentPilotPlan,
  canonicalSha256,
  canonicalPilotRecoveryMarker,
  validatePilotPlan
} from "./agent-pilot-collector.mjs";

const scriptFile = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptFile), "..");
const defaultPolicyPath = path.join(productRoot, "config", "phase5-policy.json");

const MAX_POLICY_BYTES = 256 * 1024;
const MAX_PLAN_BYTES = 256 * 1024;
const MAX_CHILD_OUTPUT_BYTES = 256 * 1024;
const CHILD_TIMEOUT_MS = 6 * 60 * 1_000;
const SHA256_RE = /^[a-f0-9]{64}$/u;
const COMMIT_RE = /^[a-f0-9]{40}$/u;
const SRI_SHA512_RE = /^sha512-[A-Za-z0-9+/]{80,}={0,2}$/u;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
const SAFE_RELATIVE_PATH_RE = /^[a-zA-Z0-9._/-]+$/u;
const SCENARIO_KEYS = [
  "id",
  "context",
  "experience",
  "capability",
  "execution_surface",
  "failure_class"
];
const CANDIDATE_KEYS = [
  "package_name",
  "package_version",
  "package_commit",
  "tarball_sha256",
  "npm_integrity",
  "package_inventory_sha256",
  "candidate_artifact_fingerprint_sha256"
];
const EXPECTED_SCENARIOS = new Set([
  "win-safe-boundary",
  "win-keyboard-recovery",
  "win-containment-recovery",
  "win-overwrite-refusal",
  "wsl-managed-root-recovery",
  "wsl-native-toolchain-recovery",
  "linux-port-conflict-recovery",
  "macos-privilege-recovery"
]);

function exactKeys(value, keys) {
  return Boolean(value)
    && typeof value === "object"
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizedRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > 512
    || value.includes("\\")
    || value.includes("\0")
    || !SAFE_RELATIVE_PATH_RE.test(value)
    || path.posix.isAbsolute(value)
  ) {
    throw new Error(`${label} must be a safe workspace-relative POSIX path.`);
  }
  const normalized = path.posix.normalize(value);
  if (
    normalized !== value
    || normalized === "."
    || normalized.startsWith("../")
    || value.split("/").some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new Error(`${label} must be a normalized workspace-relative path.`);
  }
  return value;
}

function resolveWorkspacePath(relative, expectedPrefix) {
  normalizedRelativePath(relative, "Pilot exercise path");
  if (relative !== expectedPrefix && !relative.startsWith(`${expectedPrefix}/`)) {
    throw new Error("Pilot exercise path is outside its fixed workspace prefix.");
  }
  const absolute = path.resolve(process.cwd(), ...relative.split("/"));
  const difference = path.relative(process.cwd(), absolute);
  if (difference.startsWith("..") || path.isAbsolute(difference)) {
    throw new Error("Pilot exercise path escaped its workspace.");
  }
  return absolute;
}

async function ensureWorkspaceDirectory(relative, createMissing) {
  normalizedRelativePath(relative, "Pilot workspace directory");
  let current = process.cwd();
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error?.code !== "ENOENT" || !createMissing) throw error;
      await fs.mkdir(current);
      stat = await fs.lstat(current);
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error("Pilot workspace directory chain contains an unsafe entry.");
    }
  }
  return current;
}

function exactScenario(policy, scenarioId) {
  if (!SAFE_ID_RE.test(scenarioId ?? "") || !EXPECTED_SCENARIOS.has(scenarioId)) {
    throw new Error("Pilot plan scenario id is not one of the eight reviewed scenarios.");
  }
  const scenarios = policy?.pilot?.required_scenarios;
  if (
    !Array.isArray(scenarios)
    || scenarios.length !== EXPECTED_SCENARIOS.size
    || new Set(scenarios.map((scenario) => scenario?.id)).size !== EXPECTED_SCENARIOS.size
    || new Set(scenarios.map((scenario) => scenario?.capability)).size !== EXPECTED_SCENARIOS.size
    || new Set(scenarios.map((scenario) => scenario?.failure_class)).size !== EXPECTED_SCENARIOS.size
    || scenarios.some((scenario) =>
      !exactKeys(scenario, SCENARIO_KEYS)
      || !EXPECTED_SCENARIOS.has(scenario.id)
      || !SAFE_ID_RE.test(scenario.failure_class ?? "")
    )
  ) {
    throw new Error("Phase 5 policy must define the exact eight reviewed pilot scenarios.");
  }
  const matches = scenarios.filter((scenario) => scenario.id === scenarioId);
  if (matches.length !== 1) {
    throw new Error("Pilot plan must select exactly one reviewed scenario.");
  }
  return matches[0];
}

function validateCandidate(policy, candidate) {
  if (!exactKeys(candidate, CANDIDATE_KEYS)) {
    throw new Error("Pilot candidate has unexpected or missing fields.");
  }
  if (
    candidate.package_name !== policy?.npm_distribution?.package_name
    || candidate.package_version !== policy?.npm_distribution?.package_version
    || !COMMIT_RE.test(candidate.package_commit ?? "")
    || !SHA256_RE.test(candidate.tarball_sha256 ?? "")
    || !SRI_SHA512_RE.test(candidate.npm_integrity ?? "")
    || !SHA256_RE.test(candidate.package_inventory_sha256 ?? "")
    || !SHA256_RE.test(candidate.candidate_artifact_fingerprint_sha256 ?? "")
  ) {
    throw new Error("Pilot candidate identity, commit, or artifact digests are invalid.");
  }
  return { ...candidate };
}

export function recoveryMarker(scenario) {
  return canonicalPilotRecoveryMarker(scenario);
}

export function materializeAgentPilotPlan(policy, scenarioId, candidateInput) {
  exactScenario(policy, scenarioId);
  const candidate = validateCandidate(policy, candidateInput);
  const plan = buildCanonicalAgentPilotPlan(policy, scenarioId, candidate);
  validatePilotPlan(policy, plan);
  const serialized = JSON.stringify(plan);
  if (Buffer.byteLength(serialized) > MAX_PLAN_BYTES) {
    throw new Error("Materialized pilot plan exceeds its fixed byte bound.");
  }
  return plan;
}

async function readBoundedJson(file, maximumBytes, label) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size <= 0 || stat.size > maximumBytes) {
    throw new Error(`${label} must be a bounded regular JSON file.`);
  }
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function boundedEnvironment(overrides = {}) {
  const allowed = new Set([
    "PATH",
    "Path",
    "PATHEXT",
    "SystemRoot",
    "WINDIR",
    "ComSpec",
    "TEMP",
    "TMP",
    "HOME",
    "USERPROFILE",
    "LOCALAPPDATA",
    "APPDATA",
    "ProgramFiles",
    "ProgramFiles(x86)",
    "WSL_DISTRO_NAME",
    "LANG",
    "LC_ALL",
    "TERM",
    "RUSTUP_HOME",
    "CARGO_HOME"
  ]);
  const environment = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (allowed.has(key) && typeof value === "string") environment[key] = value;
  }
  return { ...environment, CI: "1", NO_COLOR: "1", ...overrides };
}

function runBounded(file, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: boundedEnvironment(options.env),
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const output = { stdout: [], stderr: [], stdoutBytes: 0, stderrBytes: 0 };
    let exceeded = false;
    let timedOut = false;
    const collect = (kind, chunk) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const byteKey = `${kind}Bytes`;
      output[byteKey] += bytes.byteLength;
      if (output.stdoutBytes + output.stderrBytes > MAX_CHILD_OUTPUT_BYTES) {
        exceeded = true;
        child.kill("SIGKILL");
        return;
      }
      output[kind].push(bytes);
    };
    child.stdout.on("data", (chunk) => collect("stdout", chunk));
    child.stderr.on("data", (chunk) => collect("stderr", chunk));
    child.once("error", reject);
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, options.timeoutMs ?? CHILD_TIMEOUT_MS);
    child.once("close", (status, signal) => {
      clearTimeout(timeout);
      if (exceeded) {
        reject(new Error("Pilot child process exceeded its output bound."));
        return;
      }
      if (timedOut) {
        reject(new Error("Pilot child process exceeded its time bound."));
        return;
      }
      resolve({
        status,
        signal,
        stdout: Buffer.concat(output.stdout).toString("utf8"),
        stderr: Buffer.concat(output.stderr).toString("utf8")
      });
    });
  });
}

function exactCli(packageRoot) {
  return path.join(packageRoot, "bin", "dusk-developer-studio.mjs");
}

async function runStudioCli(packageRoot, args, workRoot, environment = {}) {
  return runBounded(process.execPath, [exactCli(packageRoot), ...args], {
    cwd: workRoot,
    env: environment
  });
}

function successfulLifecycle(result, mode) {
  if (result.status !== 0 || result.signal !== null) return false;
  const prefix = "DUSK_STUDIO_LIFECYCLE=";
  const lines = result.stdout.split(/\r?\n/u).filter((line) => line.startsWith(prefix));
  if (lines.length !== 1) return false;
  try {
    const receipt = JSON.parse(lines[0].slice(prefix.length));
    return receipt.schema_version === 2
      && receipt.mode === mode
      && receipt.capability_contract_verified === true
      && receipt.shutdown_smoke === "passed"
      && receipt.studio_loopback_services_stopped === true
      && (mode === "safe"
        ? receipt.local_actions_scaffold_smoke === "not-applicable"
        : receipt.local_actions_scaffold_smoke === "passed");
  } catch {
    return false;
  }
}

function httpRequest(options, body = "") {
  return new Promise((resolve, reject) => {
    const request = http.request({ ...options, timeout: 10_000 }, (response) => {
      const chunks = [];
      let bytes = 0;
      response.on("data", (chunk) => {
        const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += value.byteLength;
        if (bytes <= 64 * 1024) chunks.push(value);
      });
      response.on("end", () => {
        if (bytes > 64 * 1024) {
          reject(new Error("Pilot HTTP response exceeded its bound."));
          return;
        }
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.once("timeout", () => request.destroy(new Error("Pilot HTTP request timed out.")));
    request.once("error", reject);
    request.end(body);
  });
}

async function bootstrapRuntimeSession() {
  const origin = "http://127.0.0.1:5173";
  const bootstrap = await httpRequest({
    host: "127.0.0.1",
    port: 5173,
    path: "/__dusk/bootstrap",
    method: "POST",
    headers: {
      host: "127.0.0.1:5173",
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "content-length": "2"
    }
  }, "{}");
  const setCookie = bootstrap.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "";
  if (bootstrap.status !== 200 || !cookie.startsWith("dusk_studio_session=")) {
    throw new Error("Exact candidate bootstrap did not establish the bounded pilot session.");
  }
  return { origin, cookie };
}

export function isSafeModeMachineActionRefusal(response) {
  if (response?.status !== 403 || typeof response.body !== "string") return false;
  try {
    const body = JSON.parse(response.body);
    return body?.ok === false && body.code === "capabilities_disabled";
  } catch {
    return false;
  }
}

export function isExpectedToolchainMismatch(result) {
  return result?.status !== 0
    && result?.signal === null
    && /(?:toolchain|override|not installed|not found|unrecognized)/iu.test(
      `${result.stderr ?? ""}\n${result.stdout ?? ""}`
    );
}

async function observeSafeModeMachineActionRefusal(packageRoot, workRoot) {
  const runtimeModule = await import(pathToFileURL(path.join(packageRoot, "app", "runtime.mjs")));
  let runtime;
  try {
    runtime = await runtimeModule.startLocalRuntime({
      packageRoot,
      capabilitiesEnabled: false,
      openBrowser: false,
      projectRoot: path.join(workRoot, "safe-boundary")
    });
    const { origin, cookie } = await bootstrapRuntimeSession();
    const response = await httpRequest({
      host: "127.0.0.1",
      port: 8788,
      path: "/preflight?path=duskds",
      method: "GET",
      headers: {
        host: "127.0.0.1:8788",
        origin,
        cookie
      }
    });
    return isSafeModeMachineActionRefusal(response);
  } finally {
    if (runtime) await runtime.shutdown();
  }
}

async function launchPilotBrowser() {
  const playwright = await import("playwright");
  for (const options of [{ headless: true }, { headless: true, channel: "chrome" }]) {
    try {
      return await playwright.chromium.launch(options);
    } catch {
      // Try the installed Chrome channel only when the repository-managed
      // Chromium binary is unavailable.
    }
  }
  throw new Error("A Playwright-controlled Chromium or Chrome browser is required.");
}

async function runKeyboardBrowserFlow(packageRoot, workRoot, phase) {
  const runtimeModule = await import(pathToFileURL(path.join(packageRoot, "app", "runtime.mjs")));
  let runtime;
  let browser;
  try {
    runtime = await runtimeModule.startLocalRuntime({
      packageRoot,
      capabilitiesEnabled: false,
      openBrowser: false,
      projectRoot: path.join(workRoot, `browser-${phase}`)
    });
    browser = await launchPilotBrowser();
    const context = await browser.newContext({
      reducedMotion: "reduce",
      viewport: { width: 1280, height: 900 }
    });
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:5173/", {
      waitUntil: "networkidle",
      timeout: 30_000
    });
    await page.keyboard.press("Tab");
    const skipLink = page.getByRole("link", { name: "Skip to main content" });
    if (!await skipLink.evaluate(
      (element) => element === element.ownerDocument.activeElement
    )) return false;
    await page.keyboard.press("Enter");
    const main = page.locator("main#studio-main");
    if (!await main.evaluate(
      (element) => element === element.ownerDocument.activeElement
    )) return false;
    const duskDsPath = page.getByRole("button", { name: /Start DuskDS/iu });
    await duskDsPath.focus();
    const transitionDuration = await duskDsPath.evaluate(
      (element) => Number.parseFloat(
        element.ownerDocument.defaultView?.getComputedStyle(element).transitionDuration ?? "NaN"
      )
    );
    if (!Number.isFinite(transitionDuration) || transitionDuration > 0.00001) return false;
    await page.keyboard.press("Enter");
    await page.waitForURL(/#setup$/u, { timeout: 10_000 });
    const setupHeading = page.getByRole("heading", {
      name: "Record the native toolchain checks you ran."
    });
    if (!await setupHeading.evaluate(
      (element) => element === element.ownerDocument.activeElement
    )) return false;
    const referenceButton = page.getByRole("button", { name: "Reference", exact: true });
    await referenceButton.focus();
    await page.keyboard.press("Enter");
    await page.waitForURL(/#reference$/u, { timeout: 10_000 });
    const search = page.getByPlaceholder(/Search docs, capabilities/iu);
    await search.focus();
    if (phase === "controlled-failure") {
      await page.keyboard.type("agent-pilot-deliberate-empty-query");
      await page.getByText("No reviewed reference matches this search and scope.").waitFor({
        state: "visible",
        timeout: 10_000
      });
      const clear = page.getByRole("button", { name: "Clear search", exact: true });
      if (!await clear.isVisible()) return false;
    } else {
      await page.keyboard.type("agent-pilot-deliberate-empty-query");
      await page.getByText("No reviewed reference matches this search and scope.").waitFor({
        state: "visible",
        timeout: 10_000
      });
      const clear = page.getByRole("button", { name: "Clear search", exact: true });
      await clear.waitFor({ state: "visible", timeout: 10_000 });
      await clear.focus();
      await page.keyboard.press("Enter");
      if (await search.inputValue() !== "") return false;
      if (!await search.evaluate(
        (element) => element === element.ownerDocument.activeElement
      )) return false;
      await page.keyboard.type("Hedger");
      const broaden = page.getByRole("button", {
        name: "Search all references",
        exact: true
      });
      await broaden.waitFor({ state: "visible", timeout: 10_000 });
      await broaden.focus();
      await page.keyboard.press("Enter");
      await page.getByText("Hedger Confidential EVM Route Mention", { exact: true }).waitFor({
        state: "visible",
        timeout: 10_000
      });
      if (!await search.evaluate(
        (element) => element === element.ownerDocument.activeElement
      )) return false;
      const announcement = page.getByText(
        "Search expanded to all reviewed references. Results updated.",
        { exact: true }
      );
      if (!await announcement.isVisible()) return false;
    }
    const screenshot = await page.screenshot({ type: "png", animations: "disabled" });
    if (!Buffer.isBuffer(screenshot) || screenshot.byteLength <= 0 || screenshot.byteLength > 5 * 1024 * 1024) {
      return false;
    }
    process.stdout.write(`browser_screenshot_sha256=${sha256(screenshot)}\n`);
    await context.close();
    return true;
  } finally {
    if (browser) await browser.close();
    if (runtime) await runtime.shutdown();
  }
}

async function containmentRequest(packageRoot, workRoot, parentDir) {
  const runtimeModule = await import(pathToFileURL(path.join(packageRoot, "app", "runtime.mjs")));
  const managedRoot = path.join(workRoot, "managed");
  const previousConfiguredRoot = process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT;
  process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT = path.join(managedRoot, "duskds");
  let runtime;
  try {
    runtime = await runtimeModule.startLocalRuntime({
      packageRoot,
      capabilitiesEnabled: true,
      openBrowser: false,
      projectRoot: managedRoot
    });
    const { origin, cookie } = await bootstrapRuntimeSession();
    const requestBody = JSON.stringify({
      projectName: "containment-counter",
      ...(parentDir === undefined ? {} : { parentDir })
    });
    return await httpRequest({
      host: "127.0.0.1",
      port: 8788,
      path: "/scaffold-duskds-forge",
      method: "POST",
      headers: {
        host: "127.0.0.1:8788",
        origin,
        cookie,
        "content-type": "application/json",
        "content-length": String(Buffer.byteLength(requestBody))
      }
    }, requestBody);
  } finally {
    if (runtime) await runtime.shutdown();
    if (previousConfiguredRoot === undefined) {
      delete process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT;
    } else {
      process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT = previousConfiguredRoot;
    }
  }
}

async function observePortConflict(packageRoot, workRoot) {
  const blocker = net.createServer();
  await new Promise((resolve, reject) => {
    blocker.once("error", reject);
    blocker.listen(5173, "127.0.0.1", resolve);
  });
  try {
    const result = await runStudioCli(
      packageRoot,
      ["--lifecycle-self-test", "--no-open"],
      workRoot
    );
    return result.status !== 0
      && /(?:EADDRINUSE|address already in use)/iu.test(`${result.stderr}\n${result.stdout}`);
  } finally {
    await new Promise((resolve) => blocker.close(resolve));
  }
}

async function observeControlledFailure(scenario, packageRoot, workRoot) {
  if (scenario.id === "win-safe-boundary") {
    return observeSafeModeMachineActionRefusal(packageRoot, workRoot);
  }
  if (scenario.id === "win-keyboard-recovery") {
    return runKeyboardBrowserFlow(packageRoot, workRoot, "controlled-failure");
  }
  if (scenario.id === "win-containment-recovery") {
    const response = await containmentRequest(packageRoot, workRoot, "../..");
    const body = JSON.parse(response.body);
    return response.status === 422 && body.code === "scaffold_parent_outside_root";
  }
  if (scenario.id === "win-overwrite-refusal") {
    const result = await runStudioCli(
      packageRoot,
      ["create-duskds", "existing-counter"],
      workRoot
    );
    return result.status !== 0
      && /(?:existing target|already exists)/iu.test(`${result.stderr}\n${result.stdout}`);
  }
  if (scenario.id === "wsl-managed-root-recovery") {
    const result = await runStudioCli(
      packageRoot,
      ["local-actions", "--lifecycle-self-test", "--no-open"],
      workRoot,
      { DUSK_STUDIO_DUSKDS_PROJECT_ROOT: path.parse(workRoot).root }
    );
    return result.status !== 0
      && /cannot be a filesystem root/iu.test(`${result.stderr}\n${result.stdout}`);
  }
  if (scenario.id === "wsl-native-toolchain-recovery") {
    const result = await runBounded("cargo", [
      "+dusk-pilot-missing-toolchain",
      "check",
      "--locked"
    ], {
      cwd: path.join(workRoot, "native-toolchain-counter")
    });
    return isExpectedToolchainMismatch(result);
  }
  if (scenario.id === "linux-port-conflict-recovery") {
    return observePortConflict(packageRoot, workRoot);
  }
  if (scenario.id === "macos-privilege-recovery") {
    const result = await runBounded(
      "sudo",
      ["-n", process.execPath, exactCli(packageRoot), "--lifecycle-self-test", "--no-open"],
      { cwd: workRoot }
    );
    return result.status !== 0
      && /Dusk Developer Studio refuses elevated or root execution\./u.test(
        `${result.stderr}\n${result.stdout}`
      );
  }
  return false;
}

async function runRecovery(scenario, packageRoot, workRoot) {
  if (scenario.id === "win-safe-boundary") {
    const result = await runStudioCli(
      packageRoot,
      ["local-actions", "--lifecycle-self-test", "--no-open"],
      workRoot
    );
    if (!successfulLifecycle(result, "local-actions")) {
      throw new Error("Local Actions recovery did not complete.");
    }
    return;
  }
  if (scenario.id === "win-keyboard-recovery") {
    if (!await runKeyboardBrowserFlow(packageRoot, workRoot, "recovery")) {
      throw new Error("Keyboard, reduced-motion, search, or focus recovery did not complete.");
    }
    return;
  }
  if (scenario.id === "win-containment-recovery") {
    const response = await containmentRequest(packageRoot, workRoot);
    const body = JSON.parse(response.body);
    if (
      response.status !== 200
      || body.ok !== true
      || body.projectName !== "containment-counter"
      || body.structureVerified !== true
    ) {
      throw new Error("Contained Local Actions scaffold recovery did not complete.");
    }
    return;
  }
  if (scenario.id === "win-overwrite-refusal") {
    const result = await runStudioCli(
      packageRoot,
      ["create-duskds", "recovered-counter"],
      workRoot
    );
    if (result.status !== 0 || result.signal !== null) {
      throw new Error("Fresh-target scaffold recovery did not complete.");
    }
    return;
  }
  if (scenario.id === "wsl-managed-root-recovery") {
    const safeRoot = path.join(workRoot, "managed-root", "duskds");
    const result = await runStudioCli(
      packageRoot,
      ["local-actions", "--lifecycle-self-test", "--no-open"],
      workRoot,
      { DUSK_STUDIO_DUSKDS_PROJECT_ROOT: safeRoot }
    );
    if (!successfulLifecycle(result, "local-actions")) {
      throw new Error("Managed-root recovery did not complete.");
    }
    return;
  }
  if (scenario.id === "wsl-native-toolchain-recovery") {
    const projectRoot = path.join(workRoot, "native-toolchain-counter");
    const rustc = await runBounded("rustc", ["+1.94.0", "--version"], {
      cwd: projectRoot
    });
    if (
      rustc.status !== 0
      || !/^rustc 1[.]94[.]0\b/u.test(rustc.stdout)
    ) {
      throw new Error("Pinned native DuskDS toolchain recovery did not complete.");
    }
    for (const args of [
      ["+1.94.0", "check", "--locked"],
      ["+1.94.0", "test", "--locked", "--release"]
    ]) {
      const result = await runBounded("cargo", args, { cwd: projectRoot });
      if (result.status !== 0 || result.signal !== null) {
        throw new Error("Exact-candidate native DuskDS check or test did not complete.");
      }
    }
    return;
  }
  if (scenario.id === "linux-port-conflict-recovery") {
    const result = await runStudioCli(
      packageRoot,
      ["--lifecycle-self-test", "--no-open"],
      workRoot
    );
    if (!successfulLifecycle(result, "safe")) {
      throw new Error("Loopback port release recovery did not complete.");
    }
    return;
  }
  if (scenario.id === "macos-privilege-recovery") {
    const result = await runStudioCli(
      packageRoot,
      ["--lifecycle-self-test", "--no-open"],
      workRoot
    );
    if (!successfulLifecycle(result, "safe")) {
      throw new Error("Standard-user launch recovery did not complete.");
    }
    return;
  }
  throw new Error("Pilot recovery scenario is unsupported.");
}

async function prepareExercise(scenario, packageRoot, workRoot) {
  const packageManifest = await readBoundedJson(
    path.join(packageRoot, "package.json"),
    64 * 1024,
    "Exact candidate package manifest"
  );
  if (packageManifest.name !== "dusk-developer-studio") {
    throw new Error("Pilot package root is not the exact Dusk Developer Studio candidate.");
  }
  const sentinel = path.join(workRoot, ".pilot-owned");
  let workStat = null;
  try {
    workStat = await fs.lstat(workRoot);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (workStat) {
    if (!workStat.isDirectory() || workStat.isSymbolicLink()) {
      throw new Error("Existing pilot workspace is not a real directory.");
    }
    let existing;
    try {
      existing = await fs.readFile(sentinel, "utf8");
    } catch {
      throw new Error("Existing pilot workspace has no valid ownership sentinel.");
    }
    if (existing !== `${scenario.id}\n`) {
      throw new Error("Existing pilot workspace does not carry the expected ownership sentinel.");
    }
    await fs.rm(workRoot, { recursive: true, force: true });
  }
  await fs.mkdir(workRoot, { recursive: true });
  await fs.writeFile(sentinel, `${scenario.id}\n`, { encoding: "utf8", flag: "wx" });
  if (scenario.id === "win-overwrite-refusal") {
    const result = await runStudioCli(
      packageRoot,
      ["create-duskds", "existing-counter"],
      workRoot
    );
    if (result.status !== 0 || result.signal !== null) {
      throw new Error("Overwrite pilot could not prepare its exact existing target.");
    }
  }
  if (scenario.id === "wsl-native-toolchain-recovery") {
    const result = await runStudioCli(
      packageRoot,
      ["create-duskds", "native-toolchain-counter"],
      workRoot
    );
    if (result.status !== 0 || result.signal !== null) {
      throw new Error("Native-toolchain pilot could not scaffold the exact candidate starter.");
    }
  }
}

async function runExerciseCli(options) {
  const policy = await readBoundedJson(defaultPolicyPath, MAX_POLICY_BYTES, "Phase 5 policy");
  const scenario = exactScenario(policy, options.scenarioId);
  const expectedPackageRoot = "output/pilots/package";
  const expectedWorkRoot = `output/pilots/work/${scenario.id}`;
  if (options.packageRoot !== expectedPackageRoot || options.workRoot !== expectedWorkRoot) {
    throw new Error("Pilot exercise roots do not match the deterministic plan.");
  }
  const packageRoot = resolveWorkspacePath(options.packageRoot, expectedPackageRoot);
  const workRoot = resolveWorkspacePath(options.workRoot, expectedWorkRoot);
  await ensureWorkspaceDirectory(options.packageRoot, false);
  await ensureWorkspaceDirectory(path.posix.dirname(options.workRoot), true);
  if (options.phase === "prepare") {
    await prepareExercise(scenario, packageRoot, workRoot);
    process.stdout.write(`prepared=${scenario.id}\n`);
    return;
  }
  const sentinel = await fs.readFile(path.join(workRoot, ".pilot-owned"), "utf8");
  if (sentinel !== `${scenario.id}\n`) {
    throw new Error("Pilot exercise ownership sentinel is invalid.");
  }
  if (options.phase === "controlled-failure") {
    let observed = false;
    try {
      observed = await observeControlledFailure(scenario, packageRoot, workRoot);
    } catch {
      observed = false;
    }
    if (observed) {
      process.stderr.write(`controlled_failure=${scenario.failure_class}\n`);
      process.exitCode = 47;
    } else {
      process.stdout.write("controlled_failure_not_observed=true\n");
      process.exitCode = 0;
    }
    return;
  }
  if (options.phase === "recovery") {
    await runRecovery(scenario, packageRoot, workRoot);
    await fs.writeFile(
      path.join(workRoot, "recovered.txt"),
      recoveryMarker(scenario),
      { encoding: "utf8", flag: "wx" }
    );
    process.stdout.write(`recovered=${scenario.id}\n`);
    return;
  }
  throw new Error("Pilot exercise phase is unsupported.");
}

function parsePairs(argumentsList, allowed) {
  if (argumentsList.length === 0 || argumentsList.length % 2 !== 0) {
    throw new Error("Agent pilot plan arguments are incomplete.");
  }
  const parsed = {};
  for (let index = 0; index < argumentsList.length; index += 2) {
    const key = argumentsList[index];
    const value = argumentsList[index + 1];
    if (!allowed.has(key) || typeof value !== "string" || value.length === 0 || Object.hasOwn(parsed, key)) {
      throw new Error("Agent pilot plan argument is missing, duplicated, or unsupported.");
    }
    parsed[key] = value;
  }
  return parsed;
}

async function materializeCli(argumentsList) {
  const allowed = new Set([
    "--scenario",
    "--package-name",
    "--package-version",
    "--package-commit",
    "--tarball-sha256",
    "--npm-integrity",
    "--package-inventory-sha256",
    "--phase5-fingerprint-sha256",
    "--output",
    "--policy"
  ]);
  const parsed = parsePairs(argumentsList, allowed);
  for (const required of [
    "--scenario",
    "--package-name",
    "--package-version",
    "--package-commit",
    "--tarball-sha256",
    "--npm-integrity",
    "--package-inventory-sha256",
    "--phase5-fingerprint-sha256",
    "--output"
  ]) {
    if (!parsed[required]) throw new Error(`Agent pilot plan is missing ${required}.`);
  }
  const policyPath = parsed["--policy"]
    ? resolveWorkspacePath(parsed["--policy"], "config")
    : defaultPolicyPath;
  const policy = await readBoundedJson(policyPath, MAX_POLICY_BYTES, "Phase 5 policy");
  const plan = materializeAgentPilotPlan(policy, parsed["--scenario"], {
    package_name: parsed["--package-name"],
    package_version: parsed["--package-version"],
    package_commit: parsed["--package-commit"],
    tarball_sha256: parsed["--tarball-sha256"],
    npm_integrity: parsed["--npm-integrity"],
    package_inventory_sha256: parsed["--package-inventory-sha256"],
    candidate_artifact_fingerprint_sha256: parsed["--phase5-fingerprint-sha256"]
  });
  const expectedOutput = `output/pilots/plans/${plan.scenario_id}.json`;
  if (parsed["--output"] !== expectedOutput) {
    throw new Error("Pilot plan output must use its deterministic scenario path.");
  }
  const outputPath = resolveWorkspacePath(parsed["--output"], expectedOutput);
  await ensureWorkspaceDirectory(path.posix.dirname(parsed["--output"]), true);
  const output = `${JSON.stringify(plan, null, 2)}\n`;
  if (Buffer.byteLength(output) > MAX_PLAN_BYTES) {
    throw new Error("Formatted pilot plan exceeds its fixed byte bound.");
  }
  await fs.writeFile(outputPath, output, { encoding: "utf8", flag: "wx" });
  process.stdout.write(`${JSON.stringify({
    status: "materialized",
    scenario_id: plan.scenario_id,
    plan_sha256: canonicalSha256(plan)
  })}\n`);
}

async function main() {
  if (process.argv[2] === "--exercise-scenario") {
    const parsed = parsePairs(
      process.argv.slice(2),
      new Set(["--exercise-scenario", "--phase", "--package-root", "--work-root"])
    );
    for (const required of ["--exercise-scenario", "--phase", "--package-root", "--work-root"]) {
      if (!parsed[required]) throw new Error(`Agent pilot exercise is missing ${required}.`);
    }
    await runExerciseCli({
      scenarioId: parsed["--exercise-scenario"],
      phase: parsed["--phase"],
      packageRoot: parsed["--package-root"],
      workRoot: parsed["--work-root"]
    });
    return;
  }
  await materializeCli(process.argv.slice(2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptFile) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown agent pilot plan failure.";
    process.stderr.write(`Agent pilot plan failed: ${message.slice(0, 1_000)}\n`);
    process.exitCode = 1;
  });
}
