import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createLocalAgentServer } from "@dusk/local-agent/server";
import { terminateAllBoundedProcesses } from "@dusk/local-agent/process";
import { createLocalStudioServer } from "./staticServer";
import { verifyPayload, type PayloadManifest, type PayloadVerificationOptions } from "./verifyPayload";

const HOST = "127.0.0.1";
const STUDIO_PORT = 5173;
const COMPANION_PORT = 8788;

export interface PortableRuntimeOptions {
  distributionRoot: string;
  capabilitiesEnabled: boolean;
  openBrowser: boolean;
  projectRoot?: string;
  studioPort?: number;
  companionPort?: number;
  verification?: PayloadVerificationOptions;
}

export interface PortableRuntimeCliOptions {
  distributionRoot?: string;
  args?: string[];
  verification?: PayloadVerificationOptions;
}
export interface PortableRuntimeCliMode {
  capabilitiesEnabled: boolean;
  openBrowser: boolean;
  signedRcSelfTest: boolean;
}

const PORTABLE_RUNTIME_FLAGS = new Set(["--enable-local-actions", "--no-open", "--signed-rc-self-test"]);

export function resolvePortableRuntimeCliMode(args: string[]): PortableRuntimeCliMode {
  const unknown = args.filter((arg) => !PORTABLE_RUNTIME_FLAGS.has(arg));
  if (unknown.length) throw new Error(`Unsupported argument: ${unknown[0]}`);
  if (new Set(args).size !== args.length) throw new Error("Portable Studio arguments must not be repeated.");
  const capabilitiesEnabled = args.includes("--enable-local-actions");
  const signedRcSelfTest = args.includes("--signed-rc-self-test");
  return { capabilitiesEnabled, openBrowser: !signedRcSelfTest && !args.includes("--no-open"), signedRcSelfTest };
}


function defaultProjectRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");
    return path.join(localAppData, "Dusk", "DeveloperStudio", "projects");
  }
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Dusk", "DeveloperStudio", "projects");
  const dataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), ".local", "share");
  return path.join(dataHome, "dusk", "developer-studio", "projects");
}

function currentTarget(): PayloadManifest["target"] | "unsupported" {
  if (process.platform === "win32" && process.arch === "x64") return "windows-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux-x64";
  if (process.platform === "darwin" && process.arch === "arm64") return "darwin-arm64";
  return "unsupported";
}

function listen(server: http.Server, port: number): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, HOST, () => { server.off("error", reject); resolve(); });
  });
}

function close(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    if (!server.listening) { resolve(); return; }
    const timer = setTimeout(() => { server.closeAllConnections(); }, 2_000);
    server.close(() => { clearTimeout(timer); resolve(); });
  });
}

function openLocalBrowser(url: string): void {
  const command = process.platform === "win32" ? "explorer.exe" : process.platform === "darwin" ? "open" : "xdg-open";
  const child = spawn(command, [url], { detached: true, stdio: "ignore", windowsHide: true, shell: false });
  child.once("error", () => undefined);
  child.unref();
}

export async function startPortableRuntime(options: PortableRuntimeOptions): Promise<{
  manifest: PayloadManifest;
  studioServer: http.Server;
  companionServer: http.Server;
  projectRoot: string;
  shutdown: () => Promise<void>;
}> {
  const distributionRoot = path.resolve(options.distributionRoot);
  const manifest = await verifyPayload(distributionRoot, options.verification);
  if (manifest.target !== currentTarget()) throw new Error("This portable archive does not match the current platform and architecture.");
  const studioPort = options.studioPort ?? STUDIO_PORT;
  const companionPort = options.companionPort ?? COMPANION_PORT;
  if (studioPort !== STUDIO_PORT || companionPort !== COMPANION_PORT) throw new Error("Portable Studio ports are fixed by the security contract.");
  const pairingToken = randomBytes(32).toString("base64url");
  const projectRoot = path.resolve(options.projectRoot ?? defaultProjectRoot());
  await fs.mkdir(projectRoot, { recursive: true, mode: 0o700 });
  const releaseIdentity = { product: "Dusk Developer Studio", version: manifest.version, commit: manifest.commit, channel: "portable" as const };
  const companionServer = createLocalAgentServer({
    pairingToken,
    port: companionPort,
    workspaceRoot: projectRoot,
    foundryTemplateRoot: path.join(distributionRoot, "templates", "foundry-counter-dusk-evm"),
    duskDsProjectRoot: path.join(projectRoot, "duskds"),
    allowedOrigins: [`http://${HOST}:${studioPort}`, `http://localhost:${studioPort}`],
    capabilitiesEnabled: options.capabilitiesEnabled,
    allowPrivateNetwork: false,
    releaseIdentity
  });
  const studioServer = await createLocalStudioServer({ studioRoot: path.join(distributionRoot, "studio"), port: studioPort, companionPort, pairingToken });
  try {
    await listen(companionServer, companionPort);
    await listen(studioServer, studioPort);
  } catch (error) {
    await Promise.all([close(studioServer), close(companionServer)]);
    throw error;
  }
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    await terminateAllBoundedProcesses();
    await Promise.all([close(studioServer), close(companionServer)]);
  };
  if (options.openBrowser) openLocalBrowser(`http://${HOST}:${studioPort}/#companion`);
  return { manifest, studioServer, companionServer, projectRoot, shutdown };
}
interface SelfTestResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

