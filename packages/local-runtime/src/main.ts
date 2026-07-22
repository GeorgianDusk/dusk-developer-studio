import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createLocalAgentServer,
  assertWindowsForgeManagedRoot,
  MAX_SCAFFOLD_PATH_LENGTH,
  scaffoldDuskDsForge
} from "@dusk/local-agent/server";
import { terminateAllBoundedProcesses } from "@dusk/local-agent/process";
import { createChildEnvironment } from "@dusk/local-agent/environment";
import {
  resolveExecutableForSpawn,
  resolveExecutionDirectory,
  resolveWindowsSystemDirectory,
  resolveWindowsSystemExecutable
} from "@dusk/local-agent/executable";
import { assertNonElevatedLaunch } from "./launchPrivilege";
import { createLocalStudioServer } from "./staticServer";
import {
  assertSupportedNodeVersion,
  verifyNpmPackage,
  type NpmPackageManifest,
  type NpmPackageVerificationOptions
} from "./verifyPackage";

const HOST = "127.0.0.1";
const STUDIO_PORT = 5173;
const COMPANION_PORT = 8788;

export interface LocalRuntimeOptions {
  packageRoot: string;
  capabilitiesEnabled: boolean;
  openBrowser: boolean;
  projectRoot?: string;
  studioPort?: number;
  companionPort?: number;
  verification?: NpmPackageVerificationOptions;
}

export interface LocalRuntimeCliOptions {
  packageRoot?: string;
  args?: string[];
  capabilitiesEnabled: boolean;
  verification?: NpmPackageVerificationOptions;
}

export interface LocalRuntimeCliMode {
  openBrowser: boolean;
  lifecycleSelfTest: boolean;
}

export interface DuskDsTemplateCliOptions {
  packageRoot?: string;
  projectName: string;
  cwd?: string;
  verification?: NpmPackageVerificationOptions;
}

const LOCAL_RUNTIME_FLAGS = new Set(["--no-open", "--lifecycle-self-test"]);

export function resolveLocalRuntimeCliMode(args: string[]): LocalRuntimeCliMode {
  const unknown = args.filter((arg) => !LOCAL_RUNTIME_FLAGS.has(arg));
  if (unknown.length) throw new Error(`Unsupported argument: ${unknown[0]}`);
  if (new Set(args).size !== args.length) throw new Error("Local Studio arguments must not be repeated.");
  const lifecycleSelfTest = args.includes("--lifecycle-self-test");
  return {
    openBrowser: !lifecycleSelfTest && !args.includes("--no-open"),
    lifecycleSelfTest
  };
}

export function localRuntimeStopInstruction(platform = process.platform): string {
  const windowsConfirmation = platform === "win32"
    ? ' If Windows asks "Terminate batch job (Y/N)?", type Y and press Enter.'
    : "";
  return `Press Ctrl+C to stop.${windowsConfirmation} Projects remain under the managed DuskDS project root.`;
}

export function localBrowserPairingInstruction(openBrowser: boolean): string {
  const url = `http://${HOST}:${STUDIO_PORT}/#companion`;
  return openBrowser
    ? `Use the browser tab opened at ${url}; this launch pairs one browser profile. To use a different profile, stop this run, rerun with --no-open, then open that URL in the intended profile within five minutes.`
    : `Open ${url} in the one browser profile you want to pair within five minutes. Do not open another Local Studio page first.`;
}

export function describeLocalRuntimeListenFailure(error: unknown, port: number): Error {
  if ((error as NodeJS.ErrnoException | undefined)?.code !== "EADDRINUSE") {
    return error instanceof Error ? error : new Error("Local Studio could not start its loopback services.");
  }
  return new Error(
    `Local Studio could not start because 127.0.0.1:${port} is already in use. `
    + `Close the local application or terminal using port ${port}, confirm the port is free, then rerun the same command. `
    + "Any partially started Studio service was stopped."
  );
}

function defaultProjectRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "Dusk", "DeveloperStudio", "projects");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Dusk", "DeveloperStudio", "projects");
  }
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "dusk", "developer-studio", "projects");
}

