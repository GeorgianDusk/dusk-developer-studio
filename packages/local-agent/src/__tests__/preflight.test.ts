import { describe, expect, it, vi } from "vitest";
import { runPreflightAsync } from "../commands/preflight";
import type { BoundedProcessOptions } from "../commands/runBoundedProcess";

function logicalCommand(options: BoundedProcessOptions): string {
  return options.command === "cmd.exe" ? options.args[3] : options.command;
}

function successfulOutput(options: BoundedProcessOptions): string {
  if (options.args.includes("target") && options.args.includes("list")) return "wasm32-unknown-unknown\n";
  if (options.args.includes("component") && options.args.includes("list")) return "rust-src\n";
  if (options.command === "where.exe") return "C:\\tools\\wasm-opt.exe\n";
  return "ok\n";
}

describe("path preflight", () => {
  it("runs the EVM allowlist through bounded asynchronous workers", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const result = await runPreflightAsync("evm", { runProcess });
    expect(result.path).toBe("evm");
    expect(result.tools.map((tool) => tool.command)).toEqual(["node", "pnpm", "forge", "cast"]);
    expect(result.tools[0]).toMatchObject({ name: "Node.js", ok: true, required: true, version: process.version });
    expect(result.tools.find((tool) => tool.command === "pnpm")?.required).toBe(false);
    expect(result.ok).toBe(true);
    expect(runProcess).toHaveBeenCalledTimes(3);
    for (const [options] of runProcess.mock.calls) {
      expect(options).toEqual(expect.objectContaining({ timeoutMs: 5_000, maxOutputBytes: 65_536 }));
    }
  });

  it("uses the packaged Node identity without invoking a global Node command", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const result = await runPreflightAsync("evm", { runProcess, bundledNodeVersion: "v24.11.0" });
    expect(result.tools.find((tool) => tool.command === "node")).toMatchObject({ ok: true, version: "v24.11.0" });
    expect(runProcess.mock.calls.some(([options]) => logicalCommand(options) === "node")).toBe(false);
  });

  it("checks native DuskDS Forge tools and the pinned WASM target", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({ stdout: successfulOutput(options), stderr: "", exitCode: 0 }));
    const result = await runPreflightAsync("duskds", { runProcess });
    expect(result.path).toBe("duskds");
    expect(result.tools.map((tool) => tool.command)).toEqual(expect.arrayContaining(["git", "rustup", "rustc", "cargo", "dusk-forge", "wasm-opt", "rusk-wallet"]));
    expect(result.tools.find((tool) => tool.name === "Rust 1.94.0 WASM target")?.ok).toBe(true);
    expect(result.tools.find((tool) => tool.name === "Rust 1.94.0 rust-src")?.ok).toBe(true);
    expect(result.ok).toBe(true);
  });

  it("does not fail the whole native preflight for optional tools", async () => {
    const optional = new Set(["pnpm", "make", "wasm-pack", "wasm-tools", "jq", "wasm-opt", "rusk-wallet", "wsl.exe"]);
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => {
      const command = logicalCommand(options);
      if (options.command === "where.exe" || optional.has(command)) throw new Error("missing optional tool");
      return { stdout: successfulOutput(options), stderr: "", exitCode: 0 };
    });
    const result = await runPreflightAsync("duskds", { runProcess });
    const failedOptionalCommands = result.tools.filter((tool) => !tool.required && !tool.ok).map((tool) => tool.command);
    expect(failedOptionalCommands).toEqual(expect.arrayContaining(["pnpm", "make", "wasm-pack", "wasm-tools", "jq", "wasm-opt", "rusk-wallet"]));
    if (process.platform === "win32") expect(failedOptionalCommands).toContain("wsl.exe");
    expect(result.ok).toBe(true);
  });

  it("fails native preflight when the pinned WASM target is missing", async () => {
    const runProcess = vi.fn(async (options: BoundedProcessOptions) => ({
      stdout: options.args.includes("target") && options.args.includes("list") ? "x86_64-pc-windows-msvc\n" : successfulOutput(options),
      stderr: "",
      exitCode: 0
    }));
    const result = await runPreflightAsync("duskds", { runProcess });
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
    const result = await runPreflightAsync("duskds", { runProcess });
    expect(result.tools.find((tool) => tool.command === "wasm-opt")).toMatchObject({ ok: false, required: false });
    const wasmOptExecutions = runProcess.mock.calls.filter(([options]) => logicalCommand(options) === "wasm-opt");
    expect(wasmOptExecutions).toHaveLength(0);
  });
});
