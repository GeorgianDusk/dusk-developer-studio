import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";
import { chromium } from "playwright";
import {
  createRequestTerminalTracker,
  validatePairingTransportEvidence
} from "./npm-package-browser-telemetry.mjs";
import {
  npmPackageName,
  npmPackageVersion,
  resolveNpmCli,
  runFile,
  verifyBuiltNpmPackage,
  writeJson
} from "./npm-package-core.mjs";
import {
  PREFLIGHT_CHECK_ID,
  validatePreflightConsumerContract
} from "./npm-package-preflight-smoke.mjs";

const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const START_TIMEOUT_MS = 30_000;
const BROWSER_TIMEOUT_MS = 20_000;
const PREFLIGHT_TIMEOUT_MS = 130_000;
const PREFLIGHT_CONSUMER_SOURCE = path.join(
  import.meta.dirname,
  "..",
  "apps",
  "studio",
  "src",
  "app",
  "responseSchemas.ts"
);
const allowedArguments = new Set(["--tarball", "--receipt"]);
const argumentsByName = new Map();
for (const argument of process.argv.slice(2)) {
  const separator = argument.indexOf("=");
  const name = separator > 0 ? argument.slice(0, separator) : argument;
  const value = separator > 0 ? argument.slice(separator + 1) : "";
  if (!allowedArguments.has(name) || !value || argumentsByName.has(name)) {
    throw new Error(`Unsupported browser-smoke argument: ${argument}.`);
  }
  argumentsByName.set(name, value);
}
if (!argumentsByName.has("--tarball")) {
  throw new Error("Usage: node scripts/npm-package-browser-smoke.mjs --tarball=<tgz> [--receipt=<json>]");
}

function boundedAppend(current, chunk) {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) > MAX_PROCESS_OUTPUT_BYTES) {
    throw new Error("Local Studio browser-smoke process output exceeded its bound.");
  }
  return next;
}

