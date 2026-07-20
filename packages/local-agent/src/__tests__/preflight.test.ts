import { describe, expect, it, vi } from "vitest";
import {
  isNativeWindowsWasmOptPath,
  runPreflightAsync,
  trustedPathAdditionsForTool
} from "../commands/preflight";
import os from "node:os";
import path from "node:path";
import {
  DUSK_FORGE_INSTALL_COMMAND,
  DUSK_FORGE_REVISION,
  parseDuskForgeCargoInstallMetadata,
  reviewedDuskForgeExecutable,
  type DuskForgeInstallIdentity
} from "../commands/duskDsToolchainPolicy";
import type { BoundedProcessOptions } from "../commands/runBoundedProcess";

const REVIEWED_FORGE_IDENTITY: DuskForgeInstallIdentity = {
  package: "dusk-forge-cli",
  packageVersion: "0.1.0",
  binary: "dusk-forge",
  repository: "https://github.com/dusk-network/forge",
  revision: DUSK_FORGE_REVISION
};

function logicalCommand(options: BoundedProcessOptions): string {
  return options.command;
}

function successfulOutput(options: BoundedProcessOptions): string {
  if (options.args.includes("target") && options.args.includes("list")) return "wasm32-unknown-unknown\n";
  if (options.args.includes("component") && options.args.includes("list")) return "rust-src\n";
  if (options.command === "where.exe") return "C:\\tools\\wasm-opt.exe\n";
  return "ok\n";
}