export function resolveDuskDsProjectRoot(
  managedProjectRoot: string,
  configured = process.env.DUSK_STUDIO_DUSKDS_PROJECT_ROOT
): string {
  const managed = path.resolve(managedProjectRoot);
  const candidate = configured?.trim();
  if (!candidate) {
    const defaultRoot = path.join(managed, "duskds");
    if (defaultRoot.length > MAX_SCAFFOLD_PATH_LENGTH) {
      throw new Error(`Managed DuskDS project root must be ${MAX_SCAFFOLD_PATH_LENGTH.toLocaleString("en-US")} characters or fewer.`);
    }
    return assertWindowsForgeManagedRoot(defaultRoot);
  }
  if (
    !path.isAbsolute(candidate)
    || (process.platform === "win32" && !/^[a-zA-Z]:[\\/]/.test(candidate))
    || candidate.includes("\0")
    || /[\r\n]/.test(candidate)
    || candidate.startsWith("\\\\")
    || candidate.startsWith("\\\\?\\")
  ) {
    throw new Error("DUSK_STUDIO_DUSKDS_PROJECT_ROOT must be a normal absolute local path.");
  }
  const resolved = path.resolve(candidate);
  if (resolved === path.parse(resolved).root) {
    throw new Error("DUSK_STUDIO_DUSKDS_PROJECT_ROOT cannot be a filesystem root.");
  }
  if (resolved.length > MAX_SCAFFOLD_PATH_LENGTH) {
    throw new Error(`DUSK_STUDIO_DUSKDS_PROJECT_ROOT must be ${MAX_SCAFFOLD_PATH_LENGTH.toLocaleString("en-US")} characters or fewer.`);
  }
  return assertWindowsForgeManagedRoot(resolved);
}

export async function resolveCanonicalNpmPackageRoot(packageRoot: string): Promise<string> {
  const requested = path.resolve(packageRoot);
  const canonical = await fs.realpath(requested);
  const stat = await fs.lstat(canonical);
  if (!stat.isDirectory() || stat.isSymbolicLink() || canonical === path.parse(canonical).root) {
    throw new Error("The verified npm package root is unsafe.");
  }
  return canonical;
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) {
      resolve();
      return;
    }
    const timer = setTimeout(() => server.closeAllConnections(), 2_000);
    server.close(() => {
      clearTimeout(timer);
      resolve();
    });
  });
}

export function resolveLocalBrowserLaunch(
  cwd: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  inheritedCwd: string = process.cwd()
): { command: string; cwd: string; environment: NodeJS.ProcessEnv } {
  const childEnvironment = createChildEnvironment(environment, {
    inheritedCwd
  });
  const canonicalCwd = resolveExecutionDirectory(cwd, childEnvironment, { platform, inheritedCwd });
  const command = platform === "win32"
    ? resolveWindowsSystemExecutable("explorer.exe", childEnvironment, { inheritedCwd })
    : platform === "darwin"
      ? resolveExecutableForSpawn("open", childEnvironment, { platform, inheritedCwd })
      : platform === "linux"
        ? resolveExecutableForSpawn("xdg-open", childEnvironment, { platform, inheritedCwd })
        : (() => { throw new Error("Automatic browser launch is not supported on this operating system."); })();
  return { command, cwd: canonicalCwd, environment: childEnvironment };
}

function openLocalBrowser(url: string, cwd: string): void {
  try {
    const launch = resolveLocalBrowserLaunch(cwd);
    const child = spawn(launch.command, [url], {
      cwd: launch.cwd,
      env: launch.environment,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      shell: false
    });
    child.once("error", () => undefined);
    child.unref();
  } catch {
    // Browser launch is best-effort; the CLI always prints the loopback URL.
  }
}

