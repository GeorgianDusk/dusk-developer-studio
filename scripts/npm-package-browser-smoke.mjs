import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { URL } from "node:url";
import { chromium } from "playwright";
import {
  npmPackageName,
  npmPackageVersion,
  resolveNpmCli,
  runFile,
  verifyBuiltNpmPackage,
  writeJson
} from "./npm-package-core.mjs";

const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const START_TIMEOUT_MS = 30_000;
const BROWSER_TIMEOUT_MS = 20_000;
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
    const finishedRequests = new Set();
    const requestFailures = [];
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
    page.on("requestfinished", (request) => finishedRequests.add(request));
    page.on("requestfailed", (request) => {
      if (/^https?:\/\//u.test(request.url())) {
        requestFailures.push({
          request,
          text: request.failure()?.errorText ?? "failed",
          url: request.url()
        });
      }
    });
    page.on("response", (response) => {
      const url = response.url();
      if (/^https?:\/\//u.test(url)) {
        responseEvents.push({ url, status: response.status() });
        responseByRequest.set(response.request(), response);
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
    const probeIndex = responseEvents.findIndex(({ url, status }) =>
      url === expectedProbeUrl && status === 401
    );
    const bootstrapIndex = responseEvents.findIndex(({ url, status }) =>
      url === expectedBootstrapUrl && status === 200
    );
    const authenticatedHealthIndex = responseEvents.findIndex(({ url, status }, index) =>
      index > bootstrapIndex && url === expectedProbeUrl && status === 200
    );
    assert.ok(
      probeIndex >= 0 && bootstrapIndex > probeIndex && authenticatedHealthIndex > bootstrapIndex,
      "Local pairing must observe unauthenticated health, successful bootstrap, then authenticated health in order."
    );
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
    // Hosted Chromium can report ERR_ABORTED after this fetch has already
    // returned 200, supplied valid pairing JSON, and enabled authenticated health.
    const isExpectedCompletedBootstrapAbort = (failure) =>
      failure.request === bootstrapRequest
      && failure.text === "net::ERR_ABORTED"
      && failure.url === expectedBootstrapUrl;
    if (capabilitiesEnabled) {
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
      assert.equal(
        await scaffoldResponse.finished(),
        null,
        "The Local Actions scaffold response must finish without a transport error."
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
    // Drain the terminal event in both modes; the strict correlation below
    // determines whether any returned Chromium transport error is acceptable.
    await bootstrapResponse.finished();
    assert.deepEqual(
      responseEvents.filter(({ status }) => status >= 400),
      [{ url: expectedProbeUrl, status: 401 }],
      "The only expected HTTP failure is the one unauthenticated health probe before pairing."
    );
    const completedBootstrapAborts = requestFailures.filter(isExpectedCompletedBootstrapAbort);
    assert.ok(
      finishedRequests.has(bootstrapRequest) || completedBootstrapAborts.length === 1,
      "The successful bootstrap request must finish or produce only the correlated Chromium abort telemetry."
    );
    assert.ok(
      !(finishedRequests.has(bootstrapRequest) && completedBootstrapAborts.length),
      "The bootstrap request cannot both finish and fail."
    );
    assert.ok(
      completedBootstrapAborts.length <= 1,
      "The completed bootstrap produced duplicate Chromium abort telemetry."
    );
    assert.deepEqual(
      requestFailures
        .filter((failure) => !isExpectedCompletedBootstrapAbort(failure))
        .map(({ text, url }) => ({ text, url })),
      [],
      "Browser smoke produced an unexpected request failure."
    );
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
    /existing target|already exists/iu
  );
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
    scaffold_preserved_after_shutdown: modes.some((mode) =>
      mode.mode === "local-actions" && mode.project_preserved_after_shutdown === true
    ),
    studio_shutdown_verified: modes.some((mode) =>
      mode.mode === "local-actions" && mode.studio_shutdown_verified === true
    ),
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
