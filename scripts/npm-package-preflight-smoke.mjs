import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";

export const PREFLIGHT_CHECK_ID =
  "three-platform-exact-tarball-local-actions-preflight-producer-consumer-contract";

const FRONTEND_ORIGIN = "http://127.0.0.1:5173";
const COMPANION_ORIGIN = "http://127.0.0.1:8788";
const START_TIMEOUT_MS = 30_000;
const PREFLIGHT_TIMEOUT_MS = 130_000;
const STOP_TIMEOUT_MS = 10_000;
const MAX_PROCESS_OUTPUT_BYTES = 64 * 1024;
const MAX_PREFLIGHT_RESPONSE_BYTES = 64 * 1024;
const MAX_TOOL_ROWS = 64;
const MAX_TOOL_NAME_LENGTH = 64;
const MAX_TOOL_COMMAND_LENGTH = 256;
const MAX_VERSION_LENGTH = 128;
const runtimeFetch = globalThis.fetch;
const RuntimeAbortSignal = globalThis.AbortSignal;
const RUNTIME_ENVIRONMENT_ALLOWLIST = Object.freeze([
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "ComSpec",
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ"
]);
function isNonemptyBoundedString(value, maximum) {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function extractFunctionSource(source, name) {
  const match = new RegExp(`(?:export\\s+)?function\\s+${name}\\s*\\(`, "u").exec(source);
  if (!match) throw new Error(`Authoritative consumer guard is missing ${name}.`);
  const start = match.index;
  const bodyStart = source.indexOf("{", start);
  if (bodyStart < 0) throw new Error(`Authoritative consumer guard has no body for ${name}.`);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1).replace(/^export\s+/u, "");
    }
  }
  throw new Error(`Authoritative consumer guard has an unterminated body for ${name}.`);
}

async function loadAuthoritativeConsumerGuard(consumerSource) {
  const sourcePath = await fs.realpath(path.resolve(consumerSource));
  const sourceStat = await fs.lstat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) {
    throw new Error("Authoritative preflight consumer source must be a regular file.");
  }
  const source = await fs.readFile(sourcePath, "utf8");
  const selectedSource = [
    "isRecord",
    "boundedString",
    "optionalBoundedString",
    "isPreflightResult"
  ].map((name) => extractFunctionSource(source, name)).join("\n\n");
  const executable = stripTypeScriptTypes(
    `${selectedSource}\nexport { isPreflightResult };\n`,
    { mode: "strip", sourceUrl: "dusk-studio-preflight-consumer-contract.ts" }
  );
  const consumerModule = await import(
    `data:text/javascript;base64,${Buffer.from(executable, "utf8").toString("base64")}`
  );
  if (typeof consumerModule.isPreflightResult !== "function") {
    throw new Error("Authoritative preflight consumer guard was not executable.");
  }
  return {
    guard: consumerModule.isPreflightResult,
    source_sha256: createHash("sha256").update(source, "utf8").digest("hex")
  };
}

export async function validatePreflightConsumerContract(value, consumerSource) {
  const consumer = await loadAuthoritativeConsumerGuard(consumerSource);
  assert.equal(
    consumer.guard(value),
    true,
    "The exact checked-out Studio consumer guard rejected the exact-package producer response."
  );
  assert.equal(value.path, "duskds", "Preflight producer returned the wrong builder path.");
  assert.ok(
    value.tools.length > 0 && value.tools.length <= MAX_TOOL_ROWS,
    "Preflight producer must return one to 64 bounded tool rows."
  );

  let versionedToolCount = 0;
  for (const tool of value.tools) {
    assert.ok(
      isNonemptyBoundedString(tool.name, MAX_TOOL_NAME_LENGTH),
      "Preflight producer returned an empty or oversized tool name."
    );
    assert.ok(
      isNonemptyBoundedString(tool.command, MAX_TOOL_COMMAND_LENGTH),
      "Preflight producer returned an empty or oversized tool command."
    );
    if (tool.version !== undefined) {
      assert.ok(
        isNonemptyBoundedString(tool.version, MAX_VERSION_LENGTH),
        "Preflight producer returned an empty or oversized version string."
      );
      versionedToolCount += 1;
    }
  }
  assert.ok(
    versionedToolCount > 0,
    "Preflight producer must return at least one nonempty version string within the UI contract."
  );

  return {
    tool_count: value.tools.length,
    versioned_tool_count: versionedToolCount,
    aggregate_prerequisites_satisfied: value.ok,
    consumer_contract_source_sha256: consumer.source_sha256
  };
}