export async function startLocalRuntime(options: LocalRuntimeOptions): Promise<{
  manifest: NpmPackageManifest;
  studioServer: http.Server;
  companionServer: http.Server;
  projectRoot: string;
  duskDsProjectRoot: string;
  shutdown: () => Promise<void>;
}> {
  assertSupportedNodeVersion(options.verification?.nodeVersion ?? process.versions.node);
  assertNonElevatedLaunch();
  const packageRoot = await resolveCanonicalNpmPackageRoot(options.packageRoot);
  const manifest = await verifyNpmPackage(packageRoot, options.verification);
  const studioPort = options.studioPort ?? STUDIO_PORT;
  const companionPort = options.companionPort ?? COMPANION_PORT;
  if (studioPort !== STUDIO_PORT || companionPort !== COMPANION_PORT) {
    throw new Error("Local Studio ports are fixed by the security contract.");
  }

  const pairingToken = randomBytes(32).toString("base64url");
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot());
  const duskDsProjectRoot = resolveDuskDsProjectRoot(projectRoot);
  await fs.mkdir(projectRoot, { recursive: true, mode: 0o700 });
  const releaseIdentity = {
    product: "Dusk Developer Studio",
    version: manifest.version,
    commit: manifest.commit,
    channel: "npm" as const
  };
  const companionServer = createLocalAgentServer({
    pairingToken,
    port: companionPort,
    workspaceRoot: projectRoot,
    processCwd: packageRoot,
    foundryTemplateRoot: path.join(packageRoot, "templates", "foundry-counter-dusk-evm"),
    duskDsTemplateRoot: path.join(packageRoot, "templates", "duskds-counter-forge"),
    duskDsProjectRoot,
    allowedOrigins: [`http://${HOST}:${studioPort}`, `http://localhost:${studioPort}`],
    capabilitiesEnabled: options.capabilitiesEnabled,
    evmScaffoldEnabled: false,
    allowPrivateNetwork: false,
    releaseIdentity
  });
  const studioServer = await createLocalStudioServer({
    studioRoot: path.join(packageRoot, "studio"),
    port: studioPort,
    companionPort,
    pairingToken
  });

  let startingPort = companionPort;
  try {
    await listen(companionServer, companionPort);
    startingPort = studioPort;
    await listen(studioServer, studioPort);
  } catch (error) {
    await Promise.all([close(studioServer), close(companionServer)]);
    throw describeLocalRuntimeListenFailure(error, startingPort);
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await terminateAllBoundedProcesses();
    await Promise.all([close(studioServer), close(companionServer)]);
  };
  if (options.openBrowser) openLocalBrowser(`http://${HOST}:${studioPort}/#companion`, packageRoot);
  return { manifest, studioServer, companionServer, projectRoot, duskDsProjectRoot, shutdown };
}

interface SelfTestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface LifecycleSelfTestResult {
  schema_version: 2;
  mode: "safe" | "local-actions";
  release: {
    product: string;
    version: string;
    commit: string;
    channel: "npm";
  };
  bootstrap_succeeded: true;
  bootstrap_replay_denied: true;
  authenticated_session_verified: true;
  exact_release_parity_verified: true;
  capability_contract_verified: true;
  expected_studio_listening_endpoints: ["127.0.0.1:5173", "127.0.0.1:8788"];
  unexpected_studio_listening_endpoints: [];
  isolated_project_root_verified: true;
  local_actions_scaffold_smoke: "passed" | "not-applicable";
  scaffold_preservation_smoke: "passed" | "not-applicable";
  shutdown_smoke: "passed";
  studio_loopback_services_stopped: true;
}

interface LifecycleSelfTestExecution {
  receipt: Omit<
    LifecycleSelfTestResult,
    "scaffold_preservation_smoke" | "shutdown_smoke" | "studio_loopback_services_stopped"
  >;
  createdProjectPath?: string;
  createdProjectFiles?: string[];
}

const SELF_TEST_RESULT_PREFIX = "DUSK_STUDIO_LIFECYCLE=";