function assertPortClosed(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(5_000);
    socket.once("connect", () => {
      socket.destroy();
      reject(new Error(`Exact-package smoke found unexpected listener on 127.0.0.1:${port}.`));
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Exact-package smoke could not prove 127.0.0.1:${port} is closed.`));
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve();
      else reject(error);
    });
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

async function readPreflightResponseJson(context, response, expectedUrl) {
  try {
    return await response.json();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/Network[.]getResponseBody.*No data found for resource with given identifier/u.test(message)) {
      throw error;
    }
    const stableResponse = await context.request.get(expectedUrl, {
      timeout: PREFLIGHT_TIMEOUT_MS
    });
    assert.equal(
      stableResponse.status(),
      200,
      "The exact-package preflight replay must succeed after Chrome evicts the observed response body."
    );
    return stableResponse.json();
  }
}

async function exerciseFixedPortConflict(primaryEntry, homeRoot, occupiedPort) {
  assert.ok(occupiedPort === 5173 || occupiedPort === 8788);
  await Promise.all([assertPortClosed(5173), assertPortClosed(8788)]);
  await fs.mkdir(homeRoot, { recursive: true });
  const holder = net.createServer();
  await new Promise((resolve, reject) => {
    holder.once("error", reject);
    holder.listen(occupiedPort, "127.0.0.1", resolve);
  });
  try {
    let failure;
    try {
      await runFile(process.execPath, [primaryEntry, "--no-open"], {
        cwd: path.dirname(primaryEntry),
        capture: true,
        env: {
          ...process.env,
          HOME: homeRoot,
          LOCALAPPDATA: path.join(homeRoot, "local-app-data"),
          XDG_DATA_HOME: path.join(homeRoot, ".local", "share")
        }
      });
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof Error, "The exact package must refuse an occupied frontend port.");
    assert.match(failure.message, new RegExp(`127[.]0[.]0[.]1:${occupiedPort} is already in use`, "u"));
    assert.match(failure.message, /confirm the port is free/u);
    assert.match(failure.message, /rerun the same command/u);
    assert.match(failure.message, /partially started Studio service was stopped/u);
    assert.doesNotMatch(failure.message, /EADDRINUSE/u);
    assert.equal(holder.listening, true, "The exact package must not stop the unrelated port owner.");
    await assertPortClosed(occupiedPort === 5173 ? 8788 : 5173);
  } finally {
    if (holder.listening) await closeServer(holder);
  }
  await Promise.all([assertPortClosed(5173), assertPortClosed(8788)]);
  return {
    occupied_port: occupiedPort,
    unrelated_listener_preserved: true,
    actionable_guidance_verified: true,
    partial_start_cleanup_verified: true,
    closed_ports_after_release: true
  };
}

async function startStudio(primaryEntry, capabilitiesEnabled, environment) {
  const args = [
    primaryEntry,
    ...(capabilitiesEnabled ? ["local-actions"] : []),
    "--no-open"
  ];
  const child = spawn(process.execPath, args, {
    cwd: path.dirname(primaryEntry),
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  let settled = false;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`Local Studio browser smoke timed out.\n${stderr}`));
    }, START_TIMEOUT_MS);
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    child.stdout.on("data", (chunk) => {
      try {
        stdout = boundedAppend(stdout, chunk);
        if (stdout.includes("Open http://127.0.0.1:5173/")) finish(resolve);
      } catch (error) {
        child.kill("SIGKILL");
        finish(() => reject(error));
      }
    });
    child.stderr.on("data", (chunk) => {
      try {
        stderr = boundedAppend(stderr, chunk);
      } catch (error) {
        child.kill("SIGKILL");
        finish(() => reject(error));
      }
    });
    child.once("error", (error) => finish(() => reject(error)));
    child.once("exit", (code, signal) => finish(() => reject(new Error(
      `Local Studio exited before browser smoke (${code ?? signal}).\n${stderr}\n${stdout}`
    ))));
  });
  return { child, stdout: () => stdout, stderr: () => stderr };
}

async function stopStudio(runtime) {
  if (runtime.child.exitCode !== null || runtime.child.signalCode !== null) return;
  const exitedAfterTerminate = new Promise((resolve) => {
    runtime.child.once("exit", () => resolve(true));
  });
  runtime.child.kill("SIGTERM");
  const exited = await Promise.race([
    exitedAfterTerminate,
    new Promise((resolve) => setTimeout(() => resolve(false), 10_000))
  ]);
  if (!exited) {
    const exitedAfterKill = new Promise((resolve) => {
      runtime.child.once("exit", () => resolve(true));
    });
    runtime.child.kill("SIGKILL");
    const killed = await Promise.race([
      exitedAfterKill,
      new Promise((resolve) => setTimeout(() => resolve(false), 5_000))
    ]);
    if (!killed) {
      throw new Error("Local Studio did not stop after the browser-smoke kill bound.");
    }
    throw new Error("Local Studio required a forced stop after the browser-smoke shutdown bound.");
  }
}

async function exerciseMode(browser, primaryEntry, capabilitiesEnabled, homeRoot) {
  await fs.mkdir(homeRoot, { recursive: true });
  let runtime;
  let context;
  let result;
  let createdProjectPath;
  let studioShutdownVerified = false;
  try {
    runtime = await startStudio(primaryEntry, capabilitiesEnabled, {
      ...process.env,
      HOME: homeRoot,
      LOCALAPPDATA: path.join(homeRoot, "local-app-data"),
      XDG_DATA_HOME: path.join(homeRoot, ".local", "share")
    });
    context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    const responses = new Map();
    const responseEvents = [];
    const responseByRequest = new Map();
    const bootstrapRequests = [];
    const finishedRequests = new Map();
    const requestFailures = [];
    const requestTerminalTracker = createRequestTerminalTracker({
      finishedRequests,
      requestFailures,
      timeoutMs: BROWSER_TIMEOUT_MS
    });
    let networkEventSequence = 0;
    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push({ kind: "console", text: message.text(), url: message.location().url });
      }
    });
    page.on("pageerror", (error) => errors.push({ kind: "page", text: error.message, url: "" }));
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/__dusk/bootstrap") {
        bootstrapRequests.push(request);
      }
    });
    page.on("requestfinished", (request) => {
      finishedRequests.set(request, ++networkEventSequence);
      requestTerminalTracker.notify(request);
    });
    page.on("requestfailed", (request) => {
      if (/^https?:\/\//u.test(request.url())) {
        requestFailures.push({
          request,
          sequence: ++networkEventSequence,
          text: request.failure()?.errorText ?? "failed",
          url: request.url()
        });
        requestTerminalTracker.notify(request);
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      if (/^https?:\/\//u.test(url)) {
        const request = response.request();
        responseEvents.push({
          request,
          response,
          sequence: ++networkEventSequence,
          url,
          status: response.status()
        });
        responseByRequest.set(request, response);
      }
      if (url.startsWith("http://127.0.0.1:")) {
        responses.set(url, response.status());
      }
    });
    const navigation = await page.goto("http://127.0.0.1:5173/", {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS
    });
    assert.equal(navigation?.status(), 200);
    assert.match(
      navigation?.headers()["content-security-policy"] ?? "",
      /connect-src[^;]*https:\/\/testnet\.nodes\.dusk\.network/u,
      "Local Studio CSP must allow its bounded public DuskDS Testnet check."
    );
    await page.locator(".app-shell").waitFor({ state: "visible", timeout: BROWSER_TIMEOUT_MS });
    const expectedMode = capabilitiesEnabled ? "Actions ready" : "Safe mode";
    await page.getByRole("button", { name: `Local Studio: ${expectedMode}` })
      .waitFor({ state: "visible", timeout: BROWSER_TIMEOUT_MS });
    assert.match(await page.title(), /Dusk Developer Studio/u);
    assert.ok((await page.locator("h1").first().innerText()).trim().length > 0);
    await page.waitForFunction(() => {
      const resources = globalThis.performance.getEntriesByType("resource").map((entry) => entry.name);
      return resources.some((name) => /\.js$/u.test(new globalThis.URL(name).pathname))
        && resources.some((name) => /\.css$/u.test(new globalThis.URL(name).pathname));
    }, undefined, { timeout: BROWSER_TIMEOUT_MS });
    const assets = await page.evaluate(() => globalThis.performance.getEntriesByType("resource")
      .map((entry) => new globalThis.URL(entry.name).pathname)
      .filter((pathname) => /\.(?:js|css)$/u.test(pathname))
      .sort());
    assert.ok(
      [...responses].some(([url, status]) =>
        url.endsWith("/__dusk/bootstrap") && status === 200
      ),
      "Browser application did not complete the one-time pairing bootstrap."
    );
    assert.ok(
      [...responses].some(([url, status]) =>
        url.startsWith("http://127.0.0.1:8788/health") && status === 200
      ),
      "Browser application did not complete authenticated companion health."
    );
    const expectedProbeUrl = "http://127.0.0.1:8788/health";
    const expectedBootstrapUrl = new URL("/__dusk/bootstrap", page.url()).href;
    assert.equal(bootstrapRequests.length, 1, "Local pairing must make exactly one bootstrap request.");
    const [bootstrapRequest] = bootstrapRequests;
    assert.equal(bootstrapRequest.url(), expectedBootstrapUrl);
    assert.equal(bootstrapRequest.method(), "POST");
    assert.equal(bootstrapRequest.postData(), "{}");
    const bootstrapResponse = responseByRequest.get(bootstrapRequest);
    assert.ok(bootstrapResponse, "The single bootstrap request must receive a response.");
    assert.deepEqual(
      { url: bootstrapResponse.url(), status: bootstrapResponse.status() },
      { url: expectedBootstrapUrl, status: 200 },
      "The single bootstrap request must receive the observed successful response."
    );
    const isExpectedProbeConsoleError = (error) =>
      error.kind === "console"
      && error.text === "Failed to load resource: the server responded with a status of 401 (Unauthorized)"
      && error.url === expectedProbeUrl;
    let preflightContract;
    if (capabilitiesEnabled) {
      await page.getByRole("button", { name: /Start DuskDS/i }).click();
      const preflightButton = page.getByRole("button", { name: "Run automatic preflight" });
      await preflightButton.waitFor({ state: "visible", timeout: BROWSER_TIMEOUT_MS });
      const expectedPreflightUrl = "http://127.0.0.1:8788/preflight?path=duskds";
      const preflightResponsePromise = page.waitForResponse(
        (response) => response.url() === expectedPreflightUrl
          && response.request().method() === "GET",
        { timeout: PREFLIGHT_TIMEOUT_MS }
      );
      await preflightButton.click();
      const preflightResponse = await preflightResponsePromise;
      assert.equal(preflightResponse.status(), 200);
      preflightContract = await validatePreflightConsumerContract(
        await readPreflightResponseJson(context, preflightResponse, expectedPreflightUrl),
        PREFLIGHT_CONSUMER_SOURCE
      );
      const preflightResults = page.locator('[aria-label="Automatic preflight results"]');
      await preflightResults.waitFor({ state: "visible", timeout: PREFLIGHT_TIMEOUT_MS });
      assert.equal(
        await preflightResults.locator("article").count(),
        preflightContract.tool_count,
        "The exact-package Studio must consume and render every bounded producer tool row."
      );
      assert.equal(
        await page.getByText("The local companion returned data this Studio cannot safely use.", { exact: true }).count(),
        0,
        "The exact-package producer response must satisfy the Studio preflight schema."
      );
      const expectedScaffoldUrl = "http://127.0.0.1:8788/scaffold-duskds-forge";
      const scaffoldResponsePromise = page.waitForResponse(
        (response) =>
          response.url() === expectedScaffoldUrl && response.request().method() === "POST",
        { timeout: BROWSER_TIMEOUT_MS }
      );
      const [scaffold, scaffoldResponse] = await Promise.all([
        page.evaluate(async (scaffoldUrl) => {
          const response = await globalThis.fetch(scaffoldUrl, {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ projectName: "installed-smoke-counter" })
          });
          return { status: response.status, body: await response.json() };
        }, expectedScaffoldUrl),
        scaffoldResponsePromise
      ]);
      const scaffoldRequest = scaffoldResponse.request();
      await requestTerminalTracker.wait(
        scaffoldRequest,
        "The Local Actions scaffold request"
      );
      assert.ok(
        finishedRequests.has(scaffoldRequest),
        "The Local Actions scaffold response must finish without a transport error."
      );
      assert.equal(
        requestFailures.filter(({ request }) => request === scaffoldRequest).length,
        0,
        "The Local Actions scaffold response must not produce request-failure telemetry."
      );
      assert.equal(scaffold.status, 200);
      assert.equal(scaffold.body.ok, true);
      assert.equal(scaffold.body.projectName, "installed-smoke-counter");
      assert.equal(scaffold.body.template, "duskds-counter-forge");
      assert.match(scaffold.body.templateRevision, /^[0-9a-f]{40}$/u);
      assert.match(scaffold.body.templateLockSha256, /^[0-9a-f]{64}$/u);
      assert.equal(scaffold.body.rustToolchain, "1.94.0");
      assert.equal(scaffold.body.structureVerified, true);
      assert.ok(scaffold.body.files.includes("Cargo.lock"));
      assert.ok(scaffold.body.files.includes("src/lib.rs"));
      createdProjectPath = scaffold.body.projectPath;
      assert.equal(typeof createdProjectPath, "string");
    }
    const authenticatedHealthEvents = responseEvents.filter(({ url, status }) =>
      url === expectedProbeUrl && status === 200
    );
    assert.equal(
      authenticatedHealthEvents.length,
      1,
      "Local pairing must observe exactly one successful authenticated health response."
    );
    const [authenticatedHealthEvent] = authenticatedHealthEvents;
    // Await exact terminal request events with a hard bound. Chromium can emit a
    // late requestfailed event after the application has already consumed a
    // valid response; the identity-bound classifier below decides whether it is
    // the one safe late-abort case.
    await Promise.all([
      requestTerminalTracker.wait(bootstrapRequest, "The successful bootstrap request"),
      requestTerminalTracker.wait(
        authenticatedHealthEvent.request,
        "The successful authenticated health request"
      )
    ]);
    assert.deepEqual(
      responseEvents
        .filter(({ status }) => status >= 400)
        .map(({ url, status }) => ({ url, status })),
      [{ url: expectedProbeUrl, status: 401 }],
      "The only expected HTTP failure is the one unauthenticated health probe before pairing."
    );
    const pairingTransport = validatePairingTransportEvidence({
      bootstrapRequest,
      expectedBootstrapUrl,
      expectedProbeUrl,
      finishedRequests,
      pairingValidated: true,
      requestFailures,
      responseByRequest,
      responseEvents
    });
    assert.ok(
      errors.filter(isExpectedProbeConsoleError).length <= 1,
      "The expected unauthenticated health probe produced duplicate browser errors."
    );
    assert.deepEqual(
      errors.filter((error) => !isExpectedProbeConsoleError(error)),
      [],
      "Browser smoke produced an unexpected console or page error."
    );
    result = {
      mode: capabilitiesEnabled ? "local-actions" : "safe",
      paired_ui: expectedMode,
      assets,
      late_abort_telemetry: pairingTransport.lateAbortTelemetry,
      ...(preflightContract ? {
        preflight_verified: true,
        preflight_check_id: PREFLIGHT_CHECK_ID,
        preflight_tool_count: preflightContract.tool_count,
        preflight_versioned_tool_count: preflightContract.versioned_tool_count,
        preflight_consumer_contract_source_sha256:
          preflightContract.consumer_contract_source_sha256
      } : {}),
      ...(createdProjectPath ? { scaffold_verified: true } : {})
    };
  } finally {
    try {
      if (context) await context.close();
    } finally {
      if (runtime) {
        await stopStudio(runtime).catch((error) => {
          throw new Error(`${error.message}\n${runtime.stderr()}\n${runtime.stdout()}`);
        });
        studioShutdownVerified = true;
      }
    }
  }
  if (!result) throw new Error("Browser smoke did not produce a mode result.");
  result.studio_shutdown_verified = studioShutdownVerified;
  if (createdProjectPath) {
    const projectStat = await fs.lstat(createdProjectPath);
    if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
      throw new Error("Installed-package scaffold was not preserved as a real directory after shutdown.");
    }
    const [cargoLock, provenance] = await Promise.all([
      fs.readFile(path.join(createdProjectPath, "Cargo.lock"), "utf8"),
      fs.readFile(path.join(createdProjectPath, "PROVENANCE.md"), "utf8")
    ]);
    assert.match(cargoLock, /^version = 4$/mu);
    assert.match(provenance, /d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a/u);
    result.project_preserved_after_shutdown = true;
  }
  return result;
}

const tarball = await fs.realpath(path.resolve(argumentsByName.get("--tarball")));
const tarballStat = await fs.lstat(tarball);
if (!tarballStat.isFile() || tarballStat.isSymbolicLink()) {
  throw new Error("Browser smoke requires a regular npm tarball.");
}
const root = await fs.mkdtemp(path.join(os.tmpdir(), "dusk-studio-browser-smoke-"));
let browser;
try {
  await fs.writeFile(
    path.join(root, "package.json"),
    `${JSON.stringify({ name: "dusk-studio-browser-smoke", private: true })}\n`,
    "utf8"
  );
  const npmCli = await resolveNpmCli();
  await runFile(process.execPath, [
    npmCli,
    "install",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--package-lock=false",
    tarball
  ], { cwd: root, capture: true });
  const packageRoot = path.join(root, "node_modules", npmPackageName);
  const verified = await verifyBuiltNpmPackage(packageRoot, {
    expectedVersion: npmPackageVersion
  });
  const primaryEntry = path.join(packageRoot, "bin", "dusk-developer-studio.mjs");
  const cliProjectParent = path.join(root, "direct-cli-projects");
  await fs.mkdir(cliProjectParent, { recursive: true });
  const cliCreate = await runFile(
    process.execPath,
    [primaryEntry, "create-duskds", "installed-cli-counter"],
    { cwd: cliProjectParent, capture: true }
  );
  assert.match(cliCreate.stdout, /Created duskds-counter-forge/u);
  const directCliProject = path.join(cliProjectParent, "installed-cli-counter");
  await Promise.all([
    fs.access(path.join(directCliProject, "Cargo.lock")),
    fs.access(path.join(directCliProject, "src", "lib.rs"))
  ]);
  await assert.rejects(
    () => runFile(
      process.execPath,
      [primaryEntry, "create-duskds", "installed-cli-counter"],
      { cwd: cliProjectParent, capture: true }
    ),
    (error) => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /will not overwrite or merge it/iu);
      assert.match(message, /new project name or a different empty parent directory/iu);
      assert.doesNotMatch(message, /running Local Studio/iu);
      return true;
    }
  );
  const fixedPortConflicts = [];
  for (const occupiedPort of [5173, 8788]) {
    fixedPortConflicts.push(await exerciseFixedPortConflict(
      primaryEntry,
      path.join(root, `port-${occupiedPort}-conflict-home`),
      occupiedPort
    ));
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const browserVersion = browser.version();
  const modes = [];
  for (const capabilitiesEnabled of [false, true]) {
    modes.push(await exerciseMode(
      browser,
      primaryEntry,
      capabilitiesEnabled,
      path.join(root, capabilitiesEnabled ? "local-actions-home" : "safe-home")
    ));
  }
  const receipt = {
    schema_version: 1,
    status: "passed",
    package: npmPackageName,
    version: npmPackageVersion,
    commit: verified.manifest.commit,
    channel: "npm",
    browser: "chrome",
    browser_version: browserVersion,
    root_rendered: true,
    console_and_page_errors: 0,
    pairing_verified: true,
    direct_cli_scaffold_verified: true,
    local_actions_scaffold_verified: modes.some((mode) =>
      mode.mode === "local-actions" && mode.scaffold_verified === true
    ),
    local_actions_preflight_verified: modes.some((mode) =>
      mode.mode === "local-actions" && mode.preflight_verified === true
    ),
    local_actions_preflight_check_id: PREFLIGHT_CHECK_ID,
    local_actions_preflight_consumer_contract_source_sha256: modes.find((mode) =>
      mode.mode === "local-actions"
    )?.preflight_consumer_contract_source_sha256,
    scaffold_preserved_after_shutdown: modes.some((mode) =>
      mode.mode === "local-actions" && mode.project_preserved_after_shutdown === true
    ),
    studio_shutdown_verified: modes.some((mode) =>
      mode.mode === "local-actions" && mode.studio_shutdown_verified === true
    ),
    fixed_port_conflicts: fixedPortConflicts,
    modes
  };
  const receiptPath = argumentsByName.get("--receipt");
  if (receiptPath) {
    const destination = path.resolve(receiptPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await writeJson(destination, receipt);
  }
  console.log(JSON.stringify(receipt, null, 2));
} finally {
  if (browser) await browser.close();
  await fs.rm(root, { recursive: true, force: true });
}