function boundedAppend(current, chunk) {
  const next = current + chunk.toString("utf8");
  if (Buffer.byteLength(next) > MAX_PROCESS_OUTPUT_BYTES) {
    throw new Error("Exact-package preflight process output exceeded its bound.");
  }
  return next;
}

function inheritedRuntimeEnvironment(source) {
  const environment = {};
  for (const key of RUNTIME_ENVIRONMENT_ALLOWLIST) {
    if (typeof source[key] === "string" && source[key].length > 0) {
      environment[key] = source[key];
    }
  }
  return environment;
}

function probePort(port) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.setTimeout(2_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      reject(new Error(`Timed out checking loopback port ${port}.`));
    });
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") resolve(false);
      else reject(error);
    });
  });
}

async function assertPortsClosed() {
  const states = await Promise.all([probePort(5173), probePort(8788)]);
  assert.deepEqual(states, [false, false], "Exact-package preflight requires both fixed ports to be free.");
}

async function waitForPortsClosed() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (!(await probePort(5173)) && !(await probePort(8788))) return;
    await delay(250);
  }
  throw new Error("Exact-package preflight cleanup left a loopback listener running.");
}

async function readBoundedJson(response, label, maximumBytes) {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength && (!Number.isSafeInteger(declaredLength) || declaredLength > maximumBytes)) {
    throw new Error(`${label} declared an oversized response.`);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.byteLength > maximumBytes) throw new Error(`${label} exceeded its response bound.`);
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${label} was not valid JSON.`);
  }
}

function sessionCookieFrom(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  if (values.length !== 1) throw new Error("Pairing did not issue exactly one session cookie.");
  const [setCookie] = values;
  if (!/;\s*HttpOnly(?:;|$)/iu.test(setCookie)
      || !/;\s*SameSite=Strict(?:;|$)/iu.test(setCookie)
      || !/;\s*Path=\/(?:;|$)/iu.test(setCookie)) {
    throw new Error("Pairing session cookie attributes are outside the reviewed contract.");
  }
  const cookie = setCookie.split(";", 1)[0];
  if (!cookie || !cookie.includes("=")) throw new Error("Pairing session cookie was malformed.");
  return cookie;
}

async function pairAndRunPreflight(consumerSource) {
  const bootstrap = await runtimeFetch(`${FRONTEND_ORIGIN}/__dusk/bootstrap`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: FRONTEND_ORIGIN
    },
    body: "{}",
    signal: RuntimeAbortSignal.timeout(START_TIMEOUT_MS)
  });
  const cookie = sessionCookieFrom(bootstrap);
  const bootstrapBody = await readBoundedJson(bootstrap, "Pairing bootstrap", 8 * 1024);
  if (bootstrap.status !== 200 || bootstrapBody.ok !== true || bootstrapBody.paired !== true) {
    throw new Error("Pairing bootstrap did not complete.");
  }

  const response = await runtimeFetch(`${COMPANION_ORIGIN}/preflight?path=duskds`, {
    headers: { cookie, origin: FRONTEND_ORIGIN },
    signal: RuntimeAbortSignal.timeout(PREFLIGHT_TIMEOUT_MS)
  });
  if (response.status !== 200) throw new Error("Local Actions preflight did not return HTTP 200.");
  const body = await readBoundedJson(
    response,
    "Local Actions preflight",
    MAX_PREFLIGHT_RESPONSE_BYTES
  );
  return validatePreflightConsumerContract(body, consumerSource);
}

async function startStudio(primaryEntry, environment) {
  const child = spawn(process.execPath, [primaryEntry, "local-actions", "--no-open"], {
    cwd: path.dirname(primaryEntry),
    env: environment,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let stdout = "";
  let stderr = "";
  await new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Exact-package Local Actions startup timed out."));
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
    child.once("exit", () => finish(() => reject(new Error(
      "Exact-package Local Actions exited before preflight assurance."
    ))));
  });
  return child;
}

async function stopStudio(child) {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", () => resolve(true)));
    child.kill("SIGTERM");
    if (!await Promise.race([exited, delay(STOP_TIMEOUT_MS, false)])) {
      const killed = new Promise((resolve) => child.once("exit", () => resolve(true)));
      child.kill("SIGKILL");
      if (!await Promise.race([killed, delay(5_000, false)])) {
        throw new Error("Exact-package preflight process did not stop within its cleanup bound.");
      }
    }
  }
  await waitForPortsClosed();
}

function parseArguments(argv) {
  const allowed = new Set(["--primary", "--consumer", "--home", "--receipt"]);
  const values = new Map();
  for (const argument of argv) {
    const separator = argument.indexOf("=");
    const name = separator > 0 ? argument.slice(0, separator) : argument;
    const value = separator > 0 ? argument.slice(separator + 1) : "";
    if (!allowed.has(name) || !value || values.has(name)) {
      throw new Error(`Unsupported exact-package preflight argument: ${name}.`);
    }
    values.set(name, value);
  }
  if (!values.has("--primary") || !values.has("--consumer")) {
    throw new Error(
      "Usage: node scripts/npm-package-preflight-smoke.mjs --primary=<installed-entry> --consumer=<responseSchemas.ts> [--home=<dir>] [--receipt=<json>]"
    );
  }
  return values;
}

async function main() {
  const argumentsByName = parseArguments(process.argv.slice(2));
  const primaryEntry = await fs.realpath(path.resolve(argumentsByName.get("--primary")));
  const consumerSource = await fs.realpath(path.resolve(argumentsByName.get("--consumer")));
  const primaryStat = await fs.lstat(primaryEntry);
  if (!primaryStat.isFile() || primaryStat.isSymbolicLink()) {
    throw new Error("Exact-package preflight requires a regular installed entrypoint.");
  }
  const temporaryHome = !argumentsByName.has("--home");
  const homeRoot = temporaryHome
    ? await fs.mkdtemp(path.join(os.tmpdir(), "dusk-studio-preflight-"))
    : path.resolve(argumentsByName.get("--home"));
  const localAppData = path.join(homeRoot, "local-app-data");
  const roamingAppData = path.join(homeRoot, "roaming-app-data");
  const tempRoot = path.join(homeRoot, "temp");
  const projectRoot = path.join(homeRoot, "projects");
  await Promise.all([
    fs.mkdir(localAppData, { recursive: true }),
    fs.mkdir(roamingAppData, { recursive: true }),
    fs.mkdir(tempRoot, { recursive: true }),
    fs.mkdir(projectRoot, { recursive: true })
  ]);
  await assertPortsClosed();
  let child;
  let contract;
  try {
    child = await startStudio(primaryEntry, {
      ...inheritedRuntimeEnvironment(process.env),
      APPDATA: roamingAppData,
      HOME: homeRoot,
      LOCALAPPDATA: localAppData,
      TEMP: tempRoot,
      TMP: tempRoot,
      TMPDIR: tempRoot,
      USERPROFILE: homeRoot,
      XDG_DATA_HOME: path.join(homeRoot, ".local", "share"),
      DUSK_STUDIO_DUSKDS_PROJECT_ROOT: projectRoot
    });
    contract = await pairAndRunPreflight(consumerSource);
  } finally {
    if (child) await stopStudio(child);
    if (temporaryHome) await fs.rm(homeRoot, { recursive: true, force: true });
  }
  if (!contract) throw new Error("Exact-package preflight contract did not complete.");
  const receipt = {
    schema_version: 1,
    status: "passed",
    check_id: PREFLIGHT_CHECK_ID,
    local_actions_preflight_verified: true,
    producer_consumer_schema_compatible: true,
    nonempty_tool_rows_verified: true,
    version_strings_within_ui_contract: true,
    prerequisite_outcome_not_required: true,
    studio_loopback_services_stopped: true,
    tool_count: contract.tool_count,
    versioned_tool_count: contract.versioned_tool_count,
    consumer_contract_source_sha256: contract.consumer_contract_source_sha256,
    observed_at: new Date().toISOString()
  };
  const receiptPath = argumentsByName.get("--receipt");
  if (receiptPath) {
    const destination = path.resolve(receiptPath);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
  }
  console.log(JSON.stringify(receipt));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (invokedPath === import.meta.url) await main();