function selfTestRequest(
  options: http.RequestOptions,
  body = "",
  timeoutMs = 5_000
): Promise<SelfTestResponse> {
  return new Promise((resolve, reject) => {
    const request = http.request({ ...options, timeout: timeoutMs }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      response.on("data", (chunk: Buffer | string) => {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.byteLength;
        if (bytes <= 64 * 1024) chunks.push(buffer);
      });
      response.on("end", () => {
        if (bytes > 64 * 1024) reject(new Error("Lifecycle self-test response exceeded its bound."));
        else resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.once("timeout", () => request.destroy(new Error("Lifecycle self-test request timed out.")));
    request.once("error", reject);
    request.end(body);
  });
}

function parseSelfTestJson(response: SelfTestResponse, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(response.body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`Lifecycle ${label} response was not bounded JSON.`);
  }
}

function parseListeningEndpoint(value: string): string | undefined {
  const match = value.trim().match(/^(?:\[)?(127[.]0[.]0[.]1)(?:\])?:(\d+)$/);
  if (!match) return undefined;
  const port = Number(match[2]);
  return Number.isInteger(port) && port > 0 && port <= 65_535
    ? `${match[1]}:${port}`
    : undefined;
}

export function parseWindowsNetstatListeningEndpoints(output: string, ownerPid: number): string[] {
  if (
    !Number.isSafeInteger(ownerPid)
    || ownerPid <= 0
    || ownerPid > 0xffff_ffff
    || output.length > 1_048_576
  ) {
    throw new Error("Lifecycle self-test received an invalid Windows socket inventory.");
  }
  const values: string[] = [];
  for (const line of output.split(/\r?\n/)) {
    const fields = line.trim().split(/\s+/);
    if (fields[0]?.toUpperCase() !== "TCP") continue;
    if (fields.length !== 5 || !/^\d+$/.test(fields[4])) {
      throw new Error("Lifecycle self-test received a malformed Windows socket row.");
    }
    const rowPid = Number(fields[4]);
    if (!Number.isSafeInteger(rowPid) || rowPid < 0 || rowPid > 0xffff_ffff) {
      throw new Error("Lifecycle self-test received a malformed Windows socket PID.");
    }
    if (rowPid !== ownerPid) continue;
    if (fields[2] === "0.0.0.0:0" || fields[2] === "[::]:0") values.push(fields[1]);
  }
  return values;
}

function ownedListeningEndpoints(cwd: string): string[] {
  let values: string[] = [];
  const environment = createChildEnvironment(process.env, {
    inheritedCwd: process.cwd()
  });
  if (process.platform === "win32") {
    const netstat = resolveWindowsSystemExecutable("netstat.exe", environment);
    const result = spawnSync(netstat, ["-a", "-n", "-o", "-p", "tcp"], {
      cwd: resolveWindowsSystemDirectory(environment),
      env: environment,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 30_000,
      maxBuffer: 1_048_576
    });
    if (result.status !== 0) {
      const errorCode = (result.error as NodeJS.ErrnoException | undefined)?.code;
      const category = errorCode === "ETIMEDOUT"
        ? "timeout"
        : result.error
          ? "spawn_error"
          : `exit_${result.status}`;
      throw new Error(`Lifecycle self-test could not inspect Windows listening sockets (${category}).`);
    }
    values = parseWindowsNetstatListeningEndpoints(result.stdout, process.pid);
  } else if (process.platform === "linux") {
    const result = spawnSync(resolveExecutableForSpawn("ss", environment), ["-H", "-ltnp"], {
      cwd: resolveExecutionDirectory(cwd, environment),
      env: environment,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      timeout: 10_000
    });
    if (result.status !== 0) throw new Error("Lifecycle self-test could not inspect Linux listening sockets.");
    values = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.includes(`pid=${process.pid},`))
      .map((line) => line.trim().split(/\s+/)[3] ?? "");
  } else if (process.platform === "darwin") {
    const result = spawnSync(
      resolveExecutableForSpawn("lsof", environment),
      ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"],
      {
        cwd: resolveExecutionDirectory(cwd, environment),
        env: environment,
        encoding: "utf8",
        shell: false,
        windowsHide: true,
        timeout: 10_000
      }
    );
    if (result.status !== 0) throw new Error("Lifecycle self-test could not inspect macOS listening sockets.");
    values = result.stdout
      .split(/\r?\n/)
      .filter((line) => line.startsWith("n"))
      .map((line) => line.slice(1));
  } else {
    throw new Error("Lifecycle self-test does not support this operating system.");
  }
  const endpoints = values
    .map(parseListeningEndpoint)
    .filter((value): value is string => Boolean(value))
    .sort();
  if (endpoints.length !== values.length) {
    throw new Error("Lifecycle self-test found a non-loopback listening endpoint.");
  }
  return endpoints;
}

async function assertStudioLoopbackServicesStopped(): Promise<void> {
  for (const port of [STUDIO_PORT, COMPANION_PORT]) {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection({ host: HOST, port });
      socket.setTimeout(5_000);
      socket.once("connect", () => {
        socket.destroy();
        reject(new Error(`Lifecycle self-test left port ${port} reachable.`));
      });
      socket.once("timeout", () => {
        socket.destroy();
        reject(new Error(`Lifecycle self-test could not prove port ${port} is closed.`));
      });
      socket.once("error", (error: NodeJS.ErrnoException) => {
        if (error.code === "ECONNREFUSED") resolve();
        else reject(new Error(
          `Lifecycle self-test could not prove port ${port} is closed (${error.code ?? "unknown"}).`
        ));
      });
    });
  }
}