describe("path preflight", () => {
  it("prefers a configured Cargo home before the default per-user Cargo bin", () => {
    const root = path.join(os.tmpdir(), "dusk-cargo-order");
    const homeDirectory = path.join(root, "home");
    const cargoHome = path.join(root, "configured-cargo");
    expect(trustedPathAdditionsForTool(
      { name: "Cargo", command: "cargo", args: ["--version"], required: true },
      {
        homeDirectory,
        cargoHome,
        launchCwd: path.join(root, "launch-project"),
        pathExists: () => true
      }
    )).toEqual([
      path.resolve(cargoHome, "bin"),
      path.resolve(homeDirectory, ".cargo", "bin")
    ]);
  });

  it("restores a configured Cargo home below the profile when launched from the profile root", () => {
    const root = path.join(os.tmpdir(), "dusk-home-cargo");
    const homeDirectory = path.join(root, "home");
    const cargoHome = path.join(homeDirectory, "custom-cargo");
    expect(trustedPathAdditionsForTool(
      { name: "Cargo", command: "cargo", args: ["--version"], required: true },
      {
        homeDirectory,
        cargoHome,
        launchCwd: homeDirectory,
        pathExists: () => true
      }
    )).toEqual([
      path.resolve(cargoHome, "bin"),
      path.resolve(homeDirectory, ".cargo", "bin")
    ]);
  });

  it("accepts only a native Windows wasm-opt executable path", () => {
    expect(isNativeWindowsWasmOptPath("C:\\tools\\wasm-opt.exe")).toBe(true);
    expect(isNativeWindowsWasmOptPath("C:\\tools\\wasm-opt.cmd")).toBe(false);
    expect(isNativeWindowsWasmOptPath("C:\\tools\\wasm-opt")).toBe(false);
  });

  it("runs the EVM allowlist through bounded asynchronous workers", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const result = await runPreflightAsync("evm", { runProcess });
    expect(result.path).toBe("evm");
    expect(result.tools.map((tool) => tool.command)).toEqual(["node", "forge", "cast"]);
    expect(result.tools[0]).toMatchObject({ name: "Node.js", ok: true, required: true, version: process.version });
    expect(result.ok).toBe(true);
    expect(runProcess).toHaveBeenCalledTimes(2);
    expect(runProcess.mock.calls.some(([options]) => options.command.toLowerCase() === "cmd.exe")).toBe(false);
    for (const [options] of runProcess.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ timeoutMs: 5_000, maxOutputBytes: 65_536 }));
    }
  });

  it("uses the packaged Node identity without invoking a global Node command", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const result = await runPreflightAsync("evm", { runProcess, nodeVersion: "v24.18.0" });
    expect(result.tools.find((tool) => tool.command === "node")).toMatchObject({ ok: true, version: "v24.18.0" });
    expect(runProcess.mock.calls.some(([options]) => logicalCommand(options) === "node")).toBe(false);
  });

  it("checks native DuskDS Forge tools and the pinned WASM target", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const readDuskForgeIdentity = vi.fn(async () => REVIEWED_FORGE_IDENTITY);
    const result = await runPreflightAsync("duskds", { runProcess, readDuskForgeIdentity });
    expect(result.path).toBe("duskds");
    expect(result.tools.map((tool) => tool.command)).toEqual(expect.arrayContaining(["git", "rustup", "rustc", "cargo", "dusk-forge", "cargo-install-receipt", "wasm-opt", "rusk-wallet"]));
    expect(result.tools.find((tool) => tool.name === "Rust 1.94.0 WASM target")?.ok).toBe(true);
    expect(result.tools.find((tool) => tool.name === "Rust 1.94.0 rust-src")?.ok).toBe(true);
    expect(result.tools.find((tool) => tool.name === "Dusk Forge Cargo receipt")).toMatchObject({
      ok: true,
      version: `dusk-forge-cli 0.1.0 @ ${DUSK_FORGE_REVISION}`
    });
    expect(readDuskForgeIdentity).toHaveBeenCalledOnce();
    expect(runProcess.mock.calls.some(([options]) => options.command === reviewedDuskForgeExecutable() && options.args[0] === "--version")).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("does not fail the whole native preflight for optional tools", async () => {
    const optional = new Set(["make", "wasm-pack", "wasm-tools", "jq", "wasm-opt", "rusk-wallet", "wsl.exe"]);
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => {
      const command = logicalCommand(options);
      if (options.command === "where.exe" || optional.has(command)) throw new Error("missing optional tool");
      return { stdout: successfulOutput(options), stderr: "", exitCode: 0 };
    });
    const result = await runPreflightAsync("duskds", { runProcess, readDuskForgeIdentity: async () => REVIEWED_FORGE_IDENTITY });
    const failedOptionalCommands = result.tools.filter((tool) => !tool.required && !tool.ok).map((tool) => tool.command);
    expect(failedOptionalCommands).toEqual(expect.arrayContaining(["make", "wasm-pack", "wasm-tools", "jq", "wasm-opt", "rusk-wallet"]));
    if (process.platform === "win32") expect(failedOptionalCommands).toContain("wsl.exe");
    expect(result.ok).toBe(true);
  });

  it("fails native preflight when the pinned WASM target is missing", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({
      stdout: options.args.includes("target") && options.args.includes("list") ? "x86_64-pc-windows-msvc\n" : successfulOutput(options),
      stderr: "",
      exitCode: 0
    }));
    const result = await runPreflightAsync("duskds", { runProcess, readDuskForgeIdentity: async () => REVIEWED_FORGE_IDENTITY });
    expect(result.tools.find((tool) => tool.name === "Rust 1.94.0 WASM target")?.ok).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("reports an incompatible Windows wasm-opt shim without executing it", async () => {
    if (process.platform !== "win32") return;
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({
      stdout: options.command === "where.exe" ? "C:\\tools\\wasm-opt\n" : successfulOutput(options),
      stderr: "",
      exitCode: 0
    }));
    const result = await runPreflightAsync("duskds", { runProcess, readDuskForgeIdentity: async () => REVIEWED_FORGE_IDENTITY });
    expect(result.tools.find((tool) => tool.command === "wasm-opt")).toMatchObject({ ok: false, required: true });
    const wasmOptExecutions = runProcess.mock.calls.filter(([options]) => logicalCommand(options) === "wasm-opt");
    expect(wasmOptExecutions).toHaveLength(0);
    expect(result.ok).toBe(false);
  });

  it("suppresses executable paths from the WSL presence checks", async () => {
    if (process.platform !== "win32") return;
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({
      stdout: successfulOutput(options),
      stderr: "",
      exitCode: 0
    }));
    await runPreflightAsync("duskds", {
      runProcess,
      readDuskForgeIdentity: async () => REVIEWED_FORGE_IDENTITY
    });
    const wslCall = runProcess.mock.calls.find(([options]) => options.command === "wsl.exe")?.[0];
    expect(wslCall?.args.join(" ")).toContain("command -v make >/dev/null");
    expect(wslCall?.args.join(" ")).toContain("command -v jq >/dev/null");
    expect(wslCall?.args.join(" ")).toContain("command -v wasm-opt >/dev/null");
    expect(wslCall?.args.join(" ")).toContain("dusk-forge-cli[[:space:]]+v?0\\.1\\.0");
  });

  it("fails closed when Cargo cannot bind Dusk Forge to the reviewed revision", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const result = await runPreflightAsync("duskds", {
      runProcess,
      readDuskForgeIdentity: async () => ({ ...REVIEWED_FORGE_IDENTITY, revision: "f".repeat(40) })
    });
    const identity = result.tools.find((tool) => tool.name === "Dusk Forge Cargo receipt");
    expect(identity).toMatchObject({
      ok: false,
      required: true,
      failureKind: "version-mismatch",
      installHint: `Reinstall the required package version and source revision with: ${DUSK_FORGE_INSTALL_COMMAND}`
    });
    expect(identity?.installHint).toContain(`--rev ${DUSK_FORGE_REVISION}`);
    expect(result.tools.find((tool) => tool.name === "Dusk Forge CLI")).toMatchObject({
      ok: false,
      required: true,
      failureKind: "version-mismatch"
    });
    expect(runProcess.mock.calls.some(([options]) => options.command === reviewedDuskForgeExecutable())).toBe(false);
    expect(result.ok).toBe(false);
  });

  it("parses only the exact Cargo install receipt and returns bounded Forge identity", () => {
    const raw = JSON.stringify({
      installs: {
        [`dusk-forge-cli 0.1.0 (git+https://github.com/dusk-network/forge?rev=${DUSK_FORGE_REVISION}#${DUSK_FORGE_REVISION})`]: {
          bins: ["dusk-forge"]
        }
      }
    });
    expect(parseDuskForgeCargoInstallMetadata(raw)).toEqual(REVIEWED_FORGE_IDENTITY);
    expect(() => parseDuskForgeCargoInstallMetadata(raw.replaceAll(DUSK_FORGE_REVISION, "f".repeat(40)))).toThrow(/reviewed package version and source revision/);
    expect(() => parseDuskForgeCargoInstallMetadata(raw.replace("dusk-forge-cli 0.1.0", "dusk-forge-cli 0.2.0"))).toThrow(/reviewed package version and source revision/);
  });
});
