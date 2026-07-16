import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createChildEnvironment } from "./childEnvironment";
import { BoundedProcessError, runBoundedProcess } from "./runBoundedProcess";

export interface ToolCheck {
  name: string;
  command: string;
  args: string[];
  required: boolean;
  windowsDirect?: boolean;
  expectedOutputIncludes?: string;
  installHint?: string;
}

export type ToolFailureKind = "missing" | "unsupported" | "timeout" | "version-mismatch" | "execution-failed";

export interface ToolResult {
  name: string;
  command: string;
  ok: boolean;
  required: boolean;
  version?: string;
  error?: string;
  failureKind?: ToolFailureKind;
  installHint?: string;
}

export type PreflightPath = "evm" | "duskds";

const COMMON_TOOLS: ToolCheck[] = [
  { name: "pnpm", command: "pnpm", args: ["--version"], required: false, installHint: "Optional for source-checkout package scripts; portable Studio releases include their own runtime." }
];

const EVM_TOOLS: ToolCheck[] = [
  { name: "Foundry forge", command: "forge", args: ["--version"], required: true, installHint: "Install Foundry before building or testing Solidity projects." },
  { name: "Foundry cast", command: "cast", args: ["--version"], required: true, installHint: "Install Foundry cast for wallet import and chain checks." }
];

const DUSKDS_TOOLS: ToolCheck[] = [
  { name: "Git", command: "git", args: ["--version"], required: true, installHint: "Install Git so Cargo can fetch Dusk Forge and pinned Dusk dependencies when needed." },
  { name: "Rustup", command: "rustup", args: ["--version"], required: true, installHint: "Install rustup so Forge projects can use the verified Rust 1.94.0 toolchain." },
  { name: "Rust compiler", command: "rustc", args: ["--version"], required: true, installHint: "Install Rust with rustup for Dusk Forge projects; the Studio pins generated starters to Rust 1.94.0 until newer stable link behavior is verified." },
  { name: "Cargo", command: "cargo", args: ["--version"], required: true, installHint: "Cargo is required to build contract and data-driver WASM." },
  { name: "Dusk Forge CLI", command: "dusk-forge", args: ["--version"], required: true, installHint: "Install with: cargo install --git https://github.com/dusk-network/forge dusk-forge-cli" },
  { name: "Rust 1.94.0 toolchain", command: "rustup", args: ["run", "1.94.0", "rustc", "--version"], required: true, installHint: "Run rustup toolchain install 1.94.0 --component rust-src --target wasm32-unknown-unknown." },
  { name: "Rust 1.94.0 WASM target", command: "rustup", args: ["target", "list", "--installed", "--toolchain", "1.94.0"], required: true, expectedOutputIncludes: "wasm32-unknown-unknown", installHint: "Run rustup target add wasm32-unknown-unknown --toolchain 1.94.0." },
  { name: "Rust 1.94.0 rust-src", command: "rustup", args: ["component", "list", "--installed", "--toolchain", "1.94.0"], required: true, expectedOutputIncludes: "rust-src", installHint: "Run rustup component add rust-src --toolchain 1.94.0." },
  { name: "Make", command: "make", args: ["--version"], required: false, installHint: "Optional for template Makefile shortcuts; Forge CLI can build without Make." },
  { name: "wasm-pack", command: "wasm-pack", args: ["--version"], required: false, installHint: "Optional for JS-facing WASM packaging outside the basic Forge build." },
  { name: "wasm-tools", command: "wasm-tools", args: ["--version"], required: false, installHint: "Optional for manual WASM inspection and advanced workflows." },
  { name: "jq", command: "jq", args: ["--version"], required: false, installHint: "Optional helper for shell scripts and metadata inspection." },
  { name: "wasm-opt", command: "wasm-opt", args: ["--version"], required: false, installHint: "Optional Binaryen optimizer. On Windows, prefer a native wasm-opt.exe; npm Binaryen shims can confuse Forge." },
  { name: "Rusk Wallet (deploy)", command: "rusk-wallet", args: ["--version"], required: false, installHint: "Required before native contract deployment; keep signing manual in the public preview." }
];

function getToolAllowlist(path: PreflightPath): ToolCheck[] {
  if (path !== "duskds") {
    return [...COMMON_TOOLS, ...EVM_TOOLS];
  }

  const wslTools: ToolCheck[] = process.platform === "win32"
    ? [{
        name: "WSL Ubuntu DuskDS test runner",
        command: "wsl.exe",
        args: [
          "-d",
          "Ubuntu-24.04",
          "--",
          "bash",
          "-lc",
          [
            "set -e",
            "command -v make",
            "command -v jq",
            "command -v wasm-opt",
            "command -v dusk-forge",
            "rustup run 1.94.0 rustc --version",
            "rustup target list --installed --toolchain 1.94.0 | grep -q wasm32-unknown-unknown",
            "dusk-forge --version"
          ].join("; ")
        ],
        required: false,
        windowsDirect: true,
        installHint: "Optional for VM-backed dusk-forge test on Windows; confirms Ubuntu-24.04 has Make, jq, wasm-opt, Dusk Forge, and Rust 1.94.0."
      }]
    : [];

  return [...COMMON_TOOLS, ...DUSKDS_TOOLS, ...wslTools];
}

