import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
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
  if (signedRcSelfTest && capabilitiesEnabled) throw new Error("Signed-RC self-test cannot enable local machine actions.");
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
function checkStudioHealth(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = http.get({ host: HOST, port: STUDIO_PORT, path: "/healthz", timeout: 5_000 }, (response) => {
      let body = "";
      response.setEncoding("utf8");
      response.on("data", (chunk: string) => { body += chunk; });
      response.on("end", () => {
        if (response.statusCode === 200 && body.trim() === "ok") resolve();
        else reject(new Error(`Signed-RC self-test health check failed (${response.statusCode ?? "no status"}).`));
      });
    });
    request.once("timeout", () => request.destroy(new Error("Signed-RC self-test health check timed out.")));
    request.once("error", reject);
  });
}


export async function runPortableRuntimeCli(options: PortableRuntimeCliOptions = {}): Promise<void> {
  const mode = resolvePortableRuntimeCliMode(options.args ?? process.argv.slice(2));
  const distributionRoot = path.resolve(options.distributionRoot ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."));
  const runtime = await startPortableRuntime({ distributionRoot, capabilitiesEnabled: mode.capabilitiesEnabled, openBrowser: mode.openBrowser, verification: options.verification });
  console.log(`Dusk Developer Studio Local ${runtime.manifest.version} (${runtime.manifest.commit.slice(0, 8)})`);
  console.log(`Mode: ${mode.capabilitiesEnabled ? "local tool checks and starter creation enabled" : "safe mode; machine actions disabled"}`);
  console.log(`Open http://${HOST}:${STUDIO_PORT}/`);
  if (mode.signedRcSelfTest) {
    try {
      await checkStudioHealth();
    } finally {
      await runtime.shutdown();
    }
    console.log("Signed-RC self-test passed; health verified and local services stopped.");
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