async function exactRegularFileInventory(
  root: string,
  directory = root,
  prefix = ""
): Promise<string[]> {
  const files: string[] = [];
  for (const entry of (await fs.readdir(directory, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const stat = await fs.lstat(absolute);
    if (entry.isSymbolicLink() || stat.isSymbolicLink()) {
      throw new Error(`Lifecycle scaffold retained a link: ${relative}.`);
    }
    if (entry.isDirectory() && stat.isDirectory()) {
      files.push(...await exactRegularFileInventory(root, absolute, relative));
    } else if (entry.isFile() && stat.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Lifecycle scaffold retained a non-regular entry: ${relative}.`);
    }
  }
  return files.sort();
}

async function runLifecycleSelfTest(
  runtime: Awaited<ReturnType<typeof startLocalRuntime>>,
  capabilitiesEnabled: boolean
): Promise<LifecycleSelfTestExecution> {
  const expectedEndpoints = [`${HOST}:${STUDIO_PORT}`, `${HOST}:${COMPANION_PORT}`] as const;
  const serverEndpoints = [runtime.studioServer.address(), runtime.companionServer.address()]
    .map((address) => {
      if (!address || typeof address === "string") {
        throw new Error("Lifecycle self-test could not inspect a local server address.");
      }
      return `${address.address}:${address.port}`;
    })
    .sort();
  const socketEndpoints = ownedListeningEndpoints(runtime.projectRoot);
  if (
    JSON.stringify(serverEndpoints) !== JSON.stringify([...expectedEndpoints].sort())
    || JSON.stringify(socketEndpoints) !== JSON.stringify([...expectedEndpoints].sort())
  ) {
    throw new Error("Lifecycle self-test found an unexpected listening endpoint.");
  }

  const origin = `http://${HOST}:${STUDIO_PORT}`;
  const firstBootstrap = await selfTestRequest({
    host: HOST,
    port: STUDIO_PORT,
    path: "/__dusk/bootstrap",
    method: "POST",
    headers: {
      host: `${HOST}:${STUDIO_PORT}`,
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "content-length": "2"
    }
  }, "{}");
  if (firstBootstrap.status !== 200) {
    throw new Error(`Lifecycle bootstrap failed (${firstBootstrap.status}).`);
  }
  const bootstrapBody = parseSelfTestJson(firstBootstrap, "bootstrap");
  if (bootstrapBody.ok !== true || bootstrapBody.paired !== true) {
    throw new Error("Lifecycle bootstrap response was invalid.");
  }
  const setCookie = firstBootstrap.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "";
  if (
    !cookie.startsWith("dusk_studio_session=")
    || !String(setCookie).includes("HttpOnly")
    || !String(setCookie).includes("SameSite=Strict")
  ) {
    throw new Error("Lifecycle bootstrap did not issue the required session cookie.");
  }

  const replay = await selfTestRequest({
    host: HOST,
    port: STUDIO_PORT,
    path: "/__dusk/bootstrap",
    method: "POST",
    headers: {
      host: `${HOST}:${STUDIO_PORT}`,
      origin,
      "content-type": "application/json",
      "sec-fetch-site": "same-origin",
      "content-length": "2"
    }
  }, "{}");
  const replayBody = parseSelfTestJson(replay, "bootstrap replay");
  if (replay.status !== 410 || replayBody.code !== "bootstrap_expired") {
    throw new Error("Lifecycle one-time bootstrap was replayable.");
  }

  const health = await selfTestRequest({
    host: HOST,
    port: COMPANION_PORT,
    path: "/healthz",
    method: "GET",
    headers: { host: `${HOST}:${COMPANION_PORT}`, origin, cookie }
  });
  const healthBody = parseSelfTestJson(health, "companion health");
  const release = healthBody.release as Record<string, unknown> | undefined;
  if (
    health.status !== 200
    || healthBody.ok !== true
    || healthBody.paired !== true
    || healthBody.capabilitiesEnabled !== capabilitiesEnabled
    || !release
    || release.product !== "Dusk Developer Studio"
    || release.version !== runtime.manifest.version
    || release.commit !== runtime.manifest.commit
    || release.channel !== "npm"
  ) {
    throw new Error("Lifecycle authenticated health or release parity check failed.");
  }

  const preflight = await selfTestRequest({
    host: HOST,
    port: COMPANION_PORT,
    path: "/preflight?path=duskds",
    method: "GET",
    headers: { host: `${HOST}:${COMPANION_PORT}`, origin, cookie }
  }, "", 60_000);
  const preflightBody = parseSelfTestJson(preflight, "capability");
  if (capabilitiesEnabled) {
    if (
      preflight.status !== 200
      || typeof preflightBody.ok !== "boolean"
      || preflightBody.path !== "duskds"
      || !Array.isArray(preflightBody.tools)
    ) {
      throw new Error("Lifecycle Local Actions preflight did not complete.");
    }
  } else if (preflight.status !== 403 || preflightBody.code !== "capabilities_disabled") {
    throw new Error("Lifecycle Safe mode did not deny a local action.");
  }
  if (JSON.stringify(ownedListeningEndpoints(runtime.projectRoot)) !== JSON.stringify([...expectedEndpoints].sort())) {
    throw new Error("Lifecycle preflight changed the Studio-owned listening endpoint set.");
  }

  const expectedProjectRoot = path.resolve(defaultProjectRoot());
  if (runtime.projectRoot !== expectedProjectRoot) {
    throw new Error("Lifecycle project root did not use the isolated platform user-data root.");
  }
  if (runtime.duskDsProjectRoot !== resolveDuskDsProjectRoot(expectedProjectRoot)) {
    throw new Error("Lifecycle DuskDS project root did not match the managed containment root.");
  }
  const projectStat = await fs.lstat(runtime.projectRoot);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) {
    throw new Error("Lifecycle isolated project root is unsafe.");
  }

  let createdProjectPath: string | undefined;
  let createdProjectFiles: string[] | undefined;
  if (capabilitiesEnabled) {
    const projectName = `lifecycle-self-test-${randomBytes(6).toString("hex")}`;
    const scaffoldRequest = JSON.stringify({ projectName });
    const scaffold = await selfTestRequest({
      host: HOST,
      port: COMPANION_PORT,
      path: "/scaffold-duskds-forge",
      method: "POST",
      headers: {
        host: `${HOST}:${COMPANION_PORT}`,
        origin,
        cookie,
        "content-type": "application/json",
        "content-length": Buffer.byteLength(scaffoldRequest).toString()
      }
    }, scaffoldRequest, 120_000);
    const scaffoldBody = parseSelfTestJson(scaffold, "Local Actions scaffold");
    if (
      scaffold.status !== 200
      || scaffoldBody.ok !== true
      || scaffoldBody.projectName !== projectName
      || scaffoldBody.template !== "duskds-counter-forge"
      || typeof scaffoldBody.templateRevision !== "string"
      || !/^[a-f0-9]{40}$/u.test(scaffoldBody.templateRevision)
      || typeof scaffoldBody.templateLockSha256 !== "string"
      || !/^[a-f0-9]{64}$/u.test(scaffoldBody.templateLockSha256)
      || scaffoldBody.rustToolchain !== "1.94.0"
      || scaffoldBody.structureVerified !== true
      || !Array.isArray(scaffoldBody.files)
      || scaffoldBody.files.some((file) => typeof file !== "string")
      || !scaffoldBody.files.includes("Cargo.lock")
      || !scaffoldBody.files.includes("Cargo.toml")
      || !scaffoldBody.files.includes("PROVENANCE.md")
      || !scaffoldBody.files.includes("rust-toolchain.toml")
      || !scaffoldBody.files.includes("src/lib.rs")
      || !scaffoldBody.files.includes("tests/contract.rs")
      || typeof scaffoldBody.projectPath !== "string"
    ) {
      throw new Error("Lifecycle Local Actions scaffold did not return the reviewed starter contract.");
    }
    createdProjectPath = await fs.realpath(scaffoldBody.projectPath);
    if (
      path.dirname(createdProjectPath) !== await fs.realpath(runtime.duskDsProjectRoot)
      || path.basename(createdProjectPath) !== projectName
    ) {
      throw new Error("Lifecycle Local Actions scaffold escaped the managed DuskDS root.");
    }
    const createdStat = await fs.lstat(createdProjectPath);
    if (!createdStat.isDirectory() || createdStat.isSymbolicLink()) {
      throw new Error("Lifecycle Local Actions scaffold is not a real managed directory.");
    }
    createdProjectFiles = [...scaffoldBody.files as string[]].sort();
    if (JSON.stringify(await exactRegularFileInventory(createdProjectPath))
        !== JSON.stringify(createdProjectFiles)) {
      throw new Error("Lifecycle Local Actions scaffold inventory differs from its reviewed receipt.");
    }
  }
  if (JSON.stringify(ownedListeningEndpoints(runtime.projectRoot)) !== JSON.stringify([...expectedEndpoints].sort())) {
    throw new Error("Lifecycle scaffold changed the Studio-owned listening endpoint set.");
  }

  return {
    receipt: {
      schema_version: 2,
      mode: capabilitiesEnabled ? "local-actions" : "safe",
      release: {
        product: "Dusk Developer Studio",
        version: runtime.manifest.version,
        commit: runtime.manifest.commit,
        channel: "npm"
      },
      bootstrap_succeeded: true,
      bootstrap_replay_denied: true,
      authenticated_session_verified: true,
      exact_release_parity_verified: true,
      capability_contract_verified: true,
      expected_studio_listening_endpoints: ["127.0.0.1:5173", "127.0.0.1:8788"],
      unexpected_studio_listening_endpoints: [],
      isolated_project_root_verified: true,
      local_actions_scaffold_smoke: createdProjectPath ? "passed" : "not-applicable"
    },
    ...(createdProjectPath && createdProjectFiles
      ? { createdProjectPath, createdProjectFiles }
      : {})
  };
}

export async function runLocalRuntimeCli(options: LocalRuntimeCliOptions): Promise<void> {
  const mode = resolveLocalRuntimeCliMode(options.args ?? process.argv.slice(2));
  const packageRoot = path.resolve(
    options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  );
  const runtime = await startLocalRuntime({
    packageRoot,
    capabilitiesEnabled: options.capabilitiesEnabled,
    openBrowser: mode.openBrowser,
    verification: options.verification
  });
  console.log(
    `Dusk Developer Studio ${runtime.manifest.version} (${runtime.manifest.commit.slice(0, 8)})`
  );
  console.log(
    `Mode: ${options.capabilitiesEnabled
      ? "local tool checks and starter creation enabled"
      : "safe mode; machine actions disabled"}`
  );
  console.log(`Open http://${HOST}:${STUDIO_PORT}/`);
  console.log(localBrowserPairingInstruction(mode.openBrowser));

  if (mode.lifecycleSelfTest) {
    let execution: LifecycleSelfTestExecution;
    try {
      execution = await runLifecycleSelfTest(runtime, options.capabilitiesEnabled);
    } finally {
      await runtime.shutdown();
    }
    if (runtime.studioServer.listening || runtime.companionServer.listening) {
      throw new Error("Lifecycle local servers still report a listening state.");
    }
    await assertStudioLoopbackServicesStopped();
    let scaffoldPreserved = false;
    if (execution.createdProjectPath && execution.createdProjectFiles) {
      const createdStat = await fs.lstat(execution.createdProjectPath);
      const [cargoLock, provenance] = await Promise.all([
        fs.readFile(path.join(execution.createdProjectPath, "Cargo.lock"), "utf8"),
        fs.readFile(path.join(execution.createdProjectPath, "PROVENANCE.md"), "utf8")
      ]);
      if (!createdStat.isDirectory()
          || createdStat.isSymbolicLink()
          || JSON.stringify(await exactRegularFileInventory(execution.createdProjectPath))
            !== JSON.stringify(execution.createdProjectFiles)
          || !/^version = 4$/mu.test(cargoLock)
          || !/d1e39a16ad5e2cd0675c7aafa6e2c459310bcb1a/u.test(provenance)) {
        throw new Error("Lifecycle Local Actions scaffold was not preserved after shutdown.");
      }
      scaffoldPreserved = true;
    } else if (execution.createdProjectPath || execution.createdProjectFiles) {
      throw new Error("Lifecycle Local Actions scaffold preservation state is incomplete.");
    }
    const completed: LifecycleSelfTestResult = {
      ...execution.receipt,
      scaffold_preservation_smoke: scaffoldPreserved ? "passed" : "not-applicable",
      shutdown_smoke: "passed",
      studio_loopback_services_stopped: true
    };
    console.log(`${SELF_TEST_RESULT_PREFIX}${JSON.stringify(completed)}`);
    console.log(
      "Lifecycle self-test passed; bootstrap, session, release parity, capabilities, scaffold policy, and shutdown verified."
    );
    return;
  }

  console.log(localRuntimeStopInstruction());
  await new Promise<void>((resolve, reject) => {
    const onSignal = async () => {
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      try {
        await runtime.shutdown();
        resolve();
      } catch (error) {
        reject(error);
      }
    };
    process.on("SIGINT", onSignal);
    process.on("SIGTERM", onSignal);
  });
}

export async function runDuskDsTemplateCli(options: DuskDsTemplateCliOptions): Promise<void> {
  assertSupportedNodeVersion(options.verification?.nodeVersion ?? process.versions.node);
  assertNonElevatedLaunch();
  const packageRoot = await resolveCanonicalNpmPackageRoot(
    options.packageRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  );
  const manifest = await verifyNpmPackage(packageRoot, options.verification);
  const requestedCwd = path.resolve(options.cwd ?? process.cwd());
  if (requestedCwd === path.parse(requestedCwd).root || requestedCwd.length > MAX_SCAFFOLD_PATH_LENGTH) {
    throw new Error("create-duskds must run from a bounded project parent, not a filesystem root.");
  }
  const cwdStat = await fs.lstat(requestedCwd);
  if (!cwdStat.isDirectory() || cwdStat.isSymbolicLink()) {
    throw new Error("create-duskds must run from a real local directory.");
  }
  const canonicalCwd = await fs.realpath(requestedCwd);
  const result = await scaffoldDuskDsForge(
    { cwd: canonicalCwd, projectName: options.projectName },
    {
      projectRoot: canonicalCwd,
      templateRoot: path.join(packageRoot, "templates", "duskds-counter-forge")
    }
  );
  if (path.dirname(result.path) !== canonicalCwd || result.projectRoot !== canonicalCwd) {
    throw new Error("create-duskds returned a project outside the selected parent directory.");
  }
  console.log(`Dusk Developer Studio ${manifest.version} (${manifest.commit.slice(0, 8)})`);
  console.log(`Created ${result.template} at ${result.path}`);
  console.log(`Rust ${result.rustToolchain}; template source ${result.templateRevision.slice(0, 12)}; packaged Cargo.lock verified.`);
}

const isMainModule = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;
if (isMainModule) {
  runLocalRuntimeCli({ capabilitiesEnabled: false }).catch((error) => {
    console.error(error instanceof Error ? error.message : "Local Studio could not start.");
    process.exitCode = 1;
  });
}
