import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createChildEnvironment } from "./childEnvironment";
import {
  assertReviewedDuskForgeIdentity,
  DUSK_FORGE_BINARY,
  DUSK_FORGE_INSTALL_COMMAND,
  DUSK_FORGE_PACKAGE_VERSION,
  DUSK_FORGE_REVISION,
  DUSKDS_RUST_TOOLCHAIN,
  readReviewedDuskForgeIdentity,
  resolveCargoHome,
  reviewedDuskForgeExecutable,
  type DuskForgeInstallIdentity
} from "./duskDsToolchainPolicy";
import { BoundedProcessError, runBoundedProcess } from "./runBoundedProcess";

export interface ToolCheck {
  name: string;
  command: string;
  args: string[];
  required: boolean;
  windowsDirect?: boolean;
  expectedOutputIncludes?: string;
  installHint?: string;
  checkKind?: "process" | "dusk-forge-identity";
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

const EVM_TOOLS: ToolCheck[] = [
  { name: "Foundry forge", command: "forge", args: ["--version"], required: true, installHint: "Install Foundry before building or testing Solidity projects." },
  { name: "Foundry cast", command: "cast", args: ["--version"], required: true, installHint: "Install Foundry cast for wallet import and chain checks." }
];

const DUSKDS_TOOLS: ToolCheck[] = [
  { name: "Git", command: "git", args: ["--version"], required: true, installHint: "Install Git so Cargo can fetch Dusk Forge and pinned Dusk dependencies when needed." },
  { name: "Rustup", command: "rustup", args: ["--version"], required: true, installHint: `Install rustup so Forge projects can use the reviewed Rust ${DUSKDS_RUST_TOOLCHAIN} toolchain.` },
  { name: "Rust compiler", command: "rustc", args: ["--version"], required: true, installHint: `Install Rust with rustup for Dusk Forge projects; the Studio pins generated starters to Rust ${DUSKDS_RUST_TOOLCHAIN} until newer stable link behavior is verified.` },
  { name: "Cargo", command: "cargo", args: ["--version"], required: true, installHint: "Cargo is required to build contract and data-driver WASM." },
  { name: "Dusk Forge Cargo receipt", command: "cargo-install-receipt", args: [], required: true, checkKind: "dusk-forge-identity", installHint: `Reinstall the required package version and source revision with: ${DUSK_FORGE_INSTALL_COMMAND}` },
  { name: "Dusk Forge CLI", command: DUSK_FORGE_BINARY, args: ["--version"], required: true, installHint: `Install the reviewed revision with: ${DUSK_FORGE_INSTALL_COMMAND}` },
  { name: `Rust ${DUSKDS_RUST_TOOLCHAIN} toolchain`, command: "rustup", args: ["run", DUSKDS_RUST_TOOLCHAIN, "rustc", "--version"], required: true, installHint: `Run rustup toolchain install ${DUSKDS_RUST_TOOLCHAIN} --component rust-src --target wasm32-unknown-unknown.` },
  { name: `Rust ${DUSKDS_RUST_TOOLCHAIN} WASM target`, command: "rustup", args: ["target", "list", "--installed", "--toolchain", DUSKDS_RUST_TOOLCHAIN], required: true, expectedOutputIncludes: "wasm32-unknown-unknown", installHint: `Run rustup target add wasm32-unknown-unknown --toolchain ${DUSKDS_RUST_TOOLCHAIN}.` },
  { name: `Rust ${DUSKDS_RUST_TOOLCHAIN} rust-src`, command: "rustup", args: ["component", "list", "--installed", "--toolchain", DUSKDS_RUST_TOOLCHAIN], required: true, expectedOutputIncludes: "rust-src", installHint: `Run rustup component add rust-src --toolchain ${DUSKDS_RUST_TOOLCHAIN}.` },
  { name: "Make", command: "make", args: ["--version"], required: false, installHint: "Optional for template Makefile shortcuts; Forge CLI can build without Make." },
  { name: "wasm-pack", command: "wasm-pack", args: ["--version"], required: false, installHint: "Optional for JS-facing WASM packaging outside the basic Forge build." },
  { name: "wasm-tools", command: "wasm-tools", args: ["--version"], required: false, installHint: "Optional for manual WASM inspection and advanced workflows." },
  { name: "jq", command: "jq", args: ["--version"], required: false, installHint: "Optional helper for shell scripts and metadata inspection." },
  { name: "wasm-opt", command: "wasm-opt", args: ["--version"], required: false, installHint: "Optional Binaryen optimizer. On Windows, prefer a native wasm-opt.exe; npm Binaryen shims can confuse Forge." },
  { name: "Rusk Wallet (deploy)", command: "rusk-wallet", args: ["--version"], required: false, installHint: "Required before native contract deployment; wallet signing stays manual in your terminal." }
];

function getToolAllowlist(path: PreflightPath): ToolCheck[] {
  if (path !== "duskds") {
    return [...EVM_TOOLS];
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
            "command -v make >/dev/null",
            "command -v jq >/dev/null",
            "command -v wasm-opt >/dev/null",
            "test -x \"${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}/bin/dusk-forge\"",
            `rustup run ${DUSKDS_RUST_TOOLCHAIN} rustc --version`,
            `rustup target list --installed --toolchain ${DUSKDS_RUST_TOOLCHAIN} | grep -q wasm32-unknown-unknown`,
            `grep -Eq "dusk-forge-cli[[:space:]]+v?${DUSK_FORGE_PACKAGE_VERSION.replaceAll(".", "\\.")}.*${DUSK_FORGE_REVISION}" "\${CARGO_INSTALL_ROOT:-\${CARGO_HOME:-$HOME/.cargo}}/.crates2.json"`,
            "\"${CARGO_INSTALL_ROOT:-${CARGO_HOME:-$HOME/.cargo}}/bin/dusk-forge\" --version"
          ].join("; ")
        ],
        required: false,
        windowsDirect: true,
        installHint: `Optional for VM-backed dusk-forge test on Windows; confirms Ubuntu-24.04 has Make, jq, wasm-opt, Dusk Forge ${DUSK_FORGE_PACKAGE_VERSION} at revision ${DUSK_FORGE_REVISION}, and Rust ${DUSKDS_RUST_TOOLCHAIN}.`
      }]
    : [];

  return [...DUSKDS_TOOLS, ...wslTools];
}

