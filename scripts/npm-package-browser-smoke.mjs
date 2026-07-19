import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
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
  try {
    runtime = await startStudio(primaryEntry, capabilitiesEnabled, {
      ...process.env,
      HOME: homeRoot,
      XDG_DATA_HOME: path.join(homeRoot, ".local", "share")
    });
    context = await browser.newContext();
    const page = await context.newPage();
    const errors = [];
    const responses = new Map();
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`page: ${error.message}`));
    page.on("requestfailed", (request) => {
      if (request.url().startsWith("http://127.0.0.1:")) {
        errors.push(`request: ${request.url()} (${request.failure()?.errorText ?? "failed"})`);
      }
    });
    page.on("response", (response) => {
      if (response.url().startsWith("http://127.0.0.1:")) {
        responses.set(response.url(), response.status());
      }
    });
    const navigation = await page.goto("http://127.0.0.1:5173/", {
      waitUntil: "domcontentloaded",
      timeout: BROWSER_TIMEOUT_MS
    });
    assert.equal(navigation?.status(), 200);
    await page.locator(".app-shell").waitFor({ state: "visible", timeout: BROWSER_TIMEOUT_MS });
    const expectedMode = capabilitiesEnabled ? "Actions ready" : "Safe mode";
    await page.getByRole("button", { name: `Automation: ${expectedMode}` })
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
    assert.deepEqual(errors, []);
    return {
      mode: capabilitiesEnabled ? "local-actions" : "safe",
      paired_ui: expectedMode,
      assets
    };
  } finally {
    try {
      if (context) await context.close();
    } finally {
      if (runtime) {
        await stopStudio(runtime).catch((error) => {
          throw new Error(`${error.message}\n${runtime.stderr()}\n${runtime.stdout()}`);
        });
      }
    }
  }
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