function pathAdditionsForTool(tool: ToolCheck): string[] {
  if (process.platform !== "win32") {
    return [];
  }

  const home = homedir();
  const candidates: string[] = [];
  if (["forge", "cast", "anvil", "chisel"].includes(tool.command)) {
    candidates.push(join(home, ".foundry", "bin"));
  }
  if (["cargo", "rustc", "rustup", "dusk-forge", "rusk-wallet", "wasm-pack", "wasm-tools"].includes(tool.command)) {
    candidates.push(join(home, ".cargo", "bin"));
  }

  return candidates.filter((candidate) => existsSync(candidate));
}

function envForTool(tool: ToolCheck): NodeJS.ProcessEnv {
  const additions = pathAdditionsForTool(tool);
  return createChildEnvironment(process.env, { pathAdditions: additions });
}

async function checkWasmOptShimAsync(tool: ToolCheck, runProcess: typeof runBoundedProcess): Promise<ToolResult | undefined> {
  if (tool.command !== "wasm-opt" || process.platform !== "win32") return undefined;
  try {
    const located = await runProcess({ command: "where.exe", args: ["wasm-opt"], timeoutMs: 5_000, maxOutputBytes: 16_384 });
    const firstPath = located.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)[0];
    if (firstPath && !/\.(exe|cmd)$/i.test(firstPath)) {
      return {
        name: tool.name,
        command: tool.command,
        required: tool.required,
        ok: false,
        error: "Found an incompatible extensionless wasm-opt shim.",
        failureKind: "unsupported",
        installHint: tool.installHint
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function checkToolAsync(tool: ToolCheck, runProcess: typeof runBoundedProcess): Promise<ToolResult> {
  const shimWarning = await checkWasmOptShimAsync(tool, runProcess);
  if (shimWarning) return shimWarning;
  const invocation = process.platform === "win32" && !tool.windowsDirect
    ? { command: "cmd.exe", args: ["/d", "/s", "/c", tool.command, ...tool.args] }
    : { command: tool.command, args: tool.args };
  try {
    const result = await runProcess({
      ...invocation,
      env: envForTool(tool),
      timeoutMs: tool.windowsDirect ? 10_000 : 5_000,
      maxOutputBytes: 65_536
    });
    const output = (result.stdout || result.stderr).trim();
    if (tool.expectedOutputIncludes && !output.includes(tool.expectedOutputIncludes)) {
      return {
        name: tool.name,
        command: tool.command,
        required: tool.required,
        ok: false,
        error: `Expected ${tool.expectedOutputIncludes} in installed targets.`,
        failureKind: "version-mismatch",
        installHint: tool.installHint
      };
    }
    return { name: tool.name, command: tool.command, required: tool.required, ok: true, version: output, installHint: tool.installHint };
  } catch (error) {
    const output = error instanceof BoundedProcessError ? `${error.stdout}\n${error.stderr}` : "";
    const failureKind: ToolFailureKind = error instanceof BoundedProcessError && error.reason === "timeout"
      ? "timeout"
      : error instanceof BoundedProcessError && (error.reason === "spawn" || /not recognized|not found|cannot find|no such file/i.test(output))
        ? "missing"
        : "execution-failed";
    return {
      name: tool.name,
      command: tool.command,
      required: tool.required,
      ok: false,
      error: "Tool check failed or exceeded its resource limit.",
      failureKind,
      installHint: tool.installHint
    };
  }
}

export async function runPreflightAsync(
  path: PreflightPath = "evm",
  runtime: { runProcess?: typeof runBoundedProcess; bundledNodeVersion?: string } = {}
): Promise<{ ok: boolean; checkedAt: string; path: PreflightPath; tools: ToolResult[] }> {
  const tools: ToolResult[] = [{ name: "Node.js", command: "node", required: true, ok: true, version: runtime.bundledNodeVersion?.trim() || process.version, installHint: "Included with the portable Studio runtime." }];
  const runProcess = runtime.runProcess ?? runBoundedProcess;
  for (const tool of getToolAllowlist(path)) tools.push(await checkToolAsync(tool, runProcess));
  return { ok: tools.every((tool) => tool.ok || !tool.required), checkedAt: new Date().toISOString(), path, tools };
}