function pathAdditionsForTool(tool: ToolCheck): string[] {
  const home = homedir();
  const candidates: string[] = [];
  if (process.platform === "win32" && ["forge", "cast", "anvil", "chisel"].includes(tool.command)) {
    candidates.push(join(home, ".foundry", "bin"));
  }
  if (["cargo", "rustc", "rustup", "dusk-forge", "rusk-wallet", "wasm-pack", "wasm-tools"].includes(tool.command)) {
    candidates.push(join(resolveCargoHome(), "bin"));
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
    if (firstPath && !isNativeWindowsWasmOptPath(firstPath)) {
      return {
        name: tool.name,
        command: tool.command,
        required: true,
        ok: false,
        error: "Found an incompatible extensionless wasm-opt shim.",
        failureKind: "unsupported",
        installHint: "Remove the incompatible extensionless wasm-opt shim from PATH or replace it with a native Binaryen wasm-opt.exe, then rerun preflight."
      };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

export function isNativeWindowsWasmOptPath(value: string): boolean {
  return /\.exe$/i.test(value.trim());
}

async function checkToolAsync(tool: ToolCheck, runProcess: typeof runBoundedProcess): Promise<ToolResult> {
  if (tool.checkKind === "dusk-forge-identity") {
    throw new Error("Dusk Forge identity checks require the dedicated bounded receipt reader.");
  }
  const shimWarning = await checkWasmOptShimAsync(tool, runProcess);
  if (shimWarning) return shimWarning;
  const reviewedForgeExecutable = tool.command === DUSK_FORGE_BINARY ? reviewedDuskForgeExecutable() : undefined;
  const invocation = reviewedForgeExecutable
    ? { command: reviewedForgeExecutable, args: tool.args }
    : process.platform === "win32" && !tool.windowsDirect
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

async function checkDuskForgeIdentityAsync(
  tool: ToolCheck,
  readIdentity: () => Promise<DuskForgeInstallIdentity>
): Promise<ToolResult> {
  try {
    const identity = assertReviewedDuskForgeIdentity(await readIdentity());
    return {
      name: tool.name,
      command: tool.command,
      required: tool.required,
      ok: true,
      version: `${identity.package} ${identity.packageVersion} @ ${identity.revision}`,
      installHint: tool.installHint
    };
  } catch {
    return {
      name: tool.name,
      command: tool.command,
      required: tool.required,
      ok: false,
      error: "The Cargo install receipt did not match the required Dusk Forge package version and source revision.",
      failureKind: "version-mismatch",
      installHint: tool.installHint
    };
  }
}

export async function runPreflightAsync(
  path: PreflightPath = "evm",
  runtime: {
    runProcess?: typeof runBoundedProcess;
    nodeVersion?: string;
    readDuskForgeIdentity?: () => Promise<DuskForgeInstallIdentity>;
  } = {}
): Promise<{ ok: boolean; checkedAt: string; path: PreflightPath; tools: ToolResult[] }> {
  const tools: ToolResult[] = [{ name: "Node.js", command: "node", required: true, ok: true, version: runtime.nodeVersion?.trim() || process.version, installHint: "Node.js 24.18 or newer in the Node 24 release line is required to run Local Studio." }];
  const runProcess = runtime.runProcess ?? runBoundedProcess;
  const readDuskForgeIdentity = runtime.readDuskForgeIdentity ?? (() => readReviewedDuskForgeIdentity());
  let duskForgeIdentityVerified = path !== "duskds";
  for (const tool of getToolAllowlist(path)) {
    if (tool.checkKind === "dusk-forge-identity") {
      const result = await checkDuskForgeIdentityAsync(tool, readDuskForgeIdentity);
      duskForgeIdentityVerified = result.ok;
      tools.push(result);
    } else if (tool.command === DUSK_FORGE_BINARY && !duskForgeIdentityVerified) {
      tools.push({
        name: tool.name,
        command: tool.command,
        required: tool.required,
        ok: false,
        error: "Dusk Forge was not executed because its Cargo install receipt did not match the required package version and source revision.",
        failureKind: "version-mismatch",
        installHint: tool.installHint
      });
    } else {
      tools.push(await checkToolAsync(tool, runProcess));
    }
  }
  return { ok: tools.every((tool) => tool.ok || !tool.required), checkedAt: new Date().toISOString(), path, tools };
}