interface SignedRcLifecycleResult {
  schema_version: 1;
  mode: "safe" | "local-actions";
  release: { product: string; version: string; commit: string; channel: "portable" };
  bootstrap_succeeded: true;
  bootstrap_replay_denied: true;
  authenticated_session_verified: true;
  exact_release_parity_verified: true;
  capability_contract_verified: true;
  expected_studio_listening_endpoints: ["127.0.0.1:5173", "127.0.0.1:8788"];
  unexpected_studio_listening_endpoints: [];
  isolated_project_root_verified: true;
  studio_loopback_services_stopped: true;
}

const SELF_TEST_RESULT_PREFIX = "DUSK_STUDIO_SIGNED_RC_LIFECYCLE=";

function selfTestRequest(options: http.RequestOptions, body = "", timeoutMs = 5_000): Promise<SelfTestResponse> {
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
        if (bytes > 64 * 1024) reject(new Error("Signed-RC self-test response exceeded its bound."));
        else resolve({ status: response.statusCode ?? 0, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") });
      });
    });
    request.once("timeout", () => request.destroy(new Error("Signed-RC self-test request timed out.")));
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
    throw new Error(`Signed-RC ${label} response was not bounded JSON.`);
  }
}

function parseListeningEndpoint(value: string): string | undefined {
  const match = value.trim().match(/^(?:\[)?(127[.]0[.]0[.]1)(?:\])?:(\d+)$/);
  if (!match) return undefined;
  const port = Number(match[2]);
  return Number.isInteger(port) && port > 0 && port <= 65_535 ? `${match[1]}:${port}` : undefined;
}

function ownedListeningEndpoints(): string[] {
  let values: string[] = [];
  if (process.platform === "win32") {
    const powershell = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const command = `$ErrorActionPreference='Stop'; @(Get-NetTCPConnection -State Listen | Where-Object { $_.OwningProcess -eq ${process.pid} } | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort)" }) | ConvertTo-Json -Compress`;
    const result = spawnSync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    if (result.status !== 0) throw new Error("Signed-RC self-test could not inspect Windows listening sockets.");
    const parsed: unknown = result.stdout.trim() ? JSON.parse(result.stdout) : [];
    values = Array.isArray(parsed) ? parsed.map(String) : [String(parsed)];
  } else if (process.platform === "linux") {
    const result = spawnSync("ss", ["-H", "-ltnp"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    if (result.status !== 0) throw new Error("Signed-RC self-test could not inspect Linux listening sockets.");
    values = result.stdout.split(/\r?\n/).filter((line) => line.includes(`pid=${process.pid},`)).map((line) => line.trim().split(/\s+/)[3] ?? "");
  } else if (process.platform === "darwin") {
    const result = spawnSync("lsof", ["-nP", "-a", "-p", String(process.pid), "-iTCP", "-sTCP:LISTEN", "-Fn"], { encoding: "utf8", windowsHide: true, timeout: 10_000 });
    if (result.status !== 0) throw new Error("Signed-RC self-test could not inspect macOS listening sockets.");
    values = result.stdout.split(/\r?\n/).filter((line) => line.startsWith("n")).map((line) => line.slice(1));
  } else {
    throw new Error("Signed-RC self-test does not support this operating system.");
  }
  const endpoints = values.map(parseListeningEndpoint).filter((value): value is string => Boolean(value)).sort();
  if (endpoints.length !== values.length) throw new Error("Signed-RC self-test found a non-loopback listening endpoint.");
  return endpoints;
}

async function assertStudioLoopbackServicesStopped(): Promise<void> {
  for (const port of [STUDIO_PORT, COMPANION_PORT]) {
    try {
      await selfTestRequest({ host: HOST, port, path: "/healthz", method: "GET", headers: { host: `${HOST}:${port}` } });
      throw new Error(`Signed-RC self-test left port ${port} reachable.`);
    } catch (error) {
      if (error instanceof Error && error.message.includes("left port")) throw error;
    }
  }
}

async function runSignedRcLifecycleSelfTest(
  runtime: Awaited<ReturnType<typeof startPortableRuntime>>,
  capabilitiesEnabled: boolean
): Promise<Omit<SignedRcLifecycleResult, "studio_loopback_services_stopped">> {
  const expectedEndpoints = [`${HOST}:${STUDIO_PORT}`, `${HOST}:${COMPANION_PORT}`] as const;
  const serverEndpoints = [runtime.studioServer.address(), runtime.companionServer.address()].map((address) => {
    if (!address || typeof address === "string") throw new Error("Signed-RC self-test could not inspect a local server address.");
    return `${address.address}:${address.port}`;
  }).sort();
  const socketEndpoints = ownedListeningEndpoints();
  if (JSON.stringify(serverEndpoints) !== JSON.stringify([...expectedEndpoints].sort())
      || JSON.stringify(socketEndpoints) !== JSON.stringify([...expectedEndpoints].sort())) {
    throw new Error("Signed-RC self-test found an unexpected listening endpoint.");
  }

  const origin = `http://${HOST}:${STUDIO_PORT}`;
  const firstBootstrap = await selfTestRequest({
    host: HOST, port: STUDIO_PORT, path: "/__dusk/bootstrap", method: "POST",
    headers: { host: `${HOST}:${STUDIO_PORT}`, origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "content-length": "2" }
  }, "{}");
  if (firstBootstrap.status !== 200) throw new Error(`Signed-RC bootstrap failed (${firstBootstrap.status}).`);
  const bootstrapBody = parseSelfTestJson(firstBootstrap, "bootstrap");
  if (bootstrapBody.ok !== true || bootstrapBody.paired !== true) throw new Error("Signed-RC bootstrap response was invalid.");
  const setCookie = firstBootstrap.headers["set-cookie"];
  const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie)?.split(";", 1)[0] ?? "";
  if (!cookie.startsWith("dusk_studio_session=") || !String(setCookie).includes("HttpOnly") || !String(setCookie).includes("SameSite=Strict")) {
    throw new Error("Signed-RC bootstrap did not issue the required session cookie.");
  }

  const replay = await selfTestRequest({
    host: HOST, port: STUDIO_PORT, path: "/__dusk/bootstrap", method: "POST",
    headers: { host: `${HOST}:${STUDIO_PORT}`, origin, "content-type": "application/json", "sec-fetch-site": "same-origin", "content-length": "2" }
  }, "{}");
  const replayBody = parseSelfTestJson(replay, "bootstrap replay");
  if (replay.status !== 410 || replayBody.code !== "bootstrap_expired") throw new Error("Signed-RC one-time bootstrap was replayable.");

  const health = await selfTestRequest({
    host: HOST, port: COMPANION_PORT, path: "/healthz", method: "GET",
    headers: { host: `${HOST}:${COMPANION_PORT}`, origin, cookie }
  });
  const healthBody = parseSelfTestJson(health, "companion health");
  const release = healthBody.release as Record<string, unknown> | undefined;
  if (health.status !== 200 || healthBody.ok !== true || healthBody.paired !== true
      || healthBody.capabilitiesEnabled !== capabilitiesEnabled || !release
      || release.product !== "Dusk Developer Studio" || release.version !== runtime.manifest.version
      || release.commit !== runtime.manifest.commit || release.channel !== "portable") {
    throw new Error("Signed-RC authenticated health or release parity check failed.");
  }

  const preflight = await selfTestRequest({
    host: HOST, port: COMPANION_PORT, path: "/preflight?path=evm", method: "GET",
    headers: { host: `${HOST}:${COMPANION_PORT}`, origin, cookie }
  }, "", 60_000);
  const preflightBody = parseSelfTestJson(preflight, "capability");
  if (capabilitiesEnabled) {
    if (preflight.status !== 200 || typeof preflightBody.ok !== "boolean"
        || preflightBody.path !== "evm" || !Array.isArray(preflightBody.tools)) {
      throw new Error("Signed-RC local-actions preflight did not complete.");
    }
  } else if (preflight.status !== 403 || preflightBody.code !== "capabilities_disabled") {
    throw new Error("Signed-RC safe mode did not deny a local action.");
  }
  if (JSON.stringify(ownedListeningEndpoints()) !== JSON.stringify([...expectedEndpoints].sort())) {
    throw new Error("Signed-RC preflight changed the Studio-owned listening endpoint set.");
  }

  const expectedProjectRoot = path.resolve(defaultProjectRoot());
  if (runtime.projectRoot !== expectedProjectRoot) throw new Error("Signed-RC project root did not use the isolated platform user-data root.");
  const projectStat = await fs.lstat(runtime.projectRoot);
  if (!projectStat.isDirectory() || projectStat.isSymbolicLink()) throw new Error("Signed-RC isolated project root is unsafe.");

  return {
    schema_version: 1,
    mode: capabilitiesEnabled ? "local-actions" : "safe",
    release: { product: "Dusk Developer Studio", version: runtime.manifest.version, commit: runtime.manifest.commit, channel: "portable" },
    bootstrap_succeeded: true,
    bootstrap_replay_denied: true,
    authenticated_session_verified: true,
    exact_release_parity_verified: true,
    capability_contract_verified: true,
    expected_studio_listening_endpoints: ["127.0.0.1:5173", "127.0.0.1:8788"],
    unexpected_studio_listening_endpoints: [],
    isolated_project_root_verified: true
  };
}


export async function runPortableRuntimeCli(options: PortableRuntimeCliOptions = {}): Promise<void> {
  const mode = resolvePortableRuntimeCliMode(options.args ?? process.argv.slice(2));
  const distributionRoot = path.resolve(options.distributionRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const runtime = await startPortableRuntime({ distributionRoot, capabilitiesEnabled: mode.capabilitiesEnabled, openBrowser: mode.openBrowser, verification: options.verification });
  console.log(`Dusk Developer Studio Local ${runtime.manifest.version} (${runtime.manifest.commit.slice(0, 8)})`);
  console.log(`Mode: ${mode.capabilitiesEnabled ? "local tool checks and starter creation enabled" : "safe mode; machine actions disabled"}`);
  console.log(`Open http://${HOST}:${STUDIO_PORT}/`);
  if (mode.signedRcSelfTest) {
    let result: Omit<SignedRcLifecycleResult, "studio_loopback_services_stopped">;
    try {
      result = await runSignedRcLifecycleSelfTest(runtime, mode.capabilitiesEnabled);
    } finally {
      await runtime.shutdown();
    }
    if (runtime.studioServer.listening || runtime.companionServer.listening) throw new Error("Signed-RC local servers still report a listening state.");
    await assertStudioLoopbackServicesStopped();
    const completed: SignedRcLifecycleResult = { ...result, studio_loopback_services_stopped: true };
    console.log(`${SELF_TEST_RESULT_PREFIX}${JSON.stringify(completed)}`);
    console.log("Signed-RC lifecycle self-test passed; one-time bootstrap, session, release parity, capabilities, and shutdown verified.");
    return;
  }
  console.log("Press Ctrl+C to stop. Projects remain in your user data folder.");
  await new Promise<void>((resolve, reject) => {
    const onSignal = async () => {
      process.off("SIGINT", onSignal); process.off("SIGTERM", onSignal);
      try { await runtime.shutdown(); resolve(); }
      catch (error) { reject(error); }
    };
    process.on("SIGINT", onSignal); process.on("SIGTERM", onSignal);
  });
}

const isMainModule = process.argv[1] ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url)) : false;
if (isMainModule) runPortableRuntimeCli().catch((error) => {
  console.error(error instanceof Error ? error.message : "Portable Studio could not start.");
  process.exitCode = 1;
});
